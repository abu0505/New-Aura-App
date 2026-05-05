import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 5,
      heartbeatIntervalMs: 60000,
    },
  },
  global: {
    fetch: async (url, options) => {
      console.log('[SUPABASE FETCH START] URL:', url, 'OPTIONS:', JSON.stringify(options));
      try {
        const response = await fetch(url, options);
        console.log('[SUPABASE FETCH SUCCESS] Status:', response.status, response.statusText);
        return response;
      } catch (err: any) {
        console.error('[SUPABASE FETCH ERROR] URL:', url);
        console.error('[SUPABASE FETCH ERROR] Message:', err.message);
        console.error('[SUPABASE FETCH ERROR] Stack:', err.stack);
        throw err;
      }
    }
  }
});
