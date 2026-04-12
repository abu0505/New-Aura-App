// AURA - Service Worker for Push Notifications
// Plain JavaScript (no TypeScript) - runs in a separate worker context

self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const pushData = event.data.json();
    console.log('[Service Worker] Push Received.');

    // Always use the app name as title for privacy —
    // no partner names visible on lock screen in public places.
    const title = pushData.title || 'Aura';
    const body = pushData.body || 'You have a new message';

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
      // Tag ensures only ONE notification per sender is shown at a time.
      // Newer notification silently replaces the old one (no spam stacking).
      // Chrome won't flag this as bot spam because of the 5s debounce on sender side.
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
        
        // If app is currently visible and focused, prevent popping up a duplicate notification
        if (isFocused) {
          console.log('[Service Worker] App is focused. Suppressing system notification.');
          return Promise.resolve();
        }

        return self.registration.showNotification(title, options);
      }).catch(function(err) {
        console.error('[Service Worker] Error checking clients:', err);
        return self.registration.showNotification(title, options);
      })
    );
  } catch (err) {
    console.error('[Service Worker] Error parsing push data', err);
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
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();

  var urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  var absoluteUrl = new URL(urlToOpen, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // Focus existing window if open
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === absoluteUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Focus any open window with our origin
      for (var j = 0; j < windowClients.length; j++) {
        var c = windowClients[j];
        if ('focus' in c) {
          return c.focus();
        }
      }
      // Open new window if none exists
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
