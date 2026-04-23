-- =============================================
-- AURA: Notification Personalization Migration
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql
-- =============================================

-- Add notification_alias: custom name shown in push notification title
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS notification_alias TEXT DEFAULT NULL;

-- Add notification_bodies: array of custom notification body messages (min 10)
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS notification_bodies TEXT[] DEFAULT ARRAY[
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
