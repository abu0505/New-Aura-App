import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Utility to convert the base64 URL-safe VAPID public key to a Uint8Array
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Submits the PushSubscription to Supabase `push_subscriptions` table
 */
async function saveSubscriptionToDatabase(userId: string, subscription: PushSubscription) {
  const subJson = subscription.toJSON();
  
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    
    return false;
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    
    return false;
  }
  
  return true;
}

/**
 * Check the permission state without asking the user
 */
export function getPermissionState(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Checks if the browser is currently subscribed to push
 */
export async function checkPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch (err) {
    return false;
  }
}

/**
 * Re-subscribes silently (without prompt) IF permission is already granted.
 * To be called after PIN unlock on app load. 
 */
export async function initPushNotifications(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    // We do NOT auto-prompt the user
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        
        return false;
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    return await saveSubscriptionToDatabase(userId, subscription);
  } catch (error) {
    
    return false;
  }
}

/**
 * Triggers the permission prompt and subscribes to push.
 * To be called only when the user explicitly clicks "Enable Notifications".
 */
export async function requestAndSubscribe(userId: string): Promise<'granted' | 'denied' | 'error'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    
    return 'error';
  }

  // Request explicitly
  const permission = await Notification.requestPermission();
  
  if (permission === 'denied' || permission === 'default') {
    return 'denied';
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        
        return 'error';
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const saved = await saveSubscriptionToDatabase(userId, subscription);
    return saved ? 'granted' : 'error';

  } catch (error) {
    
    return 'error';
  }
}

/**
 * Unsubscribe from PushManager and delete from Supabase
 */
export async function unsubscribeFromPushNotifications(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
    }
    
    // Remove from Supabase
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    return true;
  } catch (error) {
    
    return false;
  }
}

/**
 * Forcefully clears all push subscriptions and unregisters service workers.
 * Use this to fix "Spam detected" or "Blocked" states.
 */
export async function forceResetPushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    // 1. Unsubscribe from all push registrations
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
      // 2. Unregister the service worker itself
      await registration.unregister();
    }
    
    // 3. Clear all caches (optional but helpful)
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    
    // Reload is usually needed to re-register fresh
    window.location.reload();
  } catch (err) {
    // silent
  }
}
