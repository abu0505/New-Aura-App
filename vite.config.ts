import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/framer-motion/')) {
            return 'vendor-motion';
          }
          if (id.includes('node_modules/emoji-picker-react/')) {
            return 'vendor-emoji';
          }
          if (id.includes('node_modules/mapbox-gl/') || id.includes('node_modules/maplibre-gl/') || id.includes('node_modules/react-map-gl/')) {
            return 'vendor-maps';
          }
          if (id.includes('node_modules/@supabase/supabase-js/')) {
            return 'vendor-supabase';
          }
          if (id.includes('node_modules/tweetnacl/') || id.includes('node_modules/tweetnacl-util/')) {
            return 'vendor-crypto';
          }
          if (id.includes('node_modules/@ffmpeg/') || id.includes('node_modules/mp4-muxer/') || id.includes('node_modules/mp4box/') || id.includes('node_modules/browser-image-compression/')) {
            return 'vendor-media';
          }
          if (id.includes('node_modules/date-fns/')) {
            return 'vendor-date';
          }
        },
      },
    },
    // Raise the chunk size warning to 600KB (default 500KB)
    // since vendor-maps will naturally exceed that
    chunkSizeWarningLimit: 600,
  },
})
