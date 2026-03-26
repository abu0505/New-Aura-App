/// <reference lib="webworker" />

// Simple trick for VSCode typed Service Worker
const sw = self;

sw.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const pushData = event.data.json();
    console.log('[Service Worker] Push Received.', pushData);

    const title = pushData.title || 'New AURA Message';
    const options = {
      body: pushData.body || 'You have a new secure message',
      icon: '/favicon.svg', 
      badge: '/favicon.svg',
      data: {
        url: pushData.url || '/',
        messageId: pushData.messageId
      },
      vibrate: [200, 100, 200]
    };

    // If there is encrypted text and we need to decrypt it, we would theoretically
    // open IndexedDB here, fetch the derived Secret Key, decrypt `pushData.ciphertext`
    // using tweetnacl, and show the exact message.
    
    // For now, if the payload already contains the decrypted body (which isn't E2EE safe 
    // unless decrypted on the client), or we just show a generic notification until IndexedDB decryption is wired up.
    
    event.waitUntil(
      sw.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('[Service Worker] Error parsing push data', err);
    // Fallback notification if parsing fails
    event.waitUntil(
      sw.registration.showNotification('AURA Web', {
        body: 'New background notification',
      })
    );
  }
});

sw.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click Received.');
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window/tab open with the target URL
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        // If so, just focus it.
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, then open the target URL in a new window/tab.
      if (sw.clients.openWindow) {
        return sw.clients.openWindow(urlToOpen);
      }
    })
  );
});
