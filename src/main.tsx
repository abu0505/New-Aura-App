import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App'
import { AuthProvider } from './contexts/AuthContext'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(
      () => {
        // Listen for messages from the service worker (e.g., push subscription changed)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
            window.dispatchEvent(new CustomEvent('push-resubscribe'));
          }
        });
      },
      (err) => {
        console.error('ServiceWorker registration failed:', err);
      }
    );
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
