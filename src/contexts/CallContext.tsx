import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { callSignaling } from '../lib/callSignaling';
import type { CallMessage } from '../lib/callSignaling';
import { WebRTCManager } from '../lib/webrtcManager';
import type { CallState } from '../lib/webrtcManager';
import {
  deriveCallSessionKey,
  generateCallSalt,
  encodeSalt,
  decodeSalt,
  generateCallFingerprint,
} from '../lib/callEncryption';
import { useAuth } from './AuthContext';
import { usePartner } from '../hooks/usePartner';
import { supabase } from '../lib/supabase';
import { getStoredKeyPair, encryptMessage, decodeBase64, encodeBase64 } from '../lib/encryption';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncomingCallInfo {
  partnerId: string;
  video: boolean;
  offerSdp: RTCSessionDescriptionInit;  // SDP offer bundled in call_request
  salt: string;                          // Per-call salt for HKDF
}

interface CallContextType {
  callState: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  incomingCall: IncomingCallInfo | null;
  callFingerprint: string[] | null;  // 4-emoji E2EE verification
  initiateCall: (video?: boolean) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  error: string | null;
}

const CallContext = createContext<CallContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, encryptionStatus } = useAuth();
  const { partner } = usePartner();

  const [callState, setCallState] = useState<CallState>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callFingerprint, setCallFingerprint] = useState<string[] | null>(null);

  const webrtcManagerRef = useRef<WebRTCManager | null>(null);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [amICaller, setAmICaller] = useState(false);
  const prevCallStateRef = useRef<CallState>('idle');
  const currentStateRef = useRef<CallState>('idle');
  currentStateRef.current = callState;
  const isVideoRef = useRef<boolean>(true);
  const isAcceptingRef = useRef<boolean>(false);

  // ─── Error helper ──────────────────────────────────────────────────────────
  const showError = useCallback((msg: string, durationMs = 5000) => {
    setError(msg);
    setTimeout(() => setError(null), durationMs);
  }, []);

  // ─── Call history logging ──────────────────────────────────────────────────
  useEffect(() => {
    if (callState === 'connected' && prevCallStateRef.current !== 'connected') {
      setCallStartTime(Date.now());
    }

    if (callState === 'idle' && prevCallStateRef.current !== 'idle') {
      if (amICaller) {
        const wasConnected = prevCallStateRef.current === 'connected';
        const status = wasConnected ? 'answered' : 'missed';
        const duration = wasConnected && callStartTime
          ? Math.floor((Date.now() - callStartTime) / 1000)
          : 0;

        const logHistory = async () => {
          if (!user || !partner?.public_key) return;
          const myKeyPair = getStoredKeyPair();
          if (!myKeyPair) return;
          const text = `[CALL:${isVideoRef.current ? 'video' : 'audio'}:${status}:${duration}]`;
          const encrypted = encryptMessage(
            text,
            decodeBase64(partner.public_key),
            myKeyPair.secretKey
          );
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
      setCallFingerprint(null);
    }

    prevCallStateRef.current = callState;
  }, [callState, amICaller, callStartTime]);

  // ─── Signaling subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !partner) return;

    // Per-pair channel (Phase 1.1)
    callSignaling.start(user.id, partner.id);

    const handleMessage = async (msg: CallMessage) => {

      // ── No manager yet: only call_request is valid ─────────────────────────
      if (!webrtcManagerRef.current) {
        if (msg.type === 'call_request') {
          const { video, sdp, salt } = msg.payload ?? {};
          if (!sdp || !salt) {
            return;
          }
          if (currentStateRef.current !== 'idle') {
            // We are busy — auto-reject
            callSignaling.sendMessage({
              type: 'call_reject',
              sender_id: user.id,
              target_id: partner.id,
            });
            return;
          }
          setIncomingCall({ partnerId: msg.sender_id, video: video ?? true, offerSdp: sdp, salt });
        }
        return;
      }

      const mgr = webrtcManagerRef.current;

      switch (msg.type) {
        case 'call_request':
          // Duplicate call_request while in a call → reject
          if (currentStateRef.current !== 'idle') {
            callSignaling.sendMessage({ type: 'call_reject', sender_id: user.id, target_id: partner.id });
            return;
          }
          const { video: v, sdp: s, salt: sl } = msg.payload ?? {};
          if (!s || !sl) return;
          setIncomingCall({ partnerId: msg.sender_id, video: v ?? true, offerSdp: s, salt: sl });
          break;

        case 'call_accept':
          // Caller receives answer SDP from receiver (WhatsApp 2-step pattern)
          if (msg.payload?.sdp) {
            await mgr.handleAccept(msg.payload.sdp);
          }
          break;

        case 'call_reject':
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          showError('Call was declined', 3000);
          callSignaling.clearQueue();
          break;

        case 'call_end':
          mgr.endCall(false);
          webrtcManagerRef.current = null;
          setCallState('idle');
          setIncomingCall(null);
          callSignaling.clearQueue();
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
  }, [user?.id, partner?.id]);

  // ─── Manager factory ───────────────────────────────────────────────────────
  const _initManager = useCallback(async (salt: Uint8Array): Promise<WebRTCManager | null> => {
    if (!user || !partner) return null;

    const mgr = new WebRTCManager(user.id, partner.id, {
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onCallStateChange: setCallState,
      onCallEnd: () => {
        setLocalStream(null);
        setRemoteStream(null);
        setCallFingerprint(null);
        webrtcManagerRef.current = null;
      },
      onError: showError,
    });

    // ── Phase 2: HKDF key derivation with per-call salt ────────────────────
    if (partner.public_key && encryptionStatus === 'ready') {
      const keyPair = getStoredKeyPair();
      if (keyPair) {
        try {
          const partnerPub = decodeBase64(partner.public_key);
          const sessionKey = await deriveCallSessionKey(partnerPub, keyPair.secretKey, salt);
          mgr.setSessionKey(sessionKey);

          // Generate emoji fingerprint for display in UI
          const fingerprint = await generateCallFingerprint(sessionKey);
          setCallFingerprint(fingerprint);
        } catch (e) {
          // Could not derive session key
        }
      }
    }

    webrtcManagerRef.current = mgr;
    return mgr;
  }, [user, partner, encryptionStatus]);

  // ─── Initiate call (CALLER side) ──────────────────────────────────────────
  const initiateCall = useCallback(async (video = true) => {
    if (!user || !partner) return;
    setError(null);
    setIsVideoEnabled(video);
    setIsAudioEnabled(true);
    setAmICaller(true);
    isVideoRef.current = video;

    // Acquire media FIRST (preserves user-gesture context for iOS Safari)
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS');
      stream = await navigator.mediaDevices.getUserMedia({
        video: video ? { facingMode: 'user' } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setLocalStream(stream);
    } catch (err: any) {
      showError(err?.message || 'Camera access denied');
      return;
    }

    // Generate per-call HKDF salt (Phase 2 — forward secrecy)
    const salt = generateCallSalt();
    const encodedSalt = encodeSalt(salt);

    const mgr = await _initManager(salt);
    if (!mgr) return;

    // Pass salt into initiateCall so it gets bundled in call_request payload
    await mgr.initiateCall(video, encodedSalt, stream);
  }, [user, partner, _initManager, showError]);

  // ─── Accept call (RECEIVER side) ──────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    if (isAcceptingRef.current) return;
    isAcceptingRef.current = true;

    setError(null);
    setIsVideoEnabled(incomingCall.video);
    setIsAudioEnabled(true);

    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS');
      stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.video ? { facingMode: 'user' } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      setLocalStream(stream);
    } catch (err: any) {
      showError(err?.message || 'Camera access denied');
      isAcceptingRef.current = false;
      // Inline reject (avoids circular dependency with rejectCall defined below)
      if (user && incomingCall) {
        callSignaling.sendMessage({
          type: 'call_reject',
          sender_id: user.id,
          target_id: incomingCall.partnerId,
        });
      }
      setIncomingCall(null);
      callSignaling.clearQueue();
      return;
    }

    const salt = decodeSalt(incomingCall.salt);
    const mgr = await _initManager(salt);
    if (!mgr) {
      isAcceptingRef.current = false;
      return;
    }

    // acceptCall sets remote description from bundled offer, creates answer, sends call_accept
    await mgr.acceptCall(incomingCall.video, incomingCall.offerSdp, stream);
    setIncomingCall(null);
    isAcceptingRef.current = false;
  }, [incomingCall, _initManager]);

  // ─── Reject call ──────────────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    if (user && incomingCall) {
      callSignaling.sendMessage({
        type: 'call_reject',
        sender_id: user.id,
        target_id: incomingCall.partnerId,
      });
    }
    setIncomingCall(null);
    callSignaling.clearQueue();
  }, [user, incomingCall]);

  // ─── End call ─────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.endCall();
    } else if (user && partner) {
      callSignaling.sendMessage({
        type: 'call_end',
        sender_id: user.id,
        target_id: partner.id,
      });
    }
    setCallState('idle');
    setIncomingCall(null);
    callSignaling.clearQueue();
  }, [user, partner]);

  const toggleVideo = useCallback(() => {
    if (webrtcManagerRef.current) {
      const next = !isVideoEnabled;
      webrtcManagerRef.current.toggleVideo(next);
      setIsVideoEnabled(next);
    }
  }, [isVideoEnabled]);

  const toggleAudio = useCallback(() => {
    if (webrtcManagerRef.current) {
      const next = !isAudioEnabled;
      webrtcManagerRef.current.toggleAudio(next);
      setIsAudioEnabled(next);
    }
  }, [isAudioEnabled]);

  return (
    <CallContext.Provider value={{
      callState,
      localStream,
      remoteStream,
      isVideoEnabled,
      isAudioEnabled,
      incomingCall,
      callFingerprint,
      initiateCall,
      acceptCall,
      rejectCall,
      endCall,
      toggleVideo,
      toggleAudio,
      error,
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
};
