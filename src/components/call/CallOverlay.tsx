import { useEffect, useRef, useCallback } from 'react';
import { useCall } from '../../contexts/CallContext';
import { usePartner } from '../../hooks/usePartner';
import EncryptedImage from '../common/EncryptedImage';

export default function CallOverlay() {
  const {
    callState,
    localStream,
    remoteStream,
    isVideoEnabled,
    isAudioEnabled,
    incomingCall,
    callFingerprint,
    acceptCall,
    rejectCall,
    endCall,
    toggleVideo,
    toggleAudio,
    error,
  } = useCall();
  const { partner } = usePartner();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // ─── Robust video attachment helper ───────────────────────────────────────
  // Phase 1.4 Fix: Explicitly call .play() and handle autoplay policy.
  // On iOS Safari and Android Chrome, <video autoPlay> alone is not enough when
  // srcObject is set programmatically — a manual .play() call is required.
  const attachStream = useCallback(
    (ref: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) => {
      const el = ref.current;
      if (!el || !stream) return;
      if (el.srcObject === stream) return; // Already attached — no-op

      el.srcObject = stream;

      // Wait for metadata to load before attempting play (prevents NotAllowedError)
      const tryPlay = () => {
        el.play().catch((err) => {
          // AutoPlay was blocked — this usually means the video is muted enough
          // already (local stream), or the remote video needs a user gesture.
          // We log but don't crash — the video will still render once the browser
          // allows it.
          console.warn('[CallOverlay] video.play() blocked:', err.name);
        });
      };

      if (el.readyState >= 1) {
        tryPlay();
      } else {
        el.onloadedmetadata = tryPlay;
      }
    },
    []
  );

  // Attach local stream
  useEffect(() => {
    attachStream(localVideoRef, localStream);
  }, [localStream, callState, attachStream]);

  // Attach remote stream
  useEffect(() => {
    attachStream(remoteVideoRef, remoteStream);
  }, [remoteStream, callState, attachStream]);

  // ─── Ringtone & vibration ─────────────────────────────────────────────────
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let vibrateInterval: ReturnType<typeof setInterval> | null = null;
    let ringInterval: ReturnType<typeof setInterval> | null = null;

    if (incomingCall && callState === 'idle') {
      if ('vibrate' in navigator) {
        navigator.vibrate([400, 200, 400, 1000]);
        vibrateInterval = setInterval(() => navigator.vibrate([400, 200, 400, 1000]), 2000);
      }

      try {
        const AC = window.AudioContext ?? (window as any).webkitAudioContext;
        if (AC) {
          audioCtx = new AC();
          const play = () => {
            if (!audioCtx || audioCtx.state === 'closed') return;
            const t = audioCtx.currentTime;
            [440, 480].forEach((freq) => {
              const osc = audioCtx!.createOscillator();
              const gain = audioCtx!.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(freq, t);
              gain.gain.setValueAtTime(0, t);
              gain.gain.linearRampToValueAtTime(0.15, t + 0.1);
              gain.gain.setValueAtTime(0.15, t + 0.8);
              gain.gain.linearRampToValueAtTime(0, t + 1.0);
              osc.connect(gain);
              gain.connect(audioCtx!.destination);
              osc.start(t);
              osc.stop(t + 1.0);
            });
          };
          play();
          ringInterval = setInterval(play, 2000);
        }
      } catch {
        console.warn('[CallOverlay] Web Audio not available');
      }
    }

    return () => {
      if (vibrateInterval) clearInterval(vibrateInterval);
      if (ringInterval) clearInterval(ringInterval);
      if ('vibrate' in navigator) navigator.vibrate(0);
      audioCtx?.close().catch(() => {});
    };
  }, [incomingCall, callState]);

  if (!partner) return null;

  // ─── Incoming call screen ─────────────────────────────────────────────────
  if (incomingCall && callState === 'idle') {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center p-6">
        {/* Blurred avatar background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
          <EncryptedImage
            url={partner.avatar_url}
            encryptionKey={partner.avatar_key}
            nonce={partner.avatar_nonce}
            alt="Background"
            className="w-full h-full object-cover blur-3xl scale-110"
          />
        </div>

        <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in duration-500">
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-primary/30 animate-ping shadow-[0_0_50px_rgba(201,169,110,0.5)]" />
            <div className="w-32 h-32 rounded-full border-4 border-[var(--gold)] overflow-hidden relative z-10">
              <EncryptedImage
                url={partner.avatar_url}
                encryptionKey={partner.avatar_key}
                nonce={partner.avatar_nonce}
                alt="Partner Avatar"
                className="w-full h-full object-cover"
                placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=000000`}
              />
            </div>
          </div>

          <h2 className="text-3xl font-serif text-white mb-3">{partner.display_name || 'Your Partner'}</h2>

          <div className="flex items-center gap-3 mb-12 bg-black/40 px-6 py-2.5 rounded-full border border-white/10 backdrop-blur-md">
            <span className={`material-symbols-outlined text-2xl ${incomingCall.video ? 'text-primary' : 'text-emerald-400'} animate-pulse`}>
              {incomingCall.video ? 'videocam' : 'call'}
            </span>
            <p className={`font-label tracking-[0.2em] uppercase text-xs font-bold ${incomingCall.video ? 'text-primary' : 'text-emerald-400'}`}>
              {incomingCall.video ? 'Video' : 'Voice'} Call...
            </p>
          </div>

          <div className="flex gap-8">
            <button
              onClick={rejectCall}
              className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg shadow-red-500/40"
            >
              <span className="material-symbols-outlined text-3xl">call_end</span>
            </button>
            <button
              onClick={acceptCall}
              className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg shadow-emerald-500/40 animate-bounce"
            >
              <span className="material-symbols-outlined text-3xl">{incomingCall.video ? 'videocam' : 'call'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Idle / error toast ───────────────────────────────────────────────────
  if (callState === 'idle') {
    if (error) {
      return (
        <div className="fixed inset-0 z-[9999] pointer-events-none flex items-start justify-center pt-12">
          <div className="bg-red-500/90 text-white px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-4">
            {error}
          </div>
        </div>
      );
    }
    return null;
  }

  // ─── Active call screen ───────────────────────────────────────────────────
  const hasRemoteVideo = remoteStream && remoteStream.getVideoTracks().length > 0;

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">

      {/* Remote video (full-screen background) */}
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {/* Phase 1.4: muted is NOT set on remote (we want audio).
            We use playsInline for iOS + explicit .play() via attachStream(). */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover transition-opacity duration-500 ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
        />

        {/* Avatar placeholder when no video track yet */}
        {!hasRemoteVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center animate-pulse">
            <div className="w-32 h-32 rounded-full overflow-hidden opacity-50 mb-4">
              <EncryptedImage
                url={partner.avatar_url}
                encryptionKey={partner.avatar_key}
                nonce={partner.avatar_nonce}
                alt="Partner"
                className="w-full h-full object-cover"
                placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=000000`}
              />
            </div>
            <p className="text-[var(--text-secondary)] font-label tracking-[0.2em] uppercase text-sm">
              {callState === 'calling' ? 'Calling...' : callState === 'connecting' ? 'Connecting...' : 'Voice Call'}
            </p>
          </div>
        )}
      </div>

      {/* Local video PiP (muted — no echo) */}
      {localStream && isVideoEnabled && (
        <div className="absolute top-12 right-6 w-32 h-48 bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/20 z-10">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform -scale-x-100"
          />
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase shadow-xl z-50 backdrop-blur-md">
          {error}
        </div>
      )}

      {/* Top bar: E2EE badge + emoji fingerprint */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full backdrop-blur-md">
          <span className="material-symbols-outlined text-[14px] text-emerald-400">lock</span>
          <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold">End-to-End Encrypted</span>
        </div>

        {/* Phase 2: Emoji verification fingerprint */}
        {callFingerprint && callFingerprint.length === 4 && (
          <div
            className="flex items-center gap-1.5 bg-black/50 border border-white/10 px-3 py-1 rounded-full backdrop-blur-md"
            title="Compare these emojis with your partner to verify the call is secure"
          >
            {callFingerprint.map((emoji, i) => (
              <span key={i} className="text-base leading-none">{emoji}</span>
            ))}
            <span className="text-[8px] uppercase tracking-widest text-white/40 ml-1">verify</span>
          </div>
        )}
      </div>

      {/* Call controls */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/60 backdrop-blur-xl px-8 py-4 rounded-full border border-white/10 shadow-2xl z-20">
        <button
          onClick={toggleAudio}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            !isAudioEnabled ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <span className="material-symbols-outlined text-xl">{isAudioEnabled ? 'mic' : 'mic_off'}</span>
        </button>
        <button
          onClick={toggleVideo}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            !isVideoEnabled ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'
          }`}
        >
          <span className="material-symbols-outlined text-xl">{isVideoEnabled ? 'videocam' : 'videocam_off'}</span>
        </button>
        <button
          onClick={endCall}
          className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 ml-2"
        >
          <span className="material-symbols-outlined text-3xl">call_end</span>
        </button>
      </div>
    </div>
  );
}
