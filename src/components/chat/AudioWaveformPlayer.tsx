import { useState, useRef, useEffect, useCallback, memo } from 'react';

interface AudioWaveformPlayerProps {
  src: string;       // Decrypted blob URL
  isMine: boolean;    // For theming (sender vs receiver)
  duration?: number;  // Optional pre-known duration in seconds
}

const BAR_COUNT = 40;
const BAR_WIDTH = 2.5;
const BAR_MIN_HEIGHT = 3;
const BAR_MAX_HEIGHT = 28;

// Shared context to avoid hitting browser limits (6 max)
let sharedAudioContext: AudioContext | null = null;
const getSharedAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioContext;
};

function AudioWaveformPlayerComponent({ src, isMine, duration: preDuration }: AudioWaveformPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(preDuration || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [waveformData, setWaveformData] = useState<number[]>(new Array(BAR_COUNT).fill(BAR_MIN_HEIGHT));
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);

  // ═══ Generate waveform visualization from audio data ═══
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let timeoutId: number;

    const generateWaveform = async () => {
      try {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        
        // Use shared context to prevent QuotaExceededError
        const audioContext = getSharedAudioContext();
        
        // Safely decode data with a generous timeout to prevent hanging forever
        const decodePromise = typeof audioContext.decodeAudioData === 'function' && audioContext.decodeAudioData.length > 1
           ? new Promise<AudioBuffer>((resolve, reject) => audioContext.decodeAudioData(arrayBuffer, resolve, reject))
           : audioContext.decodeAudioData(arrayBuffer);

        const timeoutPromise = new Promise<AudioBuffer>((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('Decode timeout')), 3000);
        });

        const audioBuffer = await Promise.race([decodePromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);
        
        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / BAR_COUNT);
        const bars: number[] = [];

        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          const start = i * blockSize;
          for (let j = start; j < start + blockSize && j < rawData.length; j++) {
            sum += Math.abs(rawData[j]);
          }
          bars.push(sum / blockSize);
        }

        const maxVal = Math.max(...bars, 0.01);
        const normalized = bars.map(v => 
          BAR_MIN_HEIGHT + (v / maxVal) * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT)
        );

        if (!cancelled) {
          setWaveformData(normalized);
          setTotalDuration(audioBuffer.duration);
          setIsLoaded(true);
        }

      } catch (err) {
        console.error('Waveform static decoding skipped/failed:', err);
        // Fallback: pseudo-random waveform derived from string length to stay mostly consistent
        if (!cancelled) {
          const pseudoSeed = src.length + (preDuration || 10);
          const fallback = Array.from({ length: BAR_COUNT }, (_, i) => {
            const seed = (pseudoSeed * i) % 100 / 100; // 0 to 1
            const bell = Math.sin((i / BAR_COUNT) * Math.PI); // shape it like a wave
            return BAR_MIN_HEIGHT + bell * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT) * (0.4 + seed * 0.6);
          });
          setWaveformData(fallback);
          setIsLoaded(true);
        }
      }
    };

    generateWaveform();
    return () => { 
      cancelled = true; 
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [src, preDuration]);

  // ═══ Set up the HTML Audio element ═══
  useEffect(() => {
    if (!src) return;
    
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && isFinite(audio.duration)) {
        setTotalDuration(audio.duration);
      }
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    });

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audio.pause();
      audio.src = '';
      audio.load();
      audioRef.current = null;
    };
  }, [src]);

  // ═══ Animation loop to update current time ═══
  const animateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    setCurrentTime(audio.currentTime);
    if (!audio.paused) {
      animationRef.current = requestAnimationFrame(animateProgress);
    }
  }, []);

  // ═══ Play / Pause ═══
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.playbackRate = playbackRate;
      audio.play().then(() => {
        setIsPlaying(true);
        animationRef.current = requestAnimationFrame(animateProgress);
      }).catch(err => {
        console.error('Playback failed:', err);
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
  }, [playbackRate, animateProgress]);

  // ═══ Playback Speed Toggle (1x → 1.5x → 2x → 1x) ═══
  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.5, 2];
    const currentIdx = speeds.indexOf(playbackRate);
    const nextRate = speeds[(currentIdx + 1) % speeds.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }, [playbackRate]);

  // ═══ Seek via waveform touch/click ═══
  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const container = waveformContainerRef.current;
    const audio = audioRef.current;
    if (!container || !audio || !totalDuration) return;

    const rect = container.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = fraction * totalDuration;

    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [totalDuration]);

  const handleTouchSeekStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    setIsSeeking(true);
    handleSeek(e);
  }, [handleSeek]);

  const handleTouchSeekMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (isSeeking) handleSeek(e);
  }, [isSeeking, handleSeek]);

  const handleTouchSeekEnd = useCallback(() => {
    setIsSeeking(false);
  }, []);

  // ═══ Format time as m:ss ═══
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = totalDuration > 0 ? currentTime / totalDuration : 0;
  const progressBarIndex = Math.floor(progress * BAR_COUNT);

  // Accent colors based on sender
  const accentColor = isMine ? 'var(--background)' : 'var(--primary)';
  const accentBg = isMine ? 'rgba(var(--background-rgb), 0.3)' : 'rgba(var(--primary-rgb), 0.15)';
  const barPlayedColor = isMine ? 'var(--background)' : 'var(--primary)';
  const barUnplayedColor = isMine ? 'rgba(var(--background-rgb), 0.3)' : 'rgba(var(--primary-rgb), 0.25)';

  return (
    <div 
      className="flex items-center gap-3 min-w-[220px] max-w-[280px] py-1 select-none"
      style={{ touchAction: 'none' }}
    >
      {/* Play/Pause Button */}
      <button
        onClick={togglePlay}
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90"
        style={{ 
          backgroundColor: accentBg,
          border: `1px solid ${isMine ? 'rgba(var(--background-rgb),0.2)' : 'rgba(var(--primary-rgb),0.2)'}` 
        }}
      >
        <span 
          className="material-symbols-outlined text-lg"
          style={{ 
            color: accentColor,
            fontVariationSettings: "'FILL' 1"
          }}
        >
          {isPlaying ? 'pause' : 'play_arrow'}
        </span>
      </button>

      {/* Waveform + Info Container */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Waveform Bars */}
        <div
          ref={waveformContainerRef}
          className="flex items-center gap-[1.5px] h-7 cursor-pointer"
          onClick={handleSeek}
          onTouchStart={handleTouchSeekStart}
          onTouchMove={handleTouchSeekMove}
          onTouchEnd={handleTouchSeekEnd}
        >
          {waveformData.map((height, i) => (
            <div
              key={i}
              className="rounded-full transition-colors duration-150"
              style={{
                width: `${BAR_WIDTH}px`,
                height: `${height}px`,
                backgroundColor: i <= progressBarIndex ? barPlayedColor : barUnplayedColor,
                opacity: !isLoaded ? 0.3 : (i <= progressBarIndex ? 1 : 0.5),
              }}
            />
          ))}
        </div>

        {/* Time + Speed */}
        <div className="flex items-center justify-between">
          <span 
            className="text-[10px] tabular-nums font-mono"
            style={{ color: isMine ? 'rgba(var(--background-rgb), 0.6)' : 'rgba(var(--primary-rgb), 0.5)' }}
          >
            {isPlaying || currentTime > 0 
              ? `${formatTime(currentTime)} / ${formatTime(totalDuration)}`
              : formatTime(totalDuration)
            }
          </span>

          {/* Playback Speed Pill */}
          <button
            onClick={cycleSpeed}
            className="px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all active:scale-90"
            style={{
              backgroundColor: playbackRate !== 1 ? accentBg : 'transparent',
              color: isMine ? 'rgba(var(--background-rgb), 0.7)' : 'rgba(var(--primary-rgb), 0.6)',
              border: playbackRate !== 1 
                ? `1px solid ${isMine ? 'rgba(var(--background-rgb), 0.15)' : 'rgba(var(--primary-rgb), 0.15)'}` 
                : '1px solid transparent',
            }}
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
}

const AudioWaveformPlayer = memo(AudioWaveformPlayerComponent);
export default AudioWaveformPlayer;
