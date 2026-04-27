import { useEffect, useRef } from 'react';
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
    acceptCall,
    rejectCall,
    endCall,
    toggleVideo,
    toggleAudio,
    error
  } = useCall();
  const { partner } = usePartner();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Auto-play local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Auto-play remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (!partner) return null;

  if (incomingCall && callState === 'idle') {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center p-6 transition-all">
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
          <div className="w-32 h-32 rounded-full border-4 border-[var(--gold)] overflow-hidden shadow-[0_0_50px_rgba(201,169,110,0.5)] mb-6 animate-pulse">
             <EncryptedImage
              url={partner.avatar_url}
              encryptionKey={partner.avatar_key}
              nonce={partner.avatar_nonce}
              alt="Partner Avatar"
              className="w-full h-full object-cover"
              placeholder={`https://ui-avatars.com/api/?name=${partner.display_name || 'Partner'}&background=c9a96e&color=000000`}
            />
          </div>
          <h2 className="text-3xl font-serif text-white mb-2">{partner.display_name || 'Your Partner'}</h2>
          <p className="text-[var(--gold)] font-label tracking-[0.2em] uppercase text-sm mb-12">
            Incoming {incomingCall.video ? 'Video' : 'Voice'} Call...
          </p>
          
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

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Background / Remote Video */}
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {remoteStream && remoteStream.getVideoTracks().length > 0 ? (
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center animate-pulse">
            <div className="w-32 h-32 rounded-full overflow-hidden opacity-50 mb-4">
               <EncryptedImage
                  url={partner.avatar_url}
                  encryptionKey={partner.avatar_key}
                  nonce={partner.avatar_nonce}
                  alt="Partner Avatar"
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

      {/* Local Video PIP */}
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

      {/* Error Toast */}
      {error && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full text-sm font-bold tracking-widest uppercase shadow-xl z-50 backdrop-blur-md">
          {error}
        </div>
      )}

      {/* Controls Overlay */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/60 backdrop-blur-xl px-8 py-4 rounded-full border border-white/10 shadow-2xl z-20">
        <button 
          onClick={toggleAudio}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${!isAudioEnabled ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
        >
          <span className="material-symbols-outlined text-xl">{isAudioEnabled ? 'mic' : 'mic_off'}</span>
        </button>
        <button 
          onClick={toggleVideo}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${!isVideoEnabled ? 'bg-red-500/20 text-red-500' : 'bg-white/10 text-white hover:bg-white/20'}`}
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

      {/* E2E Encryption Badge */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full z-10 backdrop-blur-md">
        <span className="material-symbols-outlined text-[14px] text-emerald-400">lock</span>
        <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold">End-to-End Encrypted</span>
      </div>
    </div>
  );
}
