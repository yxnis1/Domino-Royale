import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { nanoid } from 'nanoid';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import cookie from 'cookie';

// Constants and Initialization
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'domino-royale-secret';

// Initialize Firebase Admin (Optional, since we can use Client SDK on frontend and just use Backend for Bot logic)
// But for security/authoritative game state, admin is useful.
const firebaseConfig = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));

// If you have service account key, better, but let's try to use default or just bypass Admin if not strictly needed.
// For now, I'll initialize with application default or projectId if possible.
try {
    admin.initializeApp({
        projectId: firebaseConfig.projectId,
    });
} catch (e) {
    console.error('Firebase Admin init failed', e);
}

// Discord Bot
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ]
});

if (process.env.DISCORD_BOT_TOKEN) {
  bot.login(process.env.DISCORD_BOT_TOKEN).catch(console.error);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(cookieParser());

// Game State Storage (In-memory for low-latency, persisted periodically or on game over to Firestore)
const games = new Map<string, any>(); // teamCode -> gameData

// Discord OAuth URLs
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = `${APP_URL}/auth/callback`;

app.get('/api/auth/url', (req, res) => {
  const origin = req.query.origin as string || APP_URL;
  const state = Buffer.from(origin).toString('base64');
  const redirectUri = `${origin}/auth/callback`;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email guilds.join',
    state: state
  });
  res.json({ url: `https://discord.com/api/oauth2/authorize?${params}` });
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const origin = state ? Buffer.from(state as string, 'base64').toString() : APP_URL;
  const redirectUri = `${origin}/auth/callback`;

  if (!code) {
      return res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', message: 'No authorization code received from Discord.' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
  }

  try {
    const response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: DISCORD_CLIENT_ID!,
      client_secret: DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: redirectUri,
    }));

    const { access_token } = response.data;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const discordUser = userRes.data;

    // Optional: Force join server
    if (process.env.DISCORD_GUILD_ID) {
        try {
            await axios.put(`https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUser.id}`, 
            { access_token },
            { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } });
        } catch (err: any) {
            console.error('Failed to auto-join guild', err.response?.data || err.message);
        }
    }

    const token = jwt.sign({
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar,
      email: discordUser.email
    }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('auth_token', token, { 
      httpOnly: true, 
      secure: true, 
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/dashboard';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error('Discord OAuth Error', err.response?.data || err.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/user/me', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Socket.IO Game Logic
io.on('connection', (socket) => {
  // Try to get token from socket.auth or from cookies
  let token = socket.handshake.auth?.token;
  
  if (!token && socket.handshake.headers.cookie) {
    const cookies = cookie.parse(socket.handshake.headers.cookie);
    token = cookies.auth_token;
  }

  let user: any = null;
  if (token) {
    try { 
      user = jwt.verify(token, JWT_SECRET); 
    } catch (e) {
      console.error('Socket Auth Error', e);
    }
  }

  socket.on('create-game', async () => {
    if (!user) {
      socket.emit('error', 'Authentication required to create game');
      return;
    }
    const teamCode = nanoid(6).toUpperCase();
    const gameId = nanoid();
    
    // Create voice channel
    let voiceChannelId = null;
    if (bot.isReady() && process.env.DISCORD_GUILD_ID) {
        try {
            const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
            const channel = await guild.channels.create({
                name: `🎮 game-${user.username}`,
                type: ChannelType.GuildVoice,
                parent: process.env.DISCORD_VOICE_CATEGORY_ID || null,
                permissionOverwrites: [
                   { id: guild.id, deny: [PermissionsBitField.Flags.Connect] }
                ]
            });
            voiceChannelId = channel.id;
        } catch (err) {
            console.error('Discord Channel Creation Failed', err);
        }
    }

    const gameData = {
      id: gameId,
      teamCode,
      hostId: user.id,
      players: [{ ...user, socketId: socket.id }],
      status: 'waiting',
      voiceChannelId,
      gameState: null
    };
    games.set(teamCode, gameData);
    socket.join(teamCode);
    socket.emit('game-created', gameData);
  });

  socket.on('join-game', (teamCode) => {
    if (!user) return;
    const game = games.get(teamCode);
    if (game && game.status === 'waiting' && game.players.length < 4) {
      game.players.push({ ...user, socketId: socket.id });
      socket.join(teamCode);
      io.to(teamCode).emit('player-joined', game);
      
      // Bot behavior: attempt to move user if they are in voice
      if (bot.isReady() && game.voiceChannelId && process.env.DISCORD_GUILD_ID) {
          // Send info to client to let them handle the move link if automated move fails
          socket.emit('voice-ready', { channelId: game.voiceChannelId, guildId: process.env.DISCORD_GUILD_ID });
      }
    } else {
      socket.emit('error', 'Game not found or full');
    }
  });

  socket.on('start-game', (teamCode) => {
    const game = games.get(teamCode);
    if (game && game.hostId === user.id) {
      game.status = 'playing';
      game.gameState = initializeDominoGame(game.players);
      io.to(teamCode).emit('game-started', game);
    }
  });

  socket.on('play-tile', ({ teamCode, piece, position }) => {
    const game = games.get(teamCode);
    if (!game || game.status !== 'playing') return;
    // Simple logic update
    const result = handleMove(game.gameState, user.id, piece, position);
    if (result.success) {
        io.to(teamCode).emit('game-updated', game);
        if (result.winner) {
            game.status = 'finished';
            io.to(teamCode).emit('game-over', { winner: result.winner });
        }
    } else {
        socket.emit('error', result.message);
    }
  });

  socket.on('disconnect', () => {
    // Cleanup lobbies? Maybe timeout them.
  });
});

function initializeDominoGame(players: any[]) {
    const allPieces = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            allPieces.push([i, j]);
        }
    }
    // Shuffle
    for (let i = allPieces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPieces[i], allPieces[j]] = [allPieces[j], allPieces[i]];
    }

    const playerStates = players.map(p => ({
        id: p.id,
        username: p.username,
        hand: allPieces.splice(0, 7)
    }));

    return {
        pieces: playerStates,
        board: [],
        currentTurn: players[0].id,
        deck: allPieces
    };
}

function handleMove(state: any, playerId: string, piece: number[], position: 'start' | 'end') {
    if (state.currentTurn !== playerId) return { success: false, message: 'Not your turn' };
    
    const pIdx = state.pieces.findIndex((p: any) => p.id === playerId);
    const hand = state.pieces[pIdx].hand;
    const pieceIdx = hand.findIndex((p: number[]) => p[0] === piece[0] && p[1] === piece[1]);
    
    if (pieceIdx === -1) return { success: false, message: 'Piece not in hand' };

    // Board logic
    if (state.board.length === 0) {
        state.board.push(piece);
        hand.splice(pieceIdx, 1);
    } else {
        const leftSide = state.board[0][0];
        const rightSide = state.board[state.board.length - 1][1];
        
        let played = false;
        let finalPiece = [...piece];

        if (position === 'start') {
            if (finalPiece[1] === leftSide) {
                state.board.unshift(finalPiece);
                played = true;
            } else if (finalPiece[0] === leftSide) {
                state.board.unshift([finalPiece[1], finalPiece[0]]);
                played = true;
            }
        } else {
            if (finalPiece[0] === rightSide) {
                state.board.push(finalPiece);
                played = true;
            } else if (finalPiece[1] === rightSide) {
                state.board.push([finalPiece[1], finalPiece[0]]);
                played = true;
            }
        }

        if (!played) return { success: false, message: 'Invalid move' };
        hand.splice(pieceIdx, 1);
    }

    // Next turn
    const currentIdx = state.pieces.findIndex((p: any) => p.id === state.currentTurn);
    state.currentTurn = state.pieces[(currentIdx + 1) % state.pieces.length].id;

    if (hand.length === 0) return { success: true, winner: playerId };
    return { success: true };
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
