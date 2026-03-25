import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Convert a URL-safe base64 string to a Uint8Array (for VAPID key).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Request notification permission and subscribe to Web Push.
 */
export async function subscribeToNotifications(userId: string): Promise<boolean> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('Push notifications not supported in this browser');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
    });

    // Store subscription in Supabase
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          subscription: subscription.toJSON(),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('Failed to store push subscription:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Push subscription failed:', error);
    return false;
  }
}

/**
 * Unsubscribe from Web Push notifications.
 */
export async function unsubscribeFromNotifications(userId: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);
  } catch (error) {
    console.error('Push unsubscription failed:', error);
  }
}

/**
 * Show a local notification (fallback for when push isn't available).
 */
export function showLocalNotification(title: string, body: string): void {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/aura-icon.png',
      badge: '/aura-icon.png',
      tag: 'aura-notification',
    });
  }
}

// TODO: The Supabase Edge Function for sending push notifications requires the VAPID_PRIVATE_KEY.
// Add it to Supabase Edge Function secrets with:
//   supabase secrets set VAPID_PRIVATE_KEY=<your-private-key>
// The Edge Function will trigger on new message inserts and send
// Web Push notifications to the recipient's subscription.
