import React, { useState, useEffect } from 'react';
import type { Tab } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

interface AppLayoutProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  streakCount: number;
  children: React.ReactNode;
}

export default function AppLayout({ activeTab, onTabChange, streakCount, children }: AppLayoutProps) {
  const { signOut } = useAuth();
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [forceNav, setForceNav] = useState(false);
  const [hideNav, setHideNav] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    const handleToggle = () => setForceNav(v => !v);
    const handleHide = () => setHideNav(true);
    const handleShow = () => setHideNav(false);
    
    window.addEventListener('resize', handleResize);
    document.addEventListener('toggle-nav', handleToggle);
    document.addEventListener('hide-global-nav', handleHide);
    document.addEventListener('show-global-nav', handleShow);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('toggle-nav', handleToggle);
      document.removeEventListener('hide-global-nav', handleHide);
      document.removeEventListener('show-global-nav', handleShow);
    };
  }, []);

  const changeTab = (t: Tab) => {
    onTabChange(t);
    setForceNav(false);
  };

  if (isDesktop) {
    return (
      <div className="fixed inset-0 bg-[#0d0d15] text-[#e4e1ed] font-sans overflow-hidden grid grid-cols-[240px_1fr]">
        {/* Sidebar Navigation */}
        <aside className="h-full w-full bg-[#0d0d15] flex flex-col py-12 px-6 gap-12 z-50 border-r border-white/10 overflow-y-auto scrollbar-hide">
          <div className="flex items-center mb-8 shrink-0">
            <span className="text-3xl font-serif italic text-[#e6c487] tracking-[0.2em]">AURA</span>
          </div>

          <nav className="flex flex-col gap-8 flex-grow">
            <button
              onClick={() => onTabChange('chat')}
              className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 px-4 rounded-full group ${activeTab === 'chat' ? 'text-[#412d00] bg-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e4e1ed]'}`}
            >
              <span className="material-symbols-outlined text-2xl">chat_bubble</span>
              <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Chat</span>
            </button>
            <button
              onClick={() => onTabChange('stories')}
              className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 px-4 rounded-full group ${activeTab === 'stories' ? 'text-[#412d00] bg-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e4e1ed]'}`}
            >
              <span className="material-symbols-outlined text-2xl">auto_stories</span>
              <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Stories</span>
            </button>
            <button
              onClick={() => onTabChange('location')}
              className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 px-4 rounded-full group ${activeTab === 'location' ? 'text-[#412d00] bg-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e4e1ed]'}`}
            >
              <span className="material-symbols-outlined text-2xl">location_on</span>
              <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Location</span>
            </button>
            <button
              onClick={() => onTabChange('memories')}
              className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 px-4 rounded-full group ${activeTab === 'memories' ? 'text-[#412d00] bg-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e4e1ed]'}`}
            >
              <span className="material-symbols-outlined text-2xl">photo_library</span>
              <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Memories</span>
            </button>
            <button
              onClick={() => onTabChange('settings')}
              className={`flex items-center gap-4 font-medium transition-all duration-300 py-3 px-4 rounded-full group ${activeTab === 'settings' ? 'text-[#412d00] bg-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e4e1ed]'}`}
            >
              <span className="material-symbols-outlined text-2xl">settings</span>
              <span className="font-sans text-[11px] font-bold tracking-[0.15em] uppercase">Settings</span>
            </button>
          </nav>

          <div className="mt-auto pt-6 flex flex-col gap-6 shrink-0 border-t border-white/5">
            <div className="flex items-center gap-3 bg-[#1b1b23]/80 border border-white/5 py-2 px-4 rounded-full w-fit">
              <span className="text-lg">🔥</span>
              <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-[#e6c487]">{streakCount} Days</span>
            </div>
            <button 
              onClick={signOut}
              className="flex items-center gap-4 text-[#998f81]/60 hover:text-[#e4e1ed] px-4 transition-colors w-full"
            >
              <span className="material-symbols-outlined text-xl">logout</span>
              <span className="font-sans text-[10px] font-bold tracking-widest uppercase">Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="relative h-full w-full overflow-hidden">
          {children}
        </main>
      </div>
    );
  }

  // Mobile Layout
  return (
    <div className="fixed inset-0 bg-[#0d0d15] text-[#e4e1ed] font-sans flex flex-col overflow-hidden">
      {/* Main Content Area */}
      <main className="flex-1 w-full relative z-0 overflow-hidden">
        {children}
      </main>

      {/* Bottom Navigation Bar */}
      <nav className={`fixed bottom-0 left-0 w-full flex justify-around items-center px-4 pb-8 pt-2 bg-[#13131b]/80 backdrop-blur-2xl z-50 rounded-t-3xl border-t border-white/5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-transform duration-300 ${(activeTab === 'chat' && !forceNav) || hideNav ? 'translate-y-full' : 'translate-y-0'}`}>
        {/* Chat */}
        <button
          onClick={() => changeTab('chat')}
          className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'chat' ? 'text-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e6c487]'}`}
        >
          <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'chat' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'chat' ? "'FILL' 1" : "" }}>chat_bubble</span>
          <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Chat</span>
        </button>

        {/* Stories */}
        <button
          onClick={() => changeTab('stories')}
          className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'stories' ? 'text-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e6c487]'}`}
        >
          <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'stories' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'stories' ? "'FILL' 1" : "" }}>auto_stories</span>
          <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Stories</span>
        </button>

        {/* Location */}
        <button
          onClick={() => changeTab('location')}
          className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'location' ? 'text-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e6c487]'}`}
        >
          <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'location' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'location' ? "'FILL' 1" : "" }}>location_on</span>
          <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Location</span>
        </button>

        {/* Memories */}
        <button
          onClick={() => changeTab('memories')}
          className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'memories' ? 'text-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e6c487]'}`}
        >
          <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'memories' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'memories' ? "'FILL' 1" : "" }}>photo_library</span>
          <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Memories</span>
        </button>

        {/* Settings */}
        <button
          onClick={() => changeTab('settings')}
          className={`flex flex-col items-center justify-center p-3 transition-all duration-300 active:scale-90 ${activeTab === 'settings' ? 'text-[#e6c487]' : 'text-[#998f81]/60 hover:text-[#e6c487]'}`}
        >
          <span className={`material-symbols-outlined text-3xl mb-1 ${activeTab === 'settings' ? 'fill-current' : ''}`} style={{ fontVariationSettings: activeTab === 'settings' ? "'FILL' 1" : "" }}>settings</span>
          <span className="font-sans text-[9px] uppercase tracking-[0.1em] font-bold">Settings</span>
        </button>
      </nav>
    </div>
  );
}
