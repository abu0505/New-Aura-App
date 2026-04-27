import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { callSignaling } from '../lib/callSignaling';
import type { CallMessage } from '../lib/callSignaling';
import { WebRTCManager } from '../lib/webrtcManager';
import type { CallState } from '../lib/webrtcManager';
import { deriveCallSessionKey } from '../lib/callEncryption';
import { useAuth } from './AuthContext';
import { usePartner } from '../hooks/usePartner';
import { supabase } from '../lib/supabase';
import { getStoredKeyPair, encryptMessage, decodeBase64, encodeBase64 } from '../lib/encryption';

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
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [amICaller, setAmICaller] = useState(false);
  const prevCallStateRef = useRef<CallState>('idle');
  const isVideoRef = useRef<boolean>(true);

  // Monitor callState changes to log call history
  useEffect(() => {
    if (callState === 'connected' && prevCallStateRef.current !== 'connected') {
      setCallStartTime(Date.now());
    }

    if (callState === 'idle' && prevCallStateRef.current !== 'idle') {
      if (amICaller) {
        let status = 'missed';
        let duration = 0;
        
        if (prevCallStateRef.current === 'connected' && callStartTime) {
          status = 'answered';
          duration = Math.floor((Date.now() - callStartTime) / 1000);
        } else {
          status = 'missed';
        }

        const logHistory = async () => {
          if (!user || !partner?.public_key) return;
          const myKeyPair = getStoredKeyPair();
          if (!myKeyPair) return;

          const text = `[CALL:${isVideoRef.current ? 'video' : 'audio'}:${status}:${duration}]`;
          const encrypted = encryptMessage(text, decodeBase64(partner.public_key), myKeyPair.secretKey);
          
          await supabase.from('messages').insert({
            id: crypto.randomUUID(),
            sender_id: user.id,
            receiver_id: partner.id,
            encrypted_content: encrypted.ciphertext,
            nonce: encrypted.nonce,
            type: 'text',
            sender_public_key: encodeBase64(myKeyPair.publicKey),
          });
        };
        logHistory();
      }
      
      setCallStartTime(null);
      setAmICaller(false);
    }

    prevCallStateRef.current = callState;
  }, [callState, amICaller, callStartTime]);

  useEffect(() => {
    if (!user || !partner) return;

    callSignaling.start(user.id);

    const handleMessage = async (msg: CallMessage) => {
      console.log(`[WEBRTC Context] Received message: ${msg.type}`);
      // Re-initialize manager if it doesn't exist and we got a message
      if (!webrtcManagerRef.current) {
        if (msg.type === 'call_request') {
          console.log(`[WEBRTC Context] Handling incoming call request from ${msg.sender_id}`);
          setIncomingCall({ partnerId: msg.sender_id, video: msg.payload?.video ?? true });
        } else {
          console.log(`[WEBRTC Context] Ignoring message ${msg.type} because manager is null`);
        }
        return;
      }

      const mgr = webrtcManagerRef.current;

      switch (msg.type) {
        case 'call_request':
          if (callState === 'idle') {
            console.log(`[WEBRTC Context] Handling incoming call request from ${msg.sender_id}`);
            setIncomingCall({ partnerId: msg.sender_id, video: msg.payload?.video ?? true });
          } else {
            console.log(`[WEBRTC Context] Rejecting incoming call request because we are busy. state=${callState}`);
            // Already busy
            callSignaling.sendMessage({
              type: 'call_reject',
              sender_id: user.id,
              target_id: partner.id
            });
          }
          break;
        case 'call_accept':
          console.log(`[WEBRTC Context] Partner accepted call. Forwarding to manager.`);
          await mgr.handleAccept();
          break;
        case 'call_reject':
          console.log(`[WEBRTC Context] Partner rejected call. Setting idle.`);
          setCallState('idle');
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setError('Call was declined');
          setTimeout(() => setError(null), 3000);
          callSignaling.clearQueue();
          break;
        case 'call_end':
          console.log(`[WEBRTC Context] Partner ended call. Setting idle.`);
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          setIncomingCall(null);
          callSignaling.clearQueue();
          break;
        case 'sdp_offer':
          console.log(`[WEBRTC Context] Received SDP offer.`);
          await mgr.handleOffer(msg.payload);
          break;
        case 'sdp_answer':
          console.log(`[WEBRTC Context] Received SDP answer.`);
          await mgr.handleAnswer(msg.payload);
          break;
        case 'ice_candidate':
          console.log(`[WEBRTC Context] Received ICE candidate.`);
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
    console.log(`[WEBRTC Context] initiateCall(video=${video}) requested`);
    setError(null);
    setIsVideoEnabled(video);
    setIsAudioEnabled(true);
    setAmICaller(true);
    isVideoRef.current = video;
    
    // Acquire stream immediately to preserve user gesture context for iOS Safari
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access requires HTTPS or localhost');
      }
      console.log(`[WEBRTC Context] Requesting getUserMedia`);
      stream = await navigator.mediaDevices.getUserMedia({
        video: video ? { facingMode: 'user' } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      console.log(`[WEBRTC Context] getUserMedia success`);
      setLocalStream(stream);
    } catch (err: any) {
      console.error(`[WEBRTC Context] getUserMedia failed:`, err);
      setError(err?.message || 'Camera access denied');
      return; // Stop if we can't get media
    }

    const mgr = await initManager();
    if (mgr) {
      console.log(`[WEBRTC Context] Manager initialized, calling initiateCall on manager`);
      await mgr.initiateCall(video, stream);
    }
  };

  const acceptCall = async () => {
    console.log(`[WEBRTC Context] acceptCall() requested`);
    if (!incomingCall) {
      console.warn(`[WEBRTC Context] No incoming call to accept!`);
      return;
    }
    setError(null);
    setIsVideoEnabled(incomingCall.video);
    setIsAudioEnabled(true);
    
    // Acquire stream immediately to preserve user gesture context for iOS Safari
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access requires HTTPS or localhost');
      }
      console.log(`[WEBRTC Context] Requesting getUserMedia for answer`);
      stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.video ? { facingMode: 'user' } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      console.log(`[WEBRTC Context] getUserMedia success for answer`);
      setLocalStream(stream);
    } catch (err: any) {
      console.error(`[WEBRTC Context] getUserMedia failed:`, err);
      setError(err?.message || 'Camera access denied');
      rejectCall();
      return;
    }

    const mgr = await initManager();
    if (mgr) {
      console.log(`[WEBRTC Context] Manager initialized, calling acceptCall on manager`);
      await mgr.acceptCall(incomingCall.video, stream);
    }
    setIncomingCall(null);
  };

  const rejectCall = () => {
    console.log(`[WEBRTC Context] rejectCall() requested`);
    if (user && incomingCall) {
      console.log(`[WEBRTC Context] Sending call_reject manually`);
      callSignaling.sendMessage({
        type: 'call_reject',
        sender_id: user.id,
        target_id: incomingCall.partnerId
      });
    }
    setIncomingCall(null);
    callSignaling.clearQueue();
  };

  const endCall = () => {
    console.log(`[WEBRTC Context] endCall() requested`);
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.endCall();
    } else {
      if (user && partner) {
        console.log(`[WEBRTC Context] Sending call_end manually since manager is null`);
        callSignaling.sendMessage({
          type: 'call_end',
          sender_id: user.id,
          target_id: partner.id
        });
      }
    }
    setCallState('idle');
    setIncomingCall(null);
    callSignaling.clearQueue();
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
