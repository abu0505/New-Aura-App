import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { callSignaling } from '../lib/callSignaling';
import type { CallMessage } from '../lib/callSignaling';
import { WebRTCManager } from '../lib/webrtcManager';
import type { CallState } from '../lib/webrtcManager';
import { deriveCallSessionKey } from '../lib/callEncryption';
import { useAuth } from './AuthContext';
import { usePartner } from '../hooks/usePartner';

interface CallContextType {
  callState: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  incomingCall: { partnerId: string; video: boolean } | null;
  initiateCall: (video?: boolean) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  error: string | null;
}

const CallContext = createContext<CallContextType | null>(null);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, encryptionStatus } = useAuth();
  const { partner } = usePartner();
  
  const [callState, setCallState] = useState<CallState>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ partnerId: string; video: boolean } | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const webrtcManagerRef = useRef<WebRTCManager | null>(null);

  useEffect(() => {
    if (!user || !partner) return;

    callSignaling.start(user.id);

    const handleMessage = async (msg: CallMessage) => {
      // Re-initialize manager if it doesn't exist and we got a message
      if (!webrtcManagerRef.current) {
        if (msg.type === 'call_request') {
          setIncomingCall({ partnerId: msg.sender_id, video: msg.payload?.video ?? true });
        }
        return;
      }

      const mgr = webrtcManagerRef.current;

      switch (msg.type) {
        case 'call_request':
          if (callState === 'idle') {
            setIncomingCall({ partnerId: msg.sender_id, video: msg.payload?.video ?? true });
          } else {
            // Already busy
            callSignaling.sendMessage({
              type: 'call_reject',
              sender_id: user.id,
              target_id: partner.id
            });
          }
          break;
        case 'call_accept':
          await mgr.handleAccept();
          break;
        case 'call_reject':
          setCallState('idle');
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setError('Call was declined');
          setTimeout(() => setError(null), 3000);
          break;
        case 'call_end':
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          setIncomingCall(null);
          break;
        case 'sdp_offer':
          await mgr.handleOffer(msg.payload);
          break;
        case 'sdp_answer':
          await mgr.handleAnswer(msg.payload);
          break;
        case 'ice_candidate':
          await mgr.handleIceCandidate(msg.payload);
          break;
      }
    };

    const unsubscribe = callSignaling.onMessage(handleMessage);

    return () => {
      unsubscribe();
      callSignaling.stop();
    };
  }, [user, partner, callState]);

  const initManager = async () => {
    if (!user || !partner) return null;
    
    const mgr = new WebRTCManager(user.id, partner.id, {
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onCallStateChange: setCallState,
      onCallEnd: () => {
        setLocalStream(null);
        setRemoteStream(null);
        webrtcManagerRef.current = null;
      },
      onError: (err) => {
        setError(err);
        setTimeout(() => setError(null), 5000);
      }
    });

    // Derive and set encryption key
    // We get key history from partner, assuming the primary key is public_key
    if (partner.public_key && encryptionStatus === 'ready') {
      try {
        // AppKeyLocked corresponds to our secret key (Wait, the user's secret key is in AuthContext or IndexedDB)
        // Let's get mySecretKey. We need to export it from encryption or AuthContext.
        // For simplicity and since AuthContext manages keys, we might need a way to get the secret key.
        // Wait, encryption.ts has getPrivateKey() which gets it from IndexedDB/memory.
      } catch (e) {
        console.error("Encryption derivation skipped due to error", e);
      }
    }

    // ACTUALLY: Let's fetch the key asynchronously inside initManager.
    const { getStoredKeyPair, decodeBase64 } = await import('../lib/encryption');
    const keyPair = getStoredKeyPair();
    const mySec = keyPair?.secretKey;
    if (mySec && partner.public_key) {
      try {
        const partnerPub = decodeBase64(partner.public_key);
        const sessionKey = await deriveCallSessionKey(partnerPub, mySec);
        mgr.setSessionKey(sessionKey);
      } catch (e) {
        console.warn('Could not derive session key for call', e);
      }
    }

    webrtcManagerRef.current = mgr;
    return mgr;
  };

  const initiateCall = async (video: boolean = true) => {
    setError(null);
    setIsVideoEnabled(video);
    setIsAudioEnabled(true);
    const mgr = await initManager();
    if (mgr) {
      await mgr.initiateCall(video);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    setError(null);
    setIsVideoEnabled(incomingCall.video);
    setIsAudioEnabled(true);
    const mgr = await initManager();
    if (mgr) {
      await mgr.acceptCall(incomingCall.video);
    }
    setIncomingCall(null);
  };

  const rejectCall = () => {
    if (user && incomingCall) {
      callSignaling.sendMessage({
        type: 'call_reject',
        sender_id: user.id,
        target_id: incomingCall.partnerId
      });
    }
    setIncomingCall(null);
  };

  const endCall = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.endCall();
    } else {
      setCallState('idle');
    }
    setIncomingCall(null);
  };

  const toggleVideo = () => {
    if (webrtcManagerRef.current) {
      const newState = !isVideoEnabled;
      webrtcManagerRef.current.toggleVideo(newState);
      setIsVideoEnabled(newState);
    }
  };

  const toggleAudio = () => {
    if (webrtcManagerRef.current) {
      const newState = !isAudioEnabled;
      webrtcManagerRef.current.toggleAudio(newState);
      setIsAudioEnabled(newState);
    }
  };

  return (
    <CallContext.Provider value={{
      callState,
      localStream,
      remoteStream,
      isVideoEnabled,
      isAudioEnabled,
      incomingCall,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleVideo,
      toggleAudio,
      error
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within CallProvider');
  }
  return context;
};
