import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
  
  // Premium Features
  const [isRingLightOn, setIsRingLightOn] = useState(false);
  const [showShutterFlash, setShowShutterFlash] = useState(false);
  const [isHardwareMenuOpen, setIsHardwareMenuOpen] = useState(false);
  
  // Captured Media
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const isCanvasRecordingRef = useRef(false);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    } catch(err) {
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

      let ratioValue = 16/9;
      if (aspectRatio === '1:1') ratioValue = 1;
      else if (aspectRatio === '4:3') ratioValue = 4/3;
      else if (aspectRatio === '9:16') ratioValue = 9/16;
      else if (aspectRatio === '16:9') ratioValue = 16/9;

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
          frameRate: { ideal: 60, min: 30 }
        },
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
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
    return () => stopCamera();
  }, [viewMode, selectedCameraId, selectedMicId, resolution, aspectRatio, startCamera, stopCamera]);

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
    } catch(e) {}
  }, []);

  // --- Capture Logic ---
  const takePhoto = async () => {
    if (!videoRef.current) return;
    
    playShutterSound();
    setShowShutterFlash(true);
    setTimeout(() => setShowShutterFlash(false), 80);

    const video = videoRef.current;
    
    let targetRatio = 16/9;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 4/3;
    else if (aspectRatio === '9:16') targetRatio = 9/16;
    else if (aspectRatio === '16:9') targetRatio = 16/9;

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
    
    // Horizontal mirror for UX
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    // Draw cropped representation mapping cleanly to the object-cover view
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight, 0, 0, drawWidth, drawHeight);
    
    canvas.toBlob((blob) => {
      if (blob) {
        // WebP gives ~70% size reduction vs JPEG at near-identical quality
        const file = new File([blob], `desktop_photo_${Date.now()}.webp`, { type: 'image/webp' });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl(url);
        setViewMode('preview');
        setTimeout(() => setIsRingLightOn(false), 100);
      }
    }, 'image/webp', 0.82);
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    isCanvasRecordingRef.current = false;
    
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    
    setRecordingTime(0);
    setIsRingLightOn(false);
  }, []);

  const startRecording = () => {
    if (!streamRef.current || !videoRef.current) return;
    
    chunksRef.current = [];
    isCanvasRecordingRef.current = true;
    
    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    let targetRatio = 16/9;
    if (aspectRatio === '1:1') targetRatio = 1;
    else if (aspectRatio === '4:3') targetRatio = 4/3;
    else if (aspectRatio === '9:16') targetRatio = 9/16;
    else if (aspectRatio === '16:9') targetRatio = 16/9;

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

    let sec = 0;
    recordingIntervalRef.current = setInterval(() => {
      sec++;
      setRecordingTime(sec);
    }, 1000);
    
    // 5 Minute Limit
    maxDurationTimerRef.current = setTimeout(() => {
      stopRecording();
    }, 5 * 60 * 1000);
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
    setPreviewUrl(null);
    setCapturedFile(null);
    setCaption('');
    setViewMode('camera');
  };

  const handleSendFile = () => {
    if (capturedFile) {
      onSend(capturedFile, caption);
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
             <div className="absolute inset-0 z-0 pointer-events-auto">
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
               {/* Smart Ring Light Glow wrapper */}
               <div className={`absolute inset-0 z-20 pointer-events-none transition-all duration-300 ${isRingLightOn ? 'shadow-[inset_0_0_0_12px_rgba(255,255,255,1),0_0_50px_rgba(255,255,255,0.4)]' : ''}`} />
               <AnimatePresence>
                 {showShutterFlash && (
                    <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="absolute inset-0 bg-white z-[60] pointer-events-none" />
                 )}
               </AnimatePresence>
             </div>

             {/* Top Overlay / Settings Pill */}
             <div className="absolute top-0 inset-x-0 p-4 pt-6 flex flex-col gap-4 bg-gradient-to-b from-black/60 to-transparent z-40 pointer-events-none">
               <div className="flex items-start justify-between pointer-events-auto">
                 <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white hover:bg-white/20 transition-colors shadow-lg border border-white/5">
                   <span className="material-symbols-outlined text-[24px]">close</span>
                 </button>

                 <div className="flex flex-col items-center relative">
                   <div className="flex items-center bg-black/30 backdrop-blur-md rounded-full border border-white/10 p-1 shadow-lg">
                      <button 
                         onClick={() => setIsHardwareMenuOpen(!isHardwareMenuOpen)}
                         className={`px-3 py-1.5 rounded-full flex gap-1.5 items-center transition-colors ${isHardwareMenuOpen ? 'bg-primary text-background' : 'text-white hover:bg-white/10'}`}
                      >
                         <span className="material-symbols-outlined text-[16px]">tune</span>
                         <span className="text-xs font-bold font-mono tracking-widest">{resolution.toUpperCase()}</span>
                         <span className="w-1 h-1 rounded-full bg-current opacity-40 mx-0.5" />
                         <span className="text-xs font-bold uppercase">{aspectRatio}</span>
                      </button>
                      {(resolution === '4k' || resolution === '1080p') && (
                         <div className="bg-primary px-2 py-0.5 rounded-full ml-1 h-full flex items-center shadow-glow-gold rounded-r-full">
                            <span className="text-[9px] font-black uppercase text-background tracking-widest leading-none pt-[1px]">HD</span>
                         </div>
                      )}
                   </div>

                   {/* Settings Dropdown Panel */}
                   <AnimatePresence>
                     {isHardwareMenuOpen && (
                        <motion.div
                           initial={{ opacity: 0, y: -20, scale: 0.95 }}
                           animate={{ opacity: 1, y: 0, scale: 1 }}
                           exit={{ opacity: 0, y: -10, scale: 0.95 }}
                           className="absolute top-[52px] w-[260px] bg-black/70 backdrop-blur-2xl border border-white/10 rounded-2xl p-4 flex flex-col gap-4 shadow-2xl z-50 origin-top"
                        >
                          <div className="flex flex-col gap-2">
                             <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Resolution</label>
                             <div className="flex bg-black/40 rounded-xl p-1 border border-white/5">
                                {['720p', '1080p', '4k'].map(res => (
                                   <button 
                                      key={res} 
                                      onClick={() => setResolution(res as any)}
                                      className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg uppercase tracking-wider transition-colors ${resolution === res ? 'bg-primary text-background shadow-md' : 'text-white/60 hover:text-white'}`}
                                   >
                                      {res}
                                   </button>
                                ))}
                             </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                             <label className="text-[9px] font-bold uppercase tracking-widest text-white/50 pl-1">Aspect Ratio</label>
                             <div className="grid grid-cols-2 gap-1.5">
                               {['1:1', '4:3', '16:9', '9:16'].map(ratio => (
                                  <button 
                                     key={ratio} 
                                     onClick={() => setAspectRatio(ratio as any)}
                                     className={`py-2 text-[10px] font-bold rounded-xl uppercase tracking-wider transition-colors border ${aspectRatio === ratio ? 'bg-primary/20 text-primary border-primary/40 shadow-[inset_0_0_10px_rgba(212,175,55,0.1)]' : 'bg-black/20 text-white/60 border-white/5 hover:bg-white/10 hover:text-white'}`}
                                  >
                                    {ratio}
                                  </button>
                               ))}
                             </div>
                          </div>

                          {/* Hardware Pickers inside the settings panel */}
                          {(cameras.length > 0 || mics.length > 0) && (
                            <div className="pt-2 border-t border-white/10 flex flex-col gap-3">
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
                                          <span className="truncate pr-2 text-[11px] leading-relaxed">{cam.label || `Cam ${cam.deviceId.slice(0,5)}`}</span>
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
                                          <span className="truncate pr-2 text-[11px] leading-relaxed">{mic.label || `Mic ${mic.deviceId.slice(0,5)}`}</span>
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

                 <div className="w-10 flex flex-col gap-2">
                    {/* Ringlight / Right-side toolbar */}
                    <button
                        onClick={() => setIsRingLightOn(!isRingLightOn)}
                        className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border transition-colors shadow-lg pointer-events-auto ${isRingLightOn ? 'bg-white text-black border-white' : 'bg-black/30 text-white border-white/5 hover:bg-white/20'}`}
                        title="Smart Ring Light"
                     >
                        <span className="material-symbols-outlined text-[20px]">{isRingLightOn ? 'lightbulb' : 'lightbulb'}</span>
                     </button>
                 </div>
               </div>

               {/* Timer floating exactly below settings */}
               <div className="flex justify-end pointer-events-none mt-1 pr-2">
                  <AnimatePresence>
                    {isRecording && (
                        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="bg-red-500/20 backdrop-blur-md border border-red-500/50 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg pointer-events-auto">
                           <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                           <span className="text-[10px] font-mono tracking-widest text-white font-bold drop-shadow-md">
                              {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                           </span>
                        </motion.div>
                    )}
                  </AnimatePresence>
               </div>
             </div>


             {/* Bottom Overlay Layer */}
             <div className="absolute bottom-0 inset-x-0 pt-32 pb-8 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-40 pointer-events-none flex justify-center items-end">
                
                {/* Options wrapper */}
                <div className="flex flex-col items-center gap-6 w-full px-8 pointer-events-auto">
                   
                   {/* Photo/Video Swap */}
                   <div className="bg-black/30 p-1 rounded-full flex items-center border border-white/10 relative shadow-[0_10px_20px_rgba(0,0,0,0.4)] backdrop-blur-md">
                       <motion.div 
                         className="absolute w-1/2 h-[calc(100%-8px)] left-1 bg-white/10 rounded-full shadow-sm z-0"
                         animate={{ x: captureMode === 'video' ? '100%' : '0%' }}
                         transition={{ type: "spring", stiffness: 400, damping: 30 }}
                       />
                       <button 
                         onClick={() => { setCaptureMode('photo'); if (isRecording) stopRecording(); }}
                         className={`relative z-10 w-24 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${captureMode === 'photo' ? 'text-primary drop-shadow-[0_0_5px_rgba(212,175,55,0.8)]' : 'text-aura-text-secondary hover:text-white'}`}
                       >
                         Photo
                       </button>
                       <button 
                         onClick={() => setCaptureMode('video')}
                         className={`relative z-10 w-24 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${captureMode === 'video' ? 'text-primary drop-shadow-[0_0_5px_rgba(212,175,55,0.8)]' : 'text-aura-text-secondary hover:text-white'}`}
                       >
                         Video
                       </button>
                   </div>

                   {/* Controls Bottom Row */}
                   <div className="flex items-center justify-between w-full">
                       
                       {/* Gallery Drop / Select */}
                       <button 
                          onClick={() => {
                            if (fileInputRef.current) fileInputRef.current.click();
                          }}
                          className="w-12 h-12 rounded-xl border-2 border-white/20 bg-white/10 backdrop-blur-sm flex items-center justify-center hover:border-white/50 transition-colors pointer-events-auto"
                       >
                          <span className="material-symbols-outlined text-[24px] text-white">photo_library</span>
                       </button>

                       {/* Shutter Button */}
                       <div className="relative">
                          {captureMode === 'photo' ? (
                              <button 
                                onClick={takePhoto}
                                className="w-20 h-20 rounded-full border-[4px] border-white flex items-center justify-center bg-white/10 backdrop-blur-sm group hover:scale-105 active:scale-95 transition-all outline-none"
                              >
                                 <div className="w-[85%] h-[85%] bg-white rounded-full group-hover:scale-95 transition-transform shadow-lg" />
                              </button>
                          ) : (
                              isRecording ? (
                                  <button 
                                    onClick={stopRecording}
                                    className="w-20 h-20 rounded-full border-[4px] border-red-500/50 flex items-center justify-center bg-transparent group hover:scale-105 active:scale-95 transition-all outline-none"
                                  >
                                     <motion.div 
                                        className="absolute inset-[0px] rounded-full border-[3px] border-red-500 box-border"
                                        style={{ top: '-4px', left: '-4px', right: '-4px', bottom: '-4px' }}
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                     />
                                     <motion.div 
                                       className="w-8 h-8 bg-red-500 rounded-sm shadow-[0_0_15px_rgba(239,68,68,0.6)]"
                                       initial={{ borderRadius: "50%" }}
                                       animate={{ borderRadius: "8%" }}
                                       transition={{ duration: 0.2 }}
                                     />
                                  </button>
                              ) : (
                                  <button 
                                    onClick={startRecording}
                                    className="w-20 h-20 rounded-full border-[4px] border-white flex items-center justify-center bg-white/10 backdrop-blur-sm group hover:scale-105 active:scale-95 transition-all outline-none"
                                  >
                                     <div className="w-[85%] h-[85%] bg-red-500 rounded-full group-hover:scale-95 transition-transform shadow-[0_0_15px_rgba(239,68,68,0.6)]" />
                                  </button>
                              )
                          )}
                       </div>

                       {/* Placeholder for layout balance */}
                       <div className="w-12 pointer-events-none" />

                   </div>
                </div>

             </div>

          </div>
        )}

        {/* --- PREVIEW MODE --- */}
        {viewMode === 'preview' && capturedFile && previewUrl && (
          <div className="flex-1 flex flex-col relative bg-black/40 z-50 h-full">
             
             {/* Preview Top Bar */}
             <div className="absolute top-0 inset-x-0 p-4 pt-6 flex justify-between bg-gradient-to-b from-black/60 to-transparent z-40 pointer-events-none">
                <button 
                   onClick={handleDiscard}
                   className="w-10 h-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white hover:bg-white/20 transition-colors pointer-events-auto border border-white/5 shadow-lg"
                >
                   <span className="material-symbols-outlined text-[24px]">close</span>
                </button>
             </div>

             <div className="flex-1 w-full bg-black flex items-center justify-center relative overflow-hidden">
                {capturedFile.type.startsWith('video') ? (
                  <video src={previewUrl} controls autoPlay playsInline loop className="w-full h-full object-contain" />
                ) : (
                  <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
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
