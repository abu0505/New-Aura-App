-- ============================================================
-- FIX: Notifications Realtime + Trigger Dedup
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add notifications table to the Realtime publication
--    This is the PRIMARY fix — without this, Supabase Realtime
--    never broadcasts INSERT/UPDATE events from the notifications
--    table, so NotificationContext never receives new notifications.
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- 2. Fix the DB trigger: It was inserting encrypted_content as the
--    notification body (raw ciphertext = garbage), AND it was
--    duplicating notifications that the Edge Function already creates.
--    Solution: DROP the DB trigger entirely. The Edge Function
--    (send-push/index.ts) already handles notification creation
--    with proper personalized title/body. The trigger is redundant.
DROP TRIGGER IF EXISTS on_new_message_create_notification ON messages;
DROP FUNCTION IF EXISTS handle_new_message_notification();

-- 3. Fix push_subscriptions table: the old schema stored the full
--    subscription object as JSONB, but the Edge Function queries
--    p256dh and auth as separate columns. Ensure the correct schema.
--    (Only runs if the separate columns don't already exist)
DO $$
BEGIN
  -- Add p256dh column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'push_subscriptions' AND column_name = 'p256dh'
  ) THEN
    ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT;
    ALTER TABLE push_subscriptions ADD COLUMN auth TEXT;
    -- Migrate existing JSONB data if any
    UPDATE push_subscriptions
    SET
      endpoint = subscription->>'endpoint',
      p256dh   = subscription->'keys'->>'p256dh',
      auth     = subscription->'keys'->>'auth'
    WHERE p256dh IS NULL AND subscription IS NOT NULL;
  END IF;

  -- Add endpoint column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'push_subscriptions' AND column_name = 'endpoint'
  ) THEN
    ALTER TABLE push_subscriptions ADD COLUMN endpoint TEXT UNIQUE;
  END IF;
END $$;

-- 4. Add unique constraint on endpoint to prevent duplicate subscriptions
--    (silently skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'push_subscriptions_endpoint_key'
  ) THEN
    ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
  END IF;
END $$;
