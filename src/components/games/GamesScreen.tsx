import { useState } from 'react';
import { motion } from 'framer-motion';
// Game Components
import WhoIsTheSpy from './WhoIsTheSpy';

type GameMode = 'hub' | 'who-is-the-spy';

export default function GamesScreen() {
  const [viewMode, setViewMode] = useState<GameMode>('hub');

  if (viewMode === 'who-is-the-spy') {
    return <WhoIsTheSpy onBack={() => setViewMode('hub')} />;
  }

  return (
    <div className="w-full h-full bg-[var(--bg-primary)] flex flex-col font-sans overflow-hidden relative">
      {/* Header */}
      <header className="px-6 pt-6 pb-4 flex flex-col gap-2 border-b border-white/5 bg-black/20 shrink-0 safe-top">
        <div className="flex items-center gap-3">
          <button
            onClick={() => document.dispatchEvent(new CustomEvent('toggle-nav'))}
            className="p-2 -ml-2 rounded-full lg:hidden text-[#998f81] hover:text-[var(--gold)] hover:bg-white/5 active:scale-90 transition-all flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
          <div>
            <h1 className="font-serif italic text-2xl text-[var(--gold)]">Aura Arcade</h1>
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-[#998f81]">Play together, laugh together, test your bonds</p>
          </div>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
        <div className="max-w-4xl mx-auto flex flex-col gap-8">
          <div className="text-center md:text-left py-4">
            <h2 className="text-lg font-bold text-white/90 mb-1">Choose a game to play</h2>
            <p className="text-sm text-[#998f81]">Select from casual multiplayer games to play with your partner and AI companions.</p>
          </div>

          {/* Games Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* GAME 1: WHO IS THE SPY */}
            <motion.div
              whileHover={{ y: -4, scale: 1.01 }}
              className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col justify-between transition-all duration-300 relative overflow-hidden group shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            >
              {/* Subtle background glow */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--gold)]/10 rounded-full blur-3xl group-hover:bg-[var(--gold)]/20 transition-all duration-500" />
              
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--gold)]/15 border border-[var(--gold)]/25 flex items-center justify-center text-[var(--gold)]">
                    <span className="material-symbols-outlined text-2xl">visibility_off</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold tracking-widest text-[var(--gold)] uppercase bg-[var(--gold)]/10 px-2 py-0.5 rounded">Active</span>
                    <h3 className="text-lg font-bold text-white/95 mt-1">Who is the Spy? (Undercover)</h3>
                  </div>
                </div>
                
                <p className="text-sm text-[#998f81] leading-relaxed mb-6">
                  You, your partner, and 2 AI players get secret words. One is the spy with a different word, one is Mr. White with no word. Give clever clues, banter in Hinglish, and vote out the imposter!
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 mt-auto">
                <div className="text-xs text-[#998f81] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">groups</span>
                  <span>4 Players (2 Humans + 2 AI)</span>
                </div>
                
                <button
                  onClick={() => setViewMode('who-is-the-spy')}
                  className="px-5 py-2.5 rounded-xl bg-[var(--gold)] hover:bg-[var(--gold-light)] text-black font-semibold text-xs tracking-wider uppercase transition-all shadow-[0_4px_16px_rgba(212,175,55,0.2)] hover:shadow-[0_4px_20px_rgba(212,175,55,0.4)] active:scale-95"
                >
                  Play Now
                </button>
              </div>
            </motion.div>

            {/* GAME 2: DRAW & GUESS (Coming Soon) */}
            <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between opacity-50 relative overflow-hidden shadow-inner cursor-not-allowed">
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/40">
                    <span className="material-symbols-outlined text-2xl">brush</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold tracking-widest text-[#998f81] uppercase bg-white/5 px-2 py-0.5 rounded">Coming Soon</span>
                    <h3 className="text-lg font-bold text-white/60 mt-1">Draw & Guess</h3>
                  </div>
                </div>
                
                <p className="text-sm text-[#998f81]/70 leading-relaxed mb-6">
                  One person draws a word on a shared digital canvas while the other player guesses it in real-time. Fun, doodles, and hilarious fails await!
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 mt-auto">
                <div className="text-xs text-[#998f81]/60 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">edit</span>
                  <span>2 Players (Co-op)</span>
                </div>
                
                <button
                  disabled
                  className="px-5 py-2.5 rounded-xl bg-white/5 text-white/40 font-semibold text-xs tracking-wider uppercase"
                >
                  Locked
                </button>
              </div>
            </div>

            {/* GAME 3: TIC-TAC-TOE BANTER (Coming Soon) */}
            <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 flex flex-col justify-between opacity-50 relative overflow-hidden shadow-inner cursor-not-allowed">
              <div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/40">
                    <span className="material-symbols-outlined text-2xl">grid_3x3</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold tracking-widest text-[#998f81] uppercase bg-white/5 px-2 py-0.5 rounded">Coming Soon</span>
                    <h3 className="text-lg font-bold text-white/60 mt-1">Tic-Tac-Toe Banter</h3>
                  </div>
                </div>
                
                <p className="text-sm text-[#998f81]/70 leading-relaxed mb-6">
                  The classic game of X and O, but every move generates sarcastic Hinglish commentary from AI commentators roasting your strategic choices.
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 mt-auto">
                <div className="text-xs text-[#998f81]/60 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">person</span>
                  <span>1 vs 1 (Partner or Bot)</span>
                </div>
                
                <button
                  disabled
                  className="px-5 py-2.5 rounded-xl bg-white/5 text-white/40 font-semibold text-xs tracking-wider uppercase"
                >
                  Locked
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
