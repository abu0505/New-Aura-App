import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STREAK_MILESTONES } from '../types';

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
        
        if (STREAK_MILESTONES.some(m => m.days === data.current_streak) && data.current_streak > 0) {
           setShowCelebration(true);
        }
      }
    };

    fetchStreak();

  }, [user?.id]);

  return { streakCount, longestStreak, showCelebration, setShowCelebration };
}
