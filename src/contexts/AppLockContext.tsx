import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useChatSettingsContext } from './ChatSettingsContext';
import { fetchDiverseMediaPool } from '../utils/feedPool';

let prefetchFeedPromise: Promise<any[]> | null = null;

export function prefetchFeed(userId: string, partnerId: string) {
  if (prefetchFeedPromise) return; // already prefetching or prefetched
  
  console.log('[AppLockContext] Starting background prefetch of diverse feed pool...');
  prefetchFeedPromise = (async () => {
    try {
      return await fetchDiverseMediaPool(userId, partnerId, {
        recentLimit: 30,
        middleLimit: 60,
        oldLimit: 60,
      });
    } catch (e) {
      console.error('[AppLockContext] Background prefetch failed:', e);
      return [];
    }
  })();
}

export function getPrefetchedFeed(): Promise<any[]> | null {
  return prefetchFeedPromise;
}

export function clearPrefetchedFeed() {
  prefetchFeedPromise = null;
}

interface AppLockContextType {
  isLocked: boolean;
  hasAppPin: boolean;
  isLoading: boolean;
  unlockApp: (pin: string) => Promise<boolean>;
  setAppPin: (pin: string | null) => Promise<boolean>;
  lockApp: () => void;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { settings, setSharedPin, loading: settingsLoading, error: settingsError } = useChatSettingsContext();
  
  // By default, if settings are loading, we assume unlocked until we know otherwise
  // But we defer mounting the app in the App.tsx until loading is done anyway
  const [isUnlockedLocally, setIsUnlockedLocally] = useState<boolean>(false);

  // If a shared pin is present but we haven't unlocked it locally, it's locked.
  // Exception: If Stealth Mode is active, bypass the lock to look like a simple notes app.
  const hasAppPin = !!settings?.shared_pin;
  const [isStealth, setIsStealth] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('aura_stealth_mode') === 'true';
  });

  useEffect(() => {
    const handleStealthChange = () => {
      setIsStealth(localStorage.getItem('aura_stealth_mode') === 'true');
    };
    window.addEventListener('stealth-mode-change', handleStealthChange);
    return () => window.removeEventListener('stealth-mode-change', handleStealthChange);
  }, []);

  const isLocked = hasAppPin && !isUnlockedLocally && !isStealth;

  // Distinguish between 'no settings' (new user) and 'settings failed to load' (error)
  const isLoading = settingsLoading || (settingsError && !settings);

  // Listen for tab close/refresh to ensure it locks again automatically.
  // We keep `isUnlockedLocally` purely in React state, meaning a reload naturally destroys it.
  
  const unlockApp = useCallback(async (pin: string): Promise<boolean> => {
    if (!settings?.shared_pin) return true;
    const hashed = await hashPin(pin);
    if (hashed === settings.shared_pin) {
      setIsUnlockedLocally(true);
      return true;
    }
    return false;
  }, [settings?.shared_pin]);

  const lockApp = useCallback(() => {
    setIsUnlockedLocally(false);
  }, []);

  const setAppPin = useCallback(async (pin: string | null): Promise<boolean> => {
    if (pin === null) {
      // Remove PIN
      const { error } = await setSharedPin(null);
      if (!error) setIsUnlockedLocally(true);
      return !error;
    } else {
      // Set new PIN
      const hashed = await hashPin(pin);
      const { error } = await setSharedPin(hashed);
      if (!error) setIsUnlockedLocally(true); // Automatically unlocked upon setting
      return !error;
    }
  }, [setSharedPin]);

  // If the partner removes the pin remotely, we should unlock the app
  useEffect(() => {
    if (!isLoading && !hasAppPin && !isUnlockedLocally) {
      setIsUnlockedLocally(true);
    }
  }, [hasAppPin, isUnlockedLocally, isLoading]);

  // ═══ PERF: Memoize context value ═══
  const contextValue = useMemo(() => ({
    isLocked, hasAppPin, isLoading, unlockApp, setAppPin, lockApp
  }), [isLocked, hasAppPin, isLoading, unlockApp, setAppPin, lockApp]);

  return (
    <AppLockContext.Provider value={contextValue}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (context === undefined) {
    throw new Error('useAppLock must be used within an AppLockProvider');
  }
  return context;
}
