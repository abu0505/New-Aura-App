/**
 * nativeNotifications.ts
 * 
 * Handles native Firebase Cloud Messaging (FCM) push notifications
 * on Android via Capacitor's PushNotifications plugin.
 * 
 * This runs ONLY on the native Android app (Capacitor.isNativePlatform() === true).
 * On web, the existing VAPID / Service Worker system handles notifications.
 * 
 * Flow:
 * 1. App starts → requestPermissions()
 * 2. Android OS registers with FCM → returns an FCM token
 * 3. We save that token to Supabase (push_subscriptions table, type='fcm')
 * 4. When a message is sent, the Edge Function reads this token and sends
 *    a push via FCM HTTP v1 API → Android OS delivers it natively
 */

import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

/**
 * Initializes native FCM push notifications.
 * Call this once when the user is authenticated.
 * 
 * @param userId - The authenticated user's Supabase ID
 */
export async function initNativePushNotifications(userId: string): Promise<void> {
  // Only run on native Android/iOS
  if (!Capacitor.isNativePlatform()) return;

  try {
    // 1. Request permission from the OS
    const permResult = await PushNotifications.requestPermissions();
    
    if (permResult.receive !== 'granted') {
      console.warn('[FCM] ⚠️ Push notification permission denied by user');
      return;
    }

    console.log('[FCM] ✅ Permission granted, setting up listeners...');

    // ─────────────────────────────────────────────────────────────
    // CRITICAL FIX: Attach ALL listeners BEFORE calling register().
    //
    // Bug (confirmed in Logcat line ~1190):
    //   Capacitor fired the 'registration' event at 17:32:04.058
    //   while our addListener() call happened at the same tick —
    //   resulting in "No listeners found for event registration".
    //   The token was received twice because the event re-fired
    //   when the second listener was attached moments later.
    //
    // Fix: register listeners first, then call register() so the
    //   token event is guaranteed to hit an active listener.
    // ─────────────────────────────────────────────────────────────

    // Track whether we have already saved this token to avoid duplicates
    let tokenSaved = false;

    // 2. Listen for FCM token — MUST be before register()
    PushNotifications.addListener('registration', async (token) => {
      if (tokenSaved) {
        console.log('[FCM] ℹ️ Duplicate token event ignored (already saved)');
        return;
      }
      tokenSaved = true;
      console.log('[FCM] 🔑 FCM Token received:', token.value.substring(0, 20) + '...');
      await saveFcmToken(userId, token.value);
    });

    // 3. Handle registration errors — MUST be before register()
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[FCM] ❌ Registration error:', err.error);
    });

    // 4. Handle notifications received while app is IN FOREGROUND
    // (When app is in background/killed, FCM delivers directly to system tray)
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[FCM] 📨 Foreground notification received:', notification.title);
      // The realtime WebSocket handles in-app toasts.
      // Add a custom in-app banner here if needed.
    });

    // 5. Handle tap on a notification (when user taps the system tray notification)
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[FCM] 👆 Notification tapped:', action.notification.title);
      // The realtime hub will handle loading the latest messages.
    });

    // 6. NOW register with FCM — triggers the 'registration' event above
    console.log('[FCM] 🚀 Registering with FCM...');
    await PushNotifications.register();

  } catch (err: any) {
    console.error('[FCM] ❌ Failed to initialize push notifications:', err.message);
  }
}

/**
 * Saves the FCM token to Supabase push_subscriptions table.
 * Uses upsert so re-registration doesn't create duplicates.
 */
async function saveFcmToken(userId: string, fcmToken: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          // Use the FCM token as the "endpoint" for upsert uniqueness
          endpoint: `fcm:${userId}`,
          // Store the actual FCM token in the p256dh field
          // (we repurpose this for FCM tokens, type field differentiates)
          p256dh: fcmToken,
          auth: 'fcm', // marker so Edge Function knows this is an FCM token
          type: 'fcm',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('[FCM] ❌ Failed to save FCM token to Supabase:', error.message);
    } else {
      console.log('[FCM] ✅ FCM token saved to Supabase successfully');
    }
  } catch (err: any) {
    console.error('[FCM] ❌ Exception saving FCM token:', err.message);
  }
}

/**
 * Removes all FCM notification listeners.
 * Call this on logout.
 */
export async function cleanupNativePushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await PushNotifications.removeAllListeners();
  console.log('[FCM] 🧹 Cleaned up all FCM listeners');
}
