-- ========================================================
-- AURA: Fix Streak Trigger — Final Cleanup
-- Run this in Supabase SQL Editor.
--
-- ROOT CAUSE: Two bugs were preventing the camera-only streak system from working:
--   1. The old trigger `on_message_update_streak` (which fires on ALL messages)
--      was never properly dropped and was still firing, updating streaks on every message.
--   2. The camera-only trigger function `update_streak_camera` referenced
--      `NEW.message_type` but the actual DB column is `type`, so the filter
--      condition never matched and camera captures were also ignored.
-- ========================================================

-- ── 1. Drop ALL old streak triggers on messages (explicit first) ─────────────
DROP TRIGGER IF EXISTS on_message_update_streak ON public.messages;
DROP TRIGGER IF EXISTS on_message_insert_update_streak ON public.messages;
DROP TRIGGER IF EXISTS on_camera_message_update_streak ON public.messages;

-- ── 2. Drop old update_streak functions with CASCADE ─────────────────────────
-- CASCADE automatically drops any remaining dependent triggers we may have missed.
DROP FUNCTION IF EXISTS public.update_streak(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.update_streak() CASCADE;

-- ── 3. Fix the camera-only streak trigger function ──────────────────────────
-- BUG FIX: Changed `NEW.message_type` → `NEW.type` to match the actual
-- column name in the messages table.
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
  -- ═══ CRITICAL GUARD ═══
  -- Only act on camera-captured images or videos.
  -- All other messages (text, audio, gallery uploads, stickers, GIFs) are ignored.
  -- FIX: Use NEW.type (not NEW.message_type — that column doesn't exist)
  IF NOT (NEW.is_camera_capture = true AND NEW.type IN ('image', 'video')) THEN
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

-- ── 4. Re-create the trigger with the fixed function ────────────────────────
CREATE TRIGGER on_camera_message_update_streak
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_streak_camera();

-- ── 5. Verify: Run this SELECT to confirm only the camera trigger remains ────
-- SELECT trigger_name, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE event_object_table = 'messages';
