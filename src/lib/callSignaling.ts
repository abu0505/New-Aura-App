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

/**
 * Generates a deterministic, per-pair channel name so only the two
 * participants share a channel — eliminating global broadcast leakage.
 * IDs are sorted so both sides always generate the same channel name.
 */
function getPairChannelName(userId: string, partnerId: string): string {
  const sorted = [userId, partnerId].sort();
  return `call-${sorted[0]}-${sorted[1]}`;
}

class CallSignaling {
  private channel: RealtimeChannel | null = null;
  private handlers: Set<CallMessageHandler> = new Set();
  private isConnected = false;
  private myUserId: string | null = null;
  private partnerId: string | null = null;
  private messageQueue: CallMessage[] = [];

  start(userId: string, partnerId: string) {
    const channelName = getPairChannelName(userId, partnerId);
    console.log(`[WEBRTC Signaling] Starting signaling for user: ${userId} on channel: ${channelName}. Current status: connected=${this.isConnected}`);
    
    // If already connected to the correct channel, skip
    if (this.isConnected && this.channel && this.myUserId === userId && this.partnerId === partnerId) {
      console.log(`[WEBRTC Signaling] Already connected to correct channel. Skipping start.`);
      return;
    }

    // Clean up any previous channel before starting a new one
    if (this.channel) {
      console.log(`[WEBRTC Signaling] Cleaning up old channel before starting new one.`);
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.isConnected = false;
    }

    this.myUserId = userId;
    this.partnerId = partnerId;

    console.log(`[WEBRTC Signaling] Initializing Supabase channel '${channelName}'`);
    this.channel = supabase.channel(channelName, {
      config: {
        // ack: true ensures reliable delivery — message is confirmed by server
        broadcast: { ack: true },
      },
    });

    this.channel.on(
      'broadcast',
      { event: 'call-message' },
      ({ payload }: { payload: CallMessage }) => {
        // On a per-pair channel, all messages are for us — no client-side filtering needed
        console.log(`[WEBRTC Signaling] Received message from ${payload.sender_id}:`, payload.type);
        this.handlers.forEach((handler) => handler(payload));
      }
    );

    this.channel.subscribe((status) => {
      console.log(`[WEBRTC Signaling] Channel status changed to: ${status}`);
      if (status === 'SUBSCRIBED') {
        this.isConnected = true;
        this.flushQueue();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        this.isConnected = false;
        console.warn(`[WEBRTC Signaling] Disconnected due to ${status}`);
      }
    });
  }

  clearQueue() {
    console.log(`[WEBRTC Signaling] Clearing message queue. Had ${this.messageQueue.length} messages.`);
    this.messageQueue = [];
  }

  private async flushQueue() {
    if (!this.channel || !this.isConnected) return;
    if (this.messageQueue.length > 0) {
      console.log(`[WEBRTC Signaling] Flushing ${this.messageQueue.length} queued messages.`);
    }
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (msg) {
        try {
          console.log(`[WEBRTC Signaling] Sending queued message: ${msg.type}`);
          await this.channel.send({
            type: 'broadcast',
            event: 'call-message',
            payload: msg,
          });
        } catch (e) {
          console.error('[WEBRTC Signaling] Failed to flush message', e);
        }
      }
    }
  }

  stop() {
    console.log(`[WEBRTC Signaling] Stopping signaling and removing channel.`);
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.isConnected = false;
    this.myUserId = null;
    this.partnerId = null;
    this.clearQueue();
  }

  onMessage(handler: CallMessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async sendMessage(message: CallMessage) {
    if (!this.channel || !this.isConnected) {
      console.warn(`[WEBRTC Signaling] Not connected. Queuing message: ${message.type}. Current queue size: ${this.messageQueue.length}`);
      this.messageQueue.push(message);
      
      // Attempt reconnection if we dropped completely
      if (!this.channel && this.myUserId && this.partnerId) {
        console.log(`[WEBRTC Signaling] Channel is null. Attempting to restart for ${this.myUserId}`);
        this.start(this.myUserId, this.partnerId);
      }
      return;
    }

    try {
      console.log(`[WEBRTC Signaling] Sending message: ${message.type} to ${message.target_id}`);
      await this.channel.send({
        type: 'broadcast',
        event: 'call-message',
        payload: message,
      });
    } catch (e) {
      console.error('[WEBRTC Signaling] Failed to send call signaling message', e);
    }
  }
}

export const callSignaling = new CallSignaling();
