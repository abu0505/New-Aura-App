-- ===== AUTOCOMPLETE PHRASES TABLE =====
CREATE TABLE IF NOT EXISTS autocomplete_phrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  phrase TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, phrase)
);

-- Enable RLS
ALTER TABLE autocomplete_phrases ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Users can manage their own autocomplete phrases"
  ON autocomplete_phrases FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create Index for performance
CREATE INDEX IF NOT EXISTS idx_autocomplete_phrases_user_id ON autocomplete_phrases (user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE autocomplete_phrases;
