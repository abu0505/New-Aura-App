-- =============================================
-- AURA — Add Reel Upload Flag to Messages
-- Run in Supabase SQL Editor
-- =============================================

-- Add is_reel_upload flag to messages table
-- TRUE = user intentionally uploaded this as a dedicated reel (higher algorithm weight)
-- FALSE (default) = regular chat media
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_reel_upload BOOLEAN NOT NULL DEFAULT false;

-- Index for fast reel-upload-specific queries
CREATE INDEX IF NOT EXISTS idx_messages_is_reel_upload
  ON messages (is_reel_upload, created_at DESC)
  WHERE is_reel_upload = true;

-- Comment for documentation
COMMENT ON COLUMN messages.is_reel_upload IS
  'TRUE when this media was intentionally uploaded via the Reels dedicated upload flow. These items receive a higher weighting in the reel algorithm.';
