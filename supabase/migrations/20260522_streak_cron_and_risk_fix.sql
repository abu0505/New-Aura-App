-- ========================================================
-- AURA: Streak Cron Jobs & Risk Fix Migration
-- Run this in Supabase SQL Editor.
-- ========================================================

-- ── 1. Enable pg_cron extension ─────────────────────────────────────────────
-- Requires Pro plan. Check Dashboard → Database → Extensions → pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 2. Schedule midnight streak increment ───────────────────────────────────
-- 00:00 IST = 18:30 UTC (previous calendar day)
-- Increments streak if BOTH users sent a camera snap today.
-- Resets daily flags regardless.
SELECT cron.schedule(
  'aura-streak-midnight-increment',
  '30 18 * * *',   -- 18:30 UTC = 00:00 IST
  $$SELECT public.increment_streak_at_midnight();$$
);

-- ── 3. Schedule at-risk check at 16:00 IST ──────────────────────────────────
-- 16:00 IST = 10:30 UTC
-- Marks streak_at_risk = true when only one person has snapped.
-- This gives the other user 8 hours to snap before midnight reset.
SELECT cron.schedule(
  'aura-streak-at-risk-check',
  '30 10 * * *',   -- 10:30 UTC = 16:00 IST
  $$SELECT public.mark_streaks_at_risk();$$
);

-- ── 4. Fix the update_streak_camera trigger ──────────────────────────────────
-- Improved version: also clears streak_at_risk immediately when
-- the SECOND person snaps (no need to wait for the cron).
-- Also handles new pair creation cleanly.
CREATE OR REPLACE FUNCTION public.update_streak_camera()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak_row    streaks%ROWTYPE;
  is_user1      BOOLEAN;
BEGIN
  -- Only care about camera-captured images or videos
  IF NOT (NEW.is_camera_capture = true AND NEW.message_type IN ('image', 'video')) THEN
    RETURN NEW;
  END IF;

  -- Find the streak row for this pair
  SELECT * INTO streak_row
  FROM streaks
  WHERE (user1_id = NEW.sender_id AND user2_id = NEW.receiver_id)
     OR (user1_id = NEW.receiver_id AND user2_id = NEW.sender_id)
  LIMIT 1;

  IF NOT FOUND THEN
    -- Create a new streak row for this pair
    INSERT INTO streaks (user1_id, user2_id, current_streak, longest_streak,
                         user1_snapped_today, user2_snapped_today, streak_at_risk)
    VALUES (NEW.sender_id, NEW.receiver_id, 0, 0, false, false, false)
    RETURNING * INTO streak_row;
  END IF;

  -- Identify which user is which
  is_user1 := (streak_row.user1_id = NEW.sender_id);

  -- Mark sender as having snapped today
  IF is_user1 THEN
    streak_row.user1_snapped_today := true;
  ELSE
    streak_row.user2_snapped_today := true;
  END IF;

  -- If BOTH have now sent → clear the at-risk flag (streak is safe!)
  IF streak_row.user1_snapped_today AND streak_row.user2_snapped_today THEN
    streak_row.streak_at_risk := false;
  END IF;
  -- Note: streak_at_risk is set to true by the daily cron at 16:00 IST,
  -- not by the trigger. The trigger only CLEARS it when both have snapped.

  -- Persist updates
  UPDATE streaks SET
    user1_snapped_today = streak_row.user1_snapped_today,
    user2_snapped_today = streak_row.user2_snapped_today,
    streak_at_risk      = streak_row.streak_at_risk,
    updated_at          = NOW()
  WHERE id = streak_row.id;

  RETURN NEW;
END;
$$;

-- ── 5. Re-attach trigger (drop old if exists) ────────────────────────────────
DROP TRIGGER IF EXISTS on_camera_message_update_streak ON public.messages;

CREATE TRIGGER on_camera_message_update_streak
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_streak_camera();

-- ── 6. Verify realtime is enabled for streaks ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'streaks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.streaks;
  END IF;
END;
$$;
