import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTabNotification } from './hooks/useTabNotification';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import type { Tab } from './types';
import { toast } from 'sonner';
import { realtimeHub } from './lib/realtimeHub';
import { MessageCircle } from 'lucide-react';
const ChatScreen = lazy(() => import('./components/chat/ChatScreen'));
const HomeScreen = lazy(() => import('./components/home/HomeScreen'));
const ReelsScreen = lazy(() => import('./components/reels/ReelsScreen'));
const ExploreScreen = lazy(() => import('./components/explore/ExploreScreen'));
const ProfileScreen = lazy(() => import('./components/profile/ProfileScreen'));
const StreakCelebration = lazy(() => import('./components/chat/StreakCelebration'));
const UploadReelScreen = lazy(() => import('./components/reels/UploadReelScreen'));
import AppLayout from './components/layout/AppLayout';
import { usePartner } from './hooks/usePartner';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { usePresenceChannel } from './hooks/usePresenceChannel';
import KeySetupModal from './components/auth/KeySetupModal'; 
import { initPushNotifications } from './lib/pushNotifications';
import { initNativePushNotifications, cleanupNativePushNotifications } from './lib/nativeNotifications';
import { Capacitor } from '@capacitor/core';
import { AppLockProvider, useAppLock } from './contexts/AppLockContext';
import AppLockModal from './components/auth/AppLockModal';
import ThemeProvider from './components/common/ThemeProvider';
import { App as CapacitorApp } from '@capacitor/app';
import { MediaFoldersProvider } from './contexts/MediaFoldersContext';
import { Toaster } from 'sonner';
import { CallProvider } from './contexts/CallContext';
import CallOverlay from './components/call/CallOverlay';
import { NotificationProvider } from './contexts/NotificationContext';
import { GarbageProvider } from './contexts/GarbageContext';
import { ChatSettingsProvider } from './contexts/ChatSettingsContext';
import { StreakProvider, useStreak } from './contexts/StreakContext';
import WhatsNewModal from './components/common/WhatsNewModal';

function InnerApp({ 
  session, 
  partner,
}: any) {
  const { isLocked, hasAppPin, isLoading } = useAppLock();
  const isLockedRef = useRef(isLocked);
  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  const { streakCount, showCelebration, setShowCelebration } = useStreak();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const isStealth = typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
    return isStealth ? 'explore' : 'home';
  });
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const activeTabRef = useRef<Tab>(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Listen for stealth mode changes to sync state
  useEffect(() => {
    const handleStealthChange = () => {
      const isStealth = localStorage.getItem('aura_stealth_mode') === 'true';
      if (isStealth) {
        setActiveTab('explore');
      }
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);
  
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

  // ── Global Tab Badge: runs on ALL pages, not just chat ──
  useTabNotification();

  // ── In-app toast + unread dot when new message arrives outside chat ──
  useEffect(() => {
    if (!session?.user?.id) return;
    const unsubscribe = realtimeHub.on('messages', (payload) => {
      if (payload.eventType !== 'INSERT') return;
      const row = payload.new as any;
      // Only care about messages received by us (not sent by us) & not reel uploads
      if (row.receiver_id !== session.user.id) return;
      if (row.is_reel_upload) return;
      // If user is already on chat tab — no toast/dot needed
      if (activeTabRef.current === 'chat') return;
      // If app is locked — do not show the toast notification (but still mark unread dot)
      if (isLockedRef.current) {
        setHasUnreadChat(true);
        return;
      }
      // Mark unread dot
      setHasUnreadChat(true);
      // Show toast at top-right
      toast.custom(
        (id) => (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'rgba(19,19,30,0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(201,169,110,0.25)',
              borderRadius: '16px',
              padding: '12px 16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
              minWidth: '240px',
              maxWidth: '320px',
              cursor: 'pointer',
            }}
            onClick={() => {
              toast.dismiss(id);
              setActiveTab('chat');
              setHasUnreadChat(false);
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--gold), var(--gold-deep))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 0 12px rgba(201,169,110,0.4)',
              }}
            >
              <MessageCircle size={18} color="#2a1e00" strokeWidth={2.5} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>New Message</p>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(240,237,232,0.6)', letterSpacing: '0.02em' }}>Tap to open chat →</p>
            </div>
          </div>
        ),
        {
          position: 'top-right',
          duration: 5000,
          className: 'aura-custom-toast-wrapper',
          style: {
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            padding: 0,
            width: 'auto',
          }
        }
      );
    });
    return () => unsubscribe();
  }, [session?.user?.id]);

  // Clear unread dot when user navigates to chat
  useEffect(() => {
    if (activeTab === 'chat') {
      setHasUnreadChat(false);
    }
  }, [activeTab]);

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

  const { encryptionStatus } = useAuth();

  // Handle push notification setup silently
  useEffect(() => {
    if (session?.user?.id && encryptionStatus === 'ready') {

      if (Capacitor.isNativePlatform()) {
        // ── NATIVE ANDROID: Use FCM via Capacitor ──
        // Delay by 3s so we don't add FCM init to the already-heavy startup
        // render cycle (Logcat showed 86 skipped frames on startup).
        const nativeTimer = setTimeout(() => {
          console.log('[FCM] 🚀 Native platform detected — initializing FCM push notifications');
          initNativePushNotifications(session.user.id);
        }, 3000);
        return () => {
          clearTimeout(nativeTimer);
          cleanupNativePushNotifications();
        };
      } else {
        // ── WEB BROWSER: Use existing VAPID / Service Worker system ──
        const setupPush = async (reason: string) => {
          console.log(`[🔔 NOTIF] 🚀 Push setup triggered — reason: ${reason}`);
          const result = await initPushNotifications(session.user.id);
          console.log(`[🔔 NOTIF] 📋 Push setup result: ${result ? 'SUCCESS ✅' : 'FAILED ❌'}`);
        };

        // Auto-setup initially (2s delay to let SW register first)
        const timer = setTimeout(() => setupPush('app-load (2s delay)'), 2000);

        // Listen for rotation events from main.tsx (SW subscription changed)
        const handleResubscribe = () => setupPush('push-resubscribe event');
        window.addEventListener('push-resubscribe', handleResubscribe);

        return () => {
          clearTimeout(timer);
          window.removeEventListener('push-resubscribe', handleResubscribe);
        };
      }
    }
  }, [session?.user?.id, encryptionStatus]);


  // Handle global tab switching
  useEffect(() => {
    const handleSwitchTab = (e: any) => {
      if (e.detail && typeof e.detail === 'string') {
        const isStealth = localStorage.getItem('aura_stealth_mode') === 'true';
        if (isLocked || isStealth) {
           // Prevent switching 
           return;
        }
        setActiveTab(e.detail as Tab);
      }
    };
    document.addEventListener('switch-tab', handleSwitchTab);
    return () => document.removeEventListener('switch-tab', handleSwitchTab);
  }, [isLocked]);

  // Listen for redirection to a new feature
  useEffect(() => {
    const handleRedirect = (e: any) => {
      if (e.detail && (e.detail.feature === 'rename-collections' || e.detail.feature === 'frequent-folders')) {
        setActiveTab('explore');
      } else if (e.detail && (e.detail.feature === 'save-to-folders' || e.detail.feature === 'retry-failed-message')) {
        setActiveTab('chat');
      }
    };
    window.addEventListener('open-whats-new-feature', handleRedirect);
    return () => window.removeEventListener('open-whats-new-feature', handleRedirect);
  }, []);

  const handleTabChangeWrapper = (tab: Tab) => {
    const isStealth = localStorage.getItem('aura_stealth_mode') === 'true';
    if (isLocked || isStealth) {
      return; 
    }
    setActiveTab(tab);
  };

  // If newly unlocked via modal, they probably want to go back to chat
  useEffect(() => {
    if (!isLocked && hasAppPin && activeTab === 'profile') {
       setActiveTab('chat');
    }
  }, [isLocked, hasAppPin]);

  // If we are still checking if the app should be locked, show a loading splash
  // instead of the main UI. This prevents the chat screen from flashing
  // (showing partner name/avatar) and auto-focusing its input before the lock screen appears.
  // IMPORTANT: This must be AFTER all hooks to avoid violating Rules of Hooks.
  if (isLoading) {
    const isStealth = typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center z-[100]">
        <div className="text-center">
          <h1
            className={isStealth 
              ? "font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse text-[var(--gold)]" 
              : "font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse"
            }
            style={isStealth ? undefined : {
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 50%, var(--gold) 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {isStealth ? 'NOTES' : 'AURA'}
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-primary/40 animate-pulse">
            {isStealth ? 'Loading notes...' : 'Securing app...'}
          </p>
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
      {!isLocked && <WhatsNewModal currentVersion="2.19.0" />}
      <AppLayout activeTab={activeTab} onTabChange={handleTabChangeWrapper} hasUnreadChat={hasUnreadChat}>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-background w-full h-full">
            <p className="text-primary/50 uppercase tracking-widest text-xs animate-pulse">Loading...</p>
          </div>
        }>
          {/* Soft Tab Switching: Screens remain mounted but hidden to preserve state */}
          <div className={activeTab === 'home' ? 'h-full w-full' : 'hidden'}>
            <HomeScreen onTabChange={handleTabChangeWrapper} partner={partnerWithPresence} />
          </div>
          <div className={activeTab === 'explore' ? 'h-full w-full' : 'hidden'}>
            <ExploreScreen />
          </div>
          <div className={activeTab === 'chat' ? 'h-full w-full' : 'hidden'}>
            <ChatScreen partner={partnerWithPresence} isActive={activeTab === 'chat' && !isLocked} />
          </div>
          <div className={activeTab === 'reels' ? 'h-full w-full' : 'hidden'}>
            <ReelsScreen isActive={activeTab === 'reels'} />
          </div>
          <div className={activeTab === 'profile' ? 'h-full w-full' : 'hidden'}>
            <ProfileScreen />
          </div>
          <div className={activeTab === 'upload-reel' ? 'h-full w-full' : 'hidden'}>
            <UploadReelScreen onBack={() => handleTabChangeWrapper('home')} />
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
      <CallOverlay />
      </div>
    </ThemeProvider>
  );
}

export default function App() {
  const { session, loading, user } = useAuth();
  const { partner } = usePartner();

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

  // ═══ Android WebView Fix: Restart hub when app comes back to foreground ═══
  // On Android, WebSockets silently drop when the app is minimized/backgrounded.
  // The Page Visibility API detects when we come back and forces a fresh reconnect.
  //
  // CRITICAL: Use `restart()` NOT `stop()` + `start()`.
  // `stop()` wipes the listeners[] array, so all hooks (useChat, etc.) become deaf.
  // `restart()` only tears down the channel, preserving all registered listeners.
  useEffect(() => {
    if (!user?.id || !partner?.id) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Always attempt a restart on foreground — even if isConnected() says true,
        // the socket may be stale/zombie on Android after backgrounding.
        realtimeHub.restart(user.id, partner.id);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let appStateListener: any;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          realtimeHub.restart(user.id, partner.id);
        }
      }).then(listener => {
        appStateListener = listener;
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (appStateListener) appStateListener.remove();
    };
  }, [user?.id, partner?.id]);


  // Loading state
  if (loading) {
    const isStealth = typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <h1
            className={isStealth 
              ? "font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse text-[var(--gold)]" 
              : "font-serif italic text-4xl font-semibold tracking-[0.2em] mb-2 animate-pulse"
            }
            style={isStealth ? undefined : {
              background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 50%, var(--gold) 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {isStealth ? 'NOTES' : 'AURA'}
          </h1>
          <p className="font-label text-[10px] uppercase tracking-[0.4em] text-primary/40 animate-pulse">
            {isStealth ? 'Loading notes...' : 'Welcome to Aura'}
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <>
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
        <LoginScreen onLogin={() => {}} />
      </>
    );
  }

  // Authenticated — show app wrapped in navigation layout
  return (
    <ChatSettingsProvider>
      <AppLockProvider>
        <GarbageProvider>
          <MediaFoldersProvider>
            <CallProvider>
              <NotificationProvider>
                <StreakProvider>
                  <InnerApp 
                    session={session} 
                    partner={partner} 
                  />
                </StreakProvider>
              </NotificationProvider>
            </CallProvider>
          </MediaFoldersProvider>
        </GarbageProvider>
      </AppLockProvider>
    </ChatSettingsProvider>
  );
}
