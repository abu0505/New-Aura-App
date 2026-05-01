import { callSignaling } from './callSignaling';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

interface WebRTCManagerOptions {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onCallStateChange: (state: CallState) => void;
  onCallEnd: () => void;
  onError: (error: string) => void;
}

// ─── ICE Server Configuration ────────────────────────────────────────────────
// Priority: STUN (free) → TURN relay (paid Metered or openrelay fallback).
// Replace openrelay credentials with a paid Metered.ca account for production.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private myUserId: string;
  private partnerId: string;

  // ── E2EE ──────────────────────────────────────────────────────────────────
  private sessionKey: Uint8Array | null = null;
  private worker: Worker | null = null;

  // ── State ─────────────────────────────────────────────────────────────────
  private options: WebRTCManagerOptions;
  private callState: CallState = 'idle';

  // ── ICE Candidate queuing (WhatsApp pattern) ──────────────────────────────
  // Candidates that arrive before setRemoteDescription() are buffered here and
  // replayed once the remote description is set so they are never silently lost.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;

  // ── Connection health monitoring ──────────────────────────────────────────
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytesReceived = 0;
  private stalledSeconds = 0;
  private readonly STALL_THRESHOLD_S = 6; // seconds of zero bytes before ICE restart

  constructor(myUserId: string, partnerId: string, options: WebRTCManagerOptions) {
    this.myUserId = myUserId;
    this.partnerId = partnerId;
    this.options = options;
  }

  // ── Public API: set the HKDF-derived session key ──────────────────────────
  setSessionKey(key: Uint8Array) {
    this.sessionKey = key;
  }

  // ── State helper ──────────────────────────────────────────────────────────
  private setCallState(state: CallState) {
    this.callState = state;
    this.options.onCallStateChange(state);
  }

  // ─── Peer Connection Setup ────────────────────────────────────────────────
  private async _initPC() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    const pc = this.peerConnection;

    // ── ICE candidates ──────────────────────────────────────────────────────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        callSignaling.sendMessage({
          type: 'ice_candidate',
          sender_id: this.myUserId,
          target_id: this.partnerId,
          payload: candidate.toJSON(),
        });
      }
    };

    // ── ICE connection state ────────────────────────────────────────────────
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'failed') {
        this._restartICE();
      }
      if (s === 'disconnected') {
        // Give it 3 s to recover on its own before restarting
        setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            this._restartICE();
          }
        }, 3000);
      }
    };

    // ── Connection state ────────────────────────────────────────────────────
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      switch (s) {
        case 'connected':
          this.setCallState('connected');
          this._startHealthMonitor();
          break;
        case 'failed':
          this.endCall(false);
          break;
        case 'closed':
          break;
      }
    };

    // ── Incoming tracks ─────────────────────────────────────────────────────
    // IMPORTANT: Create the MediaStream once and reuse it. Adding tracks to an
    // already-assigned srcObject causes blank screens on iOS Safari.
    pc.ontrack = ({ track, streams }) => {

      if (!this.remoteStream) {
        // Use the stream that WebRTC provides if available, otherwise create our own
        this.remoteStream = streams[0] ?? new MediaStream();
        this.options.onRemoteStream(this.remoteStream);
      }

      // Only add if not already in the stream (prevents duplicate tracks on renegotiation)
      const exists = this.remoteStream.getTracks().find((t) => t.id === track.id);
      if (!exists) this.remoteStream.addTrack(track);

      // Apply decryption transform (Phase 3)
      const receiver = pc.getReceivers().find((r) => r.track.id === track.id);
      if (receiver) this._applyTransform(receiver, 'decrypt');
    };
  }

  // ─── E2EE Transform (WhatsApp-style frame-level AES-GCM) ─────────────────
  private _initWorker() {
    if (!this.sessionKey) return;
    if (!('RTCRtpScriptTransform' in window) && !this._hasInsertableStreams()) {
      return;
    }
    try {
      this.worker = new Worker(
        new URL('../workers/callEncryptionWorker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.postMessage({ operation: 'setKey', keyData: this.sessionKey });
    } catch (e) {
      // E2EE worker failed to initialize
    }
  }

  private _hasInsertableStreams(): boolean {
    return typeof (RTCRtpSender.prototype as any).createEncodedStreams === 'function';
  }

  private _applyTransform(
    senderOrReceiver: RTCRtpSender | RTCRtpReceiver,
    operation: 'encrypt' | 'decrypt'
  ) {
    if (!this.worker) return;

    // Modern API: RTCRtpScriptTransform (Chrome 94+, Firefox 117+)
    if ('RTCRtpScriptTransform' in window) {
      try {
        (senderOrReceiver as any).transform = new (window as any).RTCRtpScriptTransform(
          this.worker,
          { operation }
        );
        return;
      } catch (e) {
        // Fallback to legacy API
      }
    }

    // Legacy API: createEncodedStreams (Chrome ≤93 behind a flag)
    if (this._hasInsertableStreams()) {
      try {
        const { readable, writable } = (senderOrReceiver as any).createEncodedStreams();
        this.worker.postMessage({ operation, readable, writable }, [readable, writable]);
      } catch (e) {
        // Insertable Streams not available
      }
    }
  }

  // ─── Local Media ──────────────────────────────────────────────────────────
  async startLocalStream(video: boolean, preAcquiredStream?: MediaStream): Promise<boolean> {
    try {
      if (preAcquiredStream) {
        this.localStream = preAcquiredStream;
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires HTTPS or localhost');
        }
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      this.options.onLocalStream(this.localStream);
      return true;
    } catch (err: any) {
      this.options.onError(err?.message || 'Failed to access camera/microphone');
      return false;
    }
  }

  // ─── Add local tracks to PC ────────────────────────────────────────────────
  private _addLocalTracks() {
    if (!this.peerConnection || !this.localStream) return;
    this.localStream.getTracks().forEach((track) => {
      const sender = this.peerConnection!.addTrack(track, this.localStream!);
      this._applyTransform(sender, 'encrypt');
    });
  }

  // ─── Remote Description helper (flushes pending candidates after) ─────────
  private async _setRemoteDescription(sdp: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescSet = true;
    await this._flushPendingCandidates();
  }

  private async _flushPendingCandidates() {
    if (!this.peerConnection || this.pendingCandidates.length === 0) return;
    const toFlush = [...this.pendingCandidates];
    this.pendingCandidates = [];
    for (const c of toFlush) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        // Failed to add queued ICE candidate
      }
    }
  }

  // ─── ICE Restart ──────────────────────────────────────────────────────────
  private async _restartICE() {
    if (!this.peerConnection) return;
    if (this.peerConnection.signalingState !== 'stable') return;
    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      callSignaling.sendMessage({
        type: 'call_request',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: { iceRestart: true, sdp: offer },
      });
    } catch (e) {
      // ICE restart failed
    }
  }

  // ─── Connection Health Monitor ────────────────────────────────────────────
  private _startHealthMonitor() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(async () => {
      if (!this.peerConnection || this.peerConnection.connectionState !== 'connected') {
        this._stopHealthMonitor();
        return;
      }
      try {
        const stats = await this.peerConnection.getStats();
        let totalBytesReceived = 0;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            totalBytesReceived += report.bytesReceived ?? 0;
          }
        });
        if (totalBytesReceived === this.lastBytesReceived) {
          this.stalledSeconds += 2;
          if (this.stalledSeconds >= this.STALL_THRESHOLD_S) {
            this.stalledSeconds = 0;
            this._restartICE();
          }
        } else {
          this.stalledSeconds = 0;
        }
        this.lastBytesReceived = totalBytesReceived;
      } catch (_) {
        // Stats not available — ignore
      }
    }, 2000);
  }

  private _stopHealthMonitor() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.lastBytesReceived = 0;
    this.stalledSeconds = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Public Call Lifecycle Methods (WhatsApp 2-step SDP pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CALLER side (WhatsApp 2-step pattern):
   * 1. Acquire media
   * 2. Create SDP offer
   * 3. Send call_request with bundled { video, sdp, salt }
   *
   * @param encodedSalt - base64-encoded per-call HKDF salt generated by CallContext.
   *                      Sent to receiver so both sides derive the same session key.
   */
  async initiateCall(video: boolean, encodedSalt: string, stream?: MediaStream) {
    if (this.callState !== 'idle') {
      return;
    }

    const ok = await this.startLocalStream(video, stream);
    if (!ok) return;

    this.setCallState('calling');
    this._initWorker();
    await this._initPC();
    this._addLocalTracks();

    // Create offer BEFORE sending call_request (WhatsApp pattern — no extra round-trip)
    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);

    callSignaling.sendMessage({
      type: 'call_request',
      sender_id: this.myUserId,
      target_id: this.partnerId,
      payload: { video, sdp: offer, salt: encodedSalt },
    });
  }

  /**
   * RECEIVER side (called after user taps "Accept"):
   * 1. Acquire media
   * 2. Set remote description from the offer inside call_request
   * 3. Create answer
   * 4. Send call_accept with answer SDP bundled
   * The CALLER side handles the rest via handleAccept().
   */
  async acceptCall(video: boolean, offerSdp: RTCSessionDescriptionInit, stream?: MediaStream) {
    const ok = await this.startLocalStream(video, stream);
    if (!ok) {
      this.rejectCall();
      return;
    }

    this.setCallState('connecting');
    this._initWorker();
    await this._initPC();
    this._addLocalTracks();

    // Set the offer from caller (WhatsApp pattern: SDP is already here)
    await this._setRemoteDescription(offerSdp);

    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);

    callSignaling.sendMessage({
      type: 'call_accept',
      sender_id: this.myUserId,
      target_id: this.partnerId,
      payload: { sdp: answer },
    });
  }

  /**
   * CALLER side: receives the answer from the receiver.
   * This replaces the old separate sdp_offer / sdp_answer messages.
   */
  async handleAccept(answerSdp: RTCSessionDescriptionInit) {
    if (!this.peerConnection) return;
    if (this.peerConnection.signalingState !== 'have-local-offer') {
      return;
    }
    this.setCallState('connecting');
    await this._setRemoteDescription(answerSdp);
  }

  /**
   * Both sides: buffer or immediately add incoming ICE candidates.
   */
  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) {
      this.pendingCandidates.push(candidate);
      return;
    }
    if (!this.remoteDescSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      // Failed to add ICE candidate
    }
  }

  rejectCall() {
    callSignaling.sendMessage({
      type: 'call_reject',
      sender_id: this.myUserId,
      target_id: this.partnerId,
    });
    this.setCallState('idle');
  }

  // ─── Media Controls ───────────────────────────────────────────────────────
  toggleVideo(enabled: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }

  toggleAudio(enabled: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  // ─── End Call ─────────────────────────────────────────────────────────────
  endCall(notifyPartner = true) {
    this._stopHealthMonitor();

    if (notifyPartner) {
      callSignaling.sendMessage({
        type: 'call_end',
        sender_id: this.myUserId,
        target_id: this.partnerId,
      });
    }

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    this.peerConnection?.close();
    this.peerConnection = null;

    this.worker?.terminate();
    this.worker = null;

    this.remoteStream = null;
    this.pendingCandidates = [];
    this.remoteDescSet = false;

    this.setCallState('idle');
    this.options.onCallEnd();
  }
}
