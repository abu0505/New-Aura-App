import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useMedia } from '../../hooks/useMedia';

interface AudioRecorderProps {
  onRecordingComplete: (media: { url: string, media_key: string, media_nonce: string, type: string }) => void;
  onCancel: () => void;
}

export default function AudioRecorder({ onRecordingComplete, onCancel }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // StrictMode guard — prevents double-mount from creating 2 concurrent timers/recorders
  const isStartedRef = useRef(false);
  // Freeze duration display while processing so the timer appears stopped
  const frozenDurationRef = useRef(0);
  const { processAndUpload } = useMedia();
  const processAndUploadRef = useRef(processAndUpload);
  useEffect(() => { processAndUploadRef.current = processAndUpload; }, [processAndUpload]);

  // ═══ Web Audio API refs for live waveform ═══
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [waveformBars, setWaveformBars] = useState<number[]>(new Array(24).fill(4));

  const BAR_COUNT = 24;

  const updateWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    // Use time-domain data — captures actual mic amplitude, not frequency bins.
    // This ensures ALL bars react to the real voice signal simultaneously.
    const dataArray = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(dataArray);

    const bars: number[] = [];
    const step = Math.floor(dataArray.length / BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = i * step;
      const end = Math.min(start + step, dataArray.length);
      // Compute RMS (root mean square) amplitude for this chunk.
      // Values range 0–255, with 128 as silence (DC offset).
      let sumSq = 0;
      for (let j = start; j < end; j++) {
        const normalized = (dataArray[j] - 128) / 128; // -1 to +1
        sumSq += normalized * normalized;
      }
      const rms = Math.sqrt(sumSq / (end - start));
      // Scale: min 4px (silence), max 28px (loud)
      bars.push(Math.max(4, Math.min(28, 4 + rms * 160)));
    }

    setWaveformBars(bars);
    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startRecording = async () => {
    // StrictMode guard: only start once per mount
    if (isStartedRef.current) return;
    isStartedRef.current = true;

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      // Don't connect to destination — we don't want to hear our own mic

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop waveform animation
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        // Close audio context
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }

        if (chunksRef.current.length === 0) {
          setError('No audio data captured');
          cleanupStream();
          return;
        }

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        
        if (audioBlob.size < 100) {
          setError('Recording too short');
          cleanupStream();
          return;
        }

        const file = new File([audioBlob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
        
        setIsProcessing(true);
        try {
          const uploaded = await processAndUploadRef.current(file, { optimize: false });
          
          if (uploaded) {
            onRecordingComplete({
              url: uploaded.url,
              media_key: uploaded.media_key,
              media_nonce: uploaded.media_nonce,
              type: 'audio'
            });
          } else {
            setError('Upload failed — encryption keys may not be ready. Please try again.');
            
          }
        } catch (uploadErr) {
          
          setError('Failed to send audio. Please try again.');
        } finally {
          setIsProcessing(false);
        }
        
        cleanupStream();
      };

      recorder.start(100);
      setIsRecording(true);
      setDuration(0);
      frozenDurationRef.current = 0;
      // Single interval — only one will exist because of isStartedRef guard
      timerRef.current = window.setInterval(() => {
        setDuration(prev => {
          const next = prev + 1;
          frozenDurationRef.current = next;
          return next;
        });
      }, 1000);

      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    } catch (err) {
      
      setError('Microphone access denied');
      isStartedRef.current = false; // Allow retry
    }
  };

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      // Stop timer immediately so UI freezes at current duration
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleCancel = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    cleanupStream();
    onCancel();
  };

  const formatDuration = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    startRecording();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      cleanupStream();
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 bg-background/40 backdrop-blur-3xl rounded-full px-6 py-2 border border-primary/30 shadow-2xl">
        <div className="flex items-center gap-3">
          <motion.div 
            animate={{ scale: isRecording ? [1, 1.2, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500' : isProcessing ? 'bg-primary' : 'bg-white/30'}`}
          />
          {/* Show frozen duration while processing so timer appears stopped */}
          <span className="font-mono text-primary text-sm tabular-nums">
            {formatDuration(isProcessing ? frozenDurationRef.current : duration)}
          </span>
        </div>

        {/* ═══ Live Waveform — driven by Web Audio API analyser ═══ */}
        <div className="flex-1 h-8 flex items-center justify-center gap-[2px] overflow-hidden">
          {waveformBars.map((height, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full transition-all duration-75"
              style={{ 
                height: `${isRecording ? height : 4}px`,
                // Use inline style with CSS var so it respects any accent color theme
                backgroundColor: 'var(--primary)',
                opacity: isRecording ? 0.4 + (height / 28) * 0.6 : 0.3
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={handleCancel}
            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">delete</span>
          </button>
          <button 
            onClick={stopRecording}
            disabled={isProcessing || !isRecording}
            className="w-10 h-10 flex items-center justify-center bg-primary text-background rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
          >
            {isProcessing ? (
              <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span className="material-symbols-outlined font-bold">send</span>
            )}
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full text-red-300 text-xs"
        >
          <span className="material-symbols-outlined text-sm">error</span>
          {error}
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-200"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </motion.div>
      )}
    </div>
  );
}
