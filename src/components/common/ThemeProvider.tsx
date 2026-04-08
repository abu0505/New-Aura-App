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
  let R = parseInt(hex.substring(0, 2), 16);
  let G = parseInt(hex.substring(2, 4), 16);
  let B = parseInt(hex.substring(4, 6), 16);

  R = Math.max(0, Math.min(255, R + amount));
  G = Math.max(0, Math.min(255, G + amount));
  B = Math.max(0, Math.min(255, B + amount));

  let RR = ((R.toString(16).length == 1) ? "0" + R.toString(16) : R.toString(16));
  let GG = ((G.toString(16).length == 1) ? "0" + G.toString(16) : G.toString(16));
  let BB = ((B.toString(16).length == 1) ? "0" + B.toString(16) : B.toString(16));

  return (usePound ? "#" : "") + RR + GG + BB;
}

/**
 * Computes the perceived luminance of a hex color (0.0 = black, 1.0 = white)
 * Used to decide whether text on accent backgrounds should be dark or light.
 */
function getLuminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 0.5;
  const [r, g, b] = [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ].map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

    // ── Shade Palette ────────────────────────────────────────────────────────
    const lightColor = adjustHex(accentColor, 28);   // lighter shade of accent
    const deepColor = adjustHex(accentColor, -40);   // darker shade of accent
    const veryDeep = adjustHex(accentColor, -80);    // very dark (for bg glow core)
    const glowColor = hexToRgba(accentColor, 0.15);

    // ── On-accent text color ─────────────────────────────────────────────────
    // Dynamically computed: dark text on light accents, light text on dark accents.
    // This replaces ALL hardcoded #412d00 occurrences via CSS variable.
    const luminance = getLuminance(accentColor);
    const onAccentText = luminance > 0.35 ? veryDeep : '#FFFFFF';

    // ── Core Accent Variables ────────────────────────────────────────────────
    root.style.setProperty('--gold', accentColor);
    root.style.setProperty('--gold-light', lightColor);
    root.style.setProperty('--gold-deep', deepColor);
    root.style.setProperty('--gold-glow', glowColor);

    // New: on-accent text — use this instead of hardcoded #412d00
    root.style.setProperty('--on-accent', onAccentText);

    // New: tinted background shades for icon backgrounds, card tints, etc.
    root.style.setProperty('--accent-subtle', hexToRgba(accentColor, 0.05));   // 5%  — very faint bg tint
    root.style.setProperty('--accent-muted', hexToRgba(accentColor, 0.12));    // 12% — soft borders/badges
    root.style.setProperty('--accent-soft', hexToRgba(accentColor, 0.20));     // 20% — noticeable tint
    root.style.setProperty('--accent-medium', hexToRgba(accentColor, 0.35));   // 35% — stronger highlight

    // ── Broad Compatibility Mappings ─────────────────────────────────────────
    root.style.setProperty('--primary', accentColor);
    root.style.setProperty('--primary-rgb', hexToRgbChannels(accentColor));

    const bgColor = isTrueDark ? '#000000' : '#0C0C14';
    root.style.setProperty('--background', bgColor);
    root.style.setProperty('--background-rgb', hexToRgbChannels(bgColor));

    const elevatedBg = isTrueDark ? '#0a0a0a' : '#13131E';
    root.style.setProperty('--bg-elevated', elevatedBg);
    root.style.setProperty('--bg-elevated-rgb', hexToRgbChannels(elevatedBg));
    root.style.setProperty('--aura-bg-elevated', elevatedBg);
    root.style.setProperty('--aura-text-primary', '#F0EDE8');

    // ── Complex Mappings ─────────────────────────────────────────────────────
    root.style.setProperty('--sender-bubble', accentColor);
    root.style.setProperty('--receiver-bubble', elevatedBg);
    root.style.setProperty('--border-subtle', hexToRgba(accentColor, 0.12));
    root.style.setProperty('--border-medium', hexToRgba(accentColor, 0.25));

    // ── Functional Backgrounds ───────────────────────────────────────────────
    if (isTrueDark) {
      root.style.setProperty('--bg-primary', '#000000');
      root.style.setProperty('--bg-secondary', '#0a0a0a');
    } else {
      root.style.setProperty('--bg-primary', '#0C0C14');
      root.style.setProperty('--bg-secondary', '#13131E');
    }

    // ── CSS native focus ring (replaces hardcoded rgba in index.css) ─────────
    root.style.setProperty('--focus-ring', hexToRgba(accentColor, 0.3));

    // ── Scrollbar accent ─────────────────────────────────────────────────────
    root.style.setProperty('--scrollbar-accent', hexToRgba(accentColor, 0.4));

    // ── Persist to prevent flickering on next load ───────────────────────────
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
