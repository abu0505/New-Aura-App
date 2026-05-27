-- =============================================
-- AURA: Notification Personalization Migration
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql
-- =============================================

-- Add notification_alias: custom name shown in push notification title
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS notification_alias TEXT DEFAULT NULL;

-- Add notification_bodies: array of custom notification body messages (min 4)
-- Default is NULL — client-side + edge function both fall back to DEFAULT_BODIES constant
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS notification_bodies TEXT[] DEFAULT NULL;
