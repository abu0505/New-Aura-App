-- Add saved_message_ids column to profiles table to support saved posts and reels feature
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saved_message_ids uuid[] DEFAULT '{}'::uuid[];
