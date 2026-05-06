import React, { createContext, useContext } from 'react';
import { useChatSettings, type ChatSettings } from '../hooks/useChatSettings';

interface ChatSettingsContextType {
  settings: ChatSettings | null;
  loading: boolean;
  error: any;
  updateSettings: (updates: Partial<ChatSettings>) => Promise<{ error: any } | undefined>;
  setSharedPin: (newPinHash: string | null) => Promise<{ error: any }>;
  refreshSettings: () => Promise<void>;
}

const ChatSettingsContext = createContext<ChatSettingsContextType | null>(null);

export function ChatSettingsProvider({ children }: { children: React.ReactNode }) {
  const chatSettings = useChatSettings();
  return (
    <ChatSettingsContext.Provider value={chatSettings}>
      {children}
    </ChatSettingsContext.Provider>
  );
}

/**
 * Use this hook instead of useChatSettings() directly.
 * Returns the single shared instance — avoids N duplicate DB fetches.
 */
export function useChatSettingsContext(): ChatSettingsContextType {
  const ctx = useContext(ChatSettingsContext);
  if (!ctx) throw new Error('useChatSettingsContext must be used within ChatSettingsProvider');
  return ctx;
}
