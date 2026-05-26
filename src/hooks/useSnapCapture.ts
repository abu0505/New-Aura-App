import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useMedia } from './useMedia';

// ═══════════════════════════════════════════════════════════════════════
// SnapCapture — "Surprise Snaps" Feature
// ═══════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE:
//   Signaling:  Supabase Realtime Broadcast (WebSocket, zero egress)
//   Camera:     navigator.mediaDevices.getUserMedia (front camera)
//   Capture:    Canvas → toBlob('image/jpeg') every 5 seconds
//   Encryption: Reuses useMedia.processAndUpload() pipeline
//   Delivery:   Photos sent as regular encrypted image messages
//   Grouping:   Existing messageGrouping.ts auto-groups into grid
//
// STATE MACHINE:
//   IDLE → REQUESTING → CAPTURING → COMPLETING → IDLE
//                ↓           ↓
//             DENIED      CANCELLED
//
// CONSENT:
//   Stored in localStorage per user. Both users must agree.
//   Key: `aura_snapcapture_consent_{userId}`
//   Values: 'agreed' | 'disagreed' | (missing = never asked)
// ═══════════════════════════════════════════════════════════════════════

export type SnapCapturePhase =
  | 'idle'
  | 'consent_needed'     // First time — show consent modal
  | 'requesting'         // User A sent request, waiting for User B's ack
  | 'capturing'          // Photos are being captured on User B's device
  | 'completing'         // All photos captured, sending to chat
  | 'denied'             // Camera denied or partner refused
  | 'cancelled';         // Either user cancelled mid-session

export type SnapCaptureRole = 'initiator' | 'receiver' | null;

export interface SnapCapturePhoto {
  url: string;
  media_key: string;
  media_nonce: string;
  type: 'image';
}

export interface SnapCaptureState {
  phase: SnapCapturePhase;
  role: SnapCaptureRole;
  photosCount: number;           // How many photos captured so far
  totalPhotos: number;           // Target (10)
  photos: SnapCapturePhoto[];    // Accumulated photos (initiator side)
  errorMessage: string | null;
}

const MAX_PHOTOS = 10;
const CAPTURE_INTERVAL_MS = 5000;
const CONSENT_KEY_PREFIX = 'aura_snapcapture_consent_';

// ─── Consent helpers ────────────────────────────────────────────────────
export function getSnapCaptureConsent(userId: string): 'agreed' | 'disagreed' | null {
  const val = localStorage.getItem(`${CONSENT_KEY_PREFIX}${userId}`);
  if (val === 'agreed' || val === 'disagreed') return val;
  return null;
}

export function setSnapCaptureConsent(userId: string, value: 'agreed' | 'disagreed') {
  localStorage.setItem(`${CONSENT_KEY_PREFIX}${userId}`, value);
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useSnapCapture(
  partnerId: string | undefined,
  partnerIsOnline: boolean,
) {
  const { user } = useAuth();
  const { processAndUpload } = useMedia();

  const [state, setState] = useState<SnapCaptureState>({
    phase: 'idle',
    role: null,
    photosCount: 0,
    totalPhotos: MAX_PHOTOS,
    photos: [],
    errorMessage: null,
  });

  // Show consent modal state (separate from phase for better UX control)
  const [showConsentModal, setShowConsentModal] = useState(false);
  // Track if consent is for initiating or receiving
  const consentPurposeRef = useRef<'initiate' | 'receive'>('initiate');

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const photosCountRef = useRef(0);
  const photosAccumulatorRef = useRef<SnapCapturePhoto[]>([]);
  const stateRef = useRef(state);

  // Keep stateRef fresh
  useEffect(() => { stateRef.current = state; }, [state]);

  // ═══ Setup Broadcast Channel ══════════════════════════════════════════
  useEffect(() => {
    if (!user || !partnerId) return;

    const chatRoomId = [user.id, partnerId].sort().join('-');
    const channel = supabase.channel(`snapcapture:${chatRoomId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'snap_request' }, (payload) => {
        const data = payload.payload as { from: string };
        if (data.from !== partnerId) return;
        handleReceiveRequest();
      })
      .on('broadcast', { event: 'snap_ack' }, (payload) => {
        const data = payload.payload as { from: string; status: 'ready' | 'denied' | 'consent_pending' };
        if (data.from !== partnerId) return;
        handleReceiveAck(data.status);
      })
      .on('broadcast', { event: 'snap_photo' }, (payload) => {
        const data = payload.payload as { from: string; photo: SnapCapturePhoto; index: number; total: number };
        if (data.from !== partnerId) return;
        handleReceivePhoto(data.photo, data.index, data.total);
      })
      .on('broadcast', { event: 'snap_complete' }, (payload) => {
        const data = payload.payload as { from: string };
        if (data.from !== partnerId) return;
        handleReceiveComplete();
      })
      .on('broadcast', { event: 'snap_cancel' }, (payload) => {
        const data = payload.payload as { from: string };
        if (data.from !== partnerId) return;
        handleReceiveCancel();
      })
      .subscribe((status) => {
        subscribedRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
      stopCapture();
    };
  }, [user?.id, partnerId]);

  // ═══ Broadcast Helpers ════════════════════════════════════════════════
  const send = useCallback((event: string, payload: Record<string, any>) => {
    if (!channelRef.current || !subscribedRef.current || !user) return;
    channelRef.current.send({
      type: 'broadcast',
      event,
      payload: { ...payload, from: user.id },
    });
  }, [user?.id]);

  // ═══ Camera Helpers ═══════════════════════════════════════════════════
  const startCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      mediaStreamRef.current = stream;

      // Create hidden video element
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      videoElementRef.current = video;

      // Create canvas for frame capture
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvasRef.current = canvas;

      return true;
    } catch (err) {
      console.error('[SnapCapture] Camera access denied:', err);
      return false;
    }
  }, []);

  const captureFrame = useCallback(async (): Promise<File | null> => {
    const video = videoElementRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Update canvas dimensions in case video size changed
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(null); return; }
          const file = new File(
            [blob],
            `snapcapture_${Date.now()}.jpg`,
            { type: 'image/jpeg' }
          );
          resolve(file);
        },
        'image/jpeg',
        0.85
      );
    });
  }, []);

  const stopCapture = useCallback(() => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoElementRef.current) {
      videoElementRef.current.pause();
      videoElementRef.current.srcObject = null;
      videoElementRef.current = null;
    }
    canvasRef.current = null;
  }, []);

  // ═══ Receiver: Start Capturing Photos ═════════════════════════════════
  const beginCapturing = useCallback(async () => {
    const cameraOk = await startCamera();
    if (!cameraOk) {
      send('snap_ack', { status: 'denied' });
      setState(prev => ({
        ...prev,
        phase: 'denied',
        role: 'receiver',
        errorMessage: 'Camera access denied',
      }));
      // Auto-reset after 3 seconds
      setTimeout(() => {
        setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
      return;
    }

    // Send acknowledgement
    send('snap_ack', { status: 'ready' });

    photosCountRef.current = 0;
    photosAccumulatorRef.current = [];
    setState(prev => ({
      ...prev,
      phase: 'capturing',
      role: 'receiver',
      photosCount: 0,
      photos: [],
      errorMessage: null,
    }));

    // Capture first photo immediately, then every 5 seconds
    const doCapture = async () => {
      if (photosCountRef.current >= MAX_PHOTOS) {
        // Done — send complete
        stopCapture();
        send('snap_complete', {});
        setState(prev => ({
          ...prev,
          phase: 'idle',
          role: null,
          photosCount: 0,
          photos: [],
        }));
        return;
      }

      const file = await captureFrame();
      if (!file) return;

      // Encrypt and upload using existing pipeline
      try {
        const media = await processAndUpload(file);
        if (media) {
          const photo: SnapCapturePhoto = {
            url: media.url,
            media_key: media.media_key,
            media_nonce: media.media_nonce,
            type: 'image',
          };

          photosCountRef.current++;
          photosAccumulatorRef.current.push(photo);

          // Send photo to initiator via broadcast
          send('snap_photo', {
            photo,
            index: photosCountRef.current,
            total: MAX_PHOTOS,
          });

          setState(prev => ({
            ...prev,
            photosCount: photosCountRef.current,
          }));

          // Check if we've reached max
          if (photosCountRef.current >= MAX_PHOTOS) {
            if (captureIntervalRef.current) {
              clearInterval(captureIntervalRef.current);
              captureIntervalRef.current = null;
            }
            stopCapture();
            send('snap_complete', {});
            setState(prev => ({
              ...prev,
              phase: 'idle',
              role: null,
              photosCount: 0,
              photos: [],
            }));
          }
        }
      } catch (err) {
        console.error('[SnapCapture] Photo capture/upload failed:', err);
      }
    };

    // Immediate first capture
    doCapture();

    // Then every 5 seconds
    captureIntervalRef.current = setInterval(doCapture, CAPTURE_INTERVAL_MS);
  }, [startCamera, captureFrame, stopCapture, send, processAndUpload]);

  // ═══ Event Handlers ═══════════════════════════════════════════════════

  const handleReceiveRequest = useCallback(() => {
    if (stateRef.current.phase !== 'idle') return; // Already in a session

    // Check consent
    if (!user) return;
    const consent = getSnapCaptureConsent(user.id);
    if (consent === 'disagreed') {
      send('snap_ack', { status: 'denied' });
      return;
    }
    if (consent === null) {
      // Need to show consent modal first
      consentPurposeRef.current = 'receive';
      setShowConsentModal(true);
      // Tell initiator to wait
      send('snap_ack', { status: 'consent_pending' });
      return;
    }

    // Consent already given — start capturing
    beginCapturing();
  }, [user?.id, send, beginCapturing]);

  const handleReceiveAck = useCallback((status: 'ready' | 'denied' | 'consent_pending') => {
    if (stateRef.current.phase !== 'requesting') return;

    if (status === 'ready') {
      photosAccumulatorRef.current = [];
      setState(prev => ({
        ...prev,
        phase: 'capturing',
        photosCount: 0,
        photos: [],
      }));
    } else if (status === 'denied') {
      setState(prev => ({
        ...prev,
        phase: 'denied',
        errorMessage: 'Partner denied camera access',
      }));
      setTimeout(() => {
        setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
    } else if (status === 'consent_pending') {
      // Partner is seeing consent modal — keep waiting
      // No state change needed
    }
  }, []);

  const handleReceivePhoto = useCallback((photo: SnapCapturePhoto, index: number, total: number) => {
    if (stateRef.current.role !== 'initiator') return;

    photosAccumulatorRef.current.push(photo);
    setState(prev => ({
      ...prev,
      photosCount: index,
      totalPhotos: total,
      photos: [...photosAccumulatorRef.current],
    }));
  }, []);

  const handleReceiveComplete = useCallback(() => {
    if (stateRef.current.role !== 'initiator') return;

    setState(prev => ({
      ...prev,
      phase: 'completing',
    }));
  }, []);

  const handleReceiveCancel = useCallback(() => {
    stopCapture();
    const wasCapturing = stateRef.current.phase === 'capturing' || stateRef.current.phase === 'requesting';
    setState(prev => ({
      ...prev,
      phase: wasCapturing ? 'cancelled' : 'idle',
      role: null,
      errorMessage: wasCapturing ? 'Session cancelled by partner' : null,
    }));

    if (wasCapturing) {
      setTimeout(() => {
        setState(prev => prev.phase === 'cancelled' ? { ...prev, phase: 'idle', errorMessage: null } : prev);
      }, 3000);
    }
  }, [stopCapture]);

  // ═══ Public Actions ═══════════════════════════════════════════════════

  /** Initiator: Start a snap capture session */
  const initiateSnapCapture = useCallback(() => {
    if (!user || !partnerId || !partnerIsOnline) return;
    if (stateRef.current.phase !== 'idle') return;

    // Check my own consent
    const consent = getSnapCaptureConsent(user.id);
    if (consent === 'disagreed') {
      setState(prev => ({
        ...prev,
        phase: 'denied',
        errorMessage: 'You have disabled this feature',
      }));
      setTimeout(() => {
        setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
      return;
    }
    if (consent === null) {
      // Need consent first
      consentPurposeRef.current = 'initiate';
      setShowConsentModal(true);
      return;
    }

    // Send request
    setState(prev => ({
      ...prev,
      phase: 'requesting',
      role: 'initiator',
      photosCount: 0,
      photos: [],
      errorMessage: null,
    }));
    send('snap_request', {});

    // Timeout: if no response in 15 seconds, cancel
    setTimeout(() => {
      setState(prev => {
        if (prev.phase === 'requesting') {
          return {
            ...prev,
            phase: 'denied',
            errorMessage: 'Partner did not respond',
          };
        }
        return prev;
      });
      // Auto-reset denied state
      setTimeout(() => {
        setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
    }, 15000);
  }, [user?.id, partnerId, partnerIsOnline, send]);

  /** Cancel an active session (either role) */
  const cancelSnapCapture = useCallback(() => {
    send('snap_cancel', {});
    stopCapture();
    setState(prev => ({
      ...prev,
      phase: 'idle',
      role: null,
      photosCount: 0,
      photos: [],
      errorMessage: null,
    }));
  }, [send, stopCapture]);

  /** Handle consent modal response */
  const handleConsent = useCallback((agreed: boolean) => {
    if (!user) return;
    setShowConsentModal(false);
    setSnapCaptureConsent(user.id, agreed ? 'agreed' : 'disagreed');

    if (!agreed) {
      if (consentPurposeRef.current === 'receive') {
        send('snap_ack', { status: 'denied' });
      }
      setState(prev => ({ ...prev, phase: 'idle', role: null }));
      return;
    }

    // Consent given — proceed based on purpose
    if (consentPurposeRef.current === 'initiate') {
      // Retry the initiation now that we have consent
      setState(prev => ({
        ...prev,
        phase: 'requesting',
        role: 'initiator',
        photosCount: 0,
        photos: [],
        errorMessage: null,
      }));
      send('snap_request', {});

      // Same timeout as initiateSnapCapture
      setTimeout(() => {
        setState(prev => {
          if (prev.phase === 'requesting') {
            return { ...prev, phase: 'denied', errorMessage: 'Partner did not respond' };
          }
          return prev;
        });
        setTimeout(() => {
          setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
        }, 3000);
      }, 15000);
    } else {
      // Receiving — start capturing
      beginCapturing();
    }
  }, [user?.id, send, beginCapturing]);

  /** Get the live camera stream (for overlay preview on receiver side) */
  const getCameraStream = useCallback((): MediaStream | null => {
    return mediaStreamRef.current;
  }, []);

  // ═══ Auto-cancel if partner goes offline during session ═══════════════
  useEffect(() => {
    if (!partnerIsOnline && (state.phase === 'requesting' || state.phase === 'capturing')) {
      stopCapture();
      setState(prev => ({
        ...prev,
        phase: 'cancelled',
        errorMessage: 'Partner went offline',
      }));
      setTimeout(() => {
        setState(prev => prev.phase === 'cancelled' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
    }
  }, [partnerIsOnline, state.phase, stopCapture]);

  return {
    snapState: state,
    showConsentModal,
    initiateSnapCapture,
    cancelSnapCapture,
    handleConsent,
    getCameraStream,
  };
}
