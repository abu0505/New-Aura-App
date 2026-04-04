import type React from 'react';
import { useEffect } from 'react';
import { useChatSettings } from '../../hooks/useChatSettings';

function hexToRgba(hex: string, alpha: number) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`
    : `rgba(201, 169, 110, ${alpha})`;
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

  R = R + amount;
  G = G + amount;
  B = B + amount;

  if (R > 255) R = 255;
  else if (R < 0) R = 0;

  if (G > 255) G = 255;
  else if (G < 0) G = 0;

  if (B > 255) B = 255;
  else if (B < 0) B = 0;

  let RR = ((R.toString(16).length==1)?"0"+R.toString(16):R.toString(16));
  let GG = ((G.toString(16).length==1)?"0"+G.toString(16):G.toString(16));
  let BB = ((B.toString(16).length==1)?"0"+B.toString(16):B.toString(16));

  return (usePound?"#":"") + RR + GG + BB;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useChatSettings();

  useEffect(() => {
    // We only set these if settings exist, to avoid flipping back to default abruptly
    // However, for unauthenticated contexts or initial load we might want a base scheme.
    const accentColor = settings?.accent_color || '#e6c487';
    const isTrueDark = settings?.true_dark_mode || false;
    
    // Compute variants for the accent color
    const lightColor = adjustHex(accentColor, 20); // lighten
    const deepColor = adjustHex(accentColor, -30); // darken
    const glowColor = hexToRgba(accentColor, 0.15);
    
    const root = document.documentElement;
    root.style.setProperty('--gold', accentColor);
    root.style.setProperty('--gold-light', lightColor);
    root.style.setProperty('--gold-deep', deepColor);
    root.style.setProperty('--gold-glow', glowColor);
    
    // Sender bubble gradient updates automatically since it references these CSS variables
    // Wait, the index.css might have hardcoded the sender bubble using old values.
    // We update it here explicitly just in case:
    root.style.setProperty('--sender-bubble', `linear-gradient(135deg, ${accentColor}, ${deepColor})`);

    // True Dark Mode
    if (isTrueDark) {
      root.style.setProperty('--bg-primary', '#000000');
      root.style.setProperty('--bg-secondary', '#0a0a0a');
    } else {
      root.style.setProperty('--bg-primary', '#0C0C14');
      root.style.setProperty('--bg-secondary', '#13131E');
    }
  }, [settings?.accent_color, settings?.true_dark_mode]);

  return <>{children}</>;
}
