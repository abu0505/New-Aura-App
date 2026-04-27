import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type CallMessageType = 
  | 'call_request' 
  | 'call_accept' 
  | 'call_reject' 
  | 'call_end' 
  | 'sdp_offer' 
  | 'sdp_answer' 
  | 'ice_candidate';

export interface CallMessage {
  type: CallMessageType;
  sender_id: string;
  target_id: string;
  payload?: any;
}

type CallMessageHandler = (message: CallMessage) => void;

class CallSignaling {
  private channel: RealtimeChannel | null = null;
  private handlers: Set<CallMessageHandler> = new Set();
  private isConnected = false;
  private myUserId: string | null = null;

  start(userId: string) {
    if (this.isConnected && this.channel) return;
    this.myUserId = userId;

    this.channel = supabase.channel('call-signaling', {
      config: {
        broadcast: { ack: false },
      },
    });

    this.channel.on(
      'broadcast',
      { event: 'call-message' },
      ({ payload }: { payload: CallMessage }) => {
        // Only process messages intended for this user
        if (payload.target_id === this.myUserId) {
          this.handlers.forEach((handler) => handler(payload));
        }
      }
    );

    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.isConnected = true;
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        this.isConnected = false;
      }
    });
  }

  stop() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.isConnected = false;
    this.myUserId = null;
  }

  onMessage(handler: CallMessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async sendMessage(message: CallMessage) {
    if (!this.channel || !this.isConnected) {
      console.warn('CallSignaling is not connected. Cannot send message.');
      return;
    }

    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'call-message',
        payload: message,
      });
    } catch (e) {
      console.error('Failed to send call signaling message', e);
    }
  }
}

export const callSignaling = new CallSignaling();
