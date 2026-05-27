-- =============================================
-- AURA: Database Optimization Migration
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql
-- =============================================

-- ═══════════════════════════════════════════════════════════════════════
-- FIX 3: Auto-delete notifications older than 30 days
-- Notifications accumulate indefinitely — this function cleans them up.
-- Scheduled as a daily cron job at 3:00 AM UTC.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

SELECT cron.schedule(
  'cleanup-old-notifications',
  '0 3 * * *',
  'SELECT public.cleanup_old_notifications();'
);

-- ═══════════════════════════════════════════════════════════════════════
-- FIX 5: Hard-delete messages marked as "deleted for everyone"
-- After 7 days, the "This message was deleted" tombstone is purged.
-- Scheduled as a daily cron job at 3:15 AM UTC.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_deleted_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.messages
  WHERE is_deleted_for_everyone = true
    AND updated_at < NOW() - INTERVAL '7 days';
END;
$$;

SELECT cron.schedule(
  'cleanup-deleted-messages',
  '15 3 * * *',
  'SELECT public.cleanup_deleted_messages();'
);

-- ═══════════════════════════════════════════════════════════════════════
-- FIX 4: Weekly VACUUM ANALYZE on main tables
-- Reclaims dead tuple space from deleted/updated rows.
-- Scheduled every Sunday at 4:00 AM UTC.
-- ═══════════════════════════════════════════════════════════════════════
SELECT cron.schedule(
  'weekly-vacuum-analyze',
  '0 4 * * 0',
  'VACUUM (ANALYZE) messages; VACUUM (ANALYZE) notes; VACUUM (ANALYZE) notifications;'
);

-- ═══════════════════════════════════════════════════════════════════════
-- FIX 6: Change notification_bodies default to NULL
-- The 10-string array was stored per row even when users never customized.
-- Client-side + edge function both fall back to DEFAULT_BODIES constant.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE chat_settings ALTER COLUMN notification_bodies SET DEFAULT NULL;

-- Clear existing default values (saves ~300 bytes per row)
UPDATE chat_settings
SET notification_bodies = NULL
WHERE notification_bodies = ARRAY[
  'Someone is thinking of you 💭',
  'A whisper has arrived for you 🤫',
  'Your sanctuary has a new message ✨',
  'Something special is waiting for you 💌',
  'A secret message has arrived 🔐',
  'You have been summoned to the sanctuary 🕯️',
  'A gentle knock on your heart 💛',
  'Love is calling you back 📱',
  'The universe sent you a signal 🌙',
  'Your world just got a little brighter ☀️'
];
