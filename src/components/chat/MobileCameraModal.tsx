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
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:3' | '16:9' | 'Full'>('Full');
  const [showSettings, setShowSettings] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
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
      else if (aspectRatio === '4:3') ratioValue = 3/4; // Mobile is portrait, so 3:4 physically
      else if (aspectRatio === '16:9') ratioValue = 9/16; // 9:16 physically

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
    
    let targetRatio = 16/9; // Full defaults to taking the physical stream size
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 3/4; // Portrait
    else if (aspectRatio === '16:9') targetRatio = 9/16; // Portrait width restriction
    else if (aspectRatio === 'Full') targetRatio = video.videoWidth / video.videoHeight;
    
    let drawWidth = video.videoWidth;
    let drawHeight = drawWidth / targetRatio;
    if (drawHeight > video.videoHeight) {
      drawHeight = video.videoHeight;
      drawWidth = drawHeight * targetRatio;
    }
    const offsetX = (video.videoWidth - drawWidth) / 2;
    const offsetY = (video.videoHeight - drawHeight) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = drawWidth;
    canvas.height = drawHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Check if we need to mirror the image for front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight, 0, 0, drawWidth, drawHeight);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl(url);
        // Switch to preview mode
        setViewMode('preview');
      }
    }, 'image/jpeg', 0.9);
  };

  // --- Video Recording ---
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsLocked(false);
    
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    
    setRecordingTime(0);
    
    shutterControls.start({ scale: 1, borderColor: "rgba(255,255,255,1)" });
    lockIconControls.start({ y: 0, opacity: 0 });
  }, [shutterControls, lockIconControls]);

  const startRecording = () => {
    if (!streamRef.current) return;
    
    chunksRef.current = [];
    const options = { mimeType: 'video/mp4' };
    let recorder;
    
    try {
      recorder = new MediaRecorder(streamRef.current, options);
    } catch (e) {
      // Fallback
      recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm' });
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
    shutterControls.start({ scale: 1.5, borderColor: "rgba(239,68,68,1)" }); // red
    
    // Timer updates
    let sec = 0;
    recordingIntervalRef.current = setInterval(() => {
      sec++;
      setRecordingTime(sec);
    }, 1000);
    
    // Max duration limit (60s)
    maxDurationTimerRef.current = setTimeout(() => {
      stopRecording();
    }, 60000);
  };

  // --- Gesture Handlers ---
  const handlePointerDown = () => {
    if (isRecording) return;
    // Delay to differentiate tap vs long-press
    holdTimerRef.current = setTimeout(() => {
      startRecording();
    }, 300);
  };

  const handlePointerUp = () => {
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
    if (isRecording && !isLocked) {
      // Swipe up to lock
      const screenHeight = window.innerHeight;
      const dragY = screenHeight - e.clientY;
      
      if (dragY > 150) {
        setIsLocked(true);
        lockIconControls.start({ scale: 1.2, color: "#10B981" }); // Turn green
        if (navigator.vibrate) navigator.vibrate(100); // Lock feedback
      } else if (dragY > 60) {
        lockIconControls.start({ y: -(dragY - 60), opacity: 1 });
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
          <div className="relative w-full h-full flex flex-col bg-black">
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

            {(() => {
              let layoutClass = 'absolute inset-0';
              if (aspectRatio === '1:1') layoutClass = 'absolute top-1/2 left-0 -translate-y-1/2 w-full aspect-square';
              else if (aspectRatio === '4:3') layoutClass = 'absolute top-1/2 left-0 -translate-y-1/2 w-full aspect-[3/4]';
              else if (aspectRatio === '16:9') layoutClass = 'absolute top-[10%] left-0 w-full aspect-[9/16]';
              
              return (
                <div className={`${layoutClass} overflow-hidden bg-black flex items-center justify-center transition-all duration-300 pointer-events-none`}>
                   {hasPermission === false ? (
                    <div className="text-white/50 text-center p-6 mt-1/2 pointer-events-auto">
                      <span className="material-symbols-outlined text-[48px] mb-2 opacity-50">videocam_off</span>
                      <p>Camera access denied.<br/>Please enable in browser settings.</p>
                    </div>
                  ) : (
                    <video 
                      ref={videoRef}
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover pointer-events-auto"
                      style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : undefined}
                      onDoubleClick={toggleCamera}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              );
            })()}

            {/* Settings Dropdown Overlay */}
            <AnimatePresence>
              {showSettings && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute top-20 right-4 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-2xl p-4 flex flex-col gap-4 z-50 pointer-events-auto min-w-[200px]"
                >
                  <div>
                    <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-2 block">Resolution</span>
                    <div className="flex bg-black/40 rounded-xl p-1">
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
                      {['1:1', '4:3', '16:9', 'Full'].map(ratio => (
                        <button 
                          key={ratio} 
                          onClick={() => setAspectRatio(ratio as any)}
                          className={`py-2 text-[10px] font-bold rounded-xl uppercase tracking-wider transition-colors ${aspectRatio === ratio ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-white/5 text-white/70 border border-transparent hover:bg-white/10'}`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Top Bar Overlay */}
            <div className="absolute top-0 inset-x-0 p-4 pt-safe-top flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent z-40 pointer-events-none">
              <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md pointer-events-auto">
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>
              
              <div className="flex flex-col items-center pointer-events-auto">
                <div className="flex items-center bg-black/30 backdrop-blur-md rounded-full border border-white/10 p-1">
                  <button 
                    onClick={() => setShowSettings(!showSettings)}
                    className={`px-3 py-1.5 rounded-full flex gap-1.5 items-center transition-colors ${showSettings ? 'bg-primary text-background' : 'text-white hover:bg-white/10'}`}
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
                <button onClick={toggleCamera} className="w-10 h-10 flex flex-col items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white hover:bg-white/20">
                  <span className="material-symbols-outlined text-[20px]">flip_camera_ios</span>
                </button>
                <button onClick={toggleTorch} className={`w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md transition-colors ${isFlashOn ? 'bg-white text-black shadow-glow-gold' : 'bg-black/30 text-white hover:bg-white/20'}`}>
                  <span className="material-symbols-outlined text-[20px]">
                    {isFlashOn ? 'flashlight_on' : 'flashlight_off'}
                  </span>
                </button>
              </div>
            </div>

            <div className="absolute top-20 right-4 z-40 pointer-events-none">
              {isRecording && (
                <div className="bg-red-500/20 px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md border border-red-500/50 pointer-events-auto">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-mono text-sm font-medium">
                    {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:
                    {(recordingTime % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>

            {/* Lock Indicator */}
            <div className="absolute bottom-40 inset-x-0 flex flex-col items-center pointer-events-none z-20">
              <motion.div animate={lockIconControls} initial={{ y: 0, opacity: 0 }} className="flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-[32px]">{isLocked ? "lock" : "lock_open"}</span>
                {!isLocked && <span className="text-xs uppercase tracking-widest bg-black/40 px-2 py-1 rounded-full backdrop-blur-md">Swipe up to lock</span>}
              </motion.div>
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-0 inset-x-0 pb-safe-bottom bg-gradient-to-t from-black/80 via-black/40 to-transparent z-20">
              <div className="flex items-center justify-between px-8 pb-10 pt-4">
                {/* Gallery Button */}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-12 h-12 rounded-xl overflow-hidden border-2 border-white/20 hover:border-white/50 transition-colors bg-white/10 backdrop-blur-sm flex items-center justify-center active:scale-95 pointer-events-auto"
                >
                  <span className="material-symbols-outlined text-white">photo_library</span>
                </button>
                <input type="file" ref={fileInputRef} onChange={handleGalleryChange} className="hidden" accept="image/*,video/*" multiple />

                {/* Shutter Button */}
                <div className="relative flex items-center justify-center pointer-events-auto" style={{ touchAction: 'none' }}>
                  {/* Outer Ring */}
                  {isRecording && (
                    <motion.div 
                      className="absolute inset-0 rounded-full border-[3px] border-red-500 box-content"
                      style={{ scale: 1.5, marginLeft: '-3px', marginTop: '-3px', padding: '3px' }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  
                  {isLocked ? (
                    // Stop button when locked
                    <button 
                      onClick={stopRecording}
                      className="w-20 h-20 bg-transparent flex items-center justify-center"
                    >
                      <div className="w-8 h-8 rounded-sm bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]" />
                    </button>
                  ) : (
                    // Default Shutter
                    <motion.button
                      animate={shutterControls}
                      initial={{ scale: 1, borderColor: "rgba(255,255,255,1)" }}
                      className="w-20 h-20 rounded-full border-[4px] bg-white/20 backdrop-blur-sm flex items-center justify-center"
                      onPointerDown={handlePointerDown}
                      onPointerUp={handlePointerUp}
                      onPointerMove={handlePointerMove}
                      onPointerLeave={handlePointerUp}
                    >
                      <div className="w-[85%] h-[85%] rounded-full bg-white shadow-lg" />
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
            <div className="flex-1 relative bg-black">
              {capturedFile.type.startsWith('video') ? (
                <video 
                  src={previewUrl} 
                  controls 
                  autoPlay 
                  playsInline 
                  loop 
                  className="w-full h-full object-contain"
                />
              ) : (
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="w-full h-full object-contain"
                />
              )}
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
