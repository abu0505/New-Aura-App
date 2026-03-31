import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Online status is tied EXCLUSIVELY to PIN unlock state.
 *
 * - PIN entered successfully (encryptionStatus === 'ready')  → Online
 * - Signout / PIN re-locked                                  → Offline
 * - Tab hidden / phone sleep (visibilitychange + pagehide)   → Offline  ← KEY FIX
 * - Tab visible again (and unlocked)                         → Online
 * - Page unload (beforeunload)                               → Offline
 *
 * Heartbeat: every 20 seconds while unlocked.
 * Edge Function Smart-Skip threshold: 30 seconds (matching heartbeat + buffer).
 */
export function useOnlineStatus(currentPage?: string) {
  const { user, encryptionStatus } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refs so event listeners always have fresh values
  const userIdRef = useRef<string | null>(null);
  const isUnlockedRef = useRef<boolean>(false);
  const currentPageRef = useRef<string | undefined>(undefined);

  useEffect(() => { userIdRef.current = user?.id ?? null; }, [user]);
  useEffect(() => { isUnlockedRef.current = encryptionStatus === 'ready'; }, [encryptionStatus]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

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
  const fireOfflineBeacon = (uid: string) => {
    const url = `${(supabase as any).supabaseUrl}/rest/v1/profiles?id=eq.${uid}`;
    const apiKey = (supabase as any).supabaseKey;
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
        'Authorization': `Bearer ${apiKey}`,
        'Prefer': 'return=minimal',
      },
      body,
      keepalive: true, // survives tab close on desktop
    };
    // Try sendBeacon first (fire-and-forget, survives mobile bfcache)
    // sendBeacon doesn't support custom headers so we fall through to fetch
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
      // e.persisted = true means page is entering bfcache (back/forward cache),
      // we still want to mark offline since the app is "suspended"
      const uid = userIdRef.current;
      if (uid) fireOfflineBeacon(uid);
    };

    // 3. visibilitychange — THE most reliable signal on Android.
    //    Fires when: phone locks, user switches apps, tab goes to background.
    const handleVisibilityChange = () => {
      const uid = userIdRef.current;
      if (!uid) return;
      if (document.visibilityState === 'hidden') {
        // App went to background / phone locked
        fireOfflineBeacon(uid);
      } else if (document.visibilityState === 'visible' && isUnlockedRef.current) {
        // App came back to foreground and user is still unlocked
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

    // ── Heartbeat: 20s interval (was 60s — now fast enough for 30s Smart-Skip)
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    if (isUnlocked) {
      heartbeat = setInterval(() => {
        // Only send heartbeat if tab is visible (don't "wake up" an offline user)
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
