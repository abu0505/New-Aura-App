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
import { useOnlineStatus } from './hooks/useOnlineStatus';
import KeySetupModal from './components/auth/KeySetupModal'; 
import { initPushNotifications } from './lib/pushNotifications';
import { AppLockProvider, useAppLock } from './contexts/AppLockContext';
import AppLockModal from './components/auth/AppLockModal';

function InnerApp({ 
  session, 
  partner, 
  streakCount, 
  showCelebration, 
  setShowCelebration 
}: any) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  useOnlineStatus(activeTab);
  const { isLocked, hasAppPin } = useAppLock();
  const [showLockModal, setShowLockModal] = useState(false);
  const { encryptionStatus } = useAuth();

  // Initial Lock Modal State - show it once on load if locked
  useEffect(() => {
    if (isLocked) {
      setShowLockModal(true);
    }
  }, [isLocked]);

  // Tab Enforcement
  useEffect(() => {
    if (isLocked && activeTab !== 'settings') {
      setActiveTab('settings');
    }
  }, [isLocked, activeTab]);

  // Handle push notification setup silently
  useEffect(() => {
    if (session?.user?.id && encryptionStatus === 'ready') {
      const setupPush = async () => {
        await initPushNotifications(session.user.id);
      };
      const timer = setTimeout(setupPush, 2000);
      return () => clearTimeout(timer);
    }
  }, [session?.user?.id, encryptionStatus]);

  // Handle global tab switching
  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      if (e.detail && typeof e.detail === 'string') {
        if (isLocked && e.detail !== 'settings') {
           // Prevent switching 
           return;
        }
        setActiveTab(e.detail as Tab);
      }
    };
    document.addEventListener('switch-tab', handleSwitchTab);
    return () => document.removeEventListener('switch-tab', handleSwitchTab);
  }, [isLocked]);

  const handleTabChangeWrapper = (tab: Tab) => {
    if (isLocked && tab !== 'settings') {
      // Just briefly flash the lock modal again if they try to escape settings via navbar
      setShowLockModal(true);
      return; 
    }
    setActiveTab(tab);
  };

  // If newly unlocked via modal, they probably want to go back to chat
  useEffect(() => {
    if (!isLocked && hasAppPin && activeTab === 'settings') {
       setActiveTab('chat');
    }
  }, [isLocked, hasAppPin]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0d0d15]">
      {showLockModal && (
        <AppLockModal onCancel={() => setShowLockModal(false)} />
      )}
      <KeySetupModal />
      <AppLayout activeTab={activeTab} onTabChange={handleTabChangeWrapper} streakCount={streakCount}>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-[#0d0d15] w-full h-full">
            <p className="text-[#C9A96E]/50 uppercase tracking-widest text-xs animate-pulse">Loading...</p>
          </div>
        }>
          {/* Soft Tab Switching: Screens remain mounted but hidden to preserve state */}
          <div className={activeTab === 'chat' ? 'h-full w-full' : 'hidden'}>
            <ChatScreen partner={partner} />
          </div>
          <div className={activeTab === 'stories' ? 'h-full w-full' : 'hidden'}>
            <StoriesScreen partner={partner} />
          </div>
          <div className={activeTab === 'memories' ? 'h-full w-full' : 'hidden'}>
            <MemoriesScreen />
          </div>
          <div className={activeTab === 'location' ? 'h-full w-full' : 'hidden'}>
            <LiveLocationScreen partner={partner} />
          </div>
          <div className={activeTab === 'settings' ? 'h-full w-full' : 'hidden'}>
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

export default function App() {
  const { session, loading } = useAuth();
  const { partner } = usePartner();
  const { streakCount, showCelebration, setShowCelebration } = useStreaks();

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
    <AppLockProvider>
      <InnerApp 
        session={session} 
        partner={partner} 
        streakCount={streakCount} 
        showCelebration={showCelebration}
        setShowCelebration={setShowCelebration}
      />
    </AppLockProvider>
  );
}
