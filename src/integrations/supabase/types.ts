export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          avatar_url: string | null
          public_key: string | null
          is_online: boolean
          last_seen: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name: string
          avatar_url?: string | null
          public_key?: string | null
          is_online?: boolean
          last_seen?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          avatar_url?: string | null
          public_key?: string | null
          is_online?: boolean
          last_seen?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          sender_id: string
          receiver_id: string
          encrypted_content: string
          nonce: string
          type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker'
          media_url: string | null
          media_key: string | null
          media_nonce: string | null
          reaction: string | null
          reply_to: string | null
          is_read: boolean
          is_delivered: boolean
          is_edited: boolean
          is_deleted_for_me: boolean
          is_deleted_for_everyone: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sender_id: string
          receiver_id: string
          encrypted_content: string
          nonce: string
          type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker'
          media_url?: string | null
          media_key?: string | null
          media_nonce?: string | null
          reaction?: string | null
          reply_to?: string | null
          is_read?: boolean
          is_delivered?: boolean
          is_edited?: boolean
          is_deleted_for_me?: boolean
          is_deleted_for_everyone?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sender_id?: string
          receiver_id?: string
          encrypted_content?: string
          nonce?: string
          type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker'
          media_url?: string | null
          media_key?: string | null
          media_nonce?: string | null
          reaction?: string | null
          reply_to?: string | null
          is_read?: boolean
          is_delivered?: boolean
          is_edited?: boolean
          is_deleted_for_me?: boolean
          is_deleted_for_everyone?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      stories: {
        Row: {
          id: string
          user_id: string
          encrypted_content: string
          media_url: string | null
          media_key: string | null
          media_nonce: string | null
          expires_at: string
          viewed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          encrypted_content: string
          media_url?: string | null
          media_key?: string | null
          media_nonce?: string | null
          expires_at: string
          viewed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          encrypted_content?: string
          media_url?: string | null
          media_key?: string | null
          media_nonce?: string | null
          expires_at?: string
          viewed_at?: string | null
          created_at?: string
        }
      }
      chat_settings: {
        Row: {
          id: string
          user_id: string
          background_url: string | null
          notification_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          background_url?: string | null
          notification_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          background_url?: string | null
          notification_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      streaks: {
        Row: {
          id: string
          user1_id: string
          user2_id: string
          current_streak: number
          longest_streak: number
          last_message_date_user1: string | null
          last_message_date_user2: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user1_id: string
          user2_id: string
          current_streak?: number
          longest_streak?: number
          last_message_date_user1?: string | null
          last_message_date_user2?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user1_id?: string
          user2_id?: string
          current_streak?: number
          longest_streak?: number
          last_message_date_user1?: string | null
          last_message_date_user2?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      live_locations: {
        Row: {
          id: string
          user_id: string
          encrypted_lat: string
          encrypted_lng: string
          is_sharing: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          encrypted_lat: string
          encrypted_lng: string
          is_sharing?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          encrypted_lat?: string
          encrypted_lng?: string
          is_sharing?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      pinned_messages: {
        Row: {
          id: string
          message_id: string
          pinned_by: string
          created_at: string
        }
        Insert: {
          id?: string
          message_id: string
          pinned_by: string
          created_at?: string
        }
        Update: {
          id?: string
          message_id?: string
          pinned_by?: string
          created_at?: string
        }
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
