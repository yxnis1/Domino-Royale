import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Dices, 
  Gamepad2, 
  LogOut, 
  Users, 
  Plus, 
  Key, 
  Mic, 
  Volume2, 
  VolumeX,
  Trophy,
  ArrowRight
} from 'lucide-react';
import socket from './lib/socket';

// --- Types ---
interface User {
  id: string;
  username: string;
  avatar: string | null;
}

interface GameState {
  pieces: Array<{ id: string, username: string, hand: number[][] }>;
  board: number[][];
  currentTurn: string;
  deck: number[][];
}

interface Game {
  id: string;
  teamCode: string;
  hostId: string;
  players: any[];
  status: 'waiting' | 'playing' | 'finished';
  voiceChannelId: string | null;
  gameState: GameState | null;
}

// --- Components ---

const DominoPiece = ({ val, onClick, disabled }: { val: number[], onClick?: () => void, disabled?: boolean }) => {
  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.05, y: -5 } : {}}
      whileTap={!disabled ? { scale: 0.95 } : {}}
      onClick={onClick}
      disabled={disabled}
      className={`relative w-12 h-24 bg-white rounded-md flex flex-col items-center justify-between p-2 tile-shadow cursor-pointer border-2 border-neutral-200 ${disabled ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="grid grid-cols-2 gap-1 w-full">
         {Array.from({ length: val[0] }).map((_, i) => <div key={i} className="w-2 h-2 bg-neutral-900 rounded-full" />)}
      </div>
      <div className="h-[2px] w-full bg-neutral-300" />
      <div className="grid grid-cols-2 gap-1 w-full">
         {Array.from({ length: val[1] }).map((_, i) => <div key={i} className="w-2 h-2 bg-neutral-900 rounded-full" />)}
      </div>
    </motion.button>
  );
};

const DominoBoardPiece = ({ val }: any) => {
  return (
    <div className="flex flex-col items-center justify-center">
       <div className="w-10 h-20 bg-white rounded-sm flex flex-col items-center justify-between p-1 border border-neutral-300 shadow-sm">
          <div className="flex flex-wrap gap-0.5 justify-center">
             {Array.from({ length: val[0] }).map((_, i) => <div key={i} className="w-1.5 h-1.5 bg-neutral-900 rounded-full" />)}
          </div>
          <div className="w-full h-[1px] bg-neutral-200" />
          <div className="flex flex-wrap gap-0.5 justify-center">
             {Array.from({ length: val[1] }).map((_, i) => <div key={i} className="w-1.5 h-1.5 bg-neutral-900 rounded-full" />)}
          </div>
       </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [showWinner, setShowWinner] = useState<string | null>(null);

  useEffect(() => {
    checkUser();

    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data.type === 'OAUTH_AUTH_SUCCESS') {
        console.log('Login successful, fetching user...');
        // Small delay to ensure cookies are processed
        setTimeout(() => checkUser(), 500);
      } else if (event.data.type === 'OAUTH_AUTH_ERROR') {
        alert('Login failed: ' + event.data.message);
        setLoginLoading(false);
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    
    socket.on('game-created', (newGame) => setGame(newGame));
    socket.on('player-joined', (updatedGame) => setGame(updatedGame));
    socket.on('game-started', (startGame) => setGame(startGame));
    socket.on('game-updated', (updatedGame) => setGame(updatedGame));
    socket.on('game-over', ({ winner }) => {
      setShowWinner(winner);
      setTimeout(() => setShowWinner(null), 5000);
    });
    socket.on('error', (msg) => alert(msg));

    return () => {
      window.removeEventListener('message', handleOAuthMessage);
      socket.off('game-created');
      socket.off('player-joined');
      socket.off('game-started');
      socket.off('game-updated');
      socket.off('game-over');
      socket.off('error');
    };
  }, []);

  const checkUser = async () => {
    try {
      const res = await fetch('/api/user/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        socket.connect();
      }
    } catch (e) {
      console.error('Check User Error:', e);
    } finally {
      setLoading(false);
      setLoginLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const origin = window.location.origin;
      const res = await fetch(`/api/auth/url?origin=${encodeURIComponent(origin)}`);
      const { url } = await res.json();
      window.open(url, 'discord_auth', 'width=600,height=800');
    } catch (e) {
      console.error('Login URL Error:', e);
      setLoginLoading(false);
      alert('Failed to initialize login. Please try again.');
    }
  };

  const createGame = () => socket.emit('create-game');
  const joinGame = () => {
      if (!joinCode) return;
      socket.emit('join-game', joinCode);
  };
  const startGame = () => {
      if (game) socket.emit('start-game', game.teamCode);
  };
  const playTile = (piece: number[], position: 'start' | 'end') => {
      if (game) socket.emit('play-tile', { teamCode: game.teamCode, piece, position });
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0F0F12]">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-[#5865F2]"
        >
          <div className="w-12 h-18 bg-[#5865F2] rounded-md shadow-[0_0_20px_rgba(88,101,242,0.5)]" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <div className="bg-pattern" />
      
      {/* Navigation */}
      <nav className="h-16 px-8 flex items-center justify-between bg-[#1A1A20] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3 text-lg font-extrabold tracking-tighter">
          <div className="w-6 h-9 bg-[#5865F2] rounded-sm" />
          DOMINONODES
        </div>
        {user && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-white/5 rounded-full border border-white/5">
            <span className="text-sm font-semibold">{user.username}</span>
            <div className="w-8 h-8 rounded-full bg-[#4752C4] border-2 border-[#23A559] overflow-hidden">
               {user.avatar && <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} alt="" className="w-full h-full object-cover" />}
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 grid grid-cols-[280px_1fr_300px] gap-6 p-6 overflow-hidden">
        {!user ? (
          <div className="col-span-3 flex flex-col items-center justify-center text-center space-y-8">
            <h1 className="text-6xl font-black tracking-tighter decoration-[#5865F2] underline underline-offset-8">WELCOME</h1>
            <p className="text-[#949BA4] max-w-sm">Connect with Discord to start high-stakes domino matches with your server mates.</p>
            <button
               onClick={handleLogin}
               disabled={loginLoading}
               className={`btn-sleek btn-primary-sleek px-12 py-4 text-lg ${loginLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
               {loginLoading ? 'CONNECTING...' : 'LOGIN WITH DISCORD'}
            </button>
          </div>
        ) : !game ? (
          <>
            {/* Sidebar Left */}
            <aside className="sidebar flex flex-col gap-6">
              <section className="glass-card">
                <span className="section-label">Session Control</span>
                <div className="flex flex-col gap-3">
                  <button onClick={createGame} className="btn-sleek btn-primary-sleek w-full">CREATE NEW ROOM</button>
                  <div className="pt-4 border-t border-white/5 space-y-2">
                     <span className="section-label py-0 mb-2" style={{ fontSize: '9px' }}>Join with code</span>
                     <input 
                       type="text" 
                       value={joinCode}
                       onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                       placeholder="CODE"
                       className="w-full bg-[#0F0F12] border border-white/10 rounded-xl px-4 py-3 text-center font-mono text-lg tracking-widest focus:ring-1 focus:ring-[#5865F2] outline-none"
                     />
                     <button onClick={joinGame} className="btn-sleek btn-outline-sleek w-full">JOIN SESSION</button>
                  </div>
                </div>
              </section>

              <section className="glass-card flex-1">
                 <span className="section-label">Active Modules</span>
                 <div className="space-y-4 opacity-50">
                    <div className="flex items-center gap-3">
                       <Mic size={16} />
                       <span className="text-sm">Voice Automation</span>
                    </div>
                    <div className="flex items-center gap-3">
                       <Users size={16} />
                       <span className="text-sm">Real-time Sync</span>
                    </div>
                 </div>
              </section>
            </aside>

            {/* Dashboard Content */}
            <section className="flex flex-col gap-6">
               <div className="flex justify-between items-end">
                  <div>
                    <h1 className="text-3xl font-bold">Discover Tables</h1>
                    <p className="text-[#949BA4]">Join active global lobbies or start your own.</p>
                  </div>
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div className="glass-card border-dashed border-[#5865F2]/30 flex flex-col items-center justify-center py-12 text-center space-y-4">
                     <Plus className="text-[#5865F2]" size={40} />
                     <p className="text-sm font-semibold">START A NEW MATCH</p>
                  </div>
                  <div className="glass-card opacity-50 flex items-center justify-center italic text-sm">
                     Searching for public matches...
                  </div>
               </div>
            </section>

            {/* Sidebar Right */}
            <aside className="sidebar">
              <section className="glass-card h-full">
                <span className="section-label">Player Stats</span>
                <div className="space-y-4">
                   <div className="p-4 bg-black/20 rounded-xl border-l-4 border-[#23A559]">
                      <div className="text-xs uppercase font-bold text-[#23A559]">Global Rank</div>
                      <div className="text-xl font-bold">LEGENDARY #42</div>
                   </div>
                   <div className="p-4 bg-black/20 rounded-xl border-l-4 border-[#5865F2]">
                      <div className="text-xs uppercase font-bold text-[#5865F2]">Matches Played</div>
                      <div className="text-xl font-bold">1,284</div>
                   </div>
                </div>
              </section>
            </aside>
          </>
        ) : game.status === 'waiting' ? (
          <div className="col-span-3 grid grid-cols-[1fr_360px] gap-8">
            <div className="flex flex-col gap-6">
               <div className="flex justify-between items-center">
                  <div>
                    <h1 className="text-2xl font-bold">Current Lobby</h1>
                    <p className="text-[#949BA4] text-sm">Waiting for players to ready up...</p>
                  </div>
                  <div className="text-right">
                     <span className="section-label mb-0">Lobby Code</span>
                     <div className="font-mono text-2xl font-bold text-[#5865F2]">{game.teamCode}</div>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-4 flex-1 content-start">
                  {game.players.map((p, idx) => (
                    <div key={idx} className="player-slot-sleek p-6 flex flex-col items-center justify-center gap-4 relative">
                       {game.voiceChannelId && <div className="absolute top-4 right-4 w-2 h-2 bg-[#23A559] rounded-full shadow-[0_0_8px_#23A559]" />}
                       <div className="w-16 h-16 rounded-full bg-[#1A1A20] border-2 border-[#5865F2] overflow-hidden">
                          {p.avatar && <img src={`https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png`} alt="" className="w-full h-full object-cover" />}
                       </div>
                       <div className="text-center">
                          <p className="font-bold">{p.username} {game.hostId === p.id && "(Host)"}</p>
                          <span className="text-[10px] text-[#23A559] font-bold uppercase tracking-wider">READY</span>
                       </div>
                    </div>
                  ))}
                  {Array.from({ length: 4 - game.players.length }).map((_, i) => (
                    <div key={i} className="player-slot-empty flex flex-col items-center justify-center gap-2 p-6 rounded-2xl">
                       <Plus size={24} className="text-white/20" />
                       <span className="text-xs text-[#949BA4]">Waiting...</span>
                    </div>
                  ))}
               </div>

               {game.hostId === user.id && (
                  <button 
                    disabled={game.players.length < 2}
                    onClick={startGame}
                    className="btn-sleek btn-primary-sleek py-5 text-lg"
                  >
                    START MATCH
                  </button>
               )}
            </div>

            <aside className="sidebar">
               <div className="glass-card flex flex-col h-full">
                  <span className="section-label">Lobby Info</span>
                  <div className="space-y-6 flex-1">
                     <div className="space-y-2">
                        <span className="text-[10px] text-[#949BA4] font-bold uppercase">Game Mode</span>
                        <div className="text-sm font-semibold flex items-center gap-2 text-white">
                           <Gamepad2 size={14} className="text-[#5865F2]" />
                           Traditional 4-Player
                        </div>
                     </div>
                     {game.voiceChannelId && (
                        <div className="bg-[#5865F2]/10 p-4 rounded-xl border border-[#5865F2]/20">
                           <div className="flex items-center gap-2 text-[#5865F2] font-bold text-xs mb-2">
                              <Volume2 size={14} /> VOICE ACTIVE
                           </div>
                           <p className="text-[10px] text-[#949BA4] mb-3">All players in this lobby are being moved to the Discord voice channel.</p>
                           <button className="btn-sleek btn-primary-sleek py-2 text-xs w-full">JOIN MANUALLY</button>
                        </div>
                     )}
                  </div>
                  <button onClick={() => setGame(null)} className="btn-sleek btn-outline-sleek text-xs">LEAVE LOBBY</button>
               </div>
            </aside>
          </div>
        ) : (
          <div className="col-span-3 flex flex-col game-view relative">
             {/* Board Area */}
             <div className="flex-1 domino-board relative flex items-center justify-center p-8">
                <div className="flex flex-wrap items-center justify-center gap-2 max-w-full">
                   {game.gameState?.board.map((tile, i) => (
                      <DominoBoardPiece key={i} val={tile} />
                   ))}
                   {game.gameState?.board.length === 0 && (
                      <div className="text-white/10 text-4xl font-black italic">PLACE FIRST TILE</div>
                   )}
                </div>

                <AnimatePresence>
                  {showWinner && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-md"
                    >
                       <div className="glass-card border-[#5865F2] p-12 text-center shadow-[0_0_50px_rgba(88,101,242,0.3)]">
                          <Trophy size={64} className="text-[#5865F2] mx-auto mb-4" />
                          <h2 className="text-[#5865F2] font-black uppercase tracking-widest text-sm">Match Victory</h2>
                          <h1 className="text-5xl font-black tracking-tighter">
                             {game.gameState?.pieces.find(p => p.id === showWinner)?.username}
                          </h1>
                       </div>
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>

             {/* Footer Area: Turn & Hand */}
             <div className="h-48 border-t border-white/10 bg-[#1A1A20] flex items-center px-12 gap-12 shrink-0">
                <div className="sidebar w-48 shrink-0">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#5865F2] border-2 border-[#23A559] overflow-hidden">
                        {user.avatar && <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} alt="" className="w-full h-full" />}
                      </div>
                      <div>
                        <p className="text-sm font-bold truncate">{user.username}</p>
                        <p className={`text-[10px] font-black uppercase ${game.gameState?.currentTurn === user.id ? 'text-[#23A559]' : 'text-[#949BA4]'}`}>
                           {game.gameState?.currentTurn === user.id ? "Your Turn" : "Waiting..."}
                        </p>
                      </div>
                   </div>
                </div>

                <div className="flex-1 flex justify-center gap-4 overflow-x-auto py-4">
                   {game.gameState?.pieces.find(p => p.id === user.id)?.hand.map((piece, i) => {
                      const isMyTurn = game.gameState?.currentTurn === user.id;
                      const canPlayStart = isMyTurn && (game.gameState!.board.length === 0 || piece[0] === game.gameState!.board[0][0] || piece[1] === game.gameState!.board[0][0]);
                      const canPlayEnd = isMyTurn && (game.gameState!.board.length === 0 || piece[0] === game.gameState!.board[game.gameState!.board.length - 1][1] || piece[1] === game.gameState!.board[game.gameState!.board.length - 1][1]);
                      
                      return (
                         <div key={i} className="group relative">
                            <DominoPiece val={piece} disabled={!isMyTurn} />
                            {isMyTurn && (canPlayStart || canPlayEnd) && (
                                <div className="absolute -top-10 left-0 right-0 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                   {canPlayStart && <button onClick={() => playTile(piece, 'start')} className="px-2 py-1 bg-[#5865F2] text-[8px] font-bold rounded">L</button>}
                                   {canPlayEnd && <button onClick={() => playTile(piece, 'end')} className="px-2 py-1 bg-[#5865F2] text-[8px] font-bold rounded">R</button>}
                                </div>
                            )}
                         </div>
                      );
                   })}
                </div>

                <div className="sidebar w-32 items-center justify-center shrink-0">
                   <span className="section-label mb-2">Deck size</span>
                   <div className="text-2xl font-black">{game.gameState?.deck.length}</div>
                </div>
             </div>
          </div>
        )}
      </main>

      {/* Footer Status Bar */}
      <footer className="voice-status-bar shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Voice Connected</div>
          <span className="text-xs font-semibold">{game ? `🎮 game-session-${game.teamCode}` : "Idle"}</span>
        </div>
        <div className="flex gap-6 text-[10px] font-bold">
           <div className="flex items-center gap-2 opacity-70">
              <span className="uppercase">Latency</span>
              <span className="font-mono">24ms</span>
           </div>
           <div className="flex items-center gap-2 opacity-70">
              <span className="uppercase">Server</span>
              <span>EU-WEST</span>
           </div>
        </div>
      </footer>
    </div>
  );
}
