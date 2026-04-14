import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';

interface MobileCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (file: File, caption: string) => void;
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

  // Captured Media
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Settings
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3' | '9:16' | '16:9'>('9:16');
  const [showSettings, setShowSettings] = useState(false);
  const [digitalZoom, setDigitalZoom] = useState(1);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCanvasRecordingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      console.warn('Audio Context not supported for shutter sound');
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
      let idealWidth = 1920;
      let idealHeight = 1080;
      if (resolution === '4k') { idealWidth = 3840; idealHeight = 2160; }
      else if (resolution === '1080p') { idealWidth = 1920; idealHeight = 1080; }
      else if (resolution === '720p') { idealWidth = 1280; idealHeight = 720; }

      let ratioValue: number | undefined = undefined;
      if (aspectRatio === '1:1') ratioValue = 1;
      else if (aspectRatio === '4:3') ratioValue = 3 / 4; // Mobile is portrait, so 3:4 physically
      else if (aspectRatio === '16:9') ratioValue = 9 / 16; // 9:16 physically

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: idealHeight }, // mobile: height is usually the larger number, so idealWidth specifies the physical height mapping
          height: { ideal: idealWidth },
          ...(ratioValue ? { aspectRatio: { ideal: ratioValue } } : {}),
          frameRate: { ideal: 60, min: 30 }
        },
        audio: true
      });
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
        setDigitalZoom(1);
      } else {
        hasHardwareZoomRef.current = false;
        zoomRef.current = { current: 1, min: 1, max: 5 }; // Digital bounds
        setDigitalZoom(1);
      }
    } catch (error) {
      console.error('Camera access denied or error:', error);
      setHasPermission(false);
    }
  }, [facingMode, stopCamera, resolution, aspectRatio]);

  // Lifecycle
  useEffect(() => {
    if (isOpen && viewMode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
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
      setCaption('');
      chunksRef.current = [];
      setIsFlashOn(false);
    }
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
          console.warn('Torch is not supported on this device/camera.');
        }
      } catch (err) {
        console.error('Failed to toggle torch:', err);
      }
    }
  };

  // --- Photo Capture ---
  const takePhoto = async () => {
    if (!videoRef.current) return;

    // SFX & Flash UX
    playShutterSound();
    setShowShutterFlash(true);
    setTimeout(() => setShowShutterFlash(false), 100);

    if (navigator.vibrate) navigator.vibrate(50);

    const video = videoRef.current;
    const vw = video.videoWidth;   // e.g. 1080
    const vh = video.videoHeight;  // e.g. 1920 (portrait stream)

    // Compute canvas dimensions matching the chosen ratio
    let targetRatio = 1;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3 / 4; // Mobile is portrait, so physically 3:4
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;

    let cw: number, ch: number;
    let testH = vw / targetRatio;
    if (testH <= vh) {
      cw = vw;
      ch = testH;
    } else {
      ch = vh;
      cw = vh * targetRatio;
    }
    cw = Math.round(cw);
    ch = Math.round(ch);

    const offsetX = (vw - cw) / 2;
    const offsetY = (vh - ch) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const zoom = hasHardwareZoomRef.current ? 1 : zoomRef.current.current;
    ctx.save();

    // Check if we need to mirror the image for front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    ctx.drawImage(video, offsetX, offsetY, cw, ch, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (blob) {
        // WebP gives ~70% size reduction vs JPEG at near-identical quality
        const file = new File([blob], `photo_${Date.now()}.webp`, { type: 'image/webp' });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl(url);
        // Switch to preview mode
        setViewMode('preview');
      }
    }, 'image/webp', 0.82);
  };

  // --- Video Recording ---
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsLocked(false);
    setDigitalZoom(1);
    startPosRef.current = null;
    setRecordingTime(0);

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
      setRecordingTime(0);
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Max duration limit (60s)
      timer = setTimeout(() => {
        stopRecording();
      }, 60000);
    } else {
      setRecordingTime(0);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [isRecording, stopRecording]);

  const startRecording = () => {
    if (!streamRef.current || !videoRef.current) return;

    chunksRef.current = [];
    isCanvasRecordingRef.current = true;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // Compute canvas dimensions matching ratio — same logic as takePhoto
    let targetRatio = 1;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3 / 4;
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;

    let cw: number, ch: number;
    let testH = vw / targetRatio;
    if (testH <= vh) {
      cw = vw;
      ch = testH;
    } else {
      ch = vh;
      cw = vh * targetRatio;
    }
    cw = Math.round(cw);
    ch = Math.round(ch);
    canvas.width = cw;
    canvas.height = ch;

    let recordStream = streamRef.current;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const canvasStream = canvas.captureStream(60);
      streamRef.current.getAudioTracks().forEach(t => canvasStream.addTrack(t));
      recordStream = canvasStream;

      const drawLoop = () => {
        if (!isCanvasRecordingRef.current || !ctx || !videoRef.current) return;

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const zoom = hasHardwareZoomRef.current ? 1 : zoomRef.current.current;
        const srcX = (vw - cw) / 2;
        const srcY = (vh - ch) / 2;
        ctx.save();
        if (facingMode === 'user') {
          ctx.translate(cw, 0);
          ctx.scale(-1, 1);
        }
        ctx.translate(cw / 2, ch / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-cw / 2, -ch / 2);
        ctx.drawImage(videoRef.current, srcX, srcY, cw, ch, 0, 0, cw, ch);
        ctx.restore();

        requestAnimationFrame(drawLoop);
      };
      requestAnimationFrame(drawLoop);
    }
    const options: any = {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/mp4',
      videoBitsPerSecond: 8000000 // High bitrate for 60fps smoothness
    };
    let recorder;

    try {
      recorder = new MediaRecorder(recordStream, options);
    } catch (e) {
      // Fallback
      recorder = new MediaRecorder(recordStream, { mimeType: 'video/webm', videoBitsPerSecond: 5000000 });
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'video/mp4' });
      const file = new File([blob], `video_${Date.now()}.${recorder?.mimeType.includes('webm') ? 'webm' : 'mp4'}`, { type: blob.type });
      const url = URL.createObjectURL(blob);
      setCapturedFile(file);
      setPreviewUrl(url);

      if (navigator.vibrate) navigator.vibrate([50, 50]);

      setViewMode('preview');
    };

    recorder.start(200); // chunk every 200ms
    setIsRecording(true);

    // Haptic feedback start
    if (navigator.vibrate) navigator.vibrate(50);

    // Visuals
    shutterControls.start({ 
      scale: 1.5, 
      borderColor: "rgba(255,255,255,0)" // Hide the white border while recording
    });
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
      const deltaX = e.clientX - startPosRef.current.x; // Swipe right
      const deltaY = startPosRef.current.y - e.clientY; // Swipe up

      // Swipe right to lock
      if (deltaX > 80) {
        setIsLocked(true);
        lockIconControls.start({ x: 0, scale: 1.2, color: "#10B981" }); // Turn green
        if (navigator.vibrate) navigator.vibrate(100); // Lock feedback
      } else if (deltaX > 20) {
        lockIconControls.start({ x: deltaX - 20, opacity: 1 });
      }

      // Swipe up to zoom
      const zoomProgress = Math.max(0, Math.min(1, deltaY / 300)); // up to 300px
      const { min, max } = zoomRef.current;
      const targetZoom = min + (max - min) * zoomProgress;

      if (hasHardwareZoomRef.current && streamRef.current) {
        const track = streamRef.current.getVideoTracks()[0];
        track.applyConstraints({ advanced: [{ zoom: targetZoom }] } as any).catch(() => { });
        zoomRef.current.current = targetZoom;
      } else {
        setDigitalZoom(targetZoom);
        zoomRef.current.current = targetZoom;
      }
    }
  };

  // --- Handlers ---
  const handleDiscard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedFile(null);
    setCaption('');
    setViewMode('camera');
  };

  const handleSendFile = () => {
    if (capturedFile) {
      onSend(capturedFile, caption);
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
                        transform: facingMode === 'user' ? `scaleX(-1) scale(${digitalZoom})` : `scale(${digitalZoom})`,
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
            <div className={`absolute top-0 inset-x-0 p-4 pt-safe-top flex items-start justify-between bg-gradient-to-b ${isFlashOn && facingMode === 'user' ? 'from-white/40' : 'from-black/60'} to-transparent z-[70] pointer-events-none transition-all duration-500`}>
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
                    <span className="material-symbols-outlined text-[16px]">settings</span>
                    <span className="text-xs font-bold font-mono tracking-widest">{resolution.toUpperCase()}</span>
                    <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                    <span className="text-xs font-bold uppercase">{aspectRatio}</span>
                  </button>
                  {(resolution === '4k' || resolution === '1080p') && (
                    <div className="bg-primary px-2 py-0.5 rounded-full ml-1 h-full flex items-center shadow-glow-gold">
                      <span className="text-[9px] font-black uppercase text-background tracking-widest">HD</span>
                    </div>
                  )}
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
            <div className={`absolute bottom-0 inset-x-0 pb-safe-bottom bg-gradient-to-t ${isFlashOn && facingMode === 'user' ? 'from-white/40' : 'from-black/80'} via-transparent to-transparent z-[70] transition-all duration-500`}>
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
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Preview Top Bar */}
            <div className="absolute top-0 inset-x-0 p-4 pt-safe-top flex justify-between bg-gradient-to-b from-black/60 to-transparent">
              <button
                onClick={handleDiscard}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-red-500/80 transition-colors backdrop-blur-md"
              >
                <span className="material-symbols-outlined text-[22px]">delete</span>
              </button>
              <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full text-sm font-medium">
                {capturedFile.type.startsWith('video') ? 'Video Preview' : 'Photo Preview'}
              </div>
            </div>

            {/* Preview Bottom Bar (Caption & Send) */}
            <div className="absolute bottom-0 inset-x-0 p-4 pb-safe-bottom bg-gradient-to-t from-black/80 via-black/50 to-transparent">
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
