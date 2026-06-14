import React, { useState, useEffect } from 'react';
import type { Tab } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useStreak } from '../../contexts/StreakContext';
import { motion, AnimatePresence } from 'framer-motion';

interface AppLayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: React.ReactNode;
}

export default function AppLayout({ activeTab, onTabChange, children }: AppLayoutProps) {
  const { signOut } = useAuth();
  const { streakCount, streakAtRisk, mySnappedToday, partnerSnappedToday } = useStreak();
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [forceNav, setForceNav] = useState(false);
  const [hideNav, setHideNav] = useState(false);
  const [shrinkNav, setShrinkNav] = useState(false);
  const [isStealthActive, setIsStealthActive] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
  });

  useEffect(() => {
    const handleStealthChange = () => {
      setIsStealthActive(localStorage.getItem('aura_stealth_mode') === 'true');
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    const handleToggle = () => {
      setForceNav(v => !v);
      setHideNav(false);
    };
    const handleHide = () => {
      setHideNav(true);
      setForceNav(false);
    };
    const handleShow = () => {
      setHideNav(false);
      setForceNav(true);
    };
    const handleShrink = () => setShrinkNav(true);
    const handleExpand = () => setShrinkNav(false);
    
    window.addEventListener('resize', handleResize);
    document.addEventListener('toggle-nav', handleToggle);
    document.addEventListener('hide-global-nav', handleHide);
    document.addEventListener('show-global-nav', handleShow);
    document.addEventListener('shrink-global-nav', handleShrink);
    document.addEventListener('expand-global-nav', handleExpand);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('toggle-nav', handleToggle);
      document.removeEventListener('hide-global-nav', handleHide);
      document.removeEventListener('show-global-nav', handleShow);
      document.removeEventListener('shrink-global-nav', handleShrink);
      document.removeEventListener('expand-global-nav', handleExpand);
    };
  }, []);

  const changeTab = (t: Tab) => {
    onTabChange(t);
    setForceNav(false);
  };

  // ── Streak badge helpers ──────────────────────────────────────────────────
  const bothSnapped = mySnappedToday && partnerSnappedToday;
  const isAtRisk = streakAtRisk && streakCount > 0;
  const partnerWaitingForMe = isAtRisk && !mySnappedToday && partnerSnappedToday;

  const SidebarStreakBadge = () => {
    if (streakCount === 0 && !isAtRisk) return null;
    return (
      <AnimatePresence mode="wait">
        {isAtRisk ? (
          <motion.div
            key="risk"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative flex items-center gap-2 bg-orange-500/10 border border-orange-400/30 py-2 px-4 rounded-full w-fit overflow-visible"
            title={partnerWaitingForMe ? 'Snap now to save your streak!' : 'Waiting for partner to snap'}
          >
            {/* Pulsing ring when user needs to act */}
            {partnerWaitingForMe && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-orange-400/50"
                animate={{ scale: [1, 1.15, 1], opacity: [0.8, 0, 0.8] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              />
            )}
            <motion.span
              className="text-lg leading-none"
              animate={partnerWaitingForMe ? { rotate: [0, 180, 180, 0] } : {}}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 0.5 }}
              style={{ display: 'inline-block' }}
            >
              ⏳
            </motion.span>
            <div className="flex flex-col">
              <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-orange-300">
                {streakCount} Days
              </span>
              {partnerWaitingForMe && (
                <motion.span
                  className="font-sans text-[8px] font-black uppercase tracking-wider text-orange-400/70"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  Snap now!
                </motion.span>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="normal"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-3 bg-[var(--bg-secondary)] border border-white/5 py-2 px-4 rounded-full w-fit"
          >
            <motion.span
              className="text-lg leading-none"
              animate={bothSnapped ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 2 }}
              style={{ display: 'inline-block' }}
            >
              🔥
            </motion.span>
            <div className="flex flex-col">
              <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-[var(--gold)]">
                {streakCount} Days
              </span>
              {bothSnapped && (
                <span className="font-sans text-[8px] font-black uppercase tracking-wider text-primary/40">
                  Both Snapped ✓
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  if (isDesktop) {
    return (
      <div className={`fixed inset-0 bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden grid transition-all duration-300 ${isStealthActive ? 'grid-cols-1' : shrinkNav ? 'grid-cols-[64px_1fr]' : 'grid-cols-[240px_1fr]'}`}>
        {/* Sidebar Navigation */}
        {!isStealthActive && (
          <aside className={`h-full w-full bg-[var(--bg-primary)] flex flex-col py-12 gap-12 z-50 border-r border-white/10 overflow-y-auto scrollbar-hide transition-all duration-300 ${shrinkNav ? 'px-2 items-center' : 'px-6'}`}>
            <div className="flex items-center mb-8 shrink-0">
              {shrinkNav ? (
                <span className="text-xl font-serif italic text-[var(--gold)] tracking-widest text-center">A</span>
              ) : (
                <span className="text-3xl font-serif italic text-[var(--gold)] tracking-[0.2em]">AURA</span>
              )}
            </div>

            <nav className={`flex flex-col gap-8 flex-grow ${shrinkNav ? 'items-center w-full' : ''}`}>
              <button
                onClick={() => onTabChange('chat')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'chat' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Chat"
              >
                <span className="material-symbols-outlined text-2xl">chat_bubble</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Chat</span>}
              </button>
              <button
                onClick={() => onTabChange('stories')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'stories' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Stories"
              >
                <span className="material-symbols-outlined text-2xl">auto_stories</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Stories</span>}
              </button>

              <button
                onClick={() => onTabChange('memories')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'memories' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Memories"
              >
                <span className="material-symbols-outlined text-2xl">photo_library</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Memories</span>}
              </button>
              <button
                onClick={() => onTabChange('notes')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'notes' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Notes"
              >
                <span className="material-symbols-outlined text-2xl">sticky_note_2</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Notes</span>}
              </button>
              <button
                onClick={() => onTabChange('games')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'games' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Games"
              >
                <span className="material-symbols-outlined text-2xl">sports_esports</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Games</span>}
              </button>
              <button
                onClick={() => onTabChange('settings')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'settings' ? 'text-black bg-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Settings"
              >
                <span className="material-symbols-outlined text-2xl">settings</span>
                {!shrinkNav && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Settings</span>}
              </button>
            </nav>

            <div className={`mt-auto pt-6 flex flex-col gap-6 shrink-0 border-t border-white/5 ${shrinkNav ? 'items-center w-full' : ''}`}>
              {/* Streak Badge — reads from context */}
              {!shrinkNav && <SidebarStreakBadge />}
              {shrinkNav && (
                 <div className="flex flex-col items-center justify-center gap-1" title={`${streakCount} Days`}>
                    <span className="text-lg leading-none">🔥</span>
                    <span className="font-sans text-[8px] font-bold text-[var(--gold)]">{streakCount}</span>
                 </div>
              )}
              <button 
                onClick={signOut}
                className={`flex items-center gap-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] transition-colors ${shrinkNav ? 'justify-center w-10 h-10 px-0' : 'px-4 w-full'}`}
                title="Sign Out"
              >
                <span className="material-symbols-outlined text-xl">logout</span>
                {!shrinkNav && <span className="font-sans text-[10px] font-bold tracking-widest uppercase">Sign Out</span>}
              </button>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="relative h-full w-full overflow-hidden">
          {children}
        </main>
      </div>
    );
  }

  // Mobile Layout
  return (
    <div className="fixed inset-0 bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans flex flex-col overflow-hidden">
      {/* Main Content Area */}
      <main className="flex-1 w-full relative z-0 overflow-hidden">
        {children}
      </main>

      {/* Bottom Navigation Bar */}
      {!isStealthActive && (
        <nav className={`fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-8 pt-2 bg-[var(--bg-secondary)] backdrop-blur-2xl z-50 rounded-t-3xl border-t border-white/5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-transform duration-300 safe-bottom ${((activeTab === 'chat' || activeTab === 'memories' || activeTab === 'notes') && !forceNav) || hideNav ? 'translate-y-full' : 'translate-y-[1px]'}`}>
          {/* Chat */}
          <button
            onClick={() => changeTab('chat')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'chat' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'chat' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'chat' ? "'FILL' 1" : "" }}>chat_bubble</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Chat</span>
          </button>

          {/* Stories */}
          <button
            onClick={() => changeTab('stories')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'stories' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'stories' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'stories' ? "'FILL' 1" : "" }}>auto_stories</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Stories</span>
          </button>

          {/* Memories */}
          <button
            onClick={() => changeTab('memories')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'memories' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'memories' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'memories' ? "'FILL' 1" : "" }}>photo_library</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Memories</span>
          </button>

          {/* Notes */}
          <button
            onClick={() => changeTab('notes')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'notes' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'notes' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'notes' ? "'FILL' 1" : "" }}>sticky_note_2</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Notes</span>
          </button>

          {/* Games */}
          <button
            onClick={() => changeTab('games')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'games' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'games' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'games' ? "'FILL' 1" : "" }}>sports_esports</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Games</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => changeTab('settings')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'settings' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'settings' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'settings' ? "'FILL' 1" : "" }}>settings</span>
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Settings</span>
          </button>
        </nav>
      )}
    </div>
  );
}
