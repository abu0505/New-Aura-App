import type React from 'react';
import { useEffect } from 'react';
import { useChatSettings } from '../../hooks/useChatSettings';

function hexToRgba(hex: string, alpha: number) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
    : `rgba(201, 169, 110, ${alpha})`;
}

// Returns "R, G, B" channel string for use in rgba(var(--x-rgb), alpha) syntax
function hexToRgbChannels(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '201, 169, 110';
}

function adjustHex(hex: string, amount: number) {
  let usePound = false;
  if (hex[0] == "#") {
      hex = hex.slice(1);
      usePound = true;
  }
  let R = parseInt(hex.substring(0,2), 16);
  let G = parseInt(hex.substring(2,4), 16);
  let B = parseInt(hex.substring(4,6), 16);

  R = Math.max(0, Math.min(255, R + amount));
  G = Math.max(0, Math.min(255, G + amount));
  B = Math.max(0, Math.min(255, B + amount));

  let RR = ((R.toString(16).length==1)?"0"+R.toString(16):R.toString(16));
  let GG = ((G.toString(16).length==1)?"0"+G.toString(16):G.toString(16));
  let BB = ((B.toString(16).length==1)?"0"+B.toString(16):B.toString(16));

  return (usePound?"#":"") + RR + GG + BB;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useChatSettings();

  // Apply theme immediately from localStorage if available to prevent flash
  useEffect(() => {
    const cachedAccent = localStorage.getItem('aura_accent_color');
    const cachedDark = localStorage.getItem('aura_true_dark') === 'true';
    if (cachedAccent) {
      applyTheme(cachedAccent, cachedDark);
    }
  }, []);

  const applyTheme = (accentColor: string, isTrueDark: boolean) => {
    const root = document.documentElement;
    const lightColor = adjustHex(accentColor, 20); 
    const deepColor = adjustHex(accentColor, -30); 
    const glowColor = hexToRgba(accentColor, 0.15);
    
    // Core Accent Variables
    root.style.setProperty('--gold', accentColor);
    root.style.setProperty('--gold-light', lightColor);
    root.style.setProperty('--gold-deep', deepColor);
    root.style.setProperty('--gold-glow', glowColor);
    
    // Broad Mappings (Compatibility with Universal Sweep)
    root.style.setProperty('--primary', accentColor);
    // --primary-rgb: "R, G, B" channels for rgba(var(--primary-rgb), alpha) usage in components
    root.style.setProperty('--primary-rgb', hexToRgbChannels(accentColor));
    const bgColor = isTrueDark ? '#000000' : '#0C0C14';
    root.style.setProperty('--background', bgColor);
    // --background-rgb: same pattern for background channel usage
    root.style.setProperty('--background-rgb', hexToRgbChannels(bgColor));
    root.style.setProperty('--aura-bg-elevated', isTrueDark ? '#0a0a0a' : '#13131E');
    root.style.setProperty('--aura-text-primary', '#F0EDE8'); // Standard AURA text
    
    // Complex Mappings
    root.style.setProperty('--sender-bubble', accentColor);
    root.style.setProperty('--border-subtle', hexToRgba(accentColor, 0.12));
    root.style.setProperty('--border-medium', hexToRgba(accentColor, 0.25));

    // Functional Backgrounds
    if (isTrueDark) {
      root.style.setProperty('--bg-primary', '#000000');
      root.style.setProperty('--bg-secondary', '#0a0a0a');
    } else {
      root.style.setProperty('--bg-primary', '#0C0C14');
      root.style.setProperty('--bg-secondary', '#13131E');
    }

    // Persist to prevent flickering on next load
    localStorage.setItem('aura_accent_color', accentColor);
    localStorage.setItem('aura_true_dark', String(isTrueDark));
  };

  useEffect(() => {
    if (settings) {
      applyTheme(settings.accent_color || '#e6c487', settings.true_dark_mode);
    }
  }, [settings?.accent_color, settings?.true_dark_mode]);

  return <>{children}</>;
}

