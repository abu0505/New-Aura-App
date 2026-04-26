import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { destroyDenoiser } from '../../utils/imageDenoiser';

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

  // Settings
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3' | '9:16' | '16:9'>('9:16');
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCanvasRecordingRef = useRef(false);
  // BUG FIX: Track the canvas captureStream so we can stop its tracks on stopRecording.
  // Without this, canvas.captureStream() video tracks keep running after recording ends
  // causing a memory leak and unnecessary battery drain.
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(0);

  // Fix 3.3: Debounce ref to prevent rapid camera restarts on settings toggle
  const cameraRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPosRef = useRef<{ x: number, y: number } | null>(null);
  const zoomRef = useRef<{ current: number, min: number, max: number }>({ current: 1, min: 1, max: 1 });
  const hasHardwareZoomRef = useRef(false);

  const shutterControls = useAnimation();
  const lockIconControls = useAnimation();

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

  // Stop camera feed
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsFlashOn(false);
  }, []);

  // Start camera feed
  const startCamera = useCallback(async () => {
    stopCamera();
    try {
      // BUG 5 FIX: Always request at max sensor resolution for consistent FOV across settings.
      // When we requested low res (720p/1080p), Android driver cropped the sensor to deliver
      // that exact resolution → narrower field of view → appeared "zoomed in" vs 4K.
      // Solution: always stream at the sensor's native max (4K ideal). Resolution setting
      // now only controls OUTPUT quality (photo canvas size, video canvas bitrate).
      // This matches how Instagram/Snapchat/native camera apps work.
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode,
          width: { ideal: 3840 },   // Request max — camera delivers native sensor FOV
          height: { ideal: 2160 },  // Same FOV for all resolution settings
          frameRate: { ideal: 30, max: 30 },
          noiseSuppression: true,
          ...({ resizeMode: 'none' } as any),
        },
        audio: { noiseSuppression: true, echoCancellation: true }
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
      setHasPermission(false);
    }
  }, [facingMode, stopCamera]);

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
    }
    // Release WebGL context and Web Worker when camera closes
    return () => { destroyDenoiser(); };
  }, [isOpen, previewUrl]);

  // Flip Camera
  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  // Toggle Torch/Flash
  const toggleTorch = async () => {
    if (facingMode === 'user') {
      setIsFlashOn(!isFlashOn);
      return;
    }

    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const capabilities: any = track.getCapabilities();
        if (capabilities.torch) {
          const newStatus = !isFlashOn;
          await track.applyConstraints({
            advanced: [{ torch: newStatus }] as any
          });
          setIsFlashOn(newStatus);
        } else {
          // Fallback if not supported nicely (it will just do nothing gracefully on most browsers)
          
        }
      } catch (err) {
        
      }
    }
  };

  // --- Photo Capture (Mobile-Optimized: ImageBitmap zero-copy pipeline) ---
  const takePhoto = useCallback(async () => {
    if (!videoRef.current) return;

    // SFX & Flash UX
    playShutterSound();
    setShowShutterFlash(true);
    setTimeout(() => setShowShutterFlash(false), 100);
    if (navigator.vibrate) navigator.vibrate(50);

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
          setCapturedFile(file);
          setPreviewUrl(url);
          setViewMode('preview');
          // MOBILE OPTIMIZATION: Skip denoising pipeline entirely.
          // At 720p-4K from a modern mobile sensor, multi-frame averaging + WebGL bilateral
          // filter adds 300-800ms of processing for imperceptible gain at these resolutions.
          // Denoising is only perceptually useful on <720p or in extreme low light (ISO>3200).
          // The enhance button simply won't appear on mobile (enhancementStatus stays 'idle').
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
          setCapturedFile(file);
          setPreviewUrl(url);
          setEnhancementStatus('idle');
          setViewMode('preview');
        }
      }, 'image/webp', webpQuality);
    }
  }, [videoRef, playShutterSound, aspectRatio, facingMode, hasHardwareZoomRef, zoomRef, resolution]);

  // --- Video Recording ---
  const stopRecording = useCallback(() => {
    // Stop the canvas draw loop immediately
    isCanvasRecordingRef.current = false;

    // BUG FIX: Stop the canvas captureStream tracks to prevent memory leak.
    // canvas.captureStream() returns a MediaStream whose video track keeps running
    // even after the MediaRecorder is stopped, unless we explicitly stop it.
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(t => t.stop());
      canvasStreamRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsLocked(false);
    startPosRef.current = null;
    
    // Set final precise duration
    const finalDuration = (Date.now() - startTimeRef.current) / 1000;
    setRecordingTime(Math.max(0.5, finalDuration));

    shutterControls.start({ 
      scale: 1, 
      borderColor: isFlashOn && facingMode === 'user' ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.5)" 
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
      }, 100); // More frequent updates for smooth UI

      // Max duration limit (60s)
      timer = setTimeout(() => {
        stopRecording();
      }, 60000);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [isRecording, stopRecording]);

  const startRecording = () => {
    if (!streamRef.current || !videoRef.current) return;

    chunksRef.current = [];
    isCanvasRecordingRef.current = false;

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const isFront = facingMode === 'user';

    // ── ALWAYS USE CANVAS FOR RECORDING ────────────────────────────────────
    // Reasons:
    // BUG 2 FIX: Direct stream recording captures UNMIRRORED video. Front camera preview
    //   is mirrored via CSS, but the file was not. Now we apply scaleX(-1) in the canvas
    //   so the recorded file IS mirrored (matches user expectation, same as Instagram).
    // BUG 3 FIX: Android Chrome delivers the stream as landscape (e.g. 1920x1080) with a
    //   90° rotation metadata tag. <video> respects this tag, but ChatBubble reading
    //   videoWidth/videoHeight sees 1920x1080 (landscape) and shows wrong ratio.
    //   Canvas output has REAL portrait dimensions (e.g. 1080x1920) — no rotation tag.
    // BUG 1 FIX: We set canvas size based on resolution setting (not stream size), so
    //   4K video is recorded at a manageable canvas size, preventing encoder crash.

    // Determine target crop region from stream for selected aspect ratio
    let targetRatio: number;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3 / 4;   // portrait 4:3
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else targetRatio = 9 / 16; // '9:16' default portrait

    // Crop source region from the stream (centered)
    let srcW: number, srcH: number;
    if (targetRatio >= 1) {
      // Wider than tall (16:9 or square): use full width, crop height
      srcW = vw;
      srcH = Math.round(vw / targetRatio);
      if (srcH > vh) { srcH = vh; srcW = Math.round(vh * targetRatio); }
    } else {
      // Taller than wide (9:16, 4:3 portrait): use full height, crop width
      srcH = vh;
      srcW = Math.round(vh * targetRatio);
      if (srcW > vw) { srcW = vw; srcH = Math.round(vw / targetRatio); }
    }
    const srcX = Math.round((vw - srcW) / 2);
    const srcY = Math.round((vh - srcH) / 2);

    // Output canvas dimensions based on resolution setting (this controls output quality)
    // Cap at 1920 on longest side to stay within mobile encoder limits
    let outLong: number;
    if (resolution === '4k') outLong = 1920;        // 4K stream → 1080p output (safe for mobile)
    else if (resolution === '1080p') outLong = 1080; // 1080p output
    else outLong = 720;                              // 720p output

    let outW: number, outH: number;
    if (srcW >= srcH) {
      outW = outLong; outH = Math.round(outLong / (srcW / srcH));
    } else {
      outH = outLong; outW = Math.round(outLong * (srcW / srcH));
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

    isCanvasRecordingRef.current = true;

    const drawLoop = () => {
      if (!isCanvasRecordingRef.current) return;

      const liveZoom = hasHardwareZoomRef.current ? 1 : zoomRef.current.current;

      ctx.save();
      // BUG 2 FIX: Apply mirror for front camera IN THE CANVAS so the video file
      // is correctly mirrored (same as Instagram/Snapchat selfie behavior).
      if (isFront) {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      }
      if (!hasHardwareZoomRef.current && liveZoom !== 1) {
        ctx.translate(outW / 2, outH / 2);
        ctx.scale(liveZoom, liveZoom);
        ctx.translate(-outW / 2, -outH / 2);
      }
      ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      ctx.restore();

      if ('requestVideoFrameCallback' in video) {
        (video as any).requestVideoFrameCallback(drawLoop);
      } else {
        requestAnimationFrame(drawLoop);
      }
    };

    if ('requestVideoFrameCallback' in video) {
      (video as any).requestVideoFrameCallback(drawLoop);
    } else {
      requestAnimationFrame(drawLoop);
    }

    const capturedStream = canvas.captureStream(30);
    const audioTracks = streamRef.current.getAudioTracks();
    if (audioTracks.length > 0) capturedStream.addTrack(audioTracks[0]);
    canvasStreamRef.current = capturedStream;

    // ── CODEC SELECTION ────────────────────────────────────────────────────
    // BUG 1 FIX: avc1.42E01E often fails at high resolutions on some Android devices
    // even when isTypeSupported returns true. Use vp8 as a safe fallback — it's
    // broadly hardware-accelerated on Android and never fails silently.
    const codecCandidates = [
      'video/mp4;codecs=avc1',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = codecCandidates.find(c => {
      try { return MediaRecorder.isTypeSupported(c); } catch { return false; }
    }) || 'video/webm';

    const adaptiveBitrate =
      resolution === '4k'    ? 2_500_000 :  // Canvas capped at 1080p equivalent
      resolution === '1080p' ? 2_000_000 :
                               1_200_000;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(capturedStream, { mimeType, videoBitsPerSecond: adaptiveBitrate });
    } catch (e) {
      recorder = new MediaRecorder(capturedStream);
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };

    // BUG 1 FIX: Handle encoder errors gracefully — stop recording, reset state, show error.
    recorder.onerror = () => {
      isCanvasRecordingRef.current = false;
      if (canvasStreamRef.current) {
        canvasStreamRef.current.getTracks().forEach(t => t.stop());
        canvasStreamRef.current = null;
      }
      setIsRecording(false);
      setIsLocked(false);
      startTimeRef.current = 0;
      import('sonner').then(({ toast }) => toast.error('Recording failed. Try a lower resolution.'));
    };

    recorder.onstop = () => {
      // BUG 1 FIX: Don't reset startTimeRef here — stopRecording already computed duration.
      // Check blob validity: if empty, the encoder failed silently (common at 4K on some devices).
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      if (blob.size < 1000) {
        // Empty recording — encoder likely failed. Reset and show error.
        setIsRecording(false);
        setIsLocked(false);
        import('sonner').then(({ toast }) => toast.error('Recording failed. Try a lower resolution.'));
        return;
      }
      const ext = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type });
      const url = URL.createObjectURL(blob);
      setCapturedFile(file);
      setPreviewUrl(url);
      if (navigator.vibrate) navigator.vibrate([50, 50]);
      setViewMode('preview');
    };

    recorder.start(500);
    startTimeRef.current = Date.now();
    setIsRecording(true);
    if (navigator.vibrate) navigator.vibrate(50);
    shutterControls.start({ scale: 1.5, borderColor: 'rgba(255,255,255,0)' });
  };

  // --- Gesture Handlers ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isRecording) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    // Delay to differentiate tap vs long-press
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      startRecording();
    }, 300);
  };

  const handlePointerUp = () => {
    startPosRef.current = null;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      // It was a quick tap
      if (!isRecording) {
        takePhoto();
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

      if (hasHardwareZoomRef.current && streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        track.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any).catch(() => {});
        zoomRef.current.current = targetZoom;
      } else {
        // BUG 4 FIX: Bypass React state (setDigitalZoom) entirely during gesture.
        // setState triggers a full re-render on every pointer move = ~60 renders/sec = lag.
        // Instead, directly update the video element's transform via DOM ref (zero re-render).
        // zoomRef.current.current is read by the canvas drawLoop live, so recorded video
        // also reflects the correct zoom without any state update overhead.
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
    setViewMode('camera');
  };

  const handleSendFile = () => {
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
                      <p>Camera access denied.<br />Please enable in browser settings.</p>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover pointer-events-auto"
                      style={{
                        // Mirror front camera in viewfinder.
                        // Zoom is applied via direct DOM update in handlePointerMove (no re-render).
                        // digitalZoom state is only used to trigger a re-render when zoom resets to 1.
                        transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                        transformOrigin: 'center'
                      }}
                      onDoubleClick={toggleCamera}
                      onClick={(e) => { e.stopPropagation(); if (showSettings) setShowSettings(false); }}
                    />
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
                <button
                  onClick={toggleTorch}
                  className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-500 ${isFlashOn && facingMode === 'user' ? 'bg-black text-white shadow-glow-gold' : (isFlashOn ? 'bg-white text-black shadow-glow-gold' : 'bg-black/30 text-white hover:bg-white/20')}`}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {isFlashOn ? 'flashlight_on' : 'flashlight_off'}
                  </span>
                </button>
              </div>
            </div>

            <div className="absolute top-20 right-4 z-40 pointer-events-none" />

            {/* Lock Indicator */}
            <div className="absolute bottom-52 inset-x-0 flex flex-col items-center pointer-events-none z-20">
              <motion.div animate={lockIconControls} initial={{ opacity: 0 }} className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[32px]">{isLocked ? "lock" : "lock_open"}</span>
                {!isLocked && <span className="text-xs uppercase tracking-widest bg-black/40 px-2 py-1 rounded-full backdrop-blur-md">Swipe right to lock</span>}
              </motion.div>
            </div>

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

                {/* Empty spacer for flex alignment */}
                <div className="w-12" />
              </div>
            </div>
          </div>
        )}

        {/* --- Post-Capture Preview Mode --- */}
        {viewMode === 'preview' && capturedFile && previewUrl && (
          <div className="relative w-full h-full bg-black flex flex-col z-50">
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
                        muted  // Required for autoplay on mobile browsers (Chrome Android, Safari iOS)
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="relative w-full h-full overflow-hidden">
                        <img
                          src={isEnhancedView && enhancedUrl ? enhancedUrl : previewUrl}
                          alt="Preview"
                          className="w-full h-full object-cover transition-opacity duration-300"
                        />
                        {/* Shimmer Effect */}
                        <AnimatePresence>
                          {showShimmer && (
                            <motion.div
                              key={`shimmer-${shimmerKey}`}
                              initial={{ x: '-120%' }}
                              animate={{ x: '120%' }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.8, ease: "circOut" }}
                              onAnimationComplete={() => {
                                
                                setShowShimmer(false);
                              }}
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

              {/* Enhance Logic Button */}
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
          </div>
        )}
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default MobileCameraModal;
