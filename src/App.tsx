import { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import type { Tab } from './types';
import ChatScreen from './components/chat/ChatScreen';
import StoriesScreen from './components/stories/StoriesScreen';
import LiveLocationScreen from './components/location/LiveLocationScreen';
import StreakCelebration from './components/chat/StreakCelebration';
import SettingsScreen from './components/settings/SettingsScreen';
import MemoriesScreen from './components/memories/MemoriesScreen';
import AppLayout from './components/layout/AppLayout';
import { useStreaks } from './hooks/useStreaks';
import { usePartner } from './hooks/usePartner';
import KeySetupModal from './components/auth/KeySetupModal'; // Added import

export default function App() {
  const { session, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const { partner, loading: partnerLoading } = usePartner();
  const { streakCount, showCelebration, setShowCelebration } = useStreaks();

  // Handle global tab switching
  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      if (e.detail && typeof e.detail === 'string') {
        setActiveTab(e.detail as Tab);
      }
    };
    document.addEventListener('switch-tab', handleSwitchTab);
    return () => document.removeEventListener('switch-tab', handleSwitchTab);
  }, []);

  // Loading state
  if (loading || partnerLoading) {
    return (
      <div className="fixed inset-0 bg-[#0d0d15] flex items-center justify-center">
        <div className="text-center">
          <h1
            className="font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse"
            style={{
              background: 'linear-gradient(135deg, #C9A96E 0%, #E2CA9A 50%, #C9A96E 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AURA
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-[#e6c487]/40">Your Sanctuary Awaits</p>
        </div>
      </div>
    );
  }

  // Not authenticated — show login
  if (!session) {
    return <LoginScreen onLogin={() => {}} />;
  }

  // Authenticated — show app wrapped in navigation layout
  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0d0d15]">
      <KeySetupModal />
      <AppLayout activeTab={activeTab} onTabChange={setActiveTab} streakCount={streakCount}>
        {/* Soft Tab Switching: Screens remain mounted but hidden to preserve state */}
        <div className={activeTab === 'chat' ? 'h-full w-full block' : 'hidden'}>
          <ChatScreen partner={partner} />
        </div>
        <div className={activeTab === 'stories' ? 'h-full w-full block' : 'hidden'}>
          <StoriesScreen partner={partner} />
        </div>
        <div className={activeTab === 'memories' ? 'h-full w-full block' : 'hidden'}>
          <MemoriesScreen />
        </div>
        {activeTab === 'location' && <LiveLocationScreen partner={partner} />}
        {activeTab === 'settings' && <SettingsScreen />}
      </AppLayout>

      {/* Streak Milestone Overlay */}
      <StreakCelebration 
        streakCount={streakCount}
        isOpen={showCelebration}
        onClose={() => setShowCelebration(false)}
      />
    </div>
  );
}
