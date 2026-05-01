import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// ═══════════════════════════════════════════════════════════════════════════════
// 🔔 NOTIFICATION DIAGNOSTIC PREFIX — All logs use this for easy filtering
// ═══════════════════════════════════════════════════════════════════════════════
const TAG = '[🔔 NOTIF]';

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
    console.error(`${TAG} ❌ Subscription JSON is incomplete — missing endpoint/keys`, subJson);
    return false;
  }

  console.log(`${TAG} 💾 Saving subscription to DB...`);
  console.log(`${TAG}   endpoint: ${subJson.endpoint?.substring(0, 80)}...`);

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
    console.error(`${TAG} ❌ Failed to save subscription to DB:`, error.message);
    return false;
  }
  console.log(`${TAG} ✅ Subscription saved to DB successfully`);
  return true;
}

/**
 * Check the permission state without asking the user
 */
export function getPermissionState(): NotificationPermission {
  if (!('Notification' in window)) {
    console.warn(`${TAG} ⚠️ Notification API not available in this browser`);
    return 'denied';
  }
  const state = Notification.permission;
  console.log(`${TAG} 🔑 Current permission state: ${state}`);
  return state;
}

/**
 * Checks if the browser is currently subscribed to push
 */
export async function checkPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn(`${TAG} ⚠️ ServiceWorker or PushManager not supported`);
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const hasSubscription = !!subscription;
    console.log(`${TAG} 🔍 Existing push subscription: ${hasSubscription ? 'YES ✅' : 'NO ❌'}`);
    if (subscription) {
      console.log(`${TAG}   endpoint: ${subscription.endpoint?.substring(0, 80)}...`);
      // Check if subscription is still valid by comparing with DB
      const expirationTime = (subscription as any).expirationTime;
      if (expirationTime && expirationTime < Date.now()) {
        console.warn(`${TAG} ⚠️ Subscription has EXPIRED! expirationTime: ${new Date(expirationTime).toISOString()}`);
        return false;
      }
    }
    return hasSubscription;
  } catch (err) {
    console.error(`${TAG} ❌ Error checking push subscription:`, err);
    return false;
  }
}

/**
 * Re-subscribes silently (without prompt) IF permission is already granted.
 * To be called after PIN unlock on app load. 
 * 
 * ENHANCED: Now also validates existing subscription health and re-subscribes
 * if the subscription appears invalid (fixes Chrome spam detection recovery).
 */
export async function initPushNotifications(userId: string): Promise<boolean> {
  console.log(`${TAG} 🚀 initPushNotifications() called for user: ${userId.substring(0, 8)}...`);
  
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.error(`${TAG} ❌ Browser does not support ServiceWorker or PushManager`);
    return false;
  }

  const permission = Notification.permission;
  console.log(`${TAG} 🔑 Notification.permission = "${permission}"`);

  if (permission !== 'granted') {
    console.warn(`${TAG} ⚠️ Permission is NOT granted (${permission}) — cannot auto-subscribe. User must manually enable from Settings.`);
    return false;
  }

  try {
    console.log(`${TAG} ⏳ Waiting for ServiceWorker to be ready...`);
    const registration = await navigator.serviceWorker.ready;
    console.log(`${TAG} ✅ ServiceWorker is ready. Scope: ${registration.scope}`);
    console.log(`${TAG}   SW state: ${registration.active?.state || 'no active SW'}`);

    let subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      console.log(`${TAG} 📬 Found existing subscription`);
      console.log(`${TAG}   endpoint: ${subscription.endpoint?.substring(0, 80)}...`);
      
      // Health check: Try to verify the subscription is still valid
      const expirationTime = (subscription as any).expirationTime;
      if (expirationTime) {
        console.log(`${TAG}   expirationTime: ${new Date(expirationTime).toISOString()}`);
        if (expirationTime < Date.now()) {
          console.warn(`${TAG} ⚠️ Subscription EXPIRED — will unsubscribe and create fresh one`);
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    } else {
      console.log(`${TAG} ❌ No existing subscription found — will create new one`);
    }

    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        console.error(`${TAG} ❌ VAPID_PUBLIC_KEY is not set! Cannot subscribe.`);
        return false;
      }
      console.log(`${TAG} 🔄 Creating new push subscription with VAPID key...`);
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        console.log(`${TAG} ✅ New push subscription created!`);
        console.log(`${TAG}   endpoint: ${subscription.endpoint?.substring(0, 80)}...`);
      } catch (subscribeError: any) {
        console.error(`${TAG} ❌ pushManager.subscribe() FAILED:`, subscribeError.message);
        console.error(`${TAG}   This usually means Chrome has BLOCKED notifications for this site.`);
        console.error(`${TAG}   Fix: Go to Chrome Settings → Site Settings → Notifications → Allow this site`);
        return false;
      }
    }

    const saved = await saveSubscriptionToDatabase(userId, subscription);
    console.log(`${TAG} 📋 Final result: subscription ${saved ? 'ACTIVE ✅' : 'FAILED TO SAVE ❌'}`);
    return saved;
  } catch (error: any) {
    console.error(`${TAG} ❌ initPushNotifications() fatal error:`, error.message);
    return false;
  }
}

/**
 * Triggers the permission prompt and subscribes to push.
 * To be called only when the user explicitly clicks "Enable Notifications".
 */
export async function requestAndSubscribe(userId: string): Promise<'granted' | 'denied' | 'error'> {
  console.log(`${TAG} 🔔 requestAndSubscribe() — prompting user for permission...`);
  
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.error(`${TAG} ❌ Browser missing Notification or ServiceWorker API`);
    return 'error';
  }

  // Request explicitly
  const permission = await Notification.requestPermission();
  console.log(`${TAG} 🔑 User responded with: "${permission}"`);
  
  if (permission === 'denied' || permission === 'default') {
    console.warn(`${TAG} ⚠️ Permission ${permission} — user declined or dismissed`);
    return 'denied';
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    console.log(`${TAG} ✅ ServiceWorker ready for subscription`);
    
    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();
    console.log(`${TAG} 🔍 Existing subscription: ${subscription ? 'found' : 'not found'}`);

    if (!subscription) {
      if (!VAPID_PUBLIC_KEY) {
        console.error(`${TAG} ❌ VAPID_PUBLIC_KEY not set`);
        return 'error';
      }

      console.log(`${TAG} 🔄 Creating new subscription...`);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      console.log(`${TAG} ✅ New subscription created. endpoint: ${subscription.endpoint?.substring(0, 80)}...`);
    }

    const saved = await saveSubscriptionToDatabase(userId, subscription);
    console.log(`${TAG} 📋 requestAndSubscribe result: ${saved ? 'SUCCESS ✅' : 'DB SAVE FAILED ❌'}`);
    return saved ? 'granted' : 'error';

  } catch (error: any) {
    console.error(`${TAG} ❌ requestAndSubscribe() error:`, error.message);
    return 'error';
  }
}

/**
 * Unsubscribe from PushManager and delete from Supabase
 */
export async function unsubscribeFromPushNotifications(userId: string): Promise<boolean> {
  console.log(`${TAG} 🔕 unsubscribeFromPushNotifications() called`);
  
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    
    if (subscription) {
      await subscription.unsubscribe();
      console.log(`${TAG} ✅ Unsubscribed from PushManager`);
    } else {
      console.log(`${TAG} ℹ️ No subscription to unsubscribe from`);
    }
    
    // Remove from Supabase
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    console.log(`${TAG} ✅ Deleted subscription from DB`);
    return true;
  } catch (error: any) {
    console.error(`${TAG} ❌ unsubscribe error:`, error.message);
    return false;
  }
}

/**
 * Forcefully clears all push subscriptions and unregisters service workers.
 * Use this to fix "Spam detected" or "Blocked" states.
 */
export async function forceResetPushNotifications(): Promise<void> {
  console.log(`${TAG} 🔧 forceResetPushNotifications() — FULL RESET starting...`);
  
  if (!('serviceWorker' in navigator)) return;

  try {
    // 1. Unsubscribe from all push registrations
    const registrations = await navigator.serviceWorker.getRegistrations();
    console.log(`${TAG}   Found ${registrations.length} service worker registration(s)`);
    
    for (const registration of registrations) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log(`${TAG}   ✅ Unsubscribed push for SW scope: ${registration.scope}`);
      }
      // 2. Unregister the service worker itself
      await registration.unregister();
      console.log(`${TAG}   ✅ Unregistered SW: ${registration.scope}`);
    }
    
    // 3. Clear all caches (optional but helpful)
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      console.log(`${TAG}   ✅ Cleared ${cacheNames.length} cache(s)`);
    }
    
    console.log(`${TAG} 🔧 FULL RESET complete — reloading page...`);
    // Reload is usually needed to re-register fresh
    window.location.reload();
  } catch (err: any) {
    console.error(`${TAG} ❌ forceReset error:`, err.message);
  }
}

/**
 * 🔔 DIAGNOSTIC: Comprehensive notification health check.
 * Call this from browser console: await window.__notifHealthCheck()
 * Logs the complete state of the notification pipeline.
 */
export async function notificationHealthCheck(): Promise<void> {
  console.log(`\n${TAG} ═══════════════════════════════════════════════`);
  console.log(`${TAG} 🏥 NOTIFICATION HEALTH CHECK`);
  console.log(`${TAG} ═══════════════════════════════════════════════`);

  // 1. Browser support
  const hasNotifAPI = 'Notification' in window;
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  console.log(`${TAG} 1️⃣ Browser Support:`);
  console.log(`${TAG}   Notification API: ${hasNotifAPI ? '✅' : '❌'}`);
  console.log(`${TAG}   ServiceWorker:    ${hasSW ? '✅' : '❌'}`);
  console.log(`${TAG}   PushManager:      ${hasPush ? '✅' : '❌'}`);

  // 2. Permission
  if (hasNotifAPI) {
    console.log(`${TAG} 2️⃣ Permission: "${Notification.permission}"`);
  }

  // 3. Service Worker status
  if (hasSW) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    console.log(`${TAG} 3️⃣ Service Workers: ${registrations.length} registered`);
    registrations.forEach((reg, i) => {
      console.log(`${TAG}   [${i}] scope: ${reg.scope}`);
      console.log(`${TAG}       active: ${reg.active?.state || 'none'}`);
      console.log(`${TAG}       waiting: ${reg.waiting?.state || 'none'}`);
      console.log(`${TAG}       installing: ${reg.installing?.state || 'none'}`);
    });

    // 4. Push subscription
    if (hasPush) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        console.log(`${TAG} 4️⃣ Push Subscription: ${sub ? 'EXISTS ✅' : 'MISSING ❌'}`);
        if (sub) {
          console.log(`${TAG}   endpoint: ${sub.endpoint}`);
          const exp = (sub as any).expirationTime;
          console.log(`${TAG}   expirationTime: ${exp ? new Date(exp).toISOString() : 'none'}`);
        }
      } catch (e: any) {
        console.error(`${TAG} 4️⃣ Error checking subscription:`, e.message);
      }
    }
  }

  // 5. VAPID key
  console.log(`${TAG} 5️⃣ VAPID Key: ${VAPID_PUBLIC_KEY ? `set (${VAPID_PUBLIC_KEY.substring(0, 20)}...)` : '❌ NOT SET'}`);

  console.log(`${TAG} ═══════════════════════════════════════════════\n`);
}

// Expose health check on window for easy console access
if (typeof window !== 'undefined') {
  (window as any).__notifHealthCheck = notificationHealthCheck;
}
