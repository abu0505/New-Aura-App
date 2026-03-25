import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function useOnlineStatus() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    const updateStatus = async (isOnline: boolean) => {
      await supabase.from('profiles').update({ 
        is_online: isOnline,
        last_seen: new Date().toISOString()
      }).eq('id', user.id);
    };

    updateStatus(true); // Initial load

    const handleVisibilityChange = () => {
      updateStatus(document.visibilityState === 'visible');
    };

    const handleFocus = () => updateStatus(true);
    const handleBlur = () => updateStatus(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      updateStatus(false); // Cleanup on unmount
    };
  }, [user]);
}
