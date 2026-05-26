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
// CONSENT:
//   Stored in localStorage per user. Both users must agree ONCE.
//   Key: `aura_snapcapture_consent_{userId}`
//   Values: 'agreed' | 'disagreed' | (missing = never asked)
//
// STEALTH MODE:
//   The RECEIVER (partner being snapped) sees NO UI at all.
//   Only the INITIATOR sees a progress overlay.
//   The receiver's camera operates silently in the background.
//
// BUG FIX v2:
//   All event handlers are stored in refs so the channel's .on()
//   callbacks always call the LATEST handler version. This fixes
//   the stale closure bug where processAndUpload (not memoized in
//   useMedia) caused beginCapturing to be recreated every render,
//   but the .on() callbacks still referenced the OLD function.
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

  // ═══ Ref to always have latest processAndUpload ═══════════════════════
  // processAndUpload from useMedia is NOT memoized (recreated every render).
  // Storing it in a ref lets us always call the latest version from inside
  // stale closures (like the setInterval callback in beginCapturing).
  const processAndUploadRef = useRef(processAndUpload);
  useEffect(() => { processAndUploadRef.current = processAndUpload; }, [processAndUpload]);

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
  const userRef = useRef(user);

  // Keep refs fresh
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userRef.current = user; }, [user]);

  // ═══ Broadcast Helper (uses refs only → never stale) ══════════════════
  const send = useCallback((event: string, payload: Record<string, any>) => {
    if (!channelRef.current || !subscribedRef.current || !userRef.current) return;
    console.log(`[SnapCapture] 📤 SEND ${event}`, payload);
    channelRef.current.send({
      type: 'broadcast',
      event,
      payload: { ...payload, from: userRef.current.id },
    });
  }, []); // No deps — uses refs only

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

      console.log('[SnapCapture] 📷 Camera started successfully');
      return true;
    } catch (err) {
      console.error('[SnapCapture] ❌ Camera access denied:', err);
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

  // ═══ Receiver: Start Capturing Photos (SILENT — no UI on receiver) ════
  // This runs entirely in the background on the receiver's device.
  // No state changes that would drive UI — the receiver sees nothing.
  const beginCapturing = useCallback(async () => {
    const cameraOk = await startCamera();
    if (!cameraOk) {
      send('snap_ack', { status: 'denied' });
      return;
    }

    // Send acknowledgement IMMEDIATELY after camera is ready
    send('snap_ack', { status: 'ready' });
    console.log('[SnapCapture] ✅ Camera ready, ack sent, starting capture loop');

    photosCountRef.current = 0;

    // Capture loop — runs silently, no setState calls for receiver
    const doCapture = async () => {
      if (photosCountRef.current >= MAX_PHOTOS) {
        stopCapture();
        send('snap_complete', {});
        console.log('[SnapCapture] 🏁 All photos captured, session complete');
        return;
      }

      const file = await captureFrame();
      if (!file) return;

      try {
        // Use ref to always call latest processAndUpload
        const media = await processAndUploadRef.current(file);
        if (media) {
          photosCountRef.current++;
          console.log(`[SnapCapture] 📸 Photo ${photosCountRef.current}/${MAX_PHOTOS} captured & uploaded`);

          // Send photo to initiator via broadcast
          send('snap_photo', {
            photo: {
              url: media.url,
              media_key: media.media_key,
              media_nonce: media.media_nonce,
              type: 'image',
            },
            index: photosCountRef.current,
            total: MAX_PHOTOS,
          });

          // Check if we've reached max
          if (photosCountRef.current >= MAX_PHOTOS) {
            if (captureIntervalRef.current) {
              clearInterval(captureIntervalRef.current);
              captureIntervalRef.current = null;
            }
            stopCapture();
            send('snap_complete', {});
            console.log('[SnapCapture] 🏁 All photos captured, session complete');
          }
        }
      } catch (err) {
        console.error('[SnapCapture] ❌ Photo capture/upload failed:', err);
      }
    };

    // Immediate first capture
    doCapture();

    // Then every 5 seconds
    captureIntervalRef.current = setInterval(doCapture, CAPTURE_INTERVAL_MS);
  }, [startCamera, captureFrame, stopCapture, send]);
  // NOTE: processAndUpload removed from deps — accessed via ref instead

  // ═══ Event Handler Refs ════════════════════════════════════════════════
  // Store all event handlers in refs so the channel's .on() callbacks
  // always call the LATEST version. This eliminates stale closure bugs.

  const handleReceiveRequestRef = useRef<() => void>(() => {});
  const handleReceiveAckRef = useRef<(status: 'ready' | 'denied' | 'consent_pending') => void>(() => {});
  const handleReceivePhotoRef = useRef<(photo: SnapCapturePhoto, index: number, total: number) => void>(() => {});
  const handleReceiveCompleteRef = useRef<() => void>(() => {});
  const handleReceiveCancelRef = useRef<() => void>(() => {});

  // Update handler refs every render (cheap — just a ref assignment)
  handleReceiveRequestRef.current = () => {
    if (stateRef.current.phase !== 'idle') return;
    const currentUser = userRef.current;
    if (!currentUser) return;

    const consent = getSnapCaptureConsent(currentUser.id);
    if (consent === 'disagreed') {
      send('snap_ack', { status: 'denied' });
      return;
    }
    if (consent === null) {
      // Need consent modal first
      consentPurposeRef.current = 'receive';
      setShowConsentModal(true);
      send('snap_ack', { status: 'consent_pending' });
      return;
    }

    // Consent already given — start capturing silently
    console.log('[SnapCapture] 📥 Request received, consent OK — starting capture');
    beginCapturing();
  };

  handleReceiveAckRef.current = (status) => {
    console.log(`[SnapCapture] 📥 ACK received: ${status}, current phase: ${stateRef.current.phase}`);
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
    }
    // consent_pending → just keep waiting, no state change
  };

  handleReceivePhotoRef.current = (photo, index, total) => {
    if (stateRef.current.role !== 'initiator') return;
    console.log(`[SnapCapture] 📥 Photo ${index}/${total} received`);

    photosAccumulatorRef.current.push(photo);
    setState(prev => ({
      ...prev,
      photosCount: index,
      totalPhotos: total,
      photos: [...photosAccumulatorRef.current],
    }));
  };

  handleReceiveCompleteRef.current = () => {
    if (stateRef.current.role !== 'initiator') return;
    console.log('[SnapCapture] 📥 Complete signal received — sending photos to chat');

    setState(prev => ({
      ...prev,
      phase: 'completing',
    }));
  };

  handleReceiveCancelRef.current = () => {
    stopCapture();
    const wasActive = stateRef.current.phase === 'capturing' || stateRef.current.phase === 'requesting';
    
    if (stateRef.current.role === 'initiator' && wasActive) {
      setState(prev => ({
        ...prev,
        phase: 'cancelled',
        role: null,
        errorMessage: 'Session cancelled by partner',
      }));
      setTimeout(() => {
        setState(prev => prev.phase === 'cancelled' ? { ...prev, phase: 'idle', errorMessage: null } : prev);
      }, 3000);
    } else {
      // Receiver cancellation — just silently reset
      setState(prev => ({ ...prev, phase: 'idle', role: null }));
    }
  };

  // ═══ Setup Broadcast Channel ══════════════════════════════════════════
  // Handlers are called through refs → always latest version, never stale.
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
        handleReceiveRequestRef.current(); // ← Through ref, always latest
      })
      .on('broadcast', { event: 'snap_ack' }, (payload) => {
        const data = payload.payload as { from: string; status: 'ready' | 'denied' | 'consent_pending' };
        if (data.from !== partnerId) return;
        handleReceiveAckRef.current(data.status); // ← Through ref
      })
      .on('broadcast', { event: 'snap_photo' }, (payload) => {
        const data = payload.payload as { from: string; photo: SnapCapturePhoto; index: number; total: number };
        if (data.from !== partnerId) return;
        handleReceivePhotoRef.current(data.photo, data.index, data.total); // ← Through ref
      })
      .on('broadcast', { event: 'snap_complete' }, (payload) => {
        const data = payload.payload as { from: string };
        if (data.from !== partnerId) return;
        handleReceiveCompleteRef.current(); // ← Through ref
      })
      .on('broadcast', { event: 'snap_cancel' }, (payload) => {
        const data = payload.payload as { from: string };
        if (data.from !== partnerId) return;
        handleReceiveCancelRef.current(); // ← Through ref
      })
      .subscribe((status) => {
        subscribedRef.current = status === 'SUBSCRIBED';
        console.log(`[SnapCapture] 📡 Channel status: ${status}`);
      });

    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      supabase.removeChannel(channel);
      channelRef.current = null;
      stopCapture();
    };
  }, [user?.id, partnerId]);

  // ═══ Public Actions ═══════════════════════════════════════════════════

  /** Initiator: Start a snap capture session */
  const initiateSnapCapture = useCallback(() => {
    if (!userRef.current || !partnerId || !partnerIsOnline) return;
    if (stateRef.current.phase !== 'idle') return;

    // Check my own consent
    const consent = getSnapCaptureConsent(userRef.current.id);
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

    // Timeout: if no ack in 30 seconds, cancel (increased from 15s for camera permission prompts)
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
      setTimeout(() => {
        setState(prev => prev.phase === 'denied' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
    }, 30000);
  }, [partnerId, partnerIsOnline, send]);

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
    const currentUser = userRef.current;
    if (!currentUser) return;
    setShowConsentModal(false);
    setSnapCaptureConsent(currentUser.id, agreed ? 'agreed' : 'disagreed');

    if (!agreed) {
      if (consentPurposeRef.current === 'receive') {
        send('snap_ack', { status: 'denied' });
      }
      setState(prev => ({ ...prev, phase: 'idle', role: null }));
      return;
    }

    // Consent given — proceed based on purpose
    if (consentPurposeRef.current === 'initiate') {
      // Retry initiation
      setState(prev => ({
        ...prev,
        phase: 'requesting',
        role: 'initiator',
        photosCount: 0,
        photos: [],
        errorMessage: null,
      }));
      send('snap_request', {});

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
      }, 30000);
    } else {
      // Receiving — start capturing silently
      beginCapturing();
    }
  }, [send, beginCapturing]);

  /** Get the live camera stream (for overlay preview on receiver side) */
  const getCameraStream = useCallback((): MediaStream | null => {
    return mediaStreamRef.current;
  }, []);

  // ═══ Auto-cancel if partner goes offline during active session ════════
  useEffect(() => {
    if (!partnerIsOnline && state.role === 'initiator' && (state.phase === 'requesting' || state.phase === 'capturing')) {
      setState(prev => ({
        ...prev,
        phase: 'cancelled',
        errorMessage: 'Partner went offline',
      }));
      setTimeout(() => {
        setState(prev => prev.phase === 'cancelled' ? { ...prev, phase: 'idle', role: null, errorMessage: null } : prev);
      }, 3000);
    }
    // Receiver going offline: just stop capture silently
    if (!partnerIsOnline && state.role === 'receiver') {
      stopCapture();
      setState(prev => ({ ...prev, phase: 'idle', role: null }));
    }
  }, [partnerIsOnline, state.phase, state.role, stopCapture]);

  return {
    snapState: state,
    showConsentModal,
    initiateSnapCapture,
    cancelSnapCapture,
    handleConsent,
    getCameraStream,
  };
}
