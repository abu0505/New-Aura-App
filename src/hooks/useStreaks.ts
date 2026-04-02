import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STREAK_MILESTONES } from '../types';
import type { Database } from '../integrations/supabase/types';

export function useStreaks() {
  const { user } = useAuth();
  const [streakCount, setStreakCount] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchStreak = async () => {
      const { data } = await supabase
        .from('streaks')
        .select('id,user1_id,user2_id,current_streak,longest_streak')
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .single();

      if (data) {
        setStreakCount(data.current_streak || 0);
        setLongestStreak(data.longest_streak || 0);
        
        // Trigger celebration on exact milestones
        if (STREAK_MILESTONES.some(m => m.days === data.current_streak) && data.current_streak > 0) {
           // Provide manual user override or trigger natively
           setShowCelebration(true);
        }
      }
    };

    fetchStreak();

    const subscription = supabase
      .channel('public:streaks')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'streaks' },
        (payload) => {
          const newData = payload.new as Database['public']['Tables']['streaks']['Row'];
          if (newData.user1_id === user.id || newData.user2_id === user.id) {
            const newStreak = newData.current_streak || 0;
            setStreakCount(newStreak);
            setLongestStreak(newData.longest_streak || 0);
            
            if (STREAK_MILESTONES.some(m => m.days === newStreak) && newStreak > 0) {
               setShowCelebration(true);
            }
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user]);

  return { streakCount, longestStreak, showCelebration, setShowCelebration };
}
