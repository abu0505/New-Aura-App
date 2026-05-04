-- =============================================
-- AURA: Granular Notification Toggles
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql
-- =============================================

-- Add tab_badge_enabled: Toggle for (1) badge in browser tab
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS tab_badge_enabled BOOLEAN DEFAULT true;

-- Add push_notifications_enabled: Toggle for Push & Toasts
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT true;
