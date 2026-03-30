import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Online status is tied EXCLUSIVELY to PIN unlock state.
 *
 * - PIN entered successfully (encryptionStatus === 'ready')  → Online
 * - Page reload / logout (PIN required again)                → Offline
 * - Tab hidden                                               → Offline
 */
export function useOnlineStatus(currentPage?: string) {
  const { user, encryptionStatus } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to user.id so we can use it inside event listeners
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  // ── Core DB update ──────────────────────────────────────────────────────────
  const executeUpdate = async (userId: string, isOnline: boolean, page?: string) => {
    try {
      let statusMessage: string | null = null;
      if (isOnline) {
        if (page === 'chat') {
          statusMessage = 'Online';
        } else if (page) {
          const pageName = page.charAt(0).toUpperCase() + page.slice(1);
          statusMessage = `On ${pageName} page`;
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

  // ── Register page-unload listener once ─────────────────────────────────────
  useEffect(() => {
    // sendBeacon is fire-and-forget and survives page unload
    const markOfflineOnUnload = () => {
      const uid = userIdRef.current;
      if (!uid) return;
      // Use fetch keepalive so the request survives the unload
      const url = `${(supabase as any).supabaseUrl}/rest/v1/profiles?id=eq.${uid}`;
      const apiKey = (supabase as any).supabaseKey;
      const body = JSON.stringify({
        is_online: false,
        last_seen: new Date().toISOString(),
        status_message: null,
      });
      try {
        fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Prefer': 'return=minimal',
          },
          body,
          keepalive: true,
        });
      } catch (_) { /* ignore */ }
    };

    window.addEventListener('beforeunload', markOfflineOnUnload);
    return () => window.removeEventListener('beforeunload', markOfflineOnUnload);
  }, []); // mount once

  // ── React to PIN unlock / lock state ───────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const isUnlocked = encryptionStatus === 'ready';

    // Debounce to avoid thrashing on quick state changes
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      executeUpdate(user.id, isUnlocked, currentPage);
    }, 300);

    // ── Heartbeat (only while unlocked) ────────────────────────────────────
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    if (isUnlocked) {
      heartbeat = setInterval(() => {
        executeUpdate(user.id, true, currentPage);
      }, 60_000);
    }

    return () => {
      if (heartbeat) clearInterval(heartbeat);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [user, encryptionStatus, currentPage]);
}
