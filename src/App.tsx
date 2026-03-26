import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import type { Tab } from './types';
const ChatScreen = lazy(() => import('./components/chat/ChatScreen'));
const StoriesScreen = lazy(() => import('./components/stories/StoriesScreen'));
const LiveLocationScreen = lazy(() => import('./components/location/LiveLocationScreen'));
const StreakCelebration = lazy(() => import('./components/chat/StreakCelebration'));
const SettingsScreen = lazy(() => import('./components/settings/SettingsScreen'));
const MemoriesScreen = lazy(() => import('./components/memories/MemoriesScreen'));
import AppLayout from './components/layout/AppLayout';
import { useStreaks } from './hooks/useStreaks';
import { usePartner } from './hooks/usePartner';
import KeySetupModal from './components/auth/KeySetupModal'; 
import { subscribeToPushNotifications, requestNotificationPermission } from './lib/pushNotifications';

export default function App() {
  const { session, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const { partner } = usePartner();
  const { streakCount, showCelebration, setShowCelebration } = useStreaks();

  // Handle push notification setup
  useEffect(() => {
    if (session?.user?.id) {
      const setupPush = async () => {
        const granted = await requestNotificationPermission();
        if (granted) {
          await subscribeToPushNotifications(session.user.id);
        }
      };
      // Delay slightly to ensure service worker is ready from main.tsx registration
      const timer = setTimeout(setupPush, 2000);
      return () => clearTimeout(timer);
    }
  }, [session?.user?.id]);

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
  if (loading) {
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
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-[#0d0d15] w-full h-full">
            <p className="text-[#C9A96E]/50 uppercase tracking-widest text-xs animate-pulse">Loading...</p>
          </div>
        }>
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
          <div className={activeTab === 'location' ? 'h-full w-full block' : 'hidden'}>
            <LiveLocationScreen partner={partner} />
          </div>
          <div className={activeTab === 'settings' ? 'h-full w-full block' : 'hidden'}>
            <SettingsScreen />
          </div>
        </Suspense>
      </AppLayout>

      {/* Streak Milestone Overlay */}
      <Suspense fallback={null}>
        <StreakCelebration 
          streakCount={streakCount}
          isOpen={showCelebration}
          onClose={() => setShowCelebration(false)}
        />
      </Suspense>
    </div>
  );
}
