/**
 * usePlatform.ts
 *
 * Single source of truth for platform detection across the entire app.
 *
 * Usage:
 *   const { isNative, isWeb } = usePlatform();
 *   if (isNative) { /* show Android-specific UI *\/ }
 *
 * Why a hook and not a direct Capacitor.isNativePlatform() call?
 *   1. Consistent import path across all components
 *   2. Easy to extend with more platform signals (tablet, iOS vs Android, etc.)
 *   3. Keeps components testable — mock this hook in tests
 */

import { Capacitor } from '@capacitor/core';

export interface PlatformInfo {
  /** True when running inside the native Android/iOS Capacitor shell */
  isNative: boolean;

  /** True when running in a regular web browser */
  isWeb: boolean;

  /** The OS platform string: 'android' | 'ios' | 'web' */
  platform: 'android' | 'ios' | 'web';

  /** True on Android (native only) */
  isAndroid: boolean;

  /** True on iOS (native only) */
  isIOS: boolean;
}

/**
 * Returns information about the current runtime platform.
 * This is a pure computation — no state, no effects, no re-renders.
 * Safe to call anywhere (hooks, components, utility functions).
 */
export function usePlatform(): PlatformInfo {
  const platform = Capacitor.getPlatform() as 'android' | 'ios' | 'web';
  const isNative = Capacitor.isNativePlatform();

  return {
    isNative,
    isWeb: !isNative,
    platform,
    isAndroid: platform === 'android',
    isIOS: platform === 'ios',
  };
}

/**
 * Non-hook version for use outside React components (utility files, services, etc.)
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = Capacitor.getPlatform() as 'android' | 'ios' | 'web';
  const isNative = Capacitor.isNativePlatform();

  return {
    isNative,
    isWeb: !isNative,
    platform,
    isAndroid: platform === 'android',
    isIOS: platform === 'ios',
  };
}
