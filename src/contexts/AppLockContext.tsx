import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useChatSettings } from '../hooks/useChatSettings';

interface AppLockContextType {
  isLocked: boolean;
  hasAppPin: boolean;
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
  const { settings, setSharedPin, loading: settingsLoading } = useChatSettings();
  
  // By default, if settings are loading, we assume unlocked until we know otherwise
  // But we defer mounting the app in the App.tsx until loading is done anyway
  const [isUnlockedLocally, setIsUnlockedLocally] = useState<boolean>(false);

  // If a shared pin is present but we haven't unlocked it locally, it's locked.
  const hasAppPin = !!settings?.shared_pin;
  const isLocked = hasAppPin && !isUnlockedLocally;

  // Listen for tab close/refresh to ensure it locks again automatically.
  // We keep `isUnlockedLocally` purely in React state, meaning a reload naturally destroys it.
  
  const unlockApp = async (pin: string): Promise<boolean> => {
    if (!settings?.shared_pin) return true;
    const hashed = await hashPin(pin);
    if (hashed === settings.shared_pin) {
      setIsUnlockedLocally(true);
      return true;
    }
    return false;
  };

  const lockApp = () => {
    setIsUnlockedLocally(false);
  };

  const setAppPin = async (pin: string | null): Promise<boolean> => {
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
  };

  // If the partner removes the pin remotely, we should unlock the app
  useEffect(() => {
    if (!settingsLoading && !hasAppPin && !isUnlockedLocally) {
      setIsUnlockedLocally(true);
    }
  }, [hasAppPin, isUnlockedLocally, settingsLoading]);

  return (
    <AppLockContext.Provider value={{ isLocked, hasAppPin, unlockApp, setAppPin, lockApp }}>
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
