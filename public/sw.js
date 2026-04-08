// AURA - Service Worker for Push Notifications
// Plain JavaScript (no TypeScript) - runs in a separate worker context

self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const pushData = event.data.json();
    console.log('[Service Worker] Push Received.');

    // Use sender name from payload for personalized notifications
    const senderName = pushData.senderName || 'Your partner';
    const title = senderName;
    const body = pushData.body || 'Sent you a message';

    const options = {
      body: body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: pushData.url || '/',
        messageId: pushData.messageId
      },
      vibrate: [200, 100, 200],
      requireInteraction: false,
      // Tag ensures only ONE notification per sender is shown at a time,
      // newer notification replaces the old one (prevents spam stacking)
      tag: 'aura-msg-' + (pushData.senderId || 'default'),
      // Renotify so the device alerts even when replacing a tagged notification
      renotify: true,
      // Silent = false so the user hears/feels the notification
      silent: false
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('[Service Worker] Error parsing push data', err);
    // Fallback notification if JSON parsing fails
    event.waitUntil(
      self.registration.showNotification('AURA', {
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
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();

  var urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  var absoluteUrl = new URL(urlToOpen, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // Check if there is already a window/tab open with the target URL
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === absoluteUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Check for any open window with our origin and focus+navigate it
      for (var j = 0; j < windowClients.length; j++) {
        var c = windowClients[j];
        if ('focus' in c) {
          return c.focus();
        }
      }
      // If no existing window, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[Service Worker] pushsubscriptionchange event triggered');
  // Notify all open clients to re-subscribe
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      clients.forEach(function(client) {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      });
    })
  );
});
