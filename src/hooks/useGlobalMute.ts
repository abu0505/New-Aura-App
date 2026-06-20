import { useState, useEffect } from 'react';

export function useGlobalMute() {
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('aura_video_muted') === 'true';
  });

  useEffect(() => {
    const handleMuteChange = () => {
      setIsMuted(localStorage.getItem('aura_video_muted') === 'true');
    };
    window.addEventListener('aura-mute-change', handleMuteChange);
    return () => window.removeEventListener('aura-mute-change', handleMuteChange);
  }, []);

  const toggleMute = () => {
    const newMuted = !isMuted;
    localStorage.setItem('aura_video_muted', String(newMuted));
    setIsMuted(newMuted);
    window.dispatchEvent(new CustomEvent('aura-mute-change'));
  };

  return { isMuted, toggleMute };
}
