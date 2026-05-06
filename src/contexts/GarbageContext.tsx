import React, { createContext, useContext } from 'react';
import { useGarbage, type GarbageItem } from '../hooks/useGarbage';

export type { GarbageItem };

interface GarbageContextType {
  items: GarbageItem[];
  loading: boolean;
  isEmptying: boolean;
  count: number;
  totalSize: number;
  moveToGarbage: (
    messageId: string,
    cloudinaryPublicId: string,
    cloudName: string,
    mediaType: string,
    fileSize?: number | null
  ) => Promise<boolean>;
  removeFromGarbage: (garbageId: string) => Promise<boolean>;
  emptyGarbage: () => Promise<{ deleted: number; failed: number }>;
  refetch: () => Promise<void>;
}

const GarbageContext = createContext<GarbageContextType | null>(null);

export function GarbageProvider({ children }: { children: React.ReactNode }) {
  const garbage = useGarbage();
  return (
    <GarbageContext.Provider value={garbage}>
      {children}
    </GarbageContext.Provider>
  );
}

export function useGarbageContext(): GarbageContextType {
  const ctx = useContext(GarbageContext);
  if (!ctx) throw new Error('useGarbageContext must be used within GarbageProvider');
  return ctx;
}
