import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App'
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AuthProvider } from './contexts/AuthContext'

import { DimProvider } from './contexts/DimContext'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    console.log('[🔔 NOTIF] Registering service worker: /sw.js');
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(
      (registration) => {
        console.log('[🔔 NOTIF] ✅ Service Worker registered successfully');
        console.log('[🔔 NOTIF]   scope:', registration.scope);
        console.log('[🔔 NOTIF]   active:', registration.active?.state || 'none');
        console.log('[🔔 NOTIF]   waiting:', registration.waiting?.state || 'none');
        
        // Listen for SW updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('[🔔 NOTIF] 🔄 New service worker installing...');
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              console.log('[🔔 NOTIF]   New SW state:', newWorker.state);
            });
          }
        });

        // Listen for messages from the service worker (e.g., push subscription changed)
        navigator.serviceWorker.addEventListener('message', (event) => {
          console.log('[🔔 NOTIF] 📨 Message from SW:', JSON.stringify(event.data));
          if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
            console.log('[🔔 NOTIF] 🔄 Push subscription changed! Triggering re-subscribe...');
            window.dispatchEvent(new CustomEvent('push-resubscribe'));
          }
        });
      },
      (error) => {
        console.error('[🔔 NOTIF] ❌ Service Worker registration FAILED:', error.message || error);
      }
    );
  });
} else {
  console.warn('[🔔 NOTIF] ⚠️ ServiceWorker is NOT supported in this browser');
}

// ═══ Native Android Setup ═══
// Only runs on real native app, not in the browser.
if (Capacitor.isNativePlatform()) {
  // Make status bar transparent & overlay so our app controls the full screen.
  // This is what causes the header-behind-statusbar issue — we fix it via CSS safe-area.
  StatusBar.setOverlaysWebView({ overlay: true });
  // Set status bar style to LIGHT (white icons) to match our dark theme.
  StatusBar.setStyle({ style: Style.Dark });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <DimProvider>
        <App />
      </DimProvider>
    </AuthProvider>
  </StrictMode>,
)
