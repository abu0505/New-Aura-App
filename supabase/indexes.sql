-- =============================================
-- AURA v1.2: Performance Indexes
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql
-- =============================================
-- These indexes dramatically speed up the most common queries in the app.
-- They are safe to run multiple times (IF NOT EXISTS).

-- ═══════════════════════════════════════════════════════════════════════
-- 1. MESSAGES — Chat history loading
-- The main query in useChat.ts filters by (sender_id, receiver_id) pair
-- and orders by created_at DESC. Without an index, Postgres does a
-- sequential scan of the entire messages table for every chat open.
-- ═══════════════════════════════════════════════════════════════════════

-- Index for loading chat history between two users (sender → receiver direction)
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver_created
ON public.messages (sender_id, receiver_id, created_at DESC);

-- Index for the reverse direction (receiver → sender)
-- Both directions are needed because the query uses OR:
--   sender_id=me AND receiver_id=partner  OR  sender_id=partner AND receiver_id=me
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender_created
ON public.messages (receiver_id, sender_id, created_at DESC);

-- Index for undelivered message lookups (mark-as-delivered on open)
CREATE INDEX IF NOT EXISTS idx_messages_undelivered
ON public.messages (receiver_id, is_delivered)
WHERE is_delivered = false;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. VIDEO_CHUNKS — Chunked video loading
-- When a user opens a chunked video, we fetch all chunks by message_id.
-- Without an index, this is a full table scan.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_video_chunks_message_id
ON public.video_chunks (message_id, chunk_index ASC);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. NOTIFICATIONS — Inbox loading
-- The notification inbox fetches by recipient_id ordered by created_at.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
ON public.notifications (recipient_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. MEDIA_FOLDER_ITEMS — Folder item lookups
-- Fetching items in a folder or checking if a message is in any folder.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_media_folder_items_folder
ON public.media_folder_items (folder_id, added_at DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. PINNED_MESSAGES — Quick lookup
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pinned_messages_message_id
ON public.pinned_messages (message_id);

-- Run ANALYZE after creating indexes to update query planner statistics
ANALYZE public.messages;
ANALYZE public.video_chunks;
ANALYZE public.notifications;
ANALYZE public.media_folder_items;
ANALYZE public.pinned_messages;
