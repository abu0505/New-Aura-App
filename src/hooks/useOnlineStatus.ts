import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Online status is tied EXCLUSIVELY to PIN unlock state.
 *
 * - PIN entered successfully (encryptionStatus === 'ready')  → Online
 * - Signout / PIN re-locked                                  → Offline
 * - Tab hidden / phone sleep (visibilitychange + pagehide)   → Offline
 * - Tab visible again (and unlocked)                         → Online
 * - Page unload (beforeunload)                               → Offline
 *
 * Heartbeat: every 20 seconds while unlocked.
 * Edge Function Smart-Skip threshold: 30 seconds (matching heartbeat + buffer).
 *
 * KEY FIX: fireOfflineBeacon now uses the user's JWT token (cached in a ref)
 * instead of the anon key. Previously, RLS blocked the update because
 * auth.uid() was NULL with the anon key, causing users to stay "Online" forever.
 */
export function useOnlineStatus(currentPage?: string) {
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
      await supabase.from('profiles').update({
        is_online: isOnline,
        last_seen: new Date().toISOString(),
        status_message: statusMessage,
      }).eq('id', userId);
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
    const handleVisibilityChange = () => {
      const uid = userIdRef.current;
      if (!uid) return;
      if (document.visibilityState === 'hidden') {
        fireOfflineBeacon(uid);
      } else if (document.visibilityState === 'visible' && isUnlockedRef.current) {
        executeUpdate(uid, true, currentPageRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // mount once

  // ── React to PIN unlock / lock state ──────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const isUnlocked = encryptionStatus === 'ready';

    // Debounce to avoid rapid state thrashing
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      executeUpdate(user.id, isUnlocked, currentPage);
    }, 300);

    // ── Heartbeat: 20s interval
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    if (isUnlocked) {
      heartbeat = setInterval(() => {
        if (document.visibilityState === 'visible') {
          executeUpdate(user.id, true, currentPage);
        }
      }, 20_000); // 20 seconds
    }

    return () => {
      if (heartbeat) clearInterval(heartbeat);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [user, encryptionStatus, currentPage]);
}
