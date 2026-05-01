-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL, -- 'message' | 'story_view' | 'reaction' | 'call'
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  data            JSONB,         -- extra context (chat_id, message_id, etc.)
  seen_realtime   BOOLEAN DEFAULT FALSE,  -- was delivered via WebSocket?
  seen_push       BOOLEAN DEFAULT FALSE,  -- was Web Push sent?
  read_at         TIMESTAMPTZ,            -- user actually opened it
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Recipients can read their own notifications
CREATE POLICY "recipient_read" ON notifications
  FOR SELECT USING (auth.uid() = recipient_id);

-- Recipients can update their own notifications (to mark as read/seen)
CREATE POLICY "recipient_update" ON notifications
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Allow inserting for testing or from authenticated users
CREATE POLICY "auth_insert" ON notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 2. Trigger to automatically create notification on new message
CREATE OR REPLACE FUNCTION handle_new_message_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert into notifications table
  INSERT INTO notifications (recipient_id, sender_id, type, title, body, data)
  VALUES (
    NEW.receiver_id,
    NEW.sender_id,
    'message',
    'New Message', -- This will be replaced by Edge Function logic anyway, or we can use it directly
    NEW.content,
    jsonb_build_object('message_id', NEW.id, 'chat_id', NEW.chat_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on messages table
DROP TRIGGER IF EXISTS on_new_message_create_notification ON messages;
CREATE TRIGGER on_new_message_create_notification
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_message_notification();
