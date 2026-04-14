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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  
  // Captured Media
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        const file = new File([blob], `desktop_photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        setCapturedFile(file);
        setPreviewUrl(url);
        setViewMode('preview');
        setTimeout(() => setIsRingLightOn(false), 100);
      }
    }, 'image/jpeg', 0.95);
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
    
    setRecordingTime(0);
    setIsRingLightOn(false);
  }, []);

  const startRecording = () => {
    if (!streamRef.current) return;
    
    chunksRef.current = [];
    const options = { mimeType: 'video/webm;codecs=vp8,opus' };
    let recorder;
    
    try {
      recorder = new MediaRecorder(streamRef.current, options);
    } catch (e) {
      recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm' });
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

  // Drag and drop for the whole container if in camera mode
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
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
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      ref={containerRef}
    >
      {/* Absolute Drag Indicator Overlay */}
      <AnimatePresence>
         {isDraggingOver && (
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="absolute inset-0 bg-primary/20 backdrop-blur-md z-[200] border-4 border-dashed border-primary m-4 rounded-3xl flex flex-col items-center justify-center text-primary"
            >
               <span className="material-symbols-outlined text-[64px] mb-4">upload_file</span>
               <h3 className="font-serif text-2xl">Drop Media Here</h3>
            </motion.div>
         )}
      </AnimatePresence>

      <div className="flex items-center justify-between px-6 py-5 shrink-0 border-b border-white/5">
        <h2 className="text-lg font-serif text-primary tracking-wide">Studio</h2>
        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors text-aura-text-secondary hover:text-white">
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col relative pb-6">
        
        {viewMode === 'camera' && (
          <>
            {(() => {
               let aspectClass = 'aspect-video';
               if (aspectRatio === '1:1') aspectClass = 'aspect-square';
               else if (aspectRatio === '4:3') aspectClass = 'aspect-[4/3]';
               else if (aspectRatio === '9:16') aspectClass = 'aspect-[9/16] max-w-[180px] mx-auto'; // Limit width so it doesn't push UI out of view

               return (
                 <div className="px-6 pt-6 pb-2 shrink-0 flex items-center justify-center">
                    <div className={`relative w-full ${aspectClass} rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10 transition-all duration-300`}>
                       {/* Smart Ring Light Glow wrapper */}
                  <div className={`absolute inset-0 z-20 pointer-events-none transition-all duration-300 ${isRingLightOn ? 'shadow-[inset_0_0_0_12px_rgba(255,255,255,1),0_0_50px_rgba(255,255,255,0.4)]' : ''}`} />
                  
                  <AnimatePresence>
                    {showShutterFlash && (
                      <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="absolute inset-0 bg-white z-[60] pointer-events-none" />
                    )}
                  </AnimatePresence>

                  {hasPermission === false ? (
                      <div className="absolute inset-0 flex items-center justify-center text-center p-4">
                        <span className="text-aura-text-secondary text-sm">Please allow camera access in browser.</span>
                      </div>
                  ) : (
                      <video 
                        ref={videoRef}
                        autoPlay 
                        playsInline 
                        muted 
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                  )}

                  {/* Timer overlay */}
                  {isRecording && (
                      <div className="absolute top-3 right-3 bg-red-500/20 backdrop-blur-md border border-red-500/50 px-2.5 py-1 rounded-md flex items-center gap-2 z-30">
                         <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                         <span className="text-xs font-mono text-white font-medium">
                            {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                         </span>
                      </div>
                  )}

                  {/* Smart Light Toggle Button inside camera */}
                  <div className="absolute top-3 left-3 z-30">
                     <button
                        onClick={() => setIsRingLightOn(!isRingLightOn)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border transition-colors ${isRingLightOn ? 'bg-white text-black border-white' : 'bg-black/40 text-white border-white/20 hover:bg-black/60'}`}
                        title="Smart Ring Light"
                     >
                        <span className="material-symbols-outlined text-[16px]">{isRingLightOn ? 'lightbulb' : 'lightbulb'}</span>
                     </button>
                  </div>
               </div>
            </div>
            );
          })()}

            {/* Hardware & Settings Selection */}
            <div className="px-6 py-4 flex gap-3 shrink-0 flex-col">
               <div className="flex gap-2">
                  <select 
                     value={resolution}
                     onChange={(e) => setResolution(e.target.value as any)}
                     className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs text-aura-text-primary focus:outline-none focus:border-primary/50 w-full appearance-none custom-select"
                  >
                     <option value="720p" className="bg-background text-white">720p HD</option>
                     <option value="1080p" className="bg-background text-white">1080p FHD</option>
                     <option value="4k" className="bg-background text-white">4K UHD</option>
                  </select>

                  <select 
                     value={aspectRatio}
                     onChange={(e) => setAspectRatio(e.target.value as any)}
                     className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs text-aura-text-primary focus:outline-none focus:border-primary/50 w-full appearance-none custom-select"
                  >
                     <option value="16:9" className="bg-background text-white">16:9 (Landscape)</option>
                     <option value="9:16" className="bg-background text-white">9:16 (Portrait)</option>
                     <option value="1:1" className="bg-background text-white">1:1 (Square)</option>
                     <option value="4:3" className="bg-background text-white">4:3 (Standard)</option>
                  </select>
               </div>
               {cameras.length > 0 && (
                  <select 
                     value={selectedCameraId}
                     onChange={(e) => setSelectedCameraId(e.target.value)}
                     className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs text-aura-text-primary focus:outline-none focus:border-primary/50 w-full appearance-none custom-select"
                  >
                     {cameras.map(cam => (
                        <option key={cam.deviceId} value={cam.deviceId} className="bg-background text-white">{cam.label || `Camera ${cam.deviceId.slice(0,5)}`}</option>
                     ))}
                  </select>
               )}
               {mics.length > 0 && captureMode === 'video' && (
                  <motion.select 
                     initial={{ opacity: 0, height: 0 }}
                     animate={{ opacity: 1, height: 'auto' }}
                     value={selectedMicId}
                     onChange={(e) => setSelectedMicId(e.target.value)}
                     className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs text-aura-text-primary focus:outline-none focus:border-primary/50 w-full appearance-none custom-select"
                  >
                     {mics.map(mic => (
                        <option key={mic.deviceId} value={mic.deviceId} className="bg-background text-white">{mic.label || `Microphone ${mic.deviceId.slice(0,5)}`}</option>
                     ))}
                  </motion.select>
               )}
               <style>{`.custom-select { background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E"); background-repeat: no-repeat; background-position: right .7em top 50%; background-size: .65em auto; }`}</style>
            </div>

            {/* Main Controls */}
            <div className="mt-2 px-6 flex flex-col items-center gap-6">
                
                {/* Photo/Video Toggle */}
                <div className="bg-black/30 p-1 rounded-full flex items-center border border-white/5 relative">
                   <motion.div 
                     className="absolute w-1/2 h-[calc(100%-8px)] left-1 bg-white/10 rounded-full shadow-sm z-0"
                     animate={{ x: captureMode === 'video' ? '100%' : '0%' }}
                     transition={{ type: "spring", stiffness: 400, damping: 30 }}
                   />
                   <button 
                     onClick={() => { setCaptureMode('photo'); if (isRecording) stopRecording(); }}
                     className={`relative z-10 w-24 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${captureMode === 'photo' ? 'text-primary' : 'text-aura-text-secondary hover:text-white'}`}
                   >
                     Photo
                   </button>
                   <button 
                     onClick={() => setCaptureMode('video')}
                     className={`relative z-10 w-24 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${captureMode === 'video' ? 'text-primary' : 'text-aura-text-secondary hover:text-white'}`}
                   >
                     Video
                   </button>
                </div>

                {/* Shutter Button */}
                <div className="relative">
                   <p className="absolute -top-6 w-full text-center text-[10px] uppercase tracking-widest text-white/30 whitespace-nowrap left-1/2 -translate-x-1/2">
                      {isRecording ? "Press space to stop" : "Press space to capture"}
                   </p>
                   {captureMode === 'photo' ? (
                       <button 
                         onClick={takePhoto}
                         className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-transparent group hover:scale-105 active:scale-95 transition-all"
                       >
                          <div className="w-12 h-12 bg-white rounded-full group-hover:scale-95 transition-transform" />
                       </button>
                   ) : (
                       isRecording ? (
                           <button 
                             onClick={stopRecording}
                             className="w-16 h-16 rounded-full border-4 border-red-500/50 flex items-center justify-center bg-transparent group hover:scale-105 active:scale-95 transition-all"
                           >
                              <motion.div 
                                className="w-6 h-6 bg-red-500 rounded-sm"
                                initial={{ borderRadius: "50%" }}
                                animate={{ borderRadius: "8%" }}
                                transition={{ duration: 0.2 }}
                              />
                           </button>
                       ) : (
                           <button 
                             onClick={startRecording}
                             className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-transparent group hover:scale-105 active:scale-95 transition-all"
                           >
                              <div className="w-12 h-12 bg-red-500 rounded-full group-hover:scale-95 transition-transform shadow-[0_0_15px_rgba(239,68,68,0.4)]" />
                           </button>
                       )
                   )}
                </div>
            </div>

            {/* Desktop Drag and drop local gallery */}
            <div className="mt-8 px-6 pb-4">
               <input type="file" ref={fileInputRef} onChange={handleGalleryChange} className="hidden" accept="image/*,video/*" multiple />
               <div 
                 onClick={() => fileInputRef.current?.click()}
                 className="w-full h-24 rounded-2xl border-2 border-dashed border-white/10 hover:border-primary/50 bg-white/5 hover:bg-primary/5 transition-colors flex flex-col items-center justify-center cursor-pointer group"
               >
                  <span className="material-symbols-outlined text-[24px] text-white/40 group-hover:text-primary transition-colors mb-1">upload_file</span>
                  <span className="text-[11px] uppercase tracking-wider text-white/50 group-hover:text-primary/80 font-semibold">Browse or Drop Files</span>
               </div>
            </div>
          </>
        )}

        {/* --- PREVIEW MODE --- */}
        {viewMode === 'preview' && capturedFile && previewUrl && (
          <div className="flex-1 flex flex-col h-full relative bg-black/40">
             
             {/* Media Preview Box */}
             <div className="p-6 shrink-0 relative z-10">
                <div className="w-full aspect-[4/3] sm:aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black border border-white/10 relative group">
                   {capturedFile.type.startsWith('video') ? (
                     <video src={previewUrl} controls autoPlay playsInline loop className="w-full h-full object-contain" />
                   ) : (
                     <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />
                   )}
                </div>
             </div>

             <div className="flex-1 px-6 flex flex-col relative z-20">
                <label className="text-[10px] font-bold uppercase tracking-widest text-primary mb-2">Message Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Type a nice message..."
                  className="w-full bg-white/5 border border-white/10 focus:border-primary/50 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 resize-none h-24 focus:outline-none transition-colors custom-scrollbar"
                />
                
                <div className="mt-6 flex items-center gap-3">
                   <button
                     onClick={handleDiscard}
                     className="w-12 h-12 shrink-0 rounded-xl bg-white/5 border border-white/10 hover:bg-red-500/20 hover:border-red-500/30 hover:text-red-400 transition-all flex items-center justify-center outline-none text-aura-text-secondary"
                     title="Discard"
                   >
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                   </button>
                   <button
                     onClick={handleSendFile}
                     className="flex-1 h-12 rounded-xl bg-primary text-background font-bold text-sm tracking-wide shadow-glow-gold hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center justify-center gap-2 outline-none"
                   >
                     <span>Send to Partner</span>
                     <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                   </button>
                </div>
                
                <p className="text-center text-[10px] text-white/30 mt-4 uppercase tracking-widest">
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
