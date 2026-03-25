-- =============================================
-- AURA Private Couples Messenger — Full Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/ugfxjjakpsngfdrjlsdr/sql)
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== PROFILES =====
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  public_key TEXT NOT NULL DEFAULT '',
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ===== MESSAGES =====
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES profiles(id) NOT NULL,
  receiver_id UUID REFERENCES profiles(id) NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  media_url TEXT,
  media_key TEXT,
  media_nonce TEXT,
  media_metadata TEXT,
  reply_to_id UUID REFERENCES messages(id),
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  is_deleted_for_sender BOOLEAN DEFAULT false,
  is_deleted_for_everyone BOOLEAN DEFAULT false,
  reactions JSONB DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT false,
  is_forwarded BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own messages"
  ON messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can insert messages they send"
  ON messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update their own messages"
  ON messages FOR UPDATE
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can delete their own messages"
  ON messages FOR DELETE
  USING (auth.uid() = sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON messages (created_at DESC);

-- ===== STORIES =====
CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  ciphertext TEXT,
  nonce TEXT,
  media_url TEXT NOT NULL,
  media_key TEXT NOT NULL,
  media_nonce TEXT NOT NULL,
  media_type TEXT NOT NULL,
  media_metadata TEXT,
  viewed_by JSONB DEFAULT '[]',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view stories"
  ON stories FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert own stories"
  ON stories FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own stories"
  ON stories FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete own stories"
  ON stories FOR DELETE USING (auth.uid() = user_id);

-- ===== PINNED MESSAGES =====
CREATE TABLE IF NOT EXISTS pinned_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by UUID REFERENCES profiles(id) NOT NULL,
  pinned_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pinned_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pins"
  ON pinned_messages FOR ALL USING (auth.uid() IS NOT NULL);

-- ===== LIVE LOCATIONS =====
CREATE TABLE IF NOT EXISTS live_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  encrypted_lat TEXT NOT NULL,
  encrypted_lng TEXT NOT NULL,
  nonce TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sharing_started_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view locations"
  ON live_locations FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own location"
  ON live_locations FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own location"
  ON live_locations FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own location"
  ON live_locations FOR DELETE USING (auth.uid() = user_id);

-- ===== CHAT SETTINGS =====
CREATE TABLE IF NOT EXISTS chat_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) UNIQUE NOT NULL,
  background_url TEXT,
  background_key TEXT,
  background_nonce TEXT,
  notification_sound BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all chat settings"
  ON chat_settings FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own settings"
  ON chat_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON chat_settings FOR UPDATE USING (auth.uid() = user_id);

-- ===== PUSH SUBSCRIPTIONS =====
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) UNIQUE NOT NULL,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions"
  ON push_subscriptions FOR ALL USING (auth.uid() = user_id);

-- ===== STREAKS =====
CREATE TABLE IF NOT EXISTS streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_snap_date DATE,
  user_a_snapped_today BOOLEAN DEFAULT false,
  user_b_snapped_today BOOLEAN DEFAULT false,
  streak_at_risk BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view streaks"
  ON streaks FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update streaks"
  ON streaks FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Insert the single shared streak row
INSERT INTO streaks (current_streak, longest_streak) VALUES (0, 0);

-- ===== STREAK UPDATE FUNCTION =====
-- TODO: Replace the placeholder UUIDs below with real user UUIDs after creating accounts
CREATE OR REPLACE FUNCTION update_streak(sender_uuid UUID)
RETURNS void AS $$
DECLARE
  rec streaks%ROWTYPE;
  today DATE := CURRENT_DATE;
  user_a_id UUID := '2dfb823f-bb93-4e46-86cd-a520c5be7868'; -- Abuturab
  user_b_id UUID := '8bb51234-4a86-470f-9f7d-96a95f551952'; -- Riffuu
BEGIN
  SELECT * INTO rec FROM streaks LIMIT 1;

  IF sender_uuid = user_a_id THEN
    UPDATE streaks SET user_a_snapped_today = true, updated_at = NOW() WHERE id = rec.id;
  ELSIF sender_uuid = user_b_id THEN
    UPDATE streaks SET user_b_snapped_today = true, updated_at = NOW() WHERE id = rec.id;
  END IF;

  SELECT * INTO rec FROM streaks LIMIT 1;

  IF rec.user_a_snapped_today AND rec.user_b_snapped_today AND (rec.last_snap_date IS NULL OR rec.last_snap_date < today) THEN
    UPDATE streaks SET
      current_streak = CASE
        WHEN rec.last_snap_date = today - 1 THEN rec.current_streak + 1
        ELSE 1
      END,
      longest_streak = GREATEST(rec.longest_streak,
        CASE
          WHEN rec.last_snap_date = today - 1 THEN rec.current_streak + 1
          ELSE 1
        END
      ),
      last_snap_date = today,
      user_a_snapped_today = false,
      user_b_snapped_today = false,
      streak_at_risk = false,
      updated_at = NOW()
    WHERE id = rec.id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== ENABLE REALTIME =====
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE stories;
ALTER PUBLICATION supabase_realtime ADD TABLE live_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE streaks;
