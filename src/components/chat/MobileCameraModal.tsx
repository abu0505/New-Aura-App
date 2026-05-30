import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { destroyDenoiser } from '../../utils/imageDenoiser';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import {
  setActiveVideoTrack,
  detectNativeSensorCapabilities,
  applyTapToFocus,
  applyOpticalZoom,
  applyTorch,
  applyNightMode,
  resetNativeCameraState,
  type SensorCapabilities,
  type CameraLens,
} from '../../lib/nativeCameraService';
import { nativeCameraX, type ExtensionMode } from '../../lib/nativeCameraXBridge';

interface MobileCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (file: File, caption: string, duration?: number) => void;
  onGallerySelect: (files: File[], caption: string) => void;
}

const MobileCameraModal: React.FC<MobileCameraModalProps> = ({
  isOpen,
  onClose,
  onSend,
  onGallerySelect,
}) => {
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // States: 'camera' | 'preview'
  const [viewMode, setViewMode] = useState<'camera' | 'preview'>('camera');

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Premium Features States
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [showShutterFlash, setShowShutterFlash] = useState(false);

  // ── Timer States ─────────────────────────────────────────────────────────────
  // timerDuration: 0 = off, 3 = 3s, 5 = 5s, 10 = 10s
  const [timerDuration, setTimerDuration] = useState<0 | 3 | 5 | 10>(3);
  const [timerActive, setTimerActive] = useState(false); // true = user activated timer
  const [timerCountdown, setTimerCountdown] = useState<number | null>(null); // current countdown value shown on screen
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Background Noise Reduction States
  const [enhancedFile, setEnhancedFile] = useState<File | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [enhancementStatus, setEnhancementStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
  const [isEnhancedView, setIsEnhancedView] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [shimmerKey, setShimmerKey] = useState(0); // For forcing re-animation

  // Captured Media
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // ── Multi-Shot States ─────────────────────────────────────────────────────
  const [isMultiShotMode, setIsMultiShotMode] = useState(false);
  const [multiShotFiles, setMultiShotFiles] = useState<Array<{ file: File; url: string }>>([]);
  // Index of the currently-visible slide in carousel preview
  const [carouselIndex, setCarouselIndex] = useState(0);
  // Whether we entered preview via multi-shot (drives carousel UI)
  const [isMultiShotPreview, setIsMultiShotPreview] = useState(false);

  // Settings
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3' | '9:16' | '16:9'>('9:16');
  const [fpsSetting, setFpsSetting] = useState<'30' | '60'>('30');
  const [showSettings, setShowSettings] = useState(false);

  // Hardware capability
  const [device4kSupported, setDevice4kSupported] = useState<boolean | null>(null);
  const [device60fpsSupported, setDevice60fpsSupported] = useState<boolean | null>(null);

  // ── Native Sensor States ────────────────────────────────────────────────────
  const [sensorCaps, setSensorCaps] = useState<SensorCapabilities | null>(null);
  const [availableLenses, setAvailableLenses] = useState<CameraLens[]>([]);
  const [activeLensId, setActiveLensId] = useState<CameraLens['id']>('main');
  const [isNightMode, setIsNightMode] = useState(false);
  // ── Native CameraX Extension Mode ─────────────────────────────────────────
  // Tracks which OEM extension is currently active (HDR, NIGHT, BOKEH, etc.)
  const [activeExtension, setActiveExtension] = useState<ExtensionMode>('NONE');
  const isNativeCameraActive = nativeCameraX.isAvailable && (activeExtension !== 'NONE');
  // Focus ring — shown briefly at the tap point
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null);
  const focusRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(0);

  // WebCodecs / Worker refs (Telegram-style architecture)
  const cameraWorkerRef = useRef<Worker | null>(null);
  const videoProcessorRef = useRef<ReadableStreamDefaultReader<VideoFrame> | null>(null);
  const audioProcessorRef = useRef<ReadableStreamDefaultReader<AudioData> | null>(null);
  const isWorkerRecordingRef = useRef(false);

  // Debounce ref to prevent rapid camera restarts on settings toggle
  const cameraRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPosRef = useRef<{ x: number, y: number } | null>(null);
  const zoomRef = useRef<{ current: number, min: number, max: number }>({ current: 1, min: 1, max: 1 });
  const hasHardwareZoomRef = useRef(false);
  // Pinch-to-zoom state
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);

  const shutterControls = useAnimation();
  const lockIconControls = useAnimation();
  const countdownControls = useAnimation();

  // Premium: Synthetic Shutter Sound
  const playShutterSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      
    }
  }, []);

  // --- Device Tier Detection ---
  const getDeviceTier = useCallback((): 'low' | 'high' => {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as any).deviceMemory || 4;
    if (cores < 6 || memory < 6) return 'low';
    return 'high';
  }, []);

  // --- 4K Capability Check ---
  // Probes whether the device's VideoEncoder can actually handle 4K H.264.
  // Sets device4kSupported once on camera open. No stream needed — isConfigSupported is a dry-run.
  useEffect(() => {
    if (!isOpen || device4kSupported !== null) return;
    (async () => {
      try {
        if (typeof VideoEncoder === 'undefined') { setDevice4kSupported(false); return; }
        const result = await VideoEncoder.isConfigSupported({
          codec: 'avc1.640034',
          width: 3840, height: 2160,
          bitrate: 20_000_000,
          framerate: 30,
          hardwareAcceleration: 'prefer-hardware',
        });
        setDevice4kSupported(result.supported ?? false);
      } catch {
        setDevice4kSupported(false);
      }
    })();
  }, [isOpen, device4kSupported]);

  // --- 60 FPS Capability Check ---
  useEffect(() => {
    if (!isOpen || device60fpsSupported !== null) return;
    (async () => {
      try {
        if (typeof VideoEncoder === 'undefined') { setDevice60fpsSupported(false); return; }
        const result = await VideoEncoder.isConfigSupported({
          codec: 'avc1.42001f', // Use Baseline for broader capability check
          width: 1920, height: 1080,
          bitrate: 4_000_000,
          framerate: 60,
          hardwareAcceleration: 'prefer-hardware',
        });
        setDevice60fpsSupported(result.supported ?? false);
      } catch {
        setDevice60fpsSupported(false);
      }
    })();
  }, [isOpen, device60fpsSupported]);

  // --- Worker lifecycle ---
  // Pre-initialize the camera worker when the modal opens so it is instantly ready.
  useEffect(() => {
    if (isOpen) {
      if (!cameraWorkerRef.current) {
        cameraWorkerRef.current = new Worker(
          new URL('../../workers/camera.worker.ts', import.meta.url),
          { type: 'module' }
        );
      }
    } else {
      // Terminate worker on close to free memory
      if (cameraWorkerRef.current) {
        cameraWorkerRef.current.terminate();
        cameraWorkerRef.current = null;
      }
    }
  }, [isOpen]);

  // Stop camera feed
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsFlashOn(false);
    // Deregister track from native service
    setActiveVideoTrack(null);
  }, []);

  // Start camera feed
  const startCamera = useCallback(async () => {
    stopCamera();
    try {
      // ── NATIVE PERMISSION FIX ──────────────────────────────────────────────
      // On Android, the WebView often fails to trigger the OS permission dialog
      // for getUserMedia if the app hasn't explicitly requested it via the plugin.
      //
      // CRITICAL: We ONLY request 'camera' permission — NOT 'photos'.
      // Requesting 'photos' on Android 13+ triggers a separate system Activity
      // (the media picker permission UI) which pauses MainActivity, eventually
      // causing the WebView renderer to be OOM-killed and the process to restart.
      // This wipes React state and forces the PIN lock screen back up.
      //
      // We also check if permission is already granted BEFORE calling
      // requestPermissions, to avoid any unnecessary system dialog that could
      // briefly background the app.
      if (Capacitor.isNativePlatform()) {
        let cameraStatus: string;
        try {
          const current = await Camera.checkPermissions();
          cameraStatus = current.camera;
        } catch {
          // checkPermissions not available on older plugin versions — fall through to request
          cameraStatus = 'prompt';
        }

        if (cameraStatus !== 'granted') {
          // Only call requestPermissions if not yet granted.
          // Only request 'camera' — 'photos' triggers a separate Activity on Android 13+.
          const status = await Camera.requestPermissions({ permissions: ['camera'] });
          if (status.camera !== 'granted') {
            setHasPermission(false);
            return;
          }
        }
      }

      const tier = getDeviceTier();
      
      // LIGHTWEIGHT ARCHITECTURE FIX:
      // Requesting 4K on mid/low tier devices causes severe lag and frame drops.
      // We now dynamically request resolution based on device capability and user setting.
      // We use 'crop-and-scale' to ask the browser to handle FOV consistently if possible.
      let targetWidth = 1920;
      let targetHeight = 1080;

      if (resolution === '4k') {
        targetWidth = tier === 'high' ? 3840 : 1920; // Cap 4K to 1080p on low-end
        targetHeight = tier === 'high' ? 2160 : 1080;
      } else if (resolution === '720p') {
        targetWidth = 1280;
        targetHeight = 720;
      }

      const targetFps = fpsSetting === '60' ? 60 : 30;

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: targetWidth },
          height: { ideal: targetHeight },
          // Remove strict min/max to prevent OverconstrainedError on devices that don't support exact framerates
          frameRate: { ideal: targetFps },
          // Disable software noise suppression on video to save CPU on mid/low tier
          noiseSuppression: tier === 'high',
          ...({ resizeMode: 'crop-and-scale' } as any),
        },
        // IMPORTANT: Do NOT request audio for the viewfinder/photo stream.
        // Requesting audio triggers RECORD_AUDIO permission check in WebView
        // which can fail and cause the entire getUserMedia to be denied.
        // Audio is only added when starting video recording.
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Apply steady exposure/WB after stream is active (Chrome 92+ / Android)
      try {
        const videoTrack = stream.getVideoTracks()[0];
        await videoTrack.applyConstraints({
          advanced: [
            { exposureMode: 'continuous' } as any,
            { whiteBalanceMode: 'continuous' } as any,
          ]
        });
      } catch (_) { /* gracefully ignore on unsupported devices */ }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setHasPermission(true);

      const track = stream.getVideoTracks()[0];

      // ── Register track with native camera service ──────────────────────────
      setActiveVideoTrack(track);

      // Probe capabilities asynchronously (doesn't block viewfinder)
      detectNativeSensorCapabilities().then(caps => {
        setSensorCaps(caps);
        setAvailableLenses(caps.lenses);
      }).catch(() => {});

      const capabilities: any = track.getCapabilities();
      if (capabilities.zoom) {
        hasHardwareZoomRef.current = true;
        zoomRef.current = {
          current: track.getSettings().zoom || capabilities.zoom.min || 1,
          min: capabilities.zoom.min || 1,
          max: capabilities.zoom.max || 5
        };
      } else {
        hasHardwareZoomRef.current = false;
        zoomRef.current = { current: 1, min: 1, max: 5 };
      }
    } catch (error) {
      console.error('[MobileCameraModal] getUserMedia failed:', error);
      setHasPermission(false);
    }
  }, [facingMode, stopCamera, resolution, getDeviceTier]);

  // Fix 3.3: Debounce camera start (wait 200ms) to prevent overlapping streams
  // on rapid facingMode/resolution/aspectRatio setting changes
  useEffect(() => {
    if (isOpen && viewMode === 'camera') {
      if (cameraRestartTimerRef.current) clearTimeout(cameraRestartTimerRef.current);
      cameraRestartTimerRef.current = setTimeout(() => {
        startCamera();
      }, 200);
    } else {
      if (cameraRestartTimerRef.current) clearTimeout(cameraRestartTimerRef.current);
      stopCamera();
    }
    return () => {
      if (cameraRestartTimerRef.current) clearTimeout(cameraRestartTimerRef.current);
      stopCamera();
    };
  }, [isOpen, viewMode, facingMode, startCamera, stopCamera]);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!isOpen) {
      setCapturedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setViewMode('camera');
      setIsRecording(false);
      setIsLocked(false);
      setRecordingTime(0);
      setEnhancementStatus('idle');
      setIsEnhancedView(false);
      setEnhancedFile(null);
      if (enhancedUrl) URL.revokeObjectURL(enhancedUrl);
      setEnhancedUrl(null);
      setShowShimmer(false);
      // Reset worker recording flag and hardware probes so they re-run on next open
      isWorkerRecordingRef.current = false;
      setDevice4kSupported(null);
      setDevice60fpsSupported(null);
      // Reset multi-shot state
      setIsMultiShotMode(false);
      setMultiShotFiles(prev => { prev.forEach(f => URL.revokeObjectURL(f.url)); return []; });
      setCarouselIndex(0);
      setIsMultiShotPreview(false);

      // FIX: Stop native CameraX preview on close so it doesn't stay
      // open behind the WebView after navigating away from the camera.
      if (activeExtension !== 'NONE') {
        nativeCameraX.stopPreview();
        setActiveExtension('NONE');
        setIsNightMode(false);
      }
    }
    // Release WebGL context and Web Worker when camera closes
    return () => {
      destroyDenoiser();
      resetNativeCameraState();
      // Also stop native preview on unmount
      nativeCameraX.stopPreview();
    };
  }, [isOpen, previewUrl]);

  // Flip Camera
  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  // Toggle Torch/Flash (now routed through native service)
  const toggleTorch = async () => {
    if (facingMode === 'user') {
      // Front camera — soft flash (white overlay handled in JSX)
      setIsFlashOn(!isFlashOn);
      return;
    }
    const newStatus = !isFlashOn;
    const applied = await applyTorch(newStatus);
    // If native torch worked OR it's a fallback, still update UI state
    setIsFlashOn(applied ? newStatus : newStatus);
  };

  // Toggle Night Mode — uses native CameraX Extension when available
  // FIX Bug 4: Stop WebRTC stream before starting native CameraX to avoid
  // hardware lock conflict (camera is an exclusive resource on Android).
  const toggleNightMode = useCallback(async () => {
    const next = !isNightMode;
    setIsNightMode(next);

    if (nativeCameraX.isAvailable && sensorCaps?.hasNativeCameraX) {
      const newMode: ExtensionMode = next ? 'NIGHT' : 'NONE';
      const facing = facingMode === 'user' ? 'FRONT' : 'BACK';

      if (next) {
        // ENABLING Night Mode: release WebRTC camera first, then start native
        stopCamera();
        const result = await nativeCameraX.switchExtension(newMode, facing);
        if (result) {
          setActiveExtension('NIGHT');
        } else {
          // Native switch failed — restart WebRTC stream
          startCamera();
        }
      } else {
        // DISABLING Night Mode: stop native preview, restart WebRTC
        await nativeCameraX.stopPreview();
        setActiveExtension('NONE');
        startCamera();
      }
    } else {
      // Web fallback: exposure compensation boost
      await applyNightMode(next);
    }
  }, [isNightMode, sensorCaps, facingMode, stopCamera, startCamera]);

  // Toggle HDR Mode — uses native CameraX Extension
  // FIX Bug 4: Same hardware lock fix as toggleNightMode
  const toggleHDR = useCallback(async () => {
    const isCurrentlyHDR = activeExtension === 'HDR';
    const newMode: ExtensionMode = isCurrentlyHDR ? 'NONE' : 'HDR';

    if (nativeCameraX.isAvailable && sensorCaps?.hasNativeCameraX) {
      const facing = facingMode === 'user' ? 'FRONT' : 'BACK';

      if (!isCurrentlyHDR) {
        // ENABLING HDR: release WebRTC camera first, then start native
        stopCamera();
        const result = await nativeCameraX.switchExtension(newMode, facing);
        if (result) {
          setActiveExtension('HDR');
          setIsNightMode(false);
        } else {
          // Native switch failed — restart WebRTC stream
          startCamera();
        }
      } else {
        // DISABLING HDR: stop native preview, restart WebRTC
        await nativeCameraX.stopPreview();
        setActiveExtension('NONE');
        startCamera();
      }
    }
  }, [activeExtension, sensorCaps, facingMode, stopCamera, startCamera]);

  // Tap-to-focus handler
  const handleTapToFocus = useCallback(async (e: React.MouseEvent<HTMLVideoElement>) => {
    if (isRecording) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Show focus ring at tap point
    setFocusRing({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (focusRingTimerRef.current) clearTimeout(focusRingTimerRef.current);
    focusRingTimerRef.current = setTimeout(() => setFocusRing(null), 1200);

    await applyTapToFocus({ x, y });
  }, [isRecording]);

  // Switch physical lens
  const switchLens = useCallback(async (lens: CameraLens) => {
    if (lens.id === activeLensId) return;
    setActiveLensId(lens.id);
    // Restart camera with the selected deviceId / facingMode
    stopCamera();
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          ...(lens.deviceId ? { deviceId: { exact: lens.deviceId } } : { facingMode: lens.facingMode }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setHasPermission(true);
      const track = stream.getVideoTracks()[0];
      setActiveVideoTrack(track);
      detectNativeSensorCapabilities().then(caps => setSensorCaps(caps)).catch(() => {});
      const caps: any = track.getCapabilities();
      hasHardwareZoomRef.current = Boolean(caps.zoom);
      zoomRef.current = caps.zoom
        ? { current: caps.zoom.min ?? 1, min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 5 }
        : { current: 1, min: 1, max: 5 };
    } catch {
      setHasPermission(false);
    }
  }, [activeLensId, stopCamera]);

  // --- Photo Capture (Mobile-Optimized: ImageBitmap zero-copy pipeline) ---
  // NOTE: We intentionally do NOT use Camera.getPhoto() / captureNativePhoto() here.
  // Calling Camera.getPhoto() launches an external OS camera Activity, which puts
  // the Capacitor app into the background. On Android, this causes the WebView
  // renderer to crash (OOM) and the app to fully restart — wiping React state and
  // forcing the PIN lock screen. The getUserMedia() + canvas path below works
  // perfectly within the in-app WebRTC viewfinder on both web and native Android.
  const takePhoto = useCallback(async () => {
    if (!videoRef.current) return;

    // SFX & Flash UX
    playShutterSound();
    setShowShutterFlash(true);
    setTimeout(() => setShowShutterFlash(false), 100);
    if (navigator.vibrate) navigator.vibrate(50);

    // ── NATIVE CAMERAX CAPTURE PATH ──────────────────────────────────────────
    // When a CameraX extension (HDR/Night/Bokeh) is active, capture through
    // the native pipeline. This gives us the full ISP-processed photo with
    // OEM computational photography applied — dramatically better quality
    // than the WebView canvas capture, especially in low light and HDR scenes.
    if (nativeCameraX.isAvailable && activeExtension !== 'NONE' && isNativeCameraActive) {
      try {
        const nativeResult = await nativeCameraX.capturePhoto({ quality: 95 });
        if (nativeResult) {
          // Convert data URL to File
          const res = await fetch(nativeResult.dataUrl);
          const blob = await res.blob();
          const file = new File([blob], `native_${activeExtension.toLowerCase()}_${Date.now()}.jpg`, { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          // Multi-shot path: append, don't navigate
          if (isMultiShotMode) {
            setMultiShotFiles(prev => prev.length >= 10 ? prev : [...prev, { file, url }]);
            return;
          }
          setCapturedFile(file);
          setPreviewUrl(url);
          setViewMode('preview');
          setEnhancementStatus('idle');
          return; // Skip canvas path
        }
      } catch (err) {
        console.warn('[Camera] Native capture failed, falling back to canvas:', err);
        // Fall through to canvas capture below
      }
    }

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Compute canvas dimensions for the chosen aspect ratio
    let targetRatio = 9 / 16;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3 / 4;
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;

    let cw: number, ch: number;
    const testH = vw / targetRatio;
    if (testH <= vh) { cw = vw; ch = testH; }
    else { ch = vh; cw = vh * targetRatio; }
    cw = Math.round(cw);
    ch = Math.round(ch);

    const offsetX = (vw - cw) / 2;
    const offsetY = (vh - ch) / 2;
    const zoom = hasHardwareZoomRef.current ? 1 : zoomRef.current.current;
    const isFront = facingMode === 'user';

    // MOBILE OPTIMIZATION: Resolution-adaptive quality.
    // At 4K, lower quality still looks perfect but encodes 3-4x faster.
    const webpQuality = resolution === '4k' ? 0.80 : resolution === '1080p' ? 0.85 : 0.88;

    // MOBILE OPTIMIZATION: Use createImageBitmap() for zero-copy GPU frame grab.
    // Unlike getImageData(), this does NOT readback pixels to CPU — it stays on GPU.
    // This is the single biggest speedup for high-res capture on mobile.
    try {
      // Grab a single frame as an ImageBitmap (GPU-side, zero CPU copy)
      const bitmap = await createImageBitmap(
        video,
        offsetX, offsetY, cw, ch,
        { resizeWidth: cw, resizeHeight: ch }
      );

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;

      ctx.save();
      if (isFront) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      if (!hasHardwareZoomRef.current && zoom !== 1) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
      }
      ctx.drawImage(bitmap, 0, 0, cw, ch);
      ctx.restore();
      bitmap.close(); // Free GPU memory immediately

      // toBlob is still on main thread but canvas is already drawn — no getImageData needed.
      // MOBILE OPTIMIZATION: Use JPEG for 4K (3-5x faster encoding than WebP at same quality).
      // WebP encoder on mobile is software-only; JPEG uses hardware on Android/iOS.
      const useJpeg = resolution === '4k';
      const mimeType = useJpeg ? 'image/jpeg' : 'image/webp';
      const ext = useJpeg ? 'jpg' : 'webp';
      const quality = useJpeg ? 0.88 : webpQuality;

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `photo_${Date.now()}.${ext}`, { type: mimeType });
          const url = URL.createObjectURL(blob);
          // ── MULTI-SHOT PATH: append to list, stay on camera ───────────────
          if (isMultiShotMode) {
            setMultiShotFiles(prev => {
              if (prev.length >= 10) return prev; // hard cap at 10
              return [...prev, { file, url }];
            });
            return; // do NOT navigate to preview yet
          }
          // ── SINGLE SHOT PATH ──────────────────────────────────────────────
          setCapturedFile(file);
          setPreviewUrl(url);
          setViewMode('preview');
          setEnhancementStatus('idle');
        }
      }, mimeType, quality);

    } catch (err) {
      // Fallback: classic canvas path if createImageBitmap not supported
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.save();
      if (isFront) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, offsetX, offsetY, cw, ch, 0, 0, cw, ch);
      ctx.restore();
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `photo_${Date.now()}.webp`, { type: 'image/webp' });
          const url = URL.createObjectURL(blob);
          if (isMultiShotMode) {
            setMultiShotFiles(prev => prev.length >= 10 ? prev : [...prev, { file, url }]);
            return;
          }
          setCapturedFile(file);
          setPreviewUrl(url);
          setEnhancementStatus('idle');
          setViewMode('preview');
        }
      }, 'image/webp', webpQuality);
    }
  // FIX Bug 10: Added activeExtension to deps so the native CameraX capture path
  // triggers correctly when user toggles HDR/Night mode (was using stale closure).
  // isMultiShotMode added so we route correctly to multi-shot vs single-shot path.
  }, [videoRef, playShutterSound, aspectRatio, facingMode, hasHardwareZoomRef, zoomRef, resolution, activeExtension, isMultiShotMode]);

  // ── TELEGRAM-STYLE RECORDING: stopRecording ────────────────────────────────
  const stopRecording = useCallback(() => {
    // 1. Flag the pump loops to stop ASAP
    isWorkerRecordingRef.current = false;

    // 2. CRITICAL: Cancel the reader streams immediately.
    //    Without this, the pump loops are stuck on `await reader.read()` and will
    //    deliver frames to the worker AFTER we send STOP — crashing the encoder.
    if (videoProcessorRef.current) {
      videoProcessorRef.current.cancel().catch(() => {});
      videoProcessorRef.current = null;
    }
    if (audioProcessorRef.current) {
      audioProcessorRef.current.cancel().catch(() => {});
      audioProcessorRef.current = null;
    }

    // 3. Signal the worker to flush encoders and finalize the MP4
    if (cameraWorkerRef.current) {
      cameraWorkerRef.current.postMessage({ type: 'STOP' });
    }

    setIsRecording(false);
    setIsLocked(false);
    startPosRef.current = null;

    const finalDuration = (Date.now() - startTimeRef.current) / 1000;
    setRecordingTime(Math.max(0.5, finalDuration));

    shutterControls.start({
      scale: 1,
      borderColor: isFlashOn && facingMode === 'user' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)'
    });
    lockIconControls.start({ opacity: 0 });
  }, [shutterControls, lockIconControls, isFlashOn, facingMode]);

  // Recording timer and max duration effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((Date.now() - startTimeRef.current) / 1000);
      }, 100);
      timer = setTimeout(() => stopRecording(), 60000);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [isRecording, stopRecording]);

  // ── TELEGRAM-STYLE RECORDING: startRecording ───────────────────────────────
  const startRecording = async () => {
    if (!streamRef.current || !videoRef.current || !cameraWorkerRef.current) return;

    // Audio was NOT requested during getUserMedia (viewfinder doesn't need it).
    // We add an audio track on-demand now to avoid triggering RECORD_AUDIO permission
    // during initial camera open (which could fail and deny the entire getUserMedia).
    if (streamRef.current.getAudioTracks().length === 0) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true },
          video: false,
        });
        for (const track of audioStream.getAudioTracks()) {
          streamRef.current.addTrack(track);
        }
      } catch {
        // Audio unavailable — record video-only silently
      }
    }

    const worker = cameraWorkerRef.current;
    const video = videoRef.current;
    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const isFront = facingMode === 'user';
    const fps = fpsSetting === '60' ? 60 : 30;

    // ── Compute source crop region ─────────────────────────────────────────
    let targetRatio: number;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3 / 4;
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else targetRatio = 9 / 16;

    let srcW: number, srcH: number;
    if (targetRatio >= 1) {
      srcW = vw; srcH = Math.round(vw / targetRatio);
      if (srcH > vh) { srcH = vh; srcW = Math.round(vh * targetRatio); }
    } else {
      srcH = vh; srcW = Math.round(vh * targetRatio);
      if (srcW > vw) { srcW = vw; srcH = Math.round(vw / targetRatio); }
    }
    const srcX = Math.round((vw - srcW) / 2);
    const srcY = Math.round((vh - srcH) / 2);

    // ── Compute output canvas size based on resolution & device tier ────────
    // High-tier: deliver true resolution. Low-tier: cap to avoid overheating.
    const tier = getDeviceTier();
    let outLong: number;
    if (resolution === '4k') {
      // True 4K canvas is not feasible in-browser. Deliver 4K sensor → 1080p/720p output.
      outLong = tier === 'high' ? 1080 : 720;
    } else if (resolution === '1080p') {
      outLong = tier === 'high' ? 1080 : 720; // True 1080p on high-tier devices
    } else {
      outLong = tier === 'high' ? 720 : 480;
    }

    let outW: number, outH: number;
    if (srcW >= srcH) {
      outW = outLong; outH = Math.round(outLong / (srcW / srcH));
    } else {
      outH = outLong; outW = Math.round(outLong * (srcW / srcH));
    }
    // Ensure even dimensions (required by H.264 codec)
    outW = outW % 2 === 0 ? outW : outW - 1;
    outH = outH % 2 === 0 ? outH : outH - 1;

    // ── Bitrates — optimised for hardware encoder on each tier ───────────
    const videoBitrate =
      resolution === '4k'    ? (tier === 'high' ? 8_000_000  : 4_000_000) :
      resolution === '1080p' ? (tier === 'high' ? 4_000_000  : 2_500_000) :
                               (tier === 'high' ? 2_000_000  : 1_200_000);

    // ── Set up worker message handler ─────────────────────────────────────
    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      if (type === 'READY') {
        // Worker is initialized — start pumping frames
        isWorkerRecordingRef.current = true;
        startTimeRef.current = Date.now();
        setIsRecording(true);
        if (navigator.vibrate) navigator.vibrate(50);
        shutterControls.start({ scale: 1.5, borderColor: 'rgba(255,255,255,0)' });

        // ── VIDEO: MediaStreamTrackProcessor → Worker ───────────────────
        // This is the core of the Telegram architecture:
        // MediaStreamTrackProcessor gives us raw VideoFrame objects directly
        // from the GPU camera pipeline — no canvas, no main-thread copy.
        const videoTrack = streamRef.current!.getVideoTracks()[0];
        if ('MediaStreamTrackProcessor' in window && videoTrack) {
          const processor = new (window as any).MediaStreamTrackProcessor({ track: videoTrack });
          const reader = processor.readable.getReader() as ReadableStreamDefaultReader<VideoFrame>;
          videoProcessorRef.current = reader;

          // Frame pump loop — runs asynchronously, does NOT block main thread
          const pumpVideo = async () => {
            try {
              while (isWorkerRecordingRef.current) {
                const { value: frame, done } = await reader.read();
                if (done || !frame) break;
                if (!isWorkerRecordingRef.current) { frame.close(); break; }
                // Transfer frame to worker (zero-copy — GPU handle moved, not copied)
                worker.postMessage({ type: 'VIDEO_FRAME', frame }, [frame as any]);
              }
            } catch { /* Recording stopped */ }
          };
          pumpVideo();
        }

        // ── AUDIO: MediaStreamTrackProcessor → Worker ───────────────────
        const audioTrack = streamRef.current!.getAudioTracks()[0];
        if ('MediaStreamTrackProcessor' in window && audioTrack) {
          const audioProcessor = new (window as any).MediaStreamTrackProcessor({ track: audioTrack });
          const audioReader = audioProcessor.readable.getReader() as ReadableStreamDefaultReader<AudioData>;
          audioProcessorRef.current = audioReader;

          const pumpAudio = async () => {
            try {
              while (isWorkerRecordingRef.current) {
                const { value: data, done } = await audioReader.read();
                if (done || !data) break;
                if (!isWorkerRecordingRef.current) { data.close(); break; }
                worker.postMessage({ type: 'AUDIO_DATA', data }, [data as any]);
              }
            } catch { /* Recording stopped */ }
          };
          pumpAudio();
        }
      }

      else if (type === 'COMPLETE') {
        // Worker finished — we have the final MP4 buffer
        const buffer: ArrayBuffer = e.data.buffer;
        const blob = new Blob([buffer], { type: 'video/mp4' });
        if (blob.size < 1000) {
          import('sonner').then(({ toast }) => toast.error('Recording failed. Try a lower resolution.'));
          return;
        }
        const file = new File([blob], `video_${Date.now()}.mp4`, { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl(url);
        if (navigator.vibrate) navigator.vibrate([50, 50]);
        setViewMode('preview');

        // Re-create a fresh worker for potential next recording.
        // The old worker's internal state (muxer, encoder) is now finalized and cannot be reused.
        if (cameraWorkerRef.current) {
          cameraWorkerRef.current.terminate();
        }
        cameraWorkerRef.current = new Worker(
          new URL('../../workers/camera.worker.ts', import.meta.url),
          { type: 'module' }
        );
      }

      else if (type === 'FALLBACK') {
        // WebCodecs not supported — fall back to MediaRecorder
        import('sonner').then(({ toast }) => toast.error('Your browser does not support hardware encoding. Try updating Chrome.'));
        setIsRecording(false);
      }

      else if (type === 'ERROR') {
        import('sonner').then(({ toast }) => toast.error(`Recording error: ${e.data.message}`));
        setIsRecording(false);
        setIsLocked(false);
      }
    };

    // ── Audio track metadata (needed for AudioEncoder config in worker) ──
    const audioTrack = streamRef.current.getAudioTracks()[0];
    const audioSettings = audioTrack?.getSettings();
    const audioSampleRate = audioSettings?.sampleRate || 48000;
    const audioChannelCount = audioSettings?.channelCount || 1;

    // ── START the worker with recording config ───────────────────────────
    worker.postMessage({
      type: 'START',
      config: {
        outWidth: outW,
        outHeight: outH,
        srcX, srcY, srcW, srcH,
        mirror: isFront,
        fps,
        videoBitrate,
        audioSampleRate,
        audioChannelCount,
      }
    });
  };


  // --- Gesture Handlers ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isRecording) return;
    // Block recording if user selected 4K on a device that can't handle it
    if (resolution === '4k' && device4kSupported === false) return;
    // Block recording if user selected 60fps on a device that can't handle it
    if (fpsSetting === '60' && device60fpsSupported === false) return;
    
    startPosRef.current = { x: e.clientX, y: e.clientY };
    // Delay to differentiate tap vs long-press
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      startRecording();
    }, 300);
  };

  // ── Timer Cycle Handler ──────────────────────────────────────────────────────
  // Cycles: off(0) → 3s → 5s → 10s → off(0)
  // If timer was inactive (off), clicking activates at 3s
  // If timer was active, clicking cycles through durations
  const cycleTimer = useCallback(() => {
    if (!timerActive) {
      // Activate timer at 3s (default)
      setTimerActive(true);
      setTimerDuration(3);
      if (navigator.vibrate) navigator.vibrate(50);
      return;
    }
    // Timer is active — cycle duration with haptic feedback
    if (timerDuration === 3) {
      setTimerDuration(5);
      if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
    } else if (timerDuration === 5) {
      setTimerDuration(10);
      if (navigator.vibrate) navigator.vibrate([30, 20, 30, 20, 30]);
    } else {
      // Was 10s → deactivate timer
      setTimerActive(false);
      setTimerDuration(3); // reset back to default for next activation
      if (navigator.vibrate) navigator.vibrate(80);
    }
  }, [timerActive, timerDuration]);

  // ── Timer Countdown Runner ──────────────────────────────────────────────────
  const runTimerThenCapture = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    let count = timerDuration;
    setTimerCountdown(count);
    countdownControls.start({ scale: [1.4, 1], opacity: [0, 1], transition: { duration: 0.25 } });

    timerIntervalRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        setTimerCountdown(null);
        takePhoto();
      } else {
        setTimerCountdown(count);
        // Animate each tick
        countdownControls.start({
          scale: [1.4, 1],
          opacity: [0, 1],
          transition: { duration: 0.25 },
        });
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 1000);
  }, [timerDuration, takePhoto, countdownControls]);

  // Cancel timer if modal closes
  useEffect(() => {
    if (!isOpen && timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      setTimerCountdown(null);
    }
  }, [isOpen]);

  const handlePointerUp = () => {
    startPosRef.current = null;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      // It was a quick tap
      if (!isRecording) {
        // If a countdown is already running, cancel it
        if (timerCountdown !== null) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
          setTimerCountdown(null);
          return;
        }
        if (timerActive) {
          runTimerThenCapture();
        } else {
          takePhoto();
        }
      }
    }

    if (isRecording && !isLocked) {
      stopRecording();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isRecording && !isLocked && startPosRef.current) {
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = startPosRef.current.y - e.clientY;

      if (deltaX > 80) {
        setIsLocked(true);
        lockIconControls.start({ x: 0, scale: 1.2, color: '#10B981' });
        if (navigator.vibrate) navigator.vibrate(100);
      } else if (deltaX > 20) {
        lockIconControls.start({ x: deltaX - 20, opacity: 1 });
      }

      const zoomProgress = Math.max(0, Math.min(1, deltaY / 300));
      const { min, max } = zoomRef.current;
      const targetZoom = min + (max - min) * zoomProgress;

      if (hasHardwareZoomRef.current) {
        // Route through native service for proper optical zoom tracking
        applyOpticalZoom({ level: targetZoom }).then(applied => {
          zoomRef.current.current = applied;
        }).catch(() => {});
      } else {
        // Digital zoom via CSS transform (no quality, but zero re-render overhead)
        zoomRef.current.current = targetZoom;
        if (videoRef.current) {
          videoRef.current.style.transform = facingMode === 'user'
            ? `scaleX(-1) scale(${targetZoom})`
            : `scale(${targetZoom})`;
        }
      }
    }
  };

  // --- Handlers ---
  const handleDiscard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (enhancedUrl) URL.revokeObjectURL(enhancedUrl);
    setPreviewUrl(null);
    setCapturedFile(null);
    setEnhancedFile(null);
    setEnhancementStatus('idle');
    setIsEnhancedView(false);
    setCaption('');
    setShowShimmer(false);
    // Reset any stuck recording state (can happen when encoder errors silently)
    setIsRecording(false);
    setIsLocked(false);
    setRecordingTime(0);
    // Reset zoom DOM transform (set directly without React state during gesture)
    if (videoRef.current) videoRef.current.style.transform = '';
    zoomRef.current.current = zoomRef.current.min;
    // If discarding multi-shot preview, revoke all URLs and return to camera
    if (isMultiShotPreview) {
      multiShotFiles.forEach(f => URL.revokeObjectURL(f.url));
      setMultiShotFiles([]);
      setIsMultiShotPreview(false);
      setCarouselIndex(0);
    }
    setViewMode('camera');
  };

  // Multi-shot: discard a single shot from the preview carousel
  const handleDiscardSingleShot = (index: number) => {
    setMultiShotFiles(prev => {
      URL.revokeObjectURL(prev[index].url);
      const next = prev.filter((_, i) => i !== index);
      // If the list is now empty go back to camera
      if (next.length === 0) {
        setIsMultiShotPreview(false);
        setCarouselIndex(0);
        setViewMode('camera');
      } else {
        setCarouselIndex(c => Math.min(c, next.length - 1));
      }
      return next;
    });
  };

  // User pressed ✓ — done capturing, go to preview carousel
  const handleMultiShotDone = () => {
    if (multiShotFiles.length === 0) return;
    setIsMultiShotPreview(true);
    setCarouselIndex(0);
    // Use first file as the "primary" for the send handler (we'll send all)
    setCapturedFile(multiShotFiles[0].file);
    setPreviewUrl(multiShotFiles[0].url);
    setViewMode('preview');
  };

  const handleSendFile = () => {
    if (isMultiShotPreview && multiShotFiles.length > 0) {
      // Send all multi-shot photos via onGallerySelect
      onGallerySelect(multiShotFiles.map(f => f.file), caption);
      onClose();
      return;
    }
    const fileToSend = isEnhancedView && enhancedFile ? enhancedFile : capturedFile;
    if (fileToSend) {
      const isVideo = fileToSend.type.includes('video');
      onSend(fileToSend, caption, isVideo ? Math.max(0.5, recordingTime) : undefined);
      onClose();
    }
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      onGallerySelect(files, '');
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="camera-modal"
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: '0%', opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed inset-0 z-[100] bg-black text-white flex flex-col overflow-hidden touch-none select-none"
      >
        {viewMode === 'camera' && (
          <div className="relative w-full h-full flex flex-col bg-black" onClick={() => { if (showSettings) setShowSettings(false); }}>

            {/* ── 4K UNSUPPORTED OVERLAY ────────────────────────────────────────────
                Shows when user picks 4K but the device encoder cannot handle it.
                Blocks recording entirely and gives a clear, friendly explanation. */}
            <AnimatePresence>
              {resolution === '4k' && device4kSupported === false && (
                <motion.div
                  key="4k-unsupported"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-[90] flex flex-col items-center justify-center bg-transparent backdrop-blur-xl pointer-events-auto"
                >
                  <motion.div
                    initial={{ scale: 0.85, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 280, delay: 0.05 }}
                    className="flex flex-col items-center p-6 gap-5 px-8 rounded-2xl text-center max-w-xs bg-black/25 border border-primary"
                  >
                    {/* Icon */}
                    <div className="w-20 h-20 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[40px] text-red-400">videocam_off</span>
                    </div>

                    {/* Badge */}
                    <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-1 rounded-full">
                      4K Not Supported
                    </span>

                    {/* Heading */}
                    <h2 className="text-white font-bold text-xl leading-tight">
                      Begham jii aapka device 4K handle nai kr skta
                    </h2>

                    {/* Description */}
                    <p className="text-white/55 text-sm leading-relaxed">
                      Tumhare phone ka hardware encoder 4K (3840×2160) recording support nahi karta.
                      1080p pe switch karo — jo bilkul equally sharp dikhegi aapki screen par. 💋
                    </p>

                    {/* CTA */}
                    <button
                      onClick={() => setResolution('1080p')}
                      className="mt-2 w-full py-4 rounded-2xl bg-white text-black font-bold text-sm tracking-wide hover:bg-white/90 active:scale-95 transition-all shadow-2xl"
                    >
                      Switch to 1080p ✨
                    </button>
                    <button
                      onClick={onClose}
                      className="text-white/30 text-xs uppercase tracking-widest hover:text-white/60 transition-colors"
                    >
                      Close Camera
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── 60 FPS UNSUPPORTED OVERLAY ────────────────────────────────────────────
                Shows when user picks 60fps but the device encoder cannot handle it. */}
            <AnimatePresence>
              {fpsSetting === '60' && device60fpsSupported === false && (
                <motion.div
                  key="60fps-unsupported"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-[90] flex flex-col items-center justify-center bg-transparent backdrop-blur-xl pointer-events-auto"
                >
                  <motion.div
                    initial={{ scale: 0.85, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 280, delay: 0.05 }}
                    className="flex flex-col p-6 rounded-2xl items-center gap-5 px-8 text-center max-w-xs border border-primary bg-black/25"
                  >
                    {/* Icon */}
                    <div className="w-20 h-20 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[40px] text-orange-400">slow_motion_video</span>
                    </div>

                    {/* Badge */}
                    <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-orange-400 bg-orange-500/10 border border-orange-500/30 px-3 py-1 rounded-full">
                      60 FPS Not Supported
                    </span>

                    {/* Heading */}
                    <h2 className="text-white font-bold text-lg leading-tight">
                      Meri biwii tumhara phone 60 FPS pe struggle kar raha hai
                    </h2>

                    {/* Description */}
                    <p className="text-white/55 text-sm leading-relaxed">
                      Aapka camera sensor ya encoder ke paas 60 FPS real-time process karne ki power nahi hai.
                      Standard 30 FPS pe switch kar0, wo bhi kaafi smooth lagegi! 💋
                    </p>

                    {/* CTA */}
                    <button
                      onClick={() => setFpsSetting('30')}
                      className="mt-2 w-full py-4 rounded-2xl bg-white text-black font-bold text-sm tracking-wide hover:bg-white/90 active:scale-95 transition-all shadow-2xl"
                    >
                      Switch to 30 FPS ✨
                    </button>
                    <button
                      onClick={onClose}
                      className="text-white/30 text-xs uppercase tracking-widest hover:text-white/60 transition-colors"
                    >
                      Close Camera
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Shutter UI Flash */}
            <AnimatePresence>
              {showShutterFlash && (
                <motion.div
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 bg-white z-[60] pointer-events-none"
                />
              )}
            </AnimatePresence>

            {/* Removed blocking isEnhancing spinner to allow instant preview */}

            {/* Front Camera "Soft Flash" (Smooth Transition) */}
            <AnimatePresence>
              {isFlashOn && facingMode === 'user' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                  className="absolute inset-0 bg-white z-[60] pointer-events-none"
                  style={{
                    maskImage: 'radial-gradient(circle at center, transparent 240px, black 241px)',
                    WebkitMaskImage: 'radial-gradient(circle at center, transparent 240px, black 241px)'
                  }}
                />
              )}
            </AnimatePresence>

            {(() => {
              // Mobile is portrait. Camera stream is portrait (tall).
              // 9:16 = full portrait (fill the screen, normal mobile view)
              // 16:9 = landscape crop (wide letterbox strip in center)
              // 4:3 = standard portrait crop
              // 1:1 = square crop
              let layoutClass = 'absolute inset-0'; // 9:16 default - full screen
              if (aspectRatio === '1:1') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-square';
              else if (aspectRatio === '4:3') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-[3/4]';
              else if (aspectRatio === '16:9') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-[16/9]';
              else if (aspectRatio === '9:16') layoutClass = 'absolute inset-0';
              // NOTE: 16:9 on mobile = landscape orientation. The camera stream is portrait,
              // so 16:9 crops a SHORT WIDE strip from the center of the portrait stream.

              return (
                <div className={`${layoutClass} overflow-hidden bg-black flex items-center justify-center transition-all duration-300 pointer-events-none`}>
                  {hasPermission === false ? (
                    <div className="text-white/50 text-center p-6 mt-1/2 pointer-events-auto">
                      <span className="material-symbols-outlined text-[48px] mb-2 opacity-50">videocam_off</span>
                      <p>Camera access denied.<br />
                        {Capacitor.isNativePlatform()
                          ? 'Please grant camera permission in your device settings.'
                          : 'Please enable in browser settings.'}
                      </p>
                    </div>
                  ) : (
                    <div className="relative w-full h-full">
                      {/* FIX Bug 5: Hide video element when native CameraX preview is active
                          so the native preview (behind WebView) shows through. The native
                          preview renders behind the WebView with a transparent background;
                          if this opaque <video> is visible it covers the native preview. */}
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover pointer-events-auto"
                        style={{
                          transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                          transformOrigin: 'center',
                          opacity: isNativeCameraActive ? 0 : 1,
                        }}
                        onDoubleClick={toggleCamera}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (showSettings) { setShowSettings(false); return; }
                          handleTapToFocus(e as any);
                        }}
                        onTouchStart={(e) => {
                          if (e.touches.length === 2) {
                            const dx = e.touches[0].clientX - e.touches[1].clientX;
                            const dy = e.touches[0].clientY - e.touches[1].clientY;
                            pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
                            pinchStartZoomRef.current = zoomRef.current.current;
                          }
                        }}
                        onTouchMove={(e) => {
                          if (e.touches.length !== 2 || pinchStartDistRef.current === null) return;
                          const dx = e.touches[0].clientX - e.touches[1].clientX;
                          const dy = e.touches[0].clientY - e.touches[1].clientY;
                          const dist = Math.sqrt(dx * dx + dy * dy);
                          const scale = dist / pinchStartDistRef.current;
                          const { min, max } = zoomRef.current;
                          const targetZoom = Math.min(Math.max(pinchStartZoomRef.current * scale, min), max);
                          if (hasHardwareZoomRef.current) {
                            applyOpticalZoom({ level: targetZoom }).then(applied => {
                              zoomRef.current.current = applied;
                            }).catch(() => {});
                          } else {
                            zoomRef.current.current = targetZoom;
                            if (videoRef.current) {
                              videoRef.current.style.transform = facingMode === 'user'
                                ? `scaleX(-1) scale(${targetZoom})`
                                : `scale(${targetZoom})`;
                            }
                          }
                        }}
                        onTouchEnd={() => { pinchStartDistRef.current = null; }}
                      />

                      {/* ── Tap-to-Focus Ring ─────────────────────────────────── */}
                      <AnimatePresence>
                        {focusRing && (
                          <motion.div
                            key={`focus-${focusRing.x}-${focusRing.y}`}
                            initial={{ opacity: 0, scale: 1.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                            className="absolute pointer-events-none"
                            style={{
                              left: focusRing.x - 28,
                              top: focusRing.y - 28,
                              width: 56,
                              height: 56,
                              border: '2px solid #FFD700',
                              borderRadius: 6,
                              boxShadow: '0 0 10px rgba(255,215,0,0.5)',
                            }}
                          />
                        )}
                      </AnimatePresence>

                      {/* ── Night Mode warm-tint overlay ──────────────────────── */}
                      {isNightMode && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{ background: 'rgba(255,120,0,0.04)', mixBlendMode: 'screen' }}
                        />
                      )}

                      {/* ── Optical Zoom Badge ──────────────────────────────────── */}
                      {sensorCaps?.hasHardwareZoomViaTrack && zoomRef.current.current > 1.05 && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-md px-2.5 py-0.5 rounded-full pointer-events-none">
                          <span className="text-white text-xs font-bold font-mono">
                            {zoomRef.current.current.toFixed(1)}×
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Settings Dropdown Overlay - centered below top bar */}
            <AnimatePresence>
              {showSettings && (
                <div className="absolute top-[3.75rem] inset-x-0 flex justify-center z-[80] pointer-events-none">
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="bg-black/40 backdrop-blur-3xl border border-white/10 rounded-2xl p-4 flex flex-col gap-4 pointer-events-auto w-[220px] shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div>
                      <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-2 block">Resolution</span>
                      <div className="flex bg-black/30 rounded-xl p-1">
                        {['720p', '1080p', '4k'].map(res => (
                          <button
                            key={res}
                            onClick={() => setResolution(res as any)}
                            className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors ${resolution === res ? 'bg-primary text-background' : 'text-white/70 hover:text-white'}`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-2 block">Frame Rate</span>
                      <div className="flex bg-black/30 rounded-xl p-1 mb-2">
                        {['30', '60'].map(f => (
                          <button
                            key={f}
                            onClick={() => setFpsSetting(f as any)}
                            className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors ${fpsSetting === f ? 'bg-primary text-background' : 'text-white/70 hover:text-white'}`}
                          >
                            {f} FPS
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-2 block">Aspect Ratio</span>
                      <div className="grid grid-cols-2 gap-2">
                        {['1:1', '4:3', '16:9', '9:16'].map(ratio => (
                          <button
                            key={ratio}
                            onClick={() => setAspectRatio(ratio as any)}
                            className={`py-2 text-[10px] font-bold rounded-xl uppercase tracking-wider transition-all ${aspectRatio === ratio ? 'bg-white/20 text-white border border-white/50 shadow-inner' : 'bg-black/20 text-white/60 border border-white/10 hover:bg-white/10'}`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Top Bar Overlay */}
            <div className={`absolute top-0 inset-x-0 p-4 pt-safe-top flex items-start justify-between z-[70] pointer-events-none transition-all duration-500`}>
              <button
                onClick={onClose}
                className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md pointer-events-auto transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-white/40 text-black shadow-lg' : 'bg-black/30 text-white hover:bg-white/20'}`}
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              <div className="flex flex-col items-center pointer-events-auto">
                <div className={`flex items-center backdrop-blur-md rounded-full border p-1 transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-white/40 border-black/10 shadow-lg' : 'bg-black/30 border-white/10'}`}>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`px-3 py-1.5 rounded-full flex gap-1.5 items-center transition-all duration-500 ${showSettings ? 'bg-primary text-background' : (isFlashOn && facingMode === 'user' ? 'text-black hover:bg-black/10' : 'text-white hover:bg-white/10')}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    <span className="text-xs font-bold font-mono tracking-widest">{resolution.toUpperCase()}</span>
                    <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                    <span className="text-xs font-bold uppercase">{fpsSetting} FPS</span>
                    <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                    <span className="text-xs font-bold uppercase">{aspectRatio}</span>
                  </button>
                </div>
              </div>

              <div className="w-10 flex flex-col gap-2 pointer-events-auto transition-opacity" style={{ opacity: showSettings ? 0.3 : 1, pointerEvents: showSettings ? 'none' : 'auto' }}>
                <button
                  onClick={toggleCamera}
                  className={`w-10 h-10 flex flex-col items-center justify-center rounded-full backdrop-blur-md transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-white/40 text-black shadow-lg' : 'bg-black/30 text-white hover:bg-white/20'}`}
                >
                  <span className="material-symbols-outlined text-[20px]">flip_camera_ios</span>
                </button>

                {/* Torch button */}
                <button
                  onClick={toggleTorch}
                  className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-black text-white shadow-glow-gold' : (isFlashOn ? 'bg-white text-black shadow-glow-gold' : 'bg-black/30 text-white hover:bg-white/20')}`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {isFlashOn ? 'flashlight_on' : 'flashlight_off'}
                  </span>
                </button>

                {/* Timer button — only show when not recording */}
                {!isRecording && (
                  <motion.button
                    onClick={cycleTimer}
                    whileTap={{ scale: 1.15 }}
                    transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    className={`w-10 h-10 flex flex-col items-center justify-center rounded-full backdrop-blur-md transition-all duration-300 relative ${
                      timerActive
                        ? 'bg-[var(--gold)] text-white shadow-glow-gold'
                        : (isFlashOn && facingMode === 'user' ? 'bg-black/30 text-black' : 'bg-black/30 text-white hover:bg-white/20')
                    }`}
                    title={timerActive ? `Timer: ${timerDuration}s (tap to change)` : 'Timer off (tap to enable)'}
                  >
                    {timerActive ? (
                      <span className="text-sm font-bold tracking-tight text-white leading-none">
                        {timerDuration}s
                      </span>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[16px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>timer</span>
                        <span className="text-[9px] font-black leading-none mt-0.5 tracking-tight text-white/70">
                          off
                        </span>
                      </>
                    )}
                  </motion.button>
                )}

                {/* ── Multi-Shot Button ────────────────────────────────────────
                    Tap to toggle burst/multi-shot mode. Only visible when not recording. */}
                {!isRecording && (
                  <motion.button
                    onClick={() => {
                      if (isMultiShotMode && multiShotFiles.length > 0) {
                        // If mode is ON and we have shots, go to preview
                        handleMultiShotDone();
                      } else {
                        setIsMultiShotMode(prev => !prev);
                        if (navigator.vibrate) navigator.vibrate(40);
                      }
                    }}
                    whileTap={{ scale: 1.15 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className={`w-10 h-10 flex flex-col items-center justify-center rounded-full backdrop-blur-md transition-all duration-300 ${
                      isMultiShotMode
                        ? 'bg-[rgba(var(--primary-rgb),0.85)] text-white shadow-[0_0_12px_rgba(var(--primary-rgb),0.5)]'
                        : (isFlashOn && facingMode === 'user' ? 'bg-black/30 text-black' : 'bg-black/30 text-white hover:bg-white/20')
                    }`}
                    title={isMultiShotMode ? 'Multi-shot ON — tap to review' : 'Multi-shot off'}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>burst_mode</span>
                    {isMultiShotMode ? (
                      <span className="text-[9px] font-black leading-none mt-0.5 tracking-tight text-white">
                        {multiShotFiles.length}/10
                      </span>
                    ) : (
                      <span className="text-[9px] font-black leading-none mt-0.5 tracking-tight text-white/70">off</span>
                    )}
                  </motion.button>
                )}

                {/* HDR Mode — only show if native CameraX supports it */}
                {sensorCaps?.hasHDR && facingMode === 'environment' && (
                  <button
                    onClick={toggleHDR}
                    className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-500 ${
                      activeExtension === 'HDR'
                        ? 'bg-amber-500/80 text-white shadow-[0_0_15px_rgba(245,158,11,0.6)]'
                        : 'bg-black/30 text-white/60 hover:bg-white/20 hover:text-white'
                    }`}
                    title="HDR Mode"
                  >
                    <span className="material-symbols-outlined text-[20px]">hdr_on</span>
                  </button>
                )}

                {/* Night Mode — shows if device supports it via CameraX or exposure control */}
                {(sensorCaps?.hasNightMode || sensorCaps?.hasAutoFocus) && facingMode === 'environment' && (
                  <button
                    onClick={toggleNightMode}
                    className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-500 ${
                      isNightMode || activeExtension === 'NIGHT'
                        ? 'bg-indigo-500/80 text-white shadow-[0_0_15px_rgba(99,102,241,0.6)]'
                        : 'bg-black/30 text-white/60 hover:bg-white/20 hover:text-white'
                    }`}
                    title="Night Mode"
                  >
                    <span className="material-symbols-outlined text-[20px]">nightlight</span>
                  </button>
                )}
              </div>
            </div>

            {/* ── Lens Switcher ─────────────────────────────────────────────────────
                Shows multi-lens pills when the device has more than 2 camera lenses.
                Positioned just above the bottom controls row. */}
            {availableLenses.filter(l => l.facingMode === facingMode).length >= 2 && !isRecording && (
              <div className="absolute bottom-36 inset-x-0 flex justify-center z-[75] pointer-events-none">
                <div className="flex gap-2 bg-black/30 backdrop-blur-xl rounded-full px-3 py-1.5 border border-white/10 pointer-events-auto">
                  {availableLenses
                    .filter(l => l.facingMode === facingMode)
                    .map(lens => (
                      <button
                        key={lens.id}
                        onClick={() => switchLens(lens)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all duration-200 ${
                          activeLensId === lens.id
                            ? 'bg-white text-black shadow-md'
                            : 'text-white/60 hover:text-white'
                        }`}
                      >
                        {lens.focalMultiplier < 1
                          ? `${lens.focalMultiplier}×`
                          : lens.focalMultiplier === 1
                            ? lens.facingMode === 'user' ? 'selfie' : '1×'
                            : `${lens.focalMultiplier}×`
                        }
                      </button>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Lock Indicator */}
            <div className="absolute bottom-52 inset-x-0 flex flex-col items-center pointer-events-none z-20">
              <motion.div animate={lockIconControls} initial={{ opacity: 0 }} className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[32px]">{isLocked ? "lock" : "lock_open"}</span>
                {!isLocked && <span className="text-xs uppercase tracking-widest bg-black/40 px-2 py-1 rounded-full backdrop-blur-md">Swipe right to lock</span>}
              </motion.div>
            </div>

            {/* ── Timer Countdown Overlay ──────────────────────────────────────────
                 Full-screen premium countdown shown when self-timer is running.
                 Tap anywhere on the countdown to cancel. */}
            <AnimatePresence>
              {timerCountdown !== null && (
                <motion.div
                  key="timer-countdown-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-[85] flex flex-col items-center justify-center pointer-events-auto"
                  style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 100%)' }}
                  onClick={() => {
                    // Tap to cancel
                    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                    timerIntervalRef.current = null;
                    setTimerCountdown(null);
                  }}
                >
                  {/* Pulsing ring */}
                  <motion.div
                    key={`ring-${timerCountdown}`}
                    initial={{ scale: 0.6, opacity: 0.8 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                    className="absolute w-48 h-48 rounded-full border-[3px] border-[rgba(var(--primary-rgb),0.7)]"
                  />
                  <motion.div
                    key={`ring2-${timerCountdown}`}
                    initial={{ scale: 0.4, opacity: 0.6 }}
                    animate={{ scale: 1.4, opacity: 0 }}
                    transition={{ duration: 1, ease: 'easeOut', delay: 0.15 }}
                    className="absolute w-48 h-48 rounded-full border-[2px] border-white/50"
                  />

                  {/* Main countdown number */}
                  <motion.div
                    key={`count-${timerCountdown}`}
                    animate={countdownControls}
                    initial={{ scale: 1.6, opacity: 0 }}
                    className="relative flex flex-col items-center gap-3"
                  >
                    {/* Glowing circle background */}
                    <div
                      className="w-40 h-40 rounded-full flex items-center justify-center relative"
                      style={{
                        background: 'radial-gradient(circle, rgba(var(--primary-rgb),0.25) 0%, rgba(var(--primary-rgb),0.05) 70%, transparent 100%)',
                        boxShadow: '0 0 60px rgba(var(--primary-rgb),0.4), 0 0 120px rgba(var(--primary-rgb),0.15)',
                        border: '2px solid rgba(var(--primary-rgb),0.3)',
                      }}
                    >
                      <span
                        className="font-black text-white select-none"
                        style={{
                          fontSize: '5.5rem',
                          lineHeight: 1,
                          textShadow: '0 0 30px rgba(var(--primary-rgb),0.8), 0 0 60px rgba(var(--primary-rgb),0.4)',
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                        }}
                      >
                        {timerCountdown}
                      </span>
                    </div>

                    {/* Progress arc */}
                    <svg
                      className="absolute w-[168px] h-[168px] -top-3.5 -left-3.5 -rotate-90 pointer-events-none"
                      viewBox="0 0 168 168"
                    >
                      <circle cx="84" cy="84" r="80" stroke="rgba(var(--primary-rgb),0.15)" strokeWidth="3" fill="none" />
                      <motion.circle
                        cx="84" cy="84" r="80"
                        stroke="rgba(var(--primary-rgb),0.85)"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 80}
                        initial={{ strokeDashoffset: 0 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 80 }}
                        transition={{ duration: 1, ease: 'linear' }}
                      />
                    </svg>

                    <span className="text-white/60 text-sm font-semibold uppercase tracking-[0.2em] mt-1">Tap to cancel</span>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Controls */}
            <div className={`absolute bottom-0 inset-x-0 pb-safe-bottom z-[70] transition-all duration-500`}>
              <div className="flex items-center justify-between px-8 pb-10 pt-4">
                {/* Gallery Button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-12 h-12 rounded-xl overflow-hidden border-2 backdrop-blur-sm flex items-center justify-center active:scale-95 pointer-events-auto transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-white/40 border-black/20 text-black shadow-lg' : 'bg-white/10 border-white/20 text-white hover:border-white/50'}`}
                >
                  <span className="material-symbols-outlined">photo_library</span>
                </button>
                <input type="file" ref={fileInputRef} onChange={handleGalleryChange} className="hidden" accept="image/*,video/*" multiple />

                {/* Shutter Button */}
                <div className="relative flex items-center justify-center pointer-events-auto" style={{ touchAction: 'none' }}>

                  {/* Centered Timer Text */}
                  {isRecording && (
                    <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-red-500/20 px-3 py-1 rounded-full flex items-center gap-2 backdrop-blur-md border border-red-500/50 pointer-events-none">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="font-mono text-sm font-medium pt-0.5">
                        {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                        {(recordingTime % 60).toString().padStart(2, '0')}
                      </span>
                    </div>
                  )}

                  {/* Fix 3.4: Warning strip when approaching 60s limit (>45s) */}
                  <AnimatePresence>
                    {isRecording && recordingTime >= 45 && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute -top-28 left-1/2 -translate-x-1/2 bg-orange-500/30 px-3 py-1 rounded-full border border-orange-500/60 backdrop-blur-md whitespace-nowrap pointer-events-none"
                      >
                        <span className="text-[10px] text-orange-300 uppercase tracking-widest font-bold animate-pulse">
                          ⚠ {60 - recordingTime}s remaining
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Outer Ring Animation - Always visible while recording, larger than scaled shutter */}
                  {isRecording && (
                    <svg className="absolute w-[130px] h-[130px] pointer-events-none transform -rotate-90 z-20">
                      <circle cx="65" cy="65" r="60" stroke="rgba(239, 68, 68, 0.2)" strokeWidth="4" fill="transparent" />
                      <circle
                        cx="65" cy="65" r="60"
                        stroke="#EF4444" strokeWidth="5" fill="transparent"
                        strokeDasharray={2 * Math.PI * 60}
                        strokeDashoffset={(2 * Math.PI * 60) * (1 - Math.min(recordingTime / 60, 1))}
                        className="transition-all duration-1000 ease-linear" strokeLinecap="round"
                      />
                    </svg>
                  )}

                  {isLocked ? (
                    // Stop button when locked
                    <button
                      onPointerDown={stopRecording}
                      className="w-20 h-20 bg-transparent flex items-center justify-center relative z-30"
                    >
                      <div className="w-8 h-8 rounded-sm bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]" />
                    </button>
                  ) : (
                    // Default Shutter
                    <motion.button
                      animate={shutterControls}
                      initial={{ scale: 1, borderColor: isFlashOn && facingMode === 'user' ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.5)" }}
                      className={`w-20 h-20 rounded-full border-[4px] backdrop-blur-md flex items-center justify-center shadow-lg transition-all duration-500 relative z-10 ${isRecording ? 'border-transparent' : (isFlashOn && facingMode === 'user' ? 'bg-white/60 border-black/40' : 'bg-white/10 border-white/40')}`}
                      onPointerDown={handlePointerDown}
                      onPointerUp={handlePointerUp}
                      onPointerMove={handlePointerMove}
                      onPointerLeave={handlePointerUp}
                    >
                      <div className={`w-[85%] h-[85%] rounded-full shadow-lg transition-all duration-500 ${isFlashOn && facingMode === 'user' ? (isRecording ? 'bg-red-500/60' : 'bg-black/80') : (isRecording ? 'bg-red-500' : 'bg-white')}`} />
                    </motion.button>
                  )}
                </div>

                {/* ── Multi-shot: last-captured thumbnail + done tick ────────────
                    Shows bottom-right next to shutter. Visible only in multi-shot mode. */}
                <div className="w-12 h-12 relative flex items-center justify-center">
                  <AnimatePresence>
                    {isMultiShotMode && multiShotFiles.length > 0 && (() => {
                      const last = multiShotFiles[multiShotFiles.length - 1];
                      return (
                        <motion.button
                          key={`ms-thumb-${multiShotFiles.length}`}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                          onClick={handleMultiShotDone}
                          className="w-12 h-12 rounded-xl overflow-hidden border-2 border-white/60 relative shadow-lg active:scale-90 transition-transform"
                        >
                          <img src={last.url} alt="last shot" className="w-full h-full object-cover" />
                          {/* Badge */}
                          <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[rgba(var(--primary-rgb),1)] flex items-center justify-center shadow-md">
                            <span className="text-[9px] font-black text-white leading-none">{multiShotFiles.length}</span>
                          </div>
                        </motion.button>
                      );
                    })()}
                    {isMultiShotMode && multiShotFiles.length === 0 && (
                      <motion.div
                        key="ms-empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-12 h-12 rounded-xl border-2 border-dashed border-white/25 flex items-center justify-center"
                      >
                        <span className="material-symbols-outlined text-[18px] text-white/30">photo_camera</span>
                      </motion.div>
                    )}
                    {!isMultiShotMode && <div key="ms-spacer" className="w-12" />}
                  </AnimatePresence>

                  {/* ✓ Done button — floats above thumbnail, only when we have shots */}
                  <AnimatePresence>
                    {isMultiShotMode && multiShotFiles.length > 0 && (
                      <motion.button
                        key="ms-done"
                        initial={{ scale: 0, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0, opacity: 0, y: 10 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.05 }}
                        onClick={handleMultiShotDone}
                        className="absolute -top-9 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full flex items-center justify-center bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.7)] active:scale-90 transition-transform"
                        title="Done — preview all shots"
                      >
                        <span className="material-symbols-outlined text-[18px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- Post-Capture Preview Mode --- */}
        {viewMode === 'preview' && capturedFile && previewUrl && (
          <div className="relative w-full h-full bg-black flex flex-col z-50">

            {/* ═══════════════════════════════════════════════════════════════
                MULTI-SHOT CAROUSEL PREVIEW
                Shows when the user finished a multi-shot session.
                • Full-screen active photo in the centre
                • Horizontal strip at the bottom (inactive = smaller, active = larger)
            ═══════════════════════════════════════════════════════════════ */}
            {isMultiShotPreview && multiShotFiles.length > 0 ? (
              <>
                {/* Active photo — full screen */}
                <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={`carousel-main-${carouselIndex}`}
                      src={multiShotFiles[carouselIndex]?.url}
                      alt={`Shot ${carouselIndex + 1}`}
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      className="w-full h-full object-cover"
                    />
                  </AnimatePresence>

                  {/* Swipe hint arrows */}
                  {multiShotFiles.length > 1 && (
                    <>
                      {carouselIndex > 0 && (
                        <button
                          onClick={() => setCarouselIndex(i => i - 1)}
                          className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[20px] text-white">chevron_left</span>
                        </button>
                      )}
                      {carouselIndex < multiShotFiles.length - 1 && (
                        <button
                          onClick={() => setCarouselIndex(i => i + 1)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span className="material-symbols-outlined text-[20px] text-white">chevron_right</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Delete this single shot (top-right) */}
                  <button
                    onClick={() => handleDiscardSingleShot(carouselIndex)}
                    className="absolute top-16 right-4 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-90 transition-transform hover:bg-red-500/70"
                  >
                    <span className="material-symbols-outlined text-[18px] text-white">delete</span>
                  </button>

                  {/* Counter badge */}
                  <div className="absolute top-16 left-4 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full">
                    <span className="text-white text-xs font-bold font-mono">{carouselIndex + 1} / {multiShotFiles.length}</span>
                  </div>
                </div>

                {/* ── Horizontal thumbnail strip ───────────────────────────────── */}
                <div className="absolute bottom-[140px] inset-x-0 flex items-end justify-center gap-2 px-4 pb-2 pointer-events-none">
                  <div className="flex items-end gap-2 overflow-x-auto hide-scrollbar pointer-events-auto" style={{ maxWidth: '100%' }}>
                    {multiShotFiles.map((shot, idx) => (
                      <motion.button
                        key={shot.url}
                        onClick={() => setCarouselIndex(idx)}
                        animate={{
                          width: idx === carouselIndex ? 60 : 44,
                          height: idx === carouselIndex ? 72 : 52,
                          opacity: idx === carouselIndex ? 1 : 0.55,
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                        className="rounded-lg overflow-hidden border-2 flex-shrink-0 active:scale-95 transition-transform"
                        style={{
                          borderColor: idx === carouselIndex ? 'rgba(var(--primary-rgb),1)' : 'transparent',
                          boxShadow: idx === carouselIndex ? '0 0 12px rgba(var(--primary-rgb),0.6)' : 'none',
                        }}
                      >
                        <img src={shot.url} alt={`Shot ${idx + 1}`} className="w-full h-full object-cover" />
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Preview Top Bar */}
                <div className="absolute top-0 inset-x-0 p-4 pt-safe-top flex justify-between items-center z-50">
                  <button
                    onClick={handleDiscard}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-red-500/80 transition-colors backdrop-blur-md"
                  >
                    <span className="material-symbols-outlined text-[22px]">arrow_back</span>
                  </button>
                  <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>burst_mode</span>
                    <span className="text-sm font-bold">{multiShotFiles.length} Photos</span>
                  </div>
                </div>

                {/* Preview Bottom Bar (Caption & Send) */}
                <div className="absolute bottom-0 inset-x-0 p-4 pb-safe-bottom">
                  <div className="flex flex-col gap-3 max-w-lg mx-auto w-full">
                    <input
                      type="text"
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Add a caption for all photos..."
                      className="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-5 py-3.5 text-white placeholder-white/50 focus:outline-none focus:border-white/50 focus:bg-white/20 transition-all font-medium text-sm"
                    />
                    <button
                      onClick={handleSendFile}
                      className="w-full py-4 bg-primary text-background font-bold text-lg rounded-2xl shadow-glow-gold hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                      Send {multiShotFiles.length} Photos
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* ═══════════════════════════════════════════════════════════
                 SINGLE SHOT PREVIEW (unchanged original flow)
              ═══════════════════════════════════════════════════════════ */
              <>
                <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                  {(() => {
                    let layoutClass = 'w-full h-full';
                    if (aspectRatio === '1:1') layoutClass = 'w-full aspect-square';
                    else if (aspectRatio === '4:3') layoutClass = 'w-full aspect-[3/4]';
                    else if (aspectRatio === '16:9') layoutClass = 'w-full aspect-[16/9]';
                    else if (aspectRatio === '9:16') layoutClass = 'w-full h-full';

                    return (
                      <div className={`relative ${layoutClass} overflow-hidden flex items-center justify-center`}>
                        {capturedFile.type.startsWith('video') ? (
                          <video
                            src={previewUrl}
                            controls={false}
                            autoPlay
                            playsInline
                            loop
                            muted
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="relative w-full h-full overflow-hidden">
                            <img
                              src={isEnhancedView && enhancedUrl ? enhancedUrl : previewUrl}
                              alt="Preview"
                              className="w-full h-full object-cover transition-opacity duration-300"
                            />
                            <AnimatePresence>
                              {showShimmer && (
                                <motion.div
                                  key={`shimmer-${shimmerKey}`}
                                  initial={{ x: '-120%' }}
                                  animate={{ x: '120%' }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.8, ease: 'circOut' }}
                                  onAnimationComplete={() => setShowShimmer(false)}
                                  className="absolute inset-x-[-20%] inset-y-0 z-[100] pointer-events-none skew-x-[-15deg]"
                                  style={{
                                    background: 'linear-gradient(90deg, transparent 35%, var(--gold) 50%, transparent 65%)',
                                    mixBlendMode: 'screen'
                                  }}
                                />
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Preview Top Bar */}
                <div className="absolute top-0 inset-x-0 p-4 pt-safe-top flex justify-between items-center z-50">
                  <button
                    onClick={handleDiscard}
                    className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-red-500/80 transition-colors backdrop-blur-md"
                  >
                    <span className="material-symbols-outlined text-[22px]">delete</span>
                  </button>

                  {capturedFile.type.startsWith('image') && enhancementStatus !== 'idle' ? (
                    <button
                      onClick={() => {
                        if (enhancementStatus === 'ready') {
                          setShimmerKey(prev => prev + 1);
                          setShowShimmer(true);
                          setIsEnhancedView(prev => !prev);
                        }
                      }}
                      className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 border backdrop-blur-md ${
                        isEnhancedView
                          ? 'border-primary text-primary bg-black/40 shadow-[0_0_15px_rgba(var(--color-primary-rgb),0.5)]'
                          : 'border-white/20 text-white bg-black/40 hover:bg-white/10'
                      }`}
                    >
                      {enhancementStatus === 'processing' ? (
                        <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-[22px] shadow-sm" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                      )}
                    </button>
                  ) : (
                    <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full text-sm font-medium">
                      {capturedFile.type.startsWith('video') ? 'Video Preview' : 'Photo Preview'}
                    </div>
                  )}
                </div>

                {/* Preview Bottom Bar (Caption & Send) */}
                <div className="absolute bottom-0 inset-x-0 p-4 pb-safe-bottom">
                  <div className="flex flex-col gap-4 max-w-lg mx-auto w-full">
                    <input
                      type="text"
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Add a sweet caption..."
                      className="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-5 py-4 text-white placeholder-white/50 focus:outline-none focus:border-white/50 focus:bg-white/20 transition-all font-medium"
                    />
                    <button
                      onClick={handleSendFile}
                      className="w-full py-4 bg-primary text-background font-bold text-lg rounded-2xl shadow-glow-gold hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                      Send Message
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default MobileCameraModal;
