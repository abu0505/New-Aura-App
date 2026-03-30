export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  public_key: string;
  is_online: boolean;
  last_seen: string;
  status_message: string | null;
  created_at: string;
}

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker';

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  ciphertext: string;
  nonce: string;
  message_type: MessageType;
  media_url: string | null;
  media_key: string | null;
  media_nonce: string | null;
  media_metadata: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_deleted_for_sender: boolean;
  is_deleted_for_everyone: boolean;
  reactions: Record<string, string[]>;
  is_pinned: boolean;
  is_forwarded: boolean;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface DecryptedMessage extends Omit<Message, 'ciphertext' | 'nonce'> {
  content: string;
  decrypted_media_metadata?: MediaMetadata;
}

export interface MediaMetadata {
  filename: string;
  size: number;
  mimeType: string;
  duration?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface Story {
  id: string;
  user_id: string;
  ciphertext: string | null;
  nonce: string | null;
  media_url: string;
  media_key: string;
  media_nonce: string;
  media_type: 'image' | 'video';
  media_metadata: string | null;
  viewed_by: string[];
  expires_at: string;
  created_at: string;
}

export interface DecryptedStory extends Omit<Story, 'ciphertext' | 'nonce'> {
  caption: string | null;
  decrypted_media_url?: string;
}

export interface PinnedMessage {
  id: string;
  message_id: string;
  pinned_by: string;
  pinned_at: string;
}

export interface LiveLocation {
  id: string;
  user_id: string;
  encrypted_lat: string;
  encrypted_lng: string;
  nonce: string;
  is_active: boolean;
  sharing_started_at: string;
  expires_at: string;
  updated_at: string;
}

export interface ChatSettings {
  id: string;
  user_id: string;
  background_url: string | null;
  background_key: string | null;
  background_nonce: string | null;
  notification_sound: boolean;
  updated_at: string;
}

export interface PushSubscription {
  id: string;
  user_id: string;
  subscription: PushSubscriptionJSON;
  created_at: string;
}

export interface Streak {
  id: string;
  current_streak: number;
  longest_streak: number;
  last_snap_date: string | null;
  user_a_snapped_today: boolean;
  user_b_snapped_today: boolean;
  streak_at_risk: boolean;
  updated_at: string;
}

export interface StreakMilestone {
  days: number;
  message: string;
  emoji: string;
}

export const STREAK_MILESTONES: StreakMilestone[] = [
  { days: 7, message: 'One week of love', emoji: '🌸' },
  { days: 30, message: 'A whole month together', emoji: '🌙' },
  { days: 100, message: '100 days of us', emoji: '💛' },
  { days: 365, message: "A full year. You're everything.", emoji: '🔥' },
];

export const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👀', '🎉', '💯'] as const;
export type Reaction = typeof REACTIONS[number];

export type MediaQualityChoice = 'original' | 'optimized';

export interface OptimizationResult {
  optimizedFile: File;
  originalSize: number;
  optimizedSize: number;
}

// User constants
export const USER_A_ID = '2dfb823f-bb93-4e46-86cd-a520c5be7868'; // Abuturab
export const USER_A_NAME = 'Abuturab';

export const USER_B_ID = '8bb51234-4a86-470f-9f7d-96a95f551952'; // Riffuu
export const USER_B_NAME = 'Riffuu';

export type Tab = 'chat' | 'stories' | 'location' | 'settings' | 'memories';
