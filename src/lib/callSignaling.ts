import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type CallMessageType =
  | 'call_request'   // carries { video: boolean, sdp: RTCSessionDescriptionInit, salt: string }
  | 'call_accept'    // carries { sdp: RTCSessionDescriptionInit }
  | 'call_reject'
  | 'call_end'
  | 'ice_candidate'; // carries RTCIceCandidateInit

export interface CallMessage {
  type: CallMessageType;
  sender_id: string;
  target_id: string;
  payload?: any;
}

type CallMessageHandler = (message: CallMessage) => void;

// Build a deterministic channel name for a pair of users so that ONLY the two
// participants are on the same Supabase Realtime channel. This prevents metadata
// leakage to every other online user.
function pairChannelName(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return `call-${a}-${b}`;
}

class CallSignaling {
  private channel: RealtimeChannel | null = null;
  private handlers: Set<CallMessageHandler> = new Set();
  private isConnected = false;
  private myUserId: string | null = null;
  private partnerId: string | null = null;
  private messageQueue: CallMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  start(userId: string, partnerId: string) {
    const channelName = pairChannelName(userId, partnerId);

    // Already on the correct channel → skip
    if (this.isConnected && this.channel && this.myUserId === userId && this.partnerId === partnerId) {
      return;
    }

    // Tear down any existing channel first
    this._teardown();

    this.myUserId = userId;
    this.partnerId = partnerId;

    this.channel = supabase.channel(channelName, {
      config: { broadcast: { ack: true } }, // ack=true → Supabase confirms delivery
    });

    this.channel.on(
      'broadcast',
      { event: 'call-message' },
      ({ payload }: { payload: CallMessage }) => {
        if (payload.target_id === this.myUserId) {
          this.handlers.forEach((h) => h(payload));
        }
      }
    );

    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.isConnected = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this._flushQueue();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        this.isConnected = false;
        this._scheduleReconnect();
      }
    });
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.myUserId && this.partnerId) {
        this.start(this.myUserId, this.partnerId);
      }
    }, 2000);
  }

  private _teardown() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.isConnected = false;
  }

  clearQueue() {
    this.messageQueue = [];
  }

  private async _flushQueue() {
    if (!this.channel || !this.isConnected) return;
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (msg) await this._send(msg);
    }
  }

  stop() {
    this._teardown();
    this.myUserId = null;
    this.partnerId = null;
    this.clearQueue();
  }

  onMessage(handler: CallMessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendMessage(message: CallMessage) {
    if (!this.channel || !this.isConnected) {
      this.messageQueue.push(message);
      return;
    }
    await this._send(message);
  }

  private async _send(message: CallMessage) {
    if (!this.channel) return;
    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'call-message',
        payload: message,
      });
    } catch (e) {
      // Send failed
    }
  }
}

export const callSignaling = new CallSignaling();
