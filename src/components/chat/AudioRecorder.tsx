import { useState, useRef, useEffect } from 'react';
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const { processAndUpload } = useMedia();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
        
        setIsProcessing(true);
        const uploaded = await processAndUpload(file, { optimize: false });
        setIsProcessing(false);
        
        if (uploaded) {
          onRecordingComplete({
            url: uploaded.url,
            media_key: uploaded.media_key,
            media_nonce: uploaded.media_nonce,
            type: 'audio'
          });
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording', err);
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="flex items-center gap-4 bg-black/40 backdrop-blur-3xl rounded-full px-6 py-2 border border-[#e6c487]/30 shadow-2xl">
      <div className="flex items-center gap-3">
        <motion.div 
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-2 h-2 bg-red-500 rounded-full"
        />
        <span className="font-mono text-[#e6c487] text-sm tabular-nums">{formatDuration(duration)}</span>
      </div>

      <div className="flex-1 h-8 flex items-center justify-center gap-1 overflow-hidden">
        {/* Simple Waveform Simulation */}
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            animate={{ height: isRecording ? [8, 24, 8] : 8 }}
            transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }}
            className="w-1 bg-[#e6c487]/40 rounded-full"
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={onCancel}
          className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white"
        >
          <span className="material-symbols-outlined">delete</span>
        </button>
        <button 
          onClick={stopRecording}
          disabled={isProcessing}
          className="w-10 h-10 flex items-center justify-center bg-[#e6c487] text-[#412d00] rounded-full shadow-lg active:scale-90 transition-all"
        >
          {isProcessing ? (
            <div className="w-4 h-4 border-2 border-[#412d00] border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <span className="material-symbols-outlined font-bold">send</span>
          )}
        </button>
      </div>
    </div>
  );
}
