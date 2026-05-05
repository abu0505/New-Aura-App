import { supabase } from './supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

/**
 * RealtimeHub — A SINGLETON that manages ONE Supabase Realtime channel
 * for ALL Postgres Changes subscriptions across the entire app.
 *
 * WHY: Each `.channel()` opens a separate WebSocket multiplexed stream.
 * With 6+ channels, we pay 6× heartbeat overhead, 6× connection setup,
 * and 6× event delivery overhead. By merging into ONE channel with
 * multiple `.on()` listeners, we cut that to 1×.
 *
 * USAGE:
 *   import { realtimeHub } from '../lib/realtimeHub';
 *
 *   // In useEffect:
 *   const unsubscribe = realtimeHub.on('messages', (payload) => { ... });
 *   return () => unsubscribe();
 */

type TableName = string;
type Callback = (payload: RealtimePostgresChangesPayload<any>) => void;

interface Listener {
  id: number;
  table: TableName;
  callback: Callback;
  filter?: string;
}

let nextId = 0;
const listeners: Listener[] = [];
let channel: RealtimeChannel | null = null;
let isSetup = false;
// Track which tables are already registered on the channel
const registeredTables = new Set<string>();

/**
 * Ensures the shared channel is created and subscribed.
 * Tables are added as `.on()` listeners BEFORE subscribing.
 * For a 2-person app, we subscribe to ALL events on each table
 * and filter client-side — simpler and avoids Supabase filter limitations.
 */
function ensureChannel() {
  if (channel && isSetup) return;

  // Clean up any previous channel
  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase.channel('app-realtime-hub');
  isSetup = false;
}

/**
 * Registers a callback for a specific table's changes.
 * Returns an unsubscribe function.
 *
 * If the channel hasn't been started yet, call `start()` after
 * registering all initial listeners.
 */
function on(table: TableName, callback: Callback, filter?: string): () => void {
  const id = nextId++;
  listeners.push({ id, table, callback, filter });

  return () => {
    const idx = listeners.findIndex(l => l.id === id);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

/**
 * Builds the channel with all unique tables and subscribes.
 * Call this ONCE after all initial hooks have registered their listeners.
 * Late-registering hooks will still receive events as long as their
 * table was included in the initial set.
 *
 * For simplicity, we register the common tables upfront.
 */
function start(userId?: string, partnerId?: string) {
  if (isSetup) return;
  ensureChannel();
  if (!channel) return;

  // Register listeners for published tables.
  // Fix 2.2: pinned_messages NOW added to supabase_realtime publication (via migration),
  // so subscribing to it here will propagate partner pin/unpin in real-time.
  const tables: { table: string; filter?: string }[] = [
    { table: 'messages' },
    { table: 'stories' },
    { table: 'pinned_messages' }, // Fix 2.2: Now in realtime publication
    { table: 'video_chunks' },    // Progressive chunked video streaming
    // NOTE: No filter on profiles — we need both our own and partner's profile updates
    { table: 'profiles' },
    { table: 'chat_settings', filter: userId ? `user_id=eq.${userId}` : undefined },
    // NOTE: No filter on notifications — sender needs to see seen_push UPDATEs on
    // their partner's notification row (delivery receipt). Client-side filtering
    // in NotificationContext and useChat handles scoping.
    { table: 'notifications' },
  ];

  for (const { table, filter } of tables) {
    if (registeredTables.has(table)) continue;
    registeredTables.add(table);

    const opts: any = {
      event: '*',
      schema: 'public',
      table,
    };
    if (filter) opts.filter = filter;

    channel.on('postgres_changes', opts, (payload: RealtimePostgresChangesPayload<any>) => {
      // Dispatch to all listeners registered for this table
      for (const listener of listeners) {
        if (listener.table === table) {
          try {
            listener.callback(payload);
          } catch {
            
          }
        }
      }
    });
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      isSetup = true;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      isSetup = false;
      // Auto-reconnect after 5 seconds.
      // IMPORTANT: Capture userId & partnerId in closure so reconnect works on Android WebView
      // where the hub may have lost context after being backgrounded.
      const savedUserId = userId;
      const savedPartnerId = partnerId;
      setTimeout(() => {
        registeredTables.clear();
        start(savedUserId, savedPartnerId);
      }, 5000);
    }
  });
}

/**
 * Tears down the shared channel AND clears all listeners.
 * Call ONLY on logout or full app unmount — NOT for reconnects.
 * 
 * If you want to reconnect after a network drop/foregrounding,
 * use `restart()` instead, which preserves registered listeners.
 */
function stop() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  isSetup = false;
  registeredTables.clear();
  listeners.length = 0; // ← Only wipes listeners on FULL shutdown (logout)
}

/**
 * Reconnects the realtime channel WITHOUT clearing listeners.
 * 
 * This is the correct function to call when:
 *  - App comes back to foreground (visibilitychange)
 *  - Network reconnects after a drop
 *  - Android wakes from sleep/background
 * 
 * Preserving listeners means all hooks (useChat, NotificationContext, etc.)
 * that registered via `realtimeHub.on()` will still receive events
 * after the new channel connection is established.
 */
function restart(userId?: string, partnerId?: string) {
  // Tear down the old channel only — do NOT touch listeners[]
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  isSetup = false;
  registeredTables.clear();
  // Re-build and subscribe with existing listeners intact
  start(userId, partnerId);
}

/**
 * Returns whether the hub is currently connected.
 */
function isConnected() {
  return isSetup;
}

export const realtimeHub = { on, start, stop, restart, isConnected };

