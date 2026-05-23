-- ========================================================
-- AURA: Streak Camera-Only Overhaul Migration
-- Run this in Supabase SQL Editor.
-- ========================================================

-- ── 1. Add is_camera_capture to messages ────────────────────────────────────
-- Only images/videos captured live via MobileCameraModal or DesktopCameraStudio
-- will set this flag. Gallery uploads, stickers, GIFs, text, audio = false.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_camera_capture BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Overhaul the streaks table ───────────────────────────────────────────
-- Add user1_id / user2_id FK columns so we know which users the streak belongs to.
-- (The old single-row design is kept but user ids are now enforced.)
ALTER TABLE public.streaks
  ADD COLUMN IF NOT EXISTS user1_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS user2_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS user1_snapped_today BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user2_snapped_today BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_snap_date DATE,
  ADD COLUMN IF NOT EXISTS streak_at_risk BOOLEAN NOT NULL DEFAULT false;

-- Backfill user IDs for the existing row from the known constants
UPDATE public.streaks
  SET user1_id = '2dfb823f-bb93-4e46-86cd-a520c5be7868'::uuid,
      user2_id = '8bb51234-4a86-470f-9f7d-96a95f551952'::uuid
WHERE user1_id IS NULL;

-- ── 3. Create the camera-only streak trigger function ───────────────────────
-- This fires on every message INSERT.
-- It ONLY acts if the message is a camera-captured image or video.
-- Logic:
--   a) Mark the sender's snapped_today = true
--   b) Recalculate streak_at_risk (past 16:00 and one side hasn't sent)
-- The streak INCREMENT itself happens at midnight via the cron job.
CREATE OR REPLACE FUNCTION public.update_streak_camera()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak_row    streaks%ROWTYPE;
  is_user1      BOOLEAN;
  current_hour  INT;
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

  -- Determine if streak is at risk:
  -- After 16:00 (4 PM) local server time, if only one person has sent, it's at risk.
  -- Server time is UTC; assume UTC+5:30 for India → 16:00 IST = 10:30 UTC.
  -- For simplicity we use UTC hour >= 10 as the threshold (adjustable).
  current_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC');
  streak_row.streak_at_risk := (
    current_hour >= 10 -- 16:00 IST = 10:30 UTC, use 10 as conservative threshold
    AND (
      (streak_row.user1_snapped_today AND NOT streak_row.user2_snapped_today)
      OR
      (streak_row.user2_snapped_today AND NOT streak_row.user1_snapped_today)
    )
  );

  -- If BOTH have now sent, clear the at-risk flag
  IF streak_row.user1_snapped_today AND streak_row.user2_snapped_today THEN
    streak_row.streak_at_risk := false;
  END IF;

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

-- Drop old trigger and attach the new one
DROP TRIGGER IF EXISTS on_message_update_streak ON public.messages;

CREATE TRIGGER on_camera_message_update_streak
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_streak_camera();

-- ── 4. Midnight increment function ──────────────────────────────────────────
-- Called by pg_cron at midnight (00:00 UTC+5:30 = 18:30 UTC previous day).
-- Increments streak if both users sent a camera snap today.
-- Resets streak to 0 if either missed.
-- Resets daily flags ready for the next day.
CREATE OR REPLACE FUNCTION public.increment_streak_at_midnight()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec   streaks%ROWTYPE;
  today DATE := CURRENT_DATE;
BEGIN
  FOR rec IN SELECT * FROM streaks LOOP
    IF rec.user1_snapped_today AND rec.user2_snapped_today THEN
      -- Both sent — check continuity
      UPDATE streaks SET
        current_streak  = CASE
                            WHEN rec.last_snap_date = today - 1 OR rec.last_snap_date = today
                            THEN rec.current_streak + 1
                            ELSE 1
                          END,
        longest_streak  = GREATEST(rec.longest_streak,
                            CASE
                              WHEN rec.last_snap_date = today - 1 OR rec.last_snap_date = today
                              THEN rec.current_streak + 1
                              ELSE 1
                            END),
        last_snap_date      = today,
        user1_snapped_today = false,
        user2_snapped_today = false,
        streak_at_risk      = false,
        updated_at          = NOW()
      WHERE id = rec.id;
    ELSE
      -- At least one missed — break the streak
      UPDATE streaks SET
        current_streak      = 0,
        user1_snapped_today = false,
        user2_snapped_today = false,
        streak_at_risk      = false,
        updated_at          = NOW()
      WHERE id = rec.id;
    END IF;
  END LOOP;
END;
$$;

-- ── 5. Schedule the midnight cron job ───────────────────────────────────────
-- 00:00 IST = 18:30 UTC. Schedule at 18:30 UTC (runs just after midnight IST).
-- Requires pg_cron extension. Enable via: CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Uncomment after confirming pg_cron is available on your Supabase plan.
--
-- SELECT cron.schedule(
--   'aura-streak-midnight-increment',
--   '30 18 * * *',   -- 18:30 UTC = 00:00 IST
--   $$SELECT public.increment_streak_at_midnight();$$
-- );

-- ── 6. Also schedule streak_at_risk check at 16:00 IST (10:30 UTC) ──────────
-- This catches the case where one person sent early in the day but the other
-- still hasn't sent by 4 PM — marks streak_at_risk = true for reminder.
CREATE OR REPLACE FUNCTION public.mark_streaks_at_risk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE streaks SET
    streak_at_risk = true,
    updated_at     = NOW()
  WHERE
    -- Exactly one of the two has sent today
    (
      (user1_snapped_today = true  AND user2_snapped_today = false)
      OR
      (user1_snapped_today = false AND user2_snapped_today = true)
    )
    AND current_streak > 0;  -- Only at-risk if there's an active streak to protect
END;
$$;

-- Uncomment after confirming pg_cron is available:
-- SELECT cron.schedule(
--   'aura-streak-at-risk-check',
--   '30 10 * * *',   -- 10:30 UTC = 16:00 IST
--   $$SELECT public.mark_streaks_at_risk();$$
-- );

-- ── 7. Ensure realtime is enabled for streaks ────────────────────────────────
-- Already in migration.sql but reconfirm:
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
