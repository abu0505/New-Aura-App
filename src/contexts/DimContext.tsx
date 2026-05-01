import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface DimContextType {
  dimLevel: number; // 0 to 0.9 (0 = no dim, 0.9 = very dim)
  setDimLevel: (level: number) => void;
}

const DimContext = createContext<DimContextType | undefined>(undefined);

export function DimProvider({ children }: { children: ReactNode }) {
  const [dimLevel, setDimLevel] = useState(() => {
    const saved = localStorage.getItem('app-dim-level');
    return saved ? parseFloat(saved) : 0;
  });

  useEffect(() => {
    localStorage.setItem('app-dim-level', dimLevel.toString());
  }, [dimLevel]);

  return (
    <DimContext.Provider value={{ dimLevel, setDimLevel }}>
      <div 
        className="fixed inset-0 pointer-events-none z-[9999] transition-opacity duration-300 bg-black"
        style={{ opacity: dimLevel }}
      />
      {children}
    </DimContext.Provider>
  );
}

export function useDim() {
  const context = useContext(DimContext);
  if (context === undefined) {
    throw new Error('useDim must be used within a DimProvider');
  }
  return context;
}
