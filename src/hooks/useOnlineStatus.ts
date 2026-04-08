import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Online status is tracked via Supabase Realtime Presence (`usePresenceChannel`)
 * combined with regular DB updates for the `last_seen` timestamp.
 *
 *
 * - PIN entered successfully (encryptionStatus === 'ready')  → Online (Presence Track + DB Update)
 * - Signout / PIN re-locked                                  → Offline (Presence Untrack + DB Update)
 * - Tab hidden / phone sleep (visibilitychange + pagehide)   → Offline (Presence Untrack + Offline Beacon)
 * - Tab visible again (and unlocked)                         → Online (Presence Track + DB Update)
 * - Page unload (beforeunload)                               → Offline (Presence Untrack + Offline Beacon)
 *
 * Edge Function Smart-Skip threshold: 60 seconds.
 *
 * KEY FIX: fireOfflineBeacon now uses the user's JWT token (cached in a ref)
 * instead of the anon key. Previously, RLS blocked the update because
 * auth.uid() was NULL with the anon key, causing users to stay "Online" forever.
 */
export function useOnlineStatus(trackMyStatus: (userId: string, page?: string) => Promise<void>, untrackMyStatus: () => Promise<void>, currentPage?: string) {
  const { user, encryptionStatus } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refs so event listeners always have fresh values
  const userIdRef = useRef<string | null>(null);
  const isUnlockedRef = useRef<boolean>(false);
  const currentPageRef = useRef<string | undefined>(undefined);
  // Cache JWT token so it's available during sync unload events
  const jwtTokenRef = useRef<string | null>(null);

  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user]);
  useEffect(() => { isUnlockedRef.current = encryptionStatus === 'ready'; }, [encryptionStatus]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  // Keep JWT token ref fresh — runs on mount and whenever auth state changes
  useEffect(() => {
    const updateToken = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        jwtTokenRef.current = data.session?.access_token ?? null;
      } catch {
        jwtTokenRef.current = null;
      }
    };
    updateToken();

    // Listen for auth state changes (token refresh, sign-in, sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      jwtTokenRef.current = session?.access_token ?? null;
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Core DB update (async, for use when React is running) ─────────────────
  // KEY FIX: `last_seen` is ONLY updated when going offline.
  // When going online we intentionally skip it so that `last_seen` always
  // represents the last time the user was *seen going offline*, not the time
  // they came online. This prevents the "seen just now" bug where presence
  // sync lag causes the UI to fall back to formatLastSeen() and show the
  // login timestamp instead of "Online".
  const executeUpdate = async (userId: string, isOnline: boolean, page?: string) => {
    try {
      let statusMessage: string | null = null;
      if (isOnline) {
        if (page === 'chat') {
          statusMessage = 'Online';
        } else if (page) {
          statusMessage = `On ${page.charAt(0).toUpperCase() + page.slice(1)} page`;
        } else {
          statusMessage = 'Online';
        }
      }

      const update: Record<string, unknown> = {
        is_online: isOnline,
        status_message: statusMessage,
      };

      // Only stamp last_seen when going OFFLINE so formatLastSeen() always
      // reflects "last time seen offline", never the login time.
      if (!isOnline) {
        update.last_seen = new Date().toISOString();
      }

      await supabase.from('profiles').update(update).eq('id', userId);
    } catch (err) {
      console.error('Failed to update online status', err);
    }
  };

  // ── Fire-and-forget fetch (survives page unload + mobile app switch) ───────
  // CRITICAL: Uses cached JWT token, NOT the anon key.
  // The anon key caused auth.uid() to be NULL → RLS blocked the UPDATE silently.
  const fireOfflineBeacon = (uid: string) => {
    const url = `${(supabase as any).supabaseUrl}/rest/v1/profiles?id=eq.${uid}`;
    const apiKey = (supabase as any).supabaseKey;
    const jwt = jwtTokenRef.current;

    // If no JWT is available, we can't update (RLS will block). Skip silently.
    // The staleness check on the partner's side will handle this case.
    if (!jwt) return;

    const body = JSON.stringify({
      is_online: false,
      // Stamp last_seen on offline beacon too — this is an offline transition
      last_seen: new Date().toISOString(),
      status_message: null,
    });
    const fetchOpts: RequestInit = {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${jwt}`,
        'Prefer': 'return=minimal',
      },
      body,
      keepalive: true, // survives tab close on desktop
    };
    try { fetch(url, fetchOpts); } catch (_) { /* ignore */ }
  };

  // ── Unload listeners (mount once) ─────────────────────────────────────────
  useEffect(() => {
    // 1. beforeunload — works on desktop Chrome/Firefox when closing tab
    const handleBeforeUnload = () => {
      const uid = userIdRef.current;
      if (uid) fireOfflineBeacon(uid);
    };

    // 2. pagehide — MORE reliable on mobile than beforeunload.
    //    Fires when the page enters the bfcache or is truly unloaded.
    const handlePageHide = (_: PageTransitionEvent) => {
      const uid = userIdRef.current;
      if (uid) fireOfflineBeacon(uid);
    };

    // 3. visibilitychange — THE most reliable signal on Android.
    //    Fires when: phone locks, user switches apps, tab goes to background.
    let visibilityTimeout: ReturnType<typeof setTimeout>;
    const handleVisibilityChange = () => {
      const uid = userIdRef.current;
      if (!uid) return;
      
      if (visibilityTimeout) clearTimeout(visibilityTimeout);
      
      if (document.visibilityState === 'hidden') {
        untrackMyStatus();
        visibilityTimeout = setTimeout(() => {
           fireOfflineBeacon(uid);
        }, 1000);
      } else if (document.visibilityState === 'visible') {
        // Prevent race condition where React state hasn't updated yet
        // and add a larger debounce so rapid app-switching doesn't hammer the DB
        visibilityTimeout = setTimeout(() => {
          if (isUnlockedRef.current && userIdRef.current) {
            trackMyStatus(userIdRef.current, currentPageRef.current);
            executeUpdate(userIdRef.current, true, currentPageRef.current);
          }
        }, 2000); // 2000ms delay to ensure state settles and prevent thrashing
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Untrack cleanly on component unmount
      untrackMyStatus();
    };
  }, [trackMyStatus, untrackMyStatus]); // mount and bind to functions

  // ── React to PIN unlock / lock state ──────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const isUnlocked = encryptionStatus === 'ready';

    // Debounce to avoid rapid state thrashing
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (isUnlocked) {
        trackMyStatus(user.id, currentPage);
      } else {
        untrackMyStatus();
      }
      executeUpdate(user.id, isUnlocked, currentPage);
    }, 300);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [user?.id, encryptionStatus, currentPage, trackMyStatus, untrackMyStatus]);
}
