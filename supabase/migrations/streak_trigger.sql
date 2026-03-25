-- ========================================================
-- AURA: Automated Streak Tracking Trigger
-- Place this in the Supabase SQL Editor and Run.
-- ========================================================

-- 1. Create the Streak Update Function
CREATE OR REPLACE FUNCTION public.update_streak()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak_row streaks%ROWTYPE;
  partner_last_date DATE;
  today DATE := CURRENT_DATE;
BEGIN
  -- Find the streak record for this pair
  SELECT * INTO streak_row FROM streaks
  WHERE (user1_id = NEW.sender_id AND user2_id = NEW.receiver_id)
     OR (user1_id = NEW.receiver_id AND user2_id = NEW.sender_id)
  LIMIT 1;

  -- Create record if it doesn't exist
  IF NOT FOUND THEN
    INSERT INTO streaks (user1_id, user2_id, current_streak, longest_streak)
    VALUES (NEW.sender_id, NEW.receiver_id, 0, 0)
    RETURNING * INTO streak_row;
  END IF;

  -- Update the sender's last active date
  IF streak_row.user1_id = NEW.sender_id THEN
    streak_row.last_message_date_user1 := today;
    partner_last_date := streak_row.last_message_date_user2;
  ELSE
    streak_row.last_message_date_user2 := today;
    partner_last_date := streak_row.last_message_date_user1;
  END IF;

  -- Logic: A streak increment happens if:
  -- Both messaged either today OR one messaged today and the other messaged yesterday.
  IF partner_last_date IS NOT NULL AND (today - partner_last_date) <= 1 THEN
    -- Only increment once per day for the pair
    IF streak_row.current_streak = 0 OR (today - GREATEST(streak_row.last_message_date_user1, streak_row.last_message_date_user2)) <= 1 THEN
       -- Check if they already messaged today to avoid double-counting
       -- For simplicity, we increment if the current_streak matches the day gap
       streak_row.current_streak := streak_row.current_streak + 1;
    END IF;
  END IF;

  -- Track all-time high
  IF streak_row.current_streak > streak_row.longest_streak THEN
    streak_row.longest_streak := streak_row.current_streak;
  END IF;

  -- Update the database
  UPDATE streaks SET
    current_streak = streak_row.current_streak,
    longest_streak = streak_row.longest_streak,
    last_message_date_user1 = streak_row.last_message_date_user1,
    last_message_date_user2 = streak_row.last_message_date_user2,
    updated_at = NOW()
  WHERE id = streak_row.id;

  RETURN NEW;
END;
$$;

-- 2. Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_message_update_streak ON public.messages;

-- 3. Create the Trigger
CREATE TRIGGER on_message_update_streak
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_streak();

-- 4. Create the Daily Reset Function (Run this periodically or via pg_cron)
-- This function resets streaks if more than 24 hours have passed since the last interaction.
CREATE OR REPLACE FUNCTION public.reset_broken_streaks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.streaks
  SET current_streak = 0
  WHERE GREATEST(COALESCE(last_message_date_user1, '1970-01-01'), COALESCE(last_message_date_user2, '1970-01-01')) < CURRENT_DATE - 1
    AND current_streak > 0;
END;
$$;
