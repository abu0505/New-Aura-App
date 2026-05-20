/**
 * nativeCameraXBridge.ts
 *
 * TypeScript bridge to the native Android CameraX plugin.
 * This module provides a clean, type-safe API for the React UI to access
 * native camera hardware features like HDR, Night Mode, Bokeh, and
 * tap-to-focus — features that are impossible through the browser's
 * getUserMedia() API.
 *
 * On web/desktop, all methods return graceful fallbacks (no-ops or empty results).
 * On native Android, they route through Capacitor's bridge to the Kotlin plugin.
 *
 * Usage in MobileCameraModal:
 *   import { nativeCameraX } from '../../lib/nativeCameraXBridge';
 *   const exts = await nativeCameraX.getSupportedExtensions();
 *   await nativeCameraX.startPreview({ lensFacing: 'BACK', extensionMode: 'NIGHT' });
 *   const photo = await nativeCameraX.capturePhoto({ quality: 95 });
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ExtensionMode = 'NONE' | 'HDR' | 'NIGHT' | 'BOKEH' | 'FACE_RETOUCH' | 'AUTO';
export type LensFacing = 'BACK' | 'FRONT';

export interface SupportedExtensions {
  back: ExtensionMode[];
  front: ExtensionMode[];
}

export interface ZoomInfo {
  min: number;
  max: number;
  current: number;
}

export interface StartPreviewOptions {
  lensFacing?: LensFacing;
  extensionMode?: ExtensionMode;
}

export interface StartPreviewResult {
  started: boolean;
  extensionApplied: boolean;
  lensFacing: LensFacing;
  zoom?: ZoomInfo;
}

export interface CapturePhotoOptions {
  quality?: number;   // 1-100, default 92
}

export interface CapturePhotoResult {
  dataUrl: string;    // data:image/jpeg;base64,...
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

export interface CameraInfo {
  hasFlash: boolean;
  isFrontFacing: boolean;
  zoom?: ZoomInfo;
  sensorRotation: number;
}

// ── Native Plugin Interface ────────────────────────────────────────────────────

interface NativeCameraXPluginInterface {
  getSupportedExtensions(): Promise<SupportedExtensions>;
  startPreview(options: StartPreviewOptions): Promise<StartPreviewResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  capturePhoto(options: CapturePhotoOptions): Promise<CapturePhotoResult>;
  setZoom(options: { level: number }): Promise<{ zoom: number }>;
  setFocusPoint(options: { x: number; y: number }): Promise<{ focused: boolean }>;
  setTorch(options: { enabled: boolean }): Promise<{ torch: boolean }>;
  switchExtension(options: { extensionMode: ExtensionMode; lensFacing?: LensFacing }): Promise<StartPreviewResult>;
  getCameraInfo(): Promise<CameraInfo>;
}

// Register the plugin — on web this returns a proxy that throws "not implemented"
const NativeCameraXRaw = registerPlugin<NativeCameraXPluginInterface>('NativeCameraX');

// ── Safe Wrapper (graceful fallbacks on web) ───────────────────────────────────

class NativeCameraXBridge {
  private _isNative = Capacitor.isNativePlatform();

  /** Check if native camera is available */
  get isAvailable(): boolean {
    return this._isNative;
  }

  /** Get supported camera extensions for front and back cameras */
  async getSupportedExtensions(): Promise<SupportedExtensions> {
    if (!this._isNative) return { back: [], front: [] };
    try {
      return await NativeCameraXRaw.getSupportedExtensions();
    } catch (e) {
      console.warn('[NativeCameraX] getSupportedExtensions failed:', e);
      return { back: [], front: [] };
    }
  }

  /** Start native camera preview behind WebView */
  async startPreview(options: StartPreviewOptions = {}): Promise<StartPreviewResult | null> {
    if (!this._isNative) return null;
    try {
      return await NativeCameraXRaw.startPreview(options);
    } catch (e) {
      console.error('[NativeCameraX] startPreview failed:', e);
      return null;
    }
  }

  /** Stop native camera preview */
  async stopPreview(): Promise<boolean> {
    if (!this._isNative) return false;
    try {
      await NativeCameraXRaw.stopPreview();
      return true;
    } catch (e) {
      console.warn('[NativeCameraX] stopPreview failed:', e);
      return false;
    }
  }

  /**
   * Capture a full-resolution photo using the native CameraX pipeline.
   * When an extension (HDR/Night/Bokeh) is active, the photo will have
   * that OEM processing applied — identical to stock camera app quality.
   */
  async capturePhoto(options: CapturePhotoOptions = {}): Promise<CapturePhotoResult | null> {
    if (!this._isNative) return null;
    try {
      return await NativeCameraXRaw.capturePhoto(options);
    } catch (e) {
      console.error('[NativeCameraX] capturePhoto failed:', e);
      return null;
    }
  }

  /** Set optical/hardware zoom level */
  async setZoom(level: number): Promise<number> {
    if (!this._isNative) return level;
    try {
      const result = await NativeCameraXRaw.setZoom({ level });
      return result.zoom;
    } catch (e) {
      console.warn('[NativeCameraX] setZoom failed:', e);
      return level;
    }
  }

  /** Trigger tap-to-focus at normalized coordinates (0-1) */
  async setFocusPoint(x: number, y: number): Promise<boolean> {
    if (!this._isNative) return false;
    try {
      await NativeCameraXRaw.setFocusPoint({ x, y });
      return true;
    } catch (e) {
      console.warn('[NativeCameraX] setFocusPoint failed:', e);
      return false;
    }
  }

  /** Toggle torch/flashlight */
  async setTorch(enabled: boolean): Promise<boolean> {
    if (!this._isNative) return false;
    try {
      await NativeCameraXRaw.setTorch({ enabled });
      return true;
    } catch (e) {
      console.warn('[NativeCameraX] setTorch failed:', e);
      return false;
    }
  }

  /** Switch camera extension mode (HDR, Night, etc.) without full restart */
  async switchExtension(mode: ExtensionMode, lensFacing?: LensFacing): Promise<StartPreviewResult | null> {
    if (!this._isNative) return null;
    try {
      return await NativeCameraXRaw.switchExtension({
        extensionMode: mode,
        lensFacing
      });
    } catch (e) {
      console.error('[NativeCameraX] switchExtension failed:', e);
      return null;
    }
  }

  /** Get current camera hardware info */
  async getCameraInfo(): Promise<CameraInfo | null> {
    if (!this._isNative) return null;
    try {
      return await NativeCameraXRaw.getCameraInfo();
    } catch (e) {
      console.warn('[NativeCameraX] getCameraInfo failed:', e);
      return null;
    }
  }
}

// Singleton export
export const nativeCameraX = new NativeCameraXBridge();
