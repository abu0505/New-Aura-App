import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { 
  checkEncryptionStatus, 
  generateKeyPair, 
  storeKeyPair, 
  backupKeys, 
  restoreKeys,
  syncPublicKey,
  clearStoredKeys,
  type EncryptionState 
} from '../lib/encryption';
// Fix 1.4: Import push debounce timers to clear them on logout
import { pushDebounceTimers } from '../hooks/useChat';

const DEVICE_TOKEN_KEY = 'aura_device_token';

/** Generates a new device token, saves to localStorage, and writes it to the profiles table. */
async function registerDeviceToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  localStorage.setItem(DEVICE_TOKEN_KEY, token);
  await supabase.from('profiles').update({ current_device_token: token }).eq('id', userId);
  return token;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  encryptionStatus: EncryptionState;
  signOut: () => Promise<void>;
  setupEncryption: (pin: string) => Promise<void>;
  unlockEncryption: (pin: string) => Promise<boolean>;
  refreshUser: () => Promise<void>;
  /** Call after PIN unlock/setup to register this device and start watching for other logins. */
  registerThisDevice: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  encryptionStatus: 'initializing',
  signOut: async () => {},
  setupEncryption: async () => {},
  unlockEncryption: async () => false,
  refreshUser: async () => {},
  registerThisDevice: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionState>('initializing');
  // Ref to hold the realtime channel for device-token watch (cleanup on logout)
  const deviceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isSigningOutRef = useRef(false);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
      setLoading(false);
    });

    // Listen for auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        handleSession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  /** Subscribe to realtime profile changes to detect when another device logs in. */
  const startDeviceWatch = (userId: string) => {
    // Clean up any previous channel first
    if (deviceChannelRef.current) {
      supabase.removeChannel(deviceChannelRef.current);
    }

    const channel = supabase
      .channel(`device-watch:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          if (isSigningOutRef.current) return;
          const newToken = (payload.new as any)?.current_device_token;
          const myToken = localStorage.getItem(DEVICE_TOKEN_KEY);
          // If DB token changed and it's NOT ours → another device logged in → force sign-out
          if (newToken && myToken && newToken !== myToken) {
            performSignOut(userId, /* forcedByOtherDevice */ true);
          }
        }
      )
      .subscribe();

    deviceChannelRef.current = channel;
  };

  const handleSession = async (currentSession: Session | null) => {
    setSession(currentSession);
    setUser(currentSession?.user ?? null);

    if (currentSession?.user) {
      const status = await checkEncryptionStatus(currentSession.user.id);
      setEncryptionStatus(status);
    } else {
      setEncryptionStatus('initializing');
    }
  };

  const setupEncryption = async (pin: string) => {
    if (!user) return;
    try {
      // GUARD: If a backup already exists, try to restore first.
      // This prevents accidental key regeneration which would break old messages.
      const restored = await restoreKeys(user.id, pin);
      if (restored) {
        await syncPublicKey(user.id);
        setEncryptionStatus('ready');
        return;
      }

      // No backup exists or PIN didn't match — generate fresh keys
      const newKeyPair = generateKeyPair();
      storeKeyPair(newKeyPair, user.id);
      
      try {
        await backupKeys(user.id, pin);
        await syncPublicKey(user.id);
        setEncryptionStatus('ready');
      } catch (backupError) {
        // If backup fails, clear the local keys we just generated!
        // This is critical so the next attempt starts fresh and doesn't orphan the previous state.
        clearStoredKeys();
        throw backupError;
      }
    } catch (err) {
      
      // Re-throw so the UI component (Modal) can handle and show the error message.
      throw err;
    }
  };

  const unlockEncryption = async (pin: string): Promise<boolean> => {
    if (!user) return false;
    const success = await restoreKeys(user.id, pin);
    if (success) {
      await syncPublicKey(user.id);
      setEncryptionStatus('ready');
    }
    return success;
  };

  /** Register this device on login — call this after PIN unlock/setup. */
  const registerThisDevice = async () => {
    if (!user) return;
    await registerDeviceToken(user.id);
    startDeviceWatch(user.id);
  };

  const performSignOut = async (userId: string | undefined, forcedByOtherDevice = false) => {
    isSigningOutRef.current = true;

    // Stop watching for device changes
    if (deviceChannelRef.current) {
      supabase.removeChannel(deviceChannelRef.current);
      deviceChannelRef.current = null;
    }

    // Clear local device token
    localStorage.removeItem(DEVICE_TOKEN_KEY);

    if (!forcedByOtherDevice && userId) {
      // Only mark offline if WE initiated the logout (not the other device)
      try {
        await supabase.from('profiles').update({
          is_online: false,
          last_seen: new Date().toISOString(),
          status_message: null,
        }).eq('id', userId);
      } catch (_) { /* best-effort */ }
    }

    // Fix 1.4: Clear all pending push timers
    pushDebounceTimers.forEach(timer => clearTimeout(timer));
    pushDebounceTimers.clear();
    clearStoredKeys();
    await supabase.auth.signOut();
    isSigningOutRef.current = false;
  };

  const signOut = async () => {
    await performSignOut(user?.id, false);
  };

  const refreshUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUser(user);
  };

  return (
    <AuthContext.Provider value={{ 
      session, 
      user, 
      loading, 
      encryptionStatus,
      signOut, 
      setupEncryption,
      unlockEncryption,
      refreshUser,
      registerThisDevice,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
