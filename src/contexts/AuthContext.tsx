import React, { createContext, useContext, useEffect, useState } from 'react';
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

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  encryptionStatus: EncryptionState;
  signOut: () => Promise<void>;
  setupEncryption: (pin: string) => Promise<void>;
  unlockEncryption: (pin: string) => Promise<boolean>;
  refreshUser: () => Promise<void>;
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
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionState>('initializing');

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
      console.error('Failed to setup encryption:', err);
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

  const signOut = async () => {
    // Mark offline immediately so the partner sees the change right away
    if (user) {
      try {
        await supabase.from('profiles').update({
          is_online: false,
          last_seen: new Date().toISOString(),
          status_message: null,
        }).eq('id', user.id);
      } catch (_) { /* best-effort */ }
    }
    clearStoredKeys();
    await supabase.auth.signOut();
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
      refreshUser
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
