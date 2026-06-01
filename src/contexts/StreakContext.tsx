import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { STREAK_MILESTONES } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface StreakData {
  streakId: string | null;
  streakCount: number;
  longestStreak: number;
  streakAtRisk: boolean;       // ⏳ 8 hours left — one side snapped, other hasn't
  mySnappedToday: boolean;     // Did the current user snap today?
  partnerSnappedToday: boolean; // Did the partner snap today?
  showCelebration: boolean;
  setShowCelebration: (v: boolean) => void;
}

const StreakContext = createContext<StreakData>({
  streakId: null,
  streakCount: 0,
  longestStreak: 0,
  streakAtRisk: false,
  mySnappedToday: false,
  partnerSnappedToday: false,
  showCelebration: false,
  setShowCelebration: () => {},
});

export function useStreak() {
  return useContext(StreakContext);
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function StreakProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [streakId, setStreakId] = useState<string | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [streakAtRisk, setStreakAtRisk] = useState(false);
  const [mySnappedToday, setMySnappedToday] = useState(false);
  const [partnerSnappedToday, setPartnerSnappedToday] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  // Keep previous streak count to detect milestone hits
  const prevStreakRef = useRef(0);

  // ── Parse raw DB row into component state ──
  const applyRow = useCallback((row: any) => {
    if (!row || !user?.id) return;

    const isUser1 = row.user1_id === user.id;
    const mySnapped = isUser1 ? row.user1_snapped_today : row.user2_snapped_today;
    const partnerSnapped = isUser1 ? row.user2_snapped_today : row.user1_snapped_today;

    const newCount = row.current_streak ?? 0;

    // Check for milestone celebration (streak just increased to a milestone)
    if (
      newCount > prevStreakRef.current &&
      STREAK_MILESTONES.some(m => m.days === newCount) &&
      newCount > 0
    ) {
      setShowCelebration(true);
    }
    prevStreakRef.current = newCount;

    setStreakId(row.id);
    setStreakCount(newCount);
    setLongestStreak(row.longest_streak ?? 0);
    setStreakAtRisk(row.streak_at_risk ?? false);
    setMySnappedToday(mySnapped ?? false);
    setPartnerSnappedToday(partnerSnapped ?? false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    // ── 1. Initial fetch ──
    const fetchStreak = async () => {
      const { data } = await supabase
        .from('streaks')
        .select('id, user1_id, user2_id, current_streak, longest_streak, streak_at_risk, user1_snapped_today, user2_snapped_today')
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .single();

      if (data) {
        prevStreakRef.current = data.current_streak ?? 0;
        applyRow(data);
      }
    };

    fetchStreak();

    // ── 2. Real-time subscription ──
    // Listen for any UPDATE on the streaks table for this user's row.
    const channel = supabase
      .channel(`streak-realtime-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'streaks',
          // Filter so we only receive changes for rows where we are user1 or user2.
          // Supabase realtime filter supports single equality; we subscribe broadly
          // and filter client-side for the pair containing this user.
        },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          // Only process rows involving the current user
          if (row.user1_id === user.id || row.user2_id === user.id) {
            applyRow(row);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, applyRow]);

  // ═══ PERF: Memoize context value ═══
  const contextValue = useMemo(() => ({
    streakId,
    streakCount,
    longestStreak,
    streakAtRisk,
    mySnappedToday,
    partnerSnappedToday,
    showCelebration,
    setShowCelebration,
  }), [streakId, streakCount, longestStreak, streakAtRisk, mySnappedToday, partnerSnappedToday, showCelebration]);

  return (
    <StreakContext.Provider value={contextValue}>
      {children}
    </StreakContext.Provider>
  );
}
