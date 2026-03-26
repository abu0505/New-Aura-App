import { supabase } from './supabase';

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

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.warn('This browser does not support desktop notification');
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export async function subscribeToPushNotifications(userId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push messaging is not supported');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      
      if (!publicVapidKey) {
        console.error('VITE_VAPID_PUBLIC_KEY is not defined in the environment.');
        return false;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
      });
    }

    // Convert the PushSubscription to JSON so it can be stored in the database
    const subJson = subscription.toJSON();

    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      console.error('Invalid subscription object', subJson);
      return false;
    }

    // Save to Supabase `push_subscriptions` table
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
      console.error('Failed to save push subscription to Supabase', error);
      return false;
    }

    console.log('Successfully subscribed to push notifications!');
    return true;

  } catch (error) {
    console.error('Error subscribing to push notifications', error);
    return false;
  }
}

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
    console.error('Error unsubscribing from push notifications', error);
    return false;
  }
}
