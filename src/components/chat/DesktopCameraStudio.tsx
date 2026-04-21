import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { destroyDenoiser, captureFramesForDenoise, denoiseCapturedFrames } from '../../utils/imageDenoiser';

interface DesktopCameraStudioProps {
  onClose: () => void;
  onSend: (file: File, caption: string) => void;
  onGallerySelect: (files: File[], caption: string) => void;
}

const DesktopCameraStudio: React.FC<DesktopCameraStudioProps> = ({
  onClose,
  onSend,
  onGallerySelect,
}) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // Hardware Devices
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedMicId, setSelectedMicId] = useState<string>('');

  // Settings
  const [resolution, setResolution] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3' | '16:9' | '9:16'>('16:9');

  // States
  const [viewMode, setViewMode] = useState<'camera' | 'preview'>('camera');
  const [captureMode, setCaptureMode] = useState<'photo' | 'video'>('photo');

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Noise reduction state
  const [enhancementStatus, setEnhancementStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
  const [enhancedFile, setEnhancedFile] = useState<File | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [isEnhancedView, setIsEnhancedView] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [shimmerKey, setShimmerKey] = useState(0); // For forcing re-animation

  const [isHardwareMenuOpen, setIsHardwareMenuOpen] = useState(false);

  // Captured Media
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const isCanvasRecordingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Hardware Fetching ---
  const fetchDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const audioDevices = devices.filter(d => d.kind === 'audioinput');
      setCameras(videoDevices);
      setMics(audioDevices);

      if (videoDevices.length > 0 && !selectedCameraId) {
        setSelectedCameraId(videoDevices[0].deviceId);
      }
      if (audioDevices.length > 0 && !selectedMicId) {
        setSelectedMicId(audioDevices[0].deviceId);
      }
    } catch (err) {
      console.warn("Could not fetch media devices", err);
    }
  };

  // --- WebRTC ---
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    try {
      let idealWidth = 1920;
      let idealHeight = 1080;

      if (resolution === '4k') { idealWidth = 3840; idealHeight = 2160; }
      else if (resolution === '1080p') { idealWidth = 1920; idealHeight = 1080; }
      else if (resolution === '720p') { idealWidth = 1280; idealHeight = 720; }

      let ratioValue = 16 / 9;
      if (aspectRatio === '1:1') ratioValue = 1;
      else if (aspectRatio === '4:3') ratioValue = 4 / 3;
      else if (aspectRatio === '9:16') ratioValue = 9 / 16;
      else if (aspectRatio === '16:9') ratioValue = 16 / 9;

      if (ratioValue < 1) {
        const temp = idealWidth;
        idealWidth = idealHeight;
        idealHeight = temp;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
          width: { ideal: idealWidth },
          height: { ideal: idealHeight },
          aspectRatio: { ideal: ratioValue },
          frameRate: { ideal: 30, min: 15 }, // Slower framing helps collect more light per frame -> less noise
          noiseSuppression: true, // Request browser-level WebRTC denoise filters (hardware/software)
          autoGainControl: false, // Disabling AGC prevents massive ISO noise spikes in low light
        },
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          noiseSuppression: true,
          echoCancellation: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setHasPermission(true);

      // On first load, permissions are granted. Now fetch readable labels!
      fetchDevices();

    } catch (error) {
      console.error('Camera access denied or error:', error);
      setHasPermission(false);
    }
  }, [selectedCameraId, selectedMicId, stopCamera, resolution, aspectRatio]);

  useEffect(() => {
    if (viewMode === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
      destroyDenoiser(); // Clean up WebGL + Worker maps
    };
  }, [viewMode, selectedCameraId, selectedMicId, resolution, aspectRatio, startCamera, stopCamera]);

  // Handle click outside settings to close
  useEffect(() => {
    if (!isHardwareMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.settings-panel-container') && !target.closest('.settings-toggle-button')) {
        setIsHardwareMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isHardwareMenuOpen]);

  // SFX
  const playShutterSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1400, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (e) { }
  }, []);

  // --- Capture Logic (with Hybrid Denoising Pipeline) ---
  const takePhoto = async () => {
    if (!videoRef.current || enhancementStatus === 'processing') return;

    playShutterSound();

    const video = videoRef.current;

    let targetRatio = 16 / 9;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 4 / 3;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;

    let drawWidth = video.videoWidth;
    let drawHeight = drawWidth / targetRatio;

    if (drawHeight > video.videoHeight) {
      drawHeight = video.videoHeight;
      drawWidth = drawHeight * targetRatio;
    }

    const offsetX = (video.videoWidth - drawWidth) / 2;
    const offsetY = (video.videoHeight - drawHeight) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(drawWidth);
    canvas.height = Math.round(drawHeight);

    // Provide the drawing logic to denoise pipeline
    const drawFrame = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      // Horizontal mirror for standard UX
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };

    try {
      // Step 1: Capture frames sync rapidly (takes ~66ms for 3 frames)
      const framesData = await captureFramesForDenoise(video, canvas, drawFrame, 3, 0);

      // Step 2: Extract the raw image for immediate display
      const rawImageDataArr = framesData.frames[Math.floor(framesData.frames.length / 2)];
      const rawImageDataObj = new ImageData(rawImageDataArr as any, framesData.width, framesData.height);
      const rawCtx = canvas.getContext('2d')!;
      rawCtx.putImageData(rawImageDataObj, 0, 0);

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `desktop_photo_${Date.now()}.webp`, { type: 'image/webp' });
          const url = URL.createObjectURL(blob);
          setCapturedFile(file);
          setPreviewUrl(url);

          setEnhancementStatus('processing');
          setIsEnhancedView(false);
          setEnhancedFile(null);
          setEnhancedUrl(null);

          setViewMode('preview');
        }
      }, 'image/webp', 0.92);

      // Step 3: Math pipeline in bg
      console.log('[DesktopCamera] Starting heavy math in background...');
      denoiseCapturedFrames(framesData, canvas, {
        enableGLFilter: true,
        enableSharpening: true,
        sharpenAmount: 0.4
      }).then(denoisedImageData => {
        const enhancedCanvas = document.createElement('canvas');
        enhancedCanvas.width = canvas.width;
        enhancedCanvas.height = canvas.height;
        const eCtx = enhancedCanvas.getContext('2d')!;
        eCtx.putImageData(denoisedImageData, 0, 0);
        enhancedCanvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `desktop_photo_enhanced_${Date.now()}.webp`, { type: 'image/webp' });
            const url = URL.createObjectURL(blob);
            setEnhancedFile(file);
            setEnhancedUrl(url);
            setEnhancementStatus('ready');
            console.log('[DesktopCamera] Heavy math successfully applied! High-quality image is ready.');
          }
        }, 'image/webp', 0.92);
      }).catch(err => {
        console.error('[DesktopCamera] Background enhancement failed:', err);
        setEnhancementStatus('idle');
      });

    } catch (err) {
      console.warn('[DesktopCamera] Capture failed, using fallback', err);
      // Fallback
      const ctx = canvas.getContext('2d')!;
      drawFrame(ctx);

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `desktop_photo_${Date.now()}.webp`, { type: 'image/webp' });
          const url = URL.createObjectURL(blob);
          setCapturedFile(file);
          setPreviewUrl(url);
          setEnhancementStatus('idle');
          setViewMode('preview');
        }
      }, 'image/webp', 0.82);
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    isCanvasRecordingRef.current = false;

    setRecordingTime(0);
  }, []);

  // Recording timer and max duration effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isRecording) {
      setRecordingTime(0);
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Max duration limit (5 mins)
      timer = setTimeout(() => {
        stopRecording();
      }, 5 * 60 * 1000);
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
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    let targetRatio = 16 / 9;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 4 / 3;
    else if (aspectRatio === '9:16') targetRatio = 9 / 16;
    else if (aspectRatio === '16:9') targetRatio = 16 / 9;

    let cw = vw;
    let ch = cw / targetRatio;

    if (ch > vh) {
      ch = vh;
      cw = ch * targetRatio;
    }

    cw = Math.round(cw);
    ch = Math.round(ch);

    const canvas = document.createElement('canvas');
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

        const srcX = (vw - cw) / 2;
        const srcY = (vh - ch) / 2;

        ctx.save();
        ctx.translate(canvas.width, 0); // Mirror horizontally like the standard desktop view
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, srcX, srcY, cw, ch, 0, 0, cw, ch);
        ctx.restore();

        requestAnimationFrame(drawLoop);
      };
      requestAnimationFrame(drawLoop);
    }

    const options: any = {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 8000000 // High bitrate for 60fps smoothness
    };
    let recorder;

    try {
      recorder = new MediaRecorder(recordStream, options);
    } catch (e) {
      recorder = new MediaRecorder(recordStream, { mimeType: 'video/webm', videoBitsPerSecond: 5000000 });
    }

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const file = new File([blob], `desktop_video_${Date.now()}.webm`, { type: blob.type });
      const url = URL.createObjectURL(blob);
      setCapturedFile(file);
      setPreviewUrl(url);
      setViewMode('preview');
    };

    recorder.start(500); // chunk every 500ms
    setIsRecording(true);

    playShutterSound();
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in the caption input or anywhere else outside
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (viewMode === 'preview') {
          handleDiscard();
        } else {
          onClose();
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (viewMode === 'camera') {
          if (captureMode === 'photo') {
            takePhoto();
          } else {
            if (isRecording) {
              stopRecording();
            } else {
              startRecording();
            }
          }
        }
      } else if (e.key === 'Enter') {
        if (viewMode === 'preview') {
          handleSendFile();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, captureMode, isRecording, stopRecording]);

  // --- Handlers ---
  const handleDiscard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (enhancedUrl) URL.revokeObjectURL(enhancedUrl);
    setPreviewUrl(null);
    setCapturedFile(null);
    setEnhancedUrl(null);
    setEnhancedFile(null);
    setEnhancementStatus('idle');
    setIsEnhancedView(false);
    setCaption('');
    setShowShimmer(false);
    setViewMode('camera');
  };

  const handleSendFile = () => {
    const finalFile = (isEnhancedView && enhancedFile) ? enhancedFile : capturedFile;
    if (finalFile) {
      onSend(finalFile, caption);
      onClose(); // Auto close studio on send
    }
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      onGallerySelect(files, '');
      onClose();
    }
  };



  return (
    <motion.div
      initial={{ x: '-100%', opacity: 0 }}
      animate={{ x: '0%', opacity: 1 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className="w-[380px] shrink-0 h-full bg-aura-bg-elevated/95 backdrop-blur-3xl border-r border-white/10 flex flex-col relative overflow-hidden z-50 shadow-[20px_0_40px_rgba(0,0,0,0.5)]"
      ref={containerRef}
    >


      <input type="file" ref={fileInputRef} onChange={handleGalleryChange} className="hidden" accept="image/*,video/*" multiple />

      <div className="flex-1 relative bg-black overflow-hidden flex flex-col">

        {viewMode === 'camera' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {/* The Video Layer */}
            {(() => {
              let layoutClass = 'absolute inset-0';
              if (aspectRatio === '1:1') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-square';
              else if (aspectRatio === '4:3') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-[4/3]';
              else if (aspectRatio === '16:9') layoutClass = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full aspect-[16/9]';
              else if (aspectRatio === '9:16') layoutClass = 'absolute inset-0';

              return (
                <div className={`${layoutClass} overflow-hidden bg-black z-0 pointer-events-auto transition-all duration-300`}>
                  {hasPermission === false ? (
                    <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center text-center p-4">
                      <span className="material-symbols-outlined text-[48px] text-white/50">videocam_off</span>
                      <span className="text-white/50 text-sm">Please allow camera access in browser.</span>
                    </div>
                  ) : (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                      style={{ transform: 'scaleX(-1)' }}
                    />
                  )}

                  {/* Removed Enhancing Overlay to match mobile's instant capture experience */}

                </div>
              );
            })()}

            {/* Top Overlay / Settings Pill */}
            <div className="absolute top-0 inset-x-0 p-4 pt-6 z-40 pointer-events-none flex justify-center">

              <button
                onClick={onClose}
                className="absolute left-6 top-6 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-xl text-white border border-white/10 hover:border-white/40 hover:bg-white/10 transition-all duration-300 shadow-2xl group active:scale-90 pointer-events-auto"
              >
                <span className="material-symbols-outlined text-[24px] group-hover:rotate-90 transition-transform duration-300">close</span>
              </button>

              <div className="flex flex-col items-center relative pointer-events-auto">
                <button
                  onClick={() => setIsHardwareMenuOpen(!isHardwareMenuOpen)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition-all duration-300 backdrop-blur-md shadow-lg ${isHardwareMenuOpen
                    ? 'bg-primary text-background border-primary shadow-glow-gold'
                    : 'bg-black/40 text-white border-white/10 hover:bg-white/15 hover:border-white/30'
                    }`}
                >
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold font-mono tracking-wider">{resolution.toUpperCase()}</span>
                    <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{aspectRatio}</span>
                  </div>
                </button>


                {/* Settings Dropdown Panel */}
                <AnimatePresence>
                  {isHardwareMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, x: "-50%", scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
                      exit={{ opacity: 0, y: -10, x: "-50%", scale: 0.95 }}
                      className="absolute top-full left-1/2 mt-3 w-[260px] bg-black/40 backdrop-blur-3xl border border-white/10 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
                    >
                      <div className="flex flex-col gap-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Resolution</label>
                        <div className="flex bg-black/30 rounded-xl p-1 mb-2 overflow-hidden border border-white/5">
                          {['720p', '1080p', '4k'].map(res => (
                            <button
                              key={res}
                              onClick={() => setResolution(res as any)}
                              className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-all duration-300 ${resolution === res ? 'bg-primary text-background shadow-lg' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                            >
                              {res}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Aspect Ratio</label>
                        <div className="grid grid-cols-2 gap-2">
                          {['1:1', '4:3', '16:9', '9:16'].map(ratio => (
                            <button
                              key={ratio}
                              onClick={() => setAspectRatio(ratio as any)}
                              className={`py-2 text-[10px] font-bold rounded-xl uppercase tracking-wider transition-all duration-300 border ${aspectRatio === ratio
                                ? 'bg-white/10 text-white border-white/40 shadow-inner'
                                : 'bg-black/20 text-white/50 border-white/10 hover:bg-white/5'
                                }`}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hardware Pickers inside the settings panel */}
                      {(cameras.length > 0 || mics.length > 0) && (
                        <div className="pt-2 border-white/10 flex flex-col gap-3">
                          {cameras.length > 0 && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Camera</label>
                              <div className="flex flex-col gap-0.5">
                                {cameras.map(cam => (
                                  <button
                                    key={cam.deviceId}
                                    onClick={() => setSelectedCameraId(cam.deviceId)}
                                    className={`px-3 py-1.5 rounded-lg text-xs text-left transition-all flex items-center justify-between group ${selectedCameraId === cam.deviceId ? 'bg-white/10 text-white' : 'bg-transparent text-white/50 hover:bg-white/5'}`}
                                  >
                                    <span className="truncate pr-2 text-[11px] leading-relaxed">{cam.label || `Cam ${cam.deviceId.slice(0, 5)}`}</span>
                                    {selectedCameraId === cam.deviceId && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {captureMode === 'video' && mics.length > 0 && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Mic</label>
                              <div className="flex flex-col gap-0.5">
                                {mics.map(mic => (
                                  <button
                                    key={mic.deviceId}
                                    onClick={() => setSelectedMicId(mic.deviceId)}
                                    className={`px-3 py-1.5 rounded-lg text-xs text-left transition-all flex items-center justify-between group ${selectedMicId === mic.deviceId ? 'bg-white/10 text-white' : 'bg-transparent text-white/50 hover:bg-white/5'}`}
                                  >
                                    <span className="truncate pr-2 text-[11px] leading-relaxed">{mic.label || `Mic ${mic.deviceId.slice(0, 5)}`}</span>
                                    {selectedMicId === mic.deviceId && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Bottom Overlay Layer */}
            <div className="absolute bottom-0 inset-x-0 pt-32 pb-8 z-40 pointer-events-none flex justify-center items-end">
              <div className="flex flex-col items-center gap-6 w-full px-8 pointer-events-auto">

                {/* Photo/Video Swap */}
                <div className="bg-black/40 p-1 rounded-full flex items-center border border-white/10 relative shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-2xl overflow-hidden w-[200px]">
                  <motion.div
                    className="absolute w-[96px] h-[calc(100%-8px)] left-1 bg-white/20 rounded-full shadow-sm z-0"
                    animate={{ x: captureMode === 'video' ? 96 : 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                  <button
                    onClick={() => { setCaptureMode('photo'); if (isRecording) stopRecording(); }}
                    className={`relative z-10 w-24 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${captureMode === 'photo' ? 'text-primary' : 'text-white/40 hover:text-white'}`}
                  >
                    Photo
                  </button>
                  <button
                    onClick={() => setCaptureMode('video')}
                    className={`relative z-10 w-24 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${captureMode === 'video' ? 'text-primary' : 'text-white/40 hover:text-white'}`}
                  >
                    Video
                  </button>
                </div>

                {/* Controls Bottom Row */}
                <div className="flex items-center justify-between w-full">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-12 h-12 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl flex items-center justify-center hover:bg-white/10 hover:border-white/30 transition-all pointer-events-auto shadow-xl group"
                  >
                    <span className="material-symbols-outlined text-[24px] text-white/70 group-hover:text-white group-hover:scale-110 transition-all">photo_library</span>
                  </button>

                  <div className="relative flex items-center justify-center pointer-events-auto w-20 h-20">
                    {isRecording && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, x: "-50%" }}
                        animate={{ opacity: 1, y: 0, x: "-50%" }}
                        className="absolute -top-16 left-1/2 bg-red-500/20 px-4 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-xl border border-red-500/40 pointer-events-none whitespace-nowrap z-50 shadow-lg"
                      >
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="font-mono text-sm font-bold pt-0.5 text-white tracking-widest">
                          {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                          {(recordingTime % 60).toString().padStart(2, '0')}
                        </span>
                      </motion.div>
                    )}

                    {isRecording && (
                      <svg className="absolute w-[130px] h-[130px] pointer-events-none transform -rotate-90 z-20">
                        <circle cx="65" cy="65" r="62" stroke="rgba(239, 68, 68, 0.1)" strokeWidth="4" fill="transparent" />
                        <motion.circle
                          cx="65" cy="65" r="62"
                          stroke="#EF4444" strokeWidth="5" fill="transparent"
                          strokeDasharray={2 * Math.PI * 62}
                          strokeDashoffset={(2 * Math.PI * 62) * (1 - Math.min(recordingTime / (5 * 60), 1))}
                          className="transition-all duration-1000 ease-linear" strokeLinecap="round"
                        />
                      </svg>
                    )}

                    {captureMode === 'photo' ? (
                      <button
                        onClick={takePhoto}
                        className="w-20 h-20 rounded-full border-[6px] border-white/20 flex items-center justify-center bg-white/5 backdrop-blur-sm group hover:scale-105 active:scale-95 transition-all outline-none relative z-10 shadow-2xl"
                      >
                        <div className="w-[85%] h-[85%] bg-white rounded-full group-hover:scale-90 transition-all shadow-glow-white" />
                      </button>
                    ) : (
                      isRecording ? (
                        <button
                          onClick={stopRecording}
                          className="w-20 h-20 bg-transparent flex items-center justify-center relative z-30 group"
                        >
                          <motion.div
                            animate={{ scale: [1, 1.1, 1] }}
                            transition={{ repeat: Infinity, duration: 1 }}
                            className="w-8 h-8 rounded-lg bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)] group-hover:scale-110 active:scale-90 transition-transform"
                          />
                        </button>
                      ) : (
                        <button
                          onClick={startRecording}
                          className="w-20 h-20 rounded-full border-[6px] border-white/20 flex items-center justify-center bg-white/5 backdrop-blur-sm group hover:scale-105 active:scale-95 transition-all outline-none relative z-10 shadow-2xl"
                        >
                          <div className="w-[85%] h-[85%] bg-red-500 rounded-full group-hover:scale-90 transition-all shadow-[0_0_25px_rgba(239,68,68,0.6)]" />
                        </button>
                      )
                    )}
                  </div>

                  <div className="w-12" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- PREVIEW MODE --- */}
        {viewMode === 'preview' && capturedFile && previewUrl && (
          <div className="flex-1 flex flex-col relative bg-black/40 z-50 h-full">

            {/* Preview Top Bar */}
            <div className="absolute top-0 inset-x-0 p-4 pt-6 flex justify-between z-40 pointer-events-none">
              <button
                onClick={handleDiscard}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white hover:bg-white/20 transition-colors pointer-events-auto border border-white/5 shadow-lg"
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              {/* Desktop Enhance Button */}
              {capturedFile.type.startsWith('image') && enhancementStatus !== 'idle' && (
                <button
                  onClick={() => {
                    if (enhancementStatus === 'ready') {
                      console.log(`[DesktopCamera] Enhance button clicked! Initiating shimmer UI...`);
                      setShimmerKey(prev => prev + 1);
                      setShowShimmer(true);
                      setIsEnhancedView(prev => !prev);
                      console.log(`[DesktopCamera] View swapped to: ${!isEnhancedView ? 'Enhanced High-Res' : 'Raw Capture'}`);
                    }
                  }}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 border backdrop-blur-md pointer-events-auto ${isEnhancedView
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
              )}
            </div>

            <div className="flex-1 w-full bg-black flex items-center justify-center relative overflow-hidden">
              {capturedFile.type.startsWith('video') ? (
                <video src={previewUrl} controls autoPlay playsInline loop className="w-full h-full object-contain" />
              ) : (
                <div className="relative w-full h-full overflow-hidden">
                  <img src={isEnhancedView && enhancedUrl ? enhancedUrl : previewUrl} alt="Preview" className="w-full h-full object-contain transition-opacity duration-300" />
                  {/* Shimmer Effect */}
                  <AnimatePresence>
                    {showShimmer && (
                      <motion.div
                        key={`shimmer-${shimmerKey}`}
                        initial={{ x: '-120%' }}
                        animate={{ x: '120%' }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 5, ease: "circOut" }}
                        onAnimationComplete={() => {
                          console.log('[DesktopCamera] Shimmer effect animation cycle finished.');
                          setShowShimmer(false);
                        }}
                        className="absolute inset-0 z-[100] pointer-events-none skew-x-[30deg]"
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

            <div className="p-6 bg-black flex flex-col relative z-20 shrink-0 border-t border-white/5 shadow-[0_-20px_40px_rgba(0,0,0,0.6)]">
              <label className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Message Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Type a nice message..."
                className="w-full bg-white/5 border border-white/10 focus:border-primary/50 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 resize-none h-20 focus:outline-none transition-colors custom-scrollbar"
              />

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSendFile}
                  className="flex-1 h-12 rounded-xl bg-primary text-background font-bold text-sm tracking-wide shadow-glow-gold hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-2 outline-none"
                >
                  <span>Send to Partner</span>
                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                </button>
              </div>

              <p className="text-center text-[10px] text-white/30 mt-3 uppercase tracking-widest">
                Press Enter to send, Esc to discard
              </p>
            </div>
          </div>
        )}

      </div>
    </motion.div>
  );
};

export default DesktopCameraStudio;
