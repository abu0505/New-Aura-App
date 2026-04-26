import { useState, useEffect, useRef, lazy, Suspense } from 'react';
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
import { usePresenceChannel } from './hooks/usePresenceChannel';
import KeySetupModal from './components/auth/KeySetupModal'; 
import { initPushNotifications } from './lib/pushNotifications';
import { AppLockProvider, useAppLock } from './contexts/AppLockContext';
import AppLockModal from './components/auth/AppLockModal';
import { realtimeHub } from './lib/realtimeHub';
import ThemeProvider from './components/common/ThemeProvider';
import { MediaFoldersProvider } from './contexts/MediaFoldersContext';
import { Toaster } from 'sonner';

function InnerApp({ 
  session, 
  partner, 
  streakCount, 
  showCelebration, 
  setShowCelebration 
}: any) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  
  // ═══════════════════════════════════════════════════════════════════
  // ONLINE STATUS — WhatsApp Architecture
  // ═══════════════════════════════════════════════════════════════════
  //
  // 1. usePresenceChannel → raw WebSocket presence (sole authority)
  // 2. useOnlineStatus    → manages when to track/untrack + DB beacon
  // 3. Stability filter   → instant online, 10s debounced offline
  //
  // KEY RULE: DB `is_online` is NEVER used for display.
  //   Before presence syncs → show "Last seen" (from DB timestamp)
  //   After presence syncs  → show whatever presence says
  // This eliminates the stale-DB "Online flash" on page reload.
  // ═══════════════════════════════════════════════════════════════════

  const { trackMyStatus, untrackMyStatus, partnerPresence } = usePresenceChannel(partner?.id || null);
  useOnlineStatus(trackMyStatus, untrackMyStatus, activeTab);

  // ── Raw signal: NEVER fall back to DB is_online ──
  const rawIsOnline = partnerPresence.hasSynced ? partnerPresence.isOnline : false;

  // ── Stability filter ──
  // Absorbs ALL flicker from presence (sync races, reconnects, network blips).
  //   ONLINE  → shown INSTANTLY (zero delay)
  //   OFFLINE → confirmed after 10 seconds of no online signal
  const [stableOnline, setStableOnline] = useState(false);
  const stableOnlineRef = useRef(false);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captures the exact moment we detect partner going offline via presence.
  // Used instead of stale DB `last_seen` for "Last seen just now".
  const localLastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (rawIsOnline) {
      // ── GOING ONLINE: Instant ──
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      if (!stableOnlineRef.current) {
        stableOnlineRef.current = true;
        localLastSeenRef.current = null; // Reset — partner is online now
        setStableOnline(true);
      }
    } else {
      // ── GOING OFFLINE: Debounced 10 seconds ──
      if (stableOnlineRef.current && !offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          offlineTimerRef.current = null;
          stableOnlineRef.current = false;
          localLastSeenRef.current = new Date().toISOString(); // Capture exact offline moment
          setStableOnline(false);
        }, 10_000);
      }
    }
  }, [rawIsOnline, partnerPresence.hasSynced]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, []);

  // ── Merge into partner object for downstream components ──
  // `is_online` comes from stability filter (presence-only)
  // `last_seen` uses the more recent of: local capture vs DB value
  // This ensures "Last seen just now" when presence detects offline,
  // even if the DB beacon was from 17 minutes ago.
  const effectiveLastSeen = (() => {
    if (stableOnline) return partner?.last_seen ?? null;
    if (!localLastSeenRef.current) return partner?.last_seen ?? null;
    // Use whichever is more recent
    if (partner?.last_seen && new Date(partner.last_seen) > new Date(localLastSeenRef.current)) {
      return partner.last_seen;
    }
    return localLastSeenRef.current;
  })();

  const partnerWithPresence = partner ? { 
    ...partner, 
    is_online: stableOnline,
    last_seen: effectiveLastSeen,
  } : partner;

  const { isLocked, hasAppPin, isLoading } = useAppLock();
  const { encryptionStatus } = useAuth();

  // Handle push notification setup silently
  useEffect(() => {
    if (session?.user?.id && encryptionStatus === 'ready') {
      const setupPush = async () => {
        await initPushNotifications(session.user.id);
      };
      
      // Auto-setup initially
      const timer = setTimeout(setupPush, 2000);
      
      // Listen for rotation events from main.tsx
      const handleResubscribe = () => {
        setupPush();
      };
      window.addEventListener('push-resubscribe', handleResubscribe);
      
      return () => {
        clearTimeout(timer);
        window.removeEventListener('push-resubscribe', handleResubscribe);
      };
    }
  }, [session?.user?.id, encryptionStatus]);

  // Handle global tab switching
  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      if (e.detail && typeof e.detail === 'string') {
        if (isLocked) {
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
    if (isLocked) {
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

  // If we are still checking if the app should be locked, show a loading splash
  // instead of the main UI. This prevents the chat screen from flashing
  // (showing partner name/avatar) and auto-focusing its input before the lock screen appears.
  // IMPORTANT: This must be AFTER all hooks to avoid violating Rules of Hooks.
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center z-[100]">
        <div className="text-center">
          <h1
            className="font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse"
            style={{
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 50%, var(--gold) 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AURA
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-primary/40 animate-pulse">Securing sanctuary...</p>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <div className="relative h-[100dvh] w-full overflow-hidden bg-[var(--bg-primary)] transition-colors duration-500">
        <Toaster 
          position="bottom-right" 
          expand={false} 
          richColors 
          toastOptions={{
            style: {
              background: 'rgba(28, 28, 46, 0.95)',
              backdropFilter: 'blur(12px)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)',
              borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              marginBottom: '20px',
              marginRight: '20px',
            },
            className: 'aura-toast',
          }}
        />
        <AppLockModal />
      <KeySetupModal />
      <AppLayout activeTab={activeTab} onTabChange={handleTabChangeWrapper} streakCount={streakCount}>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-background w-full h-full">
            <p className="text-primary/50 uppercase tracking-widest text-xs animate-pulse">Loading...</p>
          </div>
        }>
          {/* Soft Tab Switching: Screens remain mounted but hidden to preserve state */}
          <div className={activeTab === 'chat' ? 'h-full w-full' : 'hidden'}>
            <ChatScreen partner={partnerWithPresence} isActive={activeTab === 'chat' && !isLocked} />
          </div>
          <div className={activeTab === 'stories' ? 'h-full w-full' : 'hidden'}>
            <StoriesScreen partner={partner} />
          </div>
          <div className={activeTab === 'memories' ? 'h-full w-full' : 'hidden'}>
            <MemoriesScreen />
          </div>
          <div className={activeTab === 'location' ? 'h-full w-full' : 'hidden'}>
            <LiveLocationScreen partner={partnerWithPresence} isActive={activeTab === 'location' && !isLocked} />
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
    </ThemeProvider>
  );
}

export default function App() {
  const { session, loading, user } = useAuth();
  const { partner } = usePartner();
  const { streakCount, showCelebration, setShowCelebration } = useStreaks();

  // ═══ Start RealtimeHub ONCE when user + partner are available ═══
  // This creates ONE shared Postgres Changes channel for the entire app,
  // replacing 6+ separate channels that each had their own WebSocket overhead.
  useEffect(() => {
    if (user?.id && partner?.id) {
      realtimeHub.start(user.id, partner.id);
    }
    return () => {
      realtimeHub.stop();
    };
  }, [user?.id, partner?.id]);

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <h1
            className="font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse"
            style={{
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 50%, var(--gold) 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AURA
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-primary/40">Your Sanctuary Awaits</p>
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
      <MediaFoldersProvider>
        <InnerApp 
          session={session} 
          partner={partner} 
          streakCount={streakCount} 
          showCelebration={showCelebration}
          setShowCelebration={setShowCelebration}
        />
      </MediaFoldersProvider>
    </AppLockProvider>
  );
}
