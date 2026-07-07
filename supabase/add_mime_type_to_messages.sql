-- Migration to add mime_type for document uploads (Critical Bug Fix)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mime_type text;
