-- ===== NOTES TABLE =====
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'default',
  background TEXT NOT NULL DEFAULT 'none',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_trashed BOOLEAN NOT NULL DEFAULT false,
  trashed_at TIMESTAMPTZ,
  labels TEXT[] NOT NULL DEFAULT '{}',
  checklist JSONB NOT NULL DEFAULT '[]',
  is_checklist BOOLEAN NOT NULL DEFAULT false,
  custom_bg JSONB,
  custom_color TEXT,
  mood TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Users can manage their own notes"
  ON notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create Index for performance
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);

-- ===== NOTE LABELS TABLE =====
CREATE TABLE IF NOT EXISTS note_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Enable RLS
ALTER TABLE note_labels ENABLE ROW LEVEL SECURITY;

-- Create Policies
CREATE POLICY "Users can manage their own note labels"
  ON note_labels FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create Index
CREATE INDEX IF NOT EXISTS idx_note_labels_user_id ON note_labels (user_id);

-- Enable Realtime for notes and note_labels
ALTER PUBLICATION supabase_realtime ADD TABLE notes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_labels;
