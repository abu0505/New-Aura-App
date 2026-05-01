// AURA - Service Worker for Push Notifications
// Plain JavaScript (no TypeScript) - runs in a separate worker context

// ═══════════════════════════════════════════════════════════════════════════════
// 🔔 NOTIFICATION DIAGNOSTIC LOGS — All logs use [🔔 SW] prefix
// ═══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', function(event) {
  console.log('[🔔 SW] Service Worker INSTALLED (version: 2026-05-01)');
  self.skipWaiting(); // Activate immediately without waiting
});

self.addEventListener('activate', function(event) {
  console.log('[🔔 SW] Service Worker ACTIVATED');
  event.waitUntil(self.clients.claim()); // Take control of all pages immediately
});

self.addEventListener('push', function(event) {
  console.log('[🔔 SW] ══════ PUSH EVENT RECEIVED ══════');
  
  if (!event.data) {
    console.warn('[🔔 SW] ❌ Push event has NO DATA attached — ignoring');
    return;
  }

  try {
    var pushData;
    try {
      pushData = event.data.json();
    } catch (parseErr) {
      console.error('[🔔 SW] ❌ Failed to parse push data as JSON:', parseErr.message);
      console.log('[🔔 SW]   Raw text:', event.data.text());
      pushData = {};
    }
    
    console.log('[🔔 SW] 📦 Push payload:', JSON.stringify(pushData));
    console.log('[🔔 SW]   messageId:', pushData.messageId || 'N/A');
    console.log('[🔔 SW]   senderId:', pushData.senderId || 'N/A');
    console.log('[🔔 SW]   senderName:', pushData.senderName || 'N/A');
    console.log('[🔔 SW]   body:', pushData.body || 'N/A');

    // Use personalized sender name from the Edge Function payload,
    // falling back to 'Aura' if not present.
    var title = pushData.senderName || pushData.title || 'Aura';
    var body = pushData.body || 'You have a new message';

    var options = {
      body: body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: pushData.url || '/',
        messageId: pushData.messageId
      },
      vibrate: [200, 100, 200],
      requireInteraction: false,
      // Tag ensures only ONE notification per sender is shown at a time.
      // Newer notification silently replaces the old one (no spam stacking).
      tag: 'aura-msg-' + (pushData.senderId || 'default'),
      // Renotify so the device still vibrates/sounds even when replacing a tagged notification
      renotify: true,
      silent: false
    };

    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
        var isFocused = false;
        for (var i = 0; i < windowClients.length; i++) {
          if (windowClients[i].focused) {
            isFocused = true;
            break;
          }
        }
        
        console.log('[🔔 SW] 🪟 Open windows: ' + windowClients.length + ', focused: ' + isFocused);
        
        // If app is currently visible and focused, prevent popping up a duplicate notification
        if (isFocused) {
          console.log('[🔔 SW] ⏭️ App is FOCUSED — skipping notification display (user is reading chat)');
          return Promise.resolve();
        }

        console.log('[🔔 SW] 📢 SHOWING notification: title="' + title + '", body="' + body + '"');
        return self.registration.showNotification(title, options);
      }).catch(function(err) {
        console.error('[🔔 SW] ❌ Error checking clients — showing notification anyway:', err.message);
        return self.registration.showNotification(title, options);
      })
    );
  } catch (err) {
    console.error('[🔔 SW] ❌ Fatal error in push handler:', err.message);
    // Fallback: still show a generic notification
    event.waitUntil(
      self.registration.showNotification('Aura', {
        body: 'You have a new message',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'aura-msg-fallback',
        renotify: true
      })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  console.log('[🔔 SW] 👆 Notification CLICKED — messageId:', event.notification.data?.messageId || 'N/A');

  event.notification.close();

  var urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  var absoluteUrl = new URL(urlToOpen, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // Focus existing window if open
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === absoluteUrl && 'focus' in client) {
          console.log('[🔔 SW]   Focusing existing window:', client.url);
          return client.focus();
        }
      }
      // Focus any open window with our origin
      for (var j = 0; j < windowClients.length; j++) {
        var c = windowClients[j];
        if ('focus' in c) {
          console.log('[🔔 SW]   Focusing any open window');
          return c.focus();
        }
      }
      // Open new window if none exists
      if (self.clients.openWindow) {
        console.log('[🔔 SW]   Opening new window:', urlToOpen);
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[🔔 SW] 🔄 pushsubscriptionchange EVENT — subscription was invalidated by browser!');
  console.log('[🔔 SW]   This usually means Chrome reset the subscription (spam detection or key rotation)');
  console.log('[🔔 SW]   old subscription:', event.oldSubscription ? event.oldSubscription.endpoint : 'N/A');
  console.log('[🔔 SW]   new subscription:', event.newSubscription ? event.newSubscription.endpoint : 'N/A');

  // Notify all open clients to re-subscribe
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      console.log('[🔔 SW]   Notifying ' + clients.length + ' client(s) to re-subscribe');
      clients.forEach(function(client) {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      });
    })
  );
});

// Log when the SW receives any message from the main thread
self.addEventListener('message', function(event) {
  console.log('[🔔 SW] 📨 Message from main thread:', JSON.stringify(event.data));
});
