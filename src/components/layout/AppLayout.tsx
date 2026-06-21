import React, { useState, useEffect } from 'react';
import type { Tab } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useStreak } from '../../contexts/StreakContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Search, MessageCircle, User, LogOut } from 'lucide-react';
import { ReelsIcon } from '../common/CustomIcons';

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
    setHideNav(false);
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

  const [isHovered, setIsHovered] = useState(false);
  const isSidebarShrunk = shrinkNav && !isHovered;

  if (isDesktop) {
    return (
      <div className={`fixed inset-0 bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden grid transition-all duration-300 ${isStealthActive ? 'grid-cols-1' : isSidebarShrunk ? 'grid-cols-[72px_minmax(0,_1fr)]' : 'grid-cols-[240px_minmax(0,_1fr)]'}`}>
        {/* Sidebar Navigation */}
        {!isStealthActive && (
          <aside 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`h-full w-full bg-[var(--bg-primary)] flex flex-col py-12 gap-12 z-50 border-r border-white/10 overflow-y-auto scrollbar-hide transition-all duration-300 ${isSidebarShrunk ? 'px-2 items-center' : 'px-6'}`}
          >
            <div className="flex items-center mb-8 shrink-0">
              {isSidebarShrunk ? (
                <span className="text-xl font-serif italic text-[var(--gold)] tracking-widest text-center w-full">A</span>
              ) : (
                <span className="text-3xl font-serif italic text-[var(--gold)] tracking-[0.2em]">AURA</span>
              )}
            </div>

            <nav className={`flex flex-col gap-8 flex-grow ${isSidebarShrunk ? 'items-center w-full' : ''}`}>
              <button
                onClick={() => onTabChange('home')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'home' ? 'text-black bg-[var(--gold)] shadow-lg shadow-[var(--gold)]/10' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Home"
              >
                <Home className={`w-5 h-5 transition-all duration-300 group-hover:scale-110 ${activeTab === 'home' ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                {!isSidebarShrunk && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Home</span>}
              </button>
              <button
                onClick={() => onTabChange('explore')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'explore' ? 'text-black bg-[var(--gold)] shadow-lg shadow-[var(--gold)]/10' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Search"
              >
                <Search className={`w-5 h-5 transition-all duration-300 group-hover:scale-110 ${activeTab === 'explore' ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                {!isSidebarShrunk && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Search</span>}
              </button>
              <button
                onClick={() => onTabChange('chat')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'chat' ? 'text-black bg-[var(--gold)] shadow-lg shadow-[var(--gold)]/10' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Chat"
              >
                <MessageCircle className={`w-5 h-5 transition-all duration-300 group-hover:scale-110 ${activeTab === 'chat' ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                {!isSidebarShrunk && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Chat</span>}
              </button>
              <button
                onClick={() => onTabChange('reels')}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'reels' ? 'text-black bg-[var(--gold)] shadow-lg shadow-[var(--gold)]/10' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Reels"
              >
                <ReelsIcon className={`w-5 h-5 transition-all duration-300 group-hover:scale-110 ${activeTab === 'reels' ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                {!isSidebarShrunk && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Reels</span>}
              </button>
              <button
                onClick={() => {
                  onTabChange('profile');
                  document.dispatchEvent(new CustomEvent('view-my-profile'));
                }}
                className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 rounded-full group ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4'} ${activeTab === 'profile' ? 'text-black bg-[var(--gold)] shadow-lg shadow-[var(--gold)]/10' : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)]'}`}
                title="Profile"
              >
                <User className={`w-5 h-5 transition-all duration-300 group-hover:scale-110 ${activeTab === 'profile' ? 'stroke-[2.5px]' : 'stroke-[1.75px]'}`} />
                {!isSidebarShrunk && <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Profile</span>}
              </button>
            </nav>

            <div className={`mt-auto pt-6 flex flex-col gap-6 shrink-0 border-t border-white/5 ${isSidebarShrunk ? 'items-center w-full' : ''}`}>
              {/* Streak Badge — reads from context */}
              {!isSidebarShrunk && <SidebarStreakBadge />}
              {isSidebarShrunk && (
                 <div className="flex flex-col items-center justify-center gap-1" title={`${streakCount} Days`}>
                    <span className="text-lg leading-none">🔥</span>
                    <span className="font-sans text-[8px] font-bold text-[var(--gold)]">{streakCount}</span>
                 </div>
              )}
            <button 
                onClick={signOut}
                className={`flex items-center gap-4 text-[var(--text-secondary)]/60 hover:text-[var(--text-primary)] transition-colors ${isSidebarShrunk ? 'justify-center w-10 h-10 px-0' : 'px-4 w-full'}`}
                title="Sign Out"
              >
                <LogOut className="w-5 h-5 transition-transform duration-300 group-hover:-translate-x-0.5" />
                {!isSidebarShrunk && <span className="font-sans text-[10px] font-bold tracking-widest uppercase">Sign Out</span>}
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
      <main className="flex-1 w-full relative z-0 min-h-0 overflow-hidden">
        {children}
      </main>
 
      {/* Bottom Navigation Bar */}
      {!isStealthActive && (
        <nav className={`fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-8 pt-2 bg-[var(--bg-secondary)] backdrop-blur-2xl z-50 rounded-t-3xl border-t border-white/5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-transform duration-300 safe-bottom ${(activeTab === 'chat' && !forceNav) || hideNav ? 'translate-y-full' : 'translate-y-[1px]'}`}>
          {/* Home */}
          <button
            onClick={() => changeTab('home')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'home' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <Home className={`w-6 h-6 mb-1.5 transition-all duration-300 ${activeTab === 'home' ? 'stroke-[2.5px] fill-[var(--gold)]/10 text-[var(--gold)] scale-110' : 'stroke-[1.75px] text-[var(--text-secondary)]/60'}`} />
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Home</span>
          </button>
 
          {/* Explore */}
          <button
            onClick={() => changeTab('explore')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'explore' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <Search className={`w-6 h-6 mb-1.5 transition-all duration-300 ${activeTab === 'explore' ? 'stroke-[2.5px] fill-[var(--gold)]/10 text-[var(--gold)] scale-110' : 'stroke-[1.75px] text-[var(--text-secondary)]/60'}`} />
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Search</span>
          </button>
 
          {/* Chat */}
          <button
            onClick={() => changeTab('chat')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'chat' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <MessageCircle className={`w-6 h-6 mb-1.5 transition-all duration-300 ${activeTab === 'chat' ? 'stroke-[2.5px] fill-[var(--gold)]/10 text-[var(--gold)] scale-110' : 'stroke-[1.75px] text-[var(--text-secondary)]/60'}`} />
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Chat</span>
          </button>
 
          {/* Reels */}
          <button
            onClick={() => changeTab('reels')}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'reels' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <ReelsIcon className={`w-6 h-6 mb-1.5 transition-all duration-300 ${activeTab === 'reels' ? 'stroke-[2.5px] fill-[var(--gold)]/10 text-[var(--gold)] scale-110' : 'stroke-[1.75px] text-[var(--text-secondary)]/60'}`} />
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Reels</span>
          </button>
 
          {/* Profile */}
          <button
            onClick={() => {
              changeTab('profile');
              document.dispatchEvent(new CustomEvent('view-my-profile'));
            }}
            className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'profile' ? 'text-[var(--gold)]' : 'text-[var(--text-secondary)]/60 hover:text-[var(--gold)]'}`}
          >
            <User className={`w-6 h-6 mb-1.5 transition-all duration-300 ${activeTab === 'profile' ? 'stroke-[2.5px] fill-[var(--gold)]/10 text-[var(--gold)] scale-110' : 'stroke-[1.75px] text-[var(--text-secondary)]/60'}`} />
            <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Profile</span>
          </button>
        </nav>
      )}
    </div>
  );
}
