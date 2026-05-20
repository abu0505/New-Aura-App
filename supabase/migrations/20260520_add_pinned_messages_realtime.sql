-- Add pinned_messages to supabase_realtime publication to enable partner pins to propagate in real-time
ALTER PUBLICATION supabase_realtime ADD TABLE pinned_messages;
