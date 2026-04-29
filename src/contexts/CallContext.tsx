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
  incomingCall: { partnerId: string; video: boolean; offerSdp: RTCSessionDescriptionInit } | null;
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
  // incomingCall now carries the offerSdp received in the call_request
  const [incomingCall, setIncomingCall] = useState<{
    partnerId: string;
    video: boolean;
    offerSdp: RTCSessionDescriptionInit;
  } | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const webrtcManagerRef = useRef<WebRTCManager | null>(null);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [amICaller, setAmICaller] = useState(false);
  const prevCallStateRef = useRef<CallState>('idle');
  const currentStateRef = useRef<CallState>('idle');
  currentStateRef.current = callState;
  const isVideoRef = useRef<boolean>(true);
  // Guard against double-accept (e.g. double tap on accept button)
  const isAcceptingRef = useRef<boolean>(false);

  // ─── Call History Logging ─────────────────────────────────────────────────
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

  // ─── Signaling Setup ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !partner) return;

    // Per-pair channel — pass both IDs so the channel name is deterministic
    callSignaling.start(user.id, partner.id);

    const handleMessage = async (msg: CallMessage) => {
      console.log(`[WEBRTC Context] Received message: ${msg.type}`);

      // ── INCOMING CALL REQUEST ────────────────────────────────────────────
      if (msg.type === 'call_request') {
        if (currentStateRef.current !== 'idle') {
          // Already busy — auto-reject
          console.log(`[WEBRTC Context] Busy (${currentStateRef.current}), auto-rejecting incoming call`);
          callSignaling.sendMessage({
            type: 'call_reject',
            sender_id: user.id,
            target_id: msg.sender_id,
          });
          return;
        }
        const offerSdp = msg.payload?.offer;
        if (!offerSdp) {
          console.error('[WEBRTC Context] call_request missing offer SDP — ignoring');
          return;
        }
        console.log(`[WEBRTC Context] Incoming call from ${msg.sender_id} — storing offer SDP`);
        setIncomingCall({
          partnerId: msg.sender_id,
          video: msg.payload?.video ?? true,
          offerSdp,
        });
        return;
      }

      // All other messages require a manager
      if (!webrtcManagerRef.current) {
        console.warn(`[WEBRTC Context] Ignoring message ${msg.type} — no active manager`);
        return;
      }
      const mgr = webrtcManagerRef.current;

      switch (msg.type) {

        // CALLER receives this: contains the answer SDP
        case 'call_accept':
          console.log(`[WEBRTC Context] Partner accepted — setting remote answer`);
          if (msg.payload?.answer) {
            await mgr.handleAccept(msg.payload.answer);
          } else {
            console.error('[WEBRTC Context] call_accept missing answer SDP');
          }
          break;

        case 'call_reject':
          console.log(`[WEBRTC Context] Partner rejected call`);
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          setError('Call was declined');
          setTimeout(() => setError(null), 3000);
          callSignaling.clearQueue();
          break;

        case 'call_end':
          console.log(`[WEBRTC Context] Partner ended call`);
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          setIncomingCall(null);
          callSignaling.clearQueue();
          break;

        // sdp_offer / sdp_answer — only used for ICE restart re-negotiation now
        case 'sdp_offer':
          console.log(`[WEBRTC Context] Received SDP offer (ICE restart)`);
          await mgr.handleOffer(msg.payload);
          break;

        case 'sdp_answer':
          console.log(`[WEBRTC Context] Received SDP answer (ICE restart)`);
          await mgr.handleAnswer(msg.payload);
          break;

        case 'ice_candidate':
          // Manager queues this internally if remote description isn't set yet
          await mgr.handleIceCandidate(msg.payload);
          break;
      }
    };

    const unsubscribe = callSignaling.onMessage(handleMessage);

    return () => {
      unsubscribe();
      callSignaling.stop();
    };
  }, [user?.id, partner?.id]);

  // ─── Manager Factory ─────────────────────────────────────────────────────
  const initManager = async () => {
    if (!user || !partner) return null;
    
    const mgr = new WebRTCManager(user.id, partner.id, {
      onLocalStream: setLocalStream,
      onRemoteStream: (stream) => {
        // Use a new MediaStream reference on each call to force React re-render
        setRemoteStream(new MediaStream(stream.getTracks()));
      },
      onCallStateChange: setCallState,
      onCallEnd: () => {
        setLocalStream(null);
        setRemoteStream(null);
        webrtcManagerRef.current = null;
      },
      onError: (err) => {
        setError(err);
        setTimeout(() => setError(null), 5000);
      },
    });

    // Derive and set the E2E session key (kept for Phase 2 activation)
    const keyPair = getStoredKeyPair();
    const mySec = keyPair?.secretKey;
    if (mySec && partner.public_key) {
      try {
        const partnerPub = decodeBase64(partner.public_key);
        const sessionKey = await deriveCallSessionKey(partnerPub, mySec);
        mgr.setSessionKey(sessionKey);
      } catch (e) {
        console.warn('[WEBRTC Context] Could not derive session key', e);
      }
    }

    webrtcManagerRef.current = mgr;
    return mgr;
  };

  // ─── Actions ─────────────────────────────────────────────────────────────

  const initiateCall = async (video: boolean = true) => {
    console.log(`[WEBRTC Context] initiateCall(video=${video}) requested`);
    setError(null);
    setIsVideoEnabled(video);
    setIsAudioEnabled(true);
    setAmICaller(true);
    isVideoRef.current = video;
    
    // Acquire stream with user gesture context intact (important for iOS Safari)
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
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
      return;
    }

    const mgr = await initManager();
    if (mgr) {
      // Manager will create offer and send call_request{offer} in one step
      await mgr.initiateCall(video, stream);
    }
  };

  const acceptCall = async () => {
    console.log(`[WEBRTC Context] acceptCall() requested`);
    if (!incomingCall) {
      console.warn(`[WEBRTC Context] No incoming call to accept!`);
      return;
    }
    // Guard against double-tap / re-render triggering acceptCall twice
    if (isAcceptingRef.current) {
      console.warn(`[WEBRTC Context] acceptCall already in progress, ignoring duplicate`);
      return;
    }
    isAcceptingRef.current = true;
    setError(null);
    setIsVideoEnabled(incomingCall.video);
    setIsAudioEnabled(true);
    
    // Acquire stream with user gesture context
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
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
      isAcceptingRef.current = false;
      rejectCall();
      return;
    }

    const mgr = await initManager();
    if (mgr) {
      // Manager sets remote description from the stored offer, creates answer,
      // and sends call_accept{answer} in one step
      await mgr.acceptCall(incomingCall.video, incomingCall.offerSdp, stream);
    }
    setIncomingCall(null);
    isAcceptingRef.current = false;
  };

  const rejectCall = () => {
    console.log(`[WEBRTC Context] rejectCall() requested`);
    if (user && incomingCall) {
      callSignaling.sendMessage({
        type: 'call_reject',
        sender_id: user.id,
        target_id: incomingCall.partnerId,
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
        callSignaling.sendMessage({
          type: 'call_end',
          sender_id: user.id,
          target_id: partner.id,
        });
      }
    }
    setCallState('idle');
    setLocalStream(null);
    setRemoteStream(null);
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
