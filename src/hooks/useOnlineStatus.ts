import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useOnlineStatus() {
  const { user } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const executeUpdate = async (isOnline: boolean) => {
      try {
        await supabase.from('profiles').update({ 
          is_online: isOnline,
          last_seen: new Date().toISOString()
        }).eq('id', user.id);
      } catch (err) {
        console.error('Failed to update online status', err);
      }
    };

    const updateStatus = (isOnline: boolean) => {
      // Debounce the update by 500ms
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        executeUpdate(isOnline);
      }, 500);
    };

    updateStatus(true); // Initial load

    const handleVisibilityChange = () => {
      updateStatus(document.visibilityState === 'visible');
    };

    // Edge case for closing the tab/browser
    const handleBeforeUnload = () => {
      // We rely more on visibility hidden which fires right before unload
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Heartbeat every 60 seconds to keep last_seen fresh
    const heartbeatParams = setInterval(() => {
       if (document.visibilityState === 'visible') {
         executeUpdate(true);
       }
    }, 60000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(heartbeatParams);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // We DO NOT updateStatus(false) here because soft tab switching unmounts/remounts logic shouldn't affect global online status
    };
  }, [user]);
}
