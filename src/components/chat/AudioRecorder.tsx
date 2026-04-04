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
  const { processAndUpload } = useMedia();
  // ═══ Ref to avoid stale closure in recorder.onstop callback ═══
  const processAndUploadRef = useRef(processAndUpload);
  useEffect(() => { processAndUploadRef.current = processAndUpload; }, [processAndUpload]);

  // ═══ Web Audio API refs for live waveform ═══
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [waveformBars, setWaveformBars] = useState<number[]>(new Array(24).fill(4));

  const BAR_COUNT = 24;

  // Animate waveform bars from analyser frequency data
  const updateWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Sample evenly from the frequency data to get BAR_COUNT values
    const bars: number[] = [];
    const step = Math.floor(dataArray.length / BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      // Average a small window of frequencies for smoother display
      const start = i * step;
      const end = Math.min(start + step, dataArray.length);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += dataArray[j];
      }
      const avg = sum / (end - start);
      // Map 0-255 to 4-28 (pixel height range)
      bars.push(Math.max(4, (avg / 255) * 28));
    }

    setWaveformBars(bars);
    animationFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // ═══ Set up Web Audio API analyser for real-time waveform ═══
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      // Don't connect analyser to destination — we don't want to hear our own mic

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
            // processAndUpload returned null — likely missing partner key or auth
            setError('Upload failed — encryption keys may not be ready. Please try again.');
            console.error('processAndUpload returned null. Ensure partner public_key is available.');
          }
        } catch (uploadErr) {
          console.error('Audio upload error:', uploadErr);
          setError('Failed to send audio. Please try again.');
        } finally {
          setIsProcessing(false);
        }
        
        cleanupStream();
      };

      recorder.start(100); // Collect data every 100ms for smoother onstop
      setIsRecording(true);
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

      // Start waveform animation loop
      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    } catch (err) {
      console.error('Failed to start recording', err);
      setError('Microphone access denied');
      // Don't auto-cancel — show the error so user knows what happened
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
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleCancel = () => {
    // Stop recording if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    
    // Cleanup
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
      <div className="flex items-center gap-4 bg-black/40 backdrop-blur-3xl rounded-full px-6 py-2 border border-[#e6c487]/30 shadow-2xl">
        <div className="flex items-center gap-3">
          <motion.div 
            animate={{ scale: isRecording ? [1, 1.2, 1] : 1 }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500' : isProcessing ? 'bg-[#e6c487]' : 'bg-white/30'}`}
          />
          <span className="font-mono text-[#e6c487] text-sm tabular-nums">{formatDuration(duration)}</span>
        </div>

        {/* ═══ Live Waveform — driven by Web Audio API analyser ═══ */}
        <div className="flex-1 h-8 flex items-center justify-center gap-[2px] overflow-hidden">
          {waveformBars.map((height, i) => (
            <div
              key={i}
              className="w-[3px] bg-[#e6c487]/50 rounded-full transition-all duration-75"
              style={{ 
                height: `${isRecording ? height : 4}px`,
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
            className="w-10 h-10 flex items-center justify-center bg-[#e6c487] text-[#412d00] rounded-full shadow-lg active:scale-90 transition-all disabled:opacity-50"
          >
            {isProcessing ? (
              <div className="w-4 h-4 border-2 border-[#412d00] border-t-transparent rounded-full animate-spin"></div>
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
