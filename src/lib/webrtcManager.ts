import { callSignaling } from './callSignaling';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

interface WebRTCManagerOptions {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onCallStateChange: (state: CallState) => void;
  onCallEnd: () => void;
  onError: (error: string) => void;
}

/**
 * WebRTC Manager — WhatsApp-inspired architecture (Phase 1)
 *
 * KEY CHANGE: 2-step signaling (merged SDP) instead of 4-step.
 *   OLD: call_request → call_accept → sdp_offer → sdp_answer
 *   NEW: call_request{offer} → call_accept{answer}
 *
 * This eliminates the duplicate call_accept race condition and ensures
 * the receiver always has the offer before sending the accept.
 *
 * ICE candidates are queued until remote description is set, then flushed.
 */
export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private myUserId: string;
  private partnerId: string;
  private sessionKey: Uint8Array | null = null;
  private worker: Worker | null = null;
  private options: WebRTCManagerOptions;
  private callState: CallState = 'idle';

  // ICE candidate queue — holds candidates received before remote description is set
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private isRemoteDescriptionSet = false;

  // Health monitoring
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastBytesReceived = 0;
  private stalledSeconds = 0;

  constructor(myUserId: string, partnerId: string, options: WebRTCManagerOptions) {
    this.myUserId = myUserId;
    this.partnerId = partnerId;
    this.options = options;
  }

  setSessionKey(key: Uint8Array) {
    this.sessionKey = key;
    // Temporary log to satisfy TS until Phase 2 E2EE is implemented
    console.debug('[WEBRTC Manager] Session key set, length:', this.sessionKey?.byteLength);
  }

  private setCallState(state: CallState) {
    this.callState = state;
    this.options.onCallStateChange(state);
  }

  private async initializePeerConnection() {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Free public TURN servers — replace with paid for production
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
      iceCandidatePoolSize: 10,
      // Prefer UDP for lower latency; TCP as fallback
      iceTransportPolicy: 'all',
    };

    this.peerConnection = new RTCPeerConnection(config);

    // Trickle ICE: send candidates as they arrive
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WEBRTC Manager] Generated ICE candidate (${event.candidate.type}), sending to partner`);
        callSignaling.sendMessage({
          type: 'ice_candidate',
          sender_id: this.myUserId,
          target_id: this.partnerId,
          payload: event.candidate.toJSON(),
        });
      } else {
        console.log(`[WEBRTC Manager] ICE gathering complete`);
      }
    };

    // Notify about ICE gathering state
    this.peerConnection.onicegatheringstatechange = () => {
      console.log(`[WEBRTC Manager] ICE gathering state: ${this.peerConnection?.iceGatheringState}`);
    };

    // Monitor ICE connection state separately from overall connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log(`[WEBRTC Manager] ICE connection state: ${state}`);
      if (state === 'disconnected') {
        // Give it 4 seconds to recover before attempting ICE restart
        console.warn('[WEBRTC Manager] ICE disconnected — will restart if not recovered in 4s');
        setTimeout(() => {
          if (this.peerConnection?.iceConnectionState === 'disconnected') {
            console.warn('[WEBRTC Manager] ICE still disconnected — triggering ICE restart');
            this.triggerIceRestart();
          }
        }, 4000);
      } else if (state === 'failed') {
        console.error('[WEBRTC Manager] ICE failed — triggering ICE restart');
        this.triggerIceRestart();
      }
    };

    // When remote tracks arrive, add them to the remote stream and notify
    this.peerConnection.ontrack = (event) => {
      console.log(`[WEBRTC Manager] Received remote track: ${event.track.kind} (readyState: ${event.track.readyState})`);
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        this.options.onRemoteStream(this.remoteStream);
      }
      this.remoteStream.addTrack(event.track);

      // Notify again after adding each track so the UI can re-render
      // This ensures both audio and video tracks trigger a re-render
      this.options.onRemoteStream(this.remoteStream);

      event.track.onunmute = () => {
        console.log(`[WEBRTC Manager] Track unmuted: ${event.track.kind}`);
        if (this.remoteStream) this.options.onRemoteStream(this.remoteStream);
      };
    };

    // Monitor overall connection state for lifecycle management
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log(`[WEBRTC Manager] Connection state: ${state}`);
      switch (state) {
        case 'connected':
          this.setCallState('connected');
          this.startHealthMonitoring();
          break;
        case 'disconnected':
          // Handled by ICE state change above
          break;
        case 'failed':
          console.error('[WEBRTC Manager] Connection failed — ending call');
          this.options.onError('Connection failed. Please try calling again.');
          this.endCall(false);
          break;
        case 'closed':
          // endCall already handles cleanup
          break;
      }
    };
  }

  /**
   * Flush ICE candidates that arrived before remote description was set.
   * This is critical — without this, early candidates are silently dropped.
   */
  private async flushPendingIceCandidates() {
    if (!this.peerConnection || this.pendingIceCandidates.length === 0) return;
    console.log(`[WEBRTC Manager] Flushing ${this.pendingIceCandidates.length} queued ICE candidates`);
    for (const candidate of this.pendingIceCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('[WEBRTC Manager] Failed to add queued ICE candidate', e);
      }
    }
    this.pendingIceCandidates = [];
  }

  /**
   * After remote description is set: mark it, then flush the ICE queue.
   */
  private async afterSetRemoteDescription() {
    this.isRemoteDescriptionSet = true;
    await this.flushPendingIceCandidates();
  }

  /**
   * Attempt an ICE restart — re-negotiates network paths without hanging up.
   * Only the offerer (caller) can initiate an ICE restart.
   */
  private async triggerIceRestart() {
    if (!this.peerConnection || this.callState !== 'connected') return;
    try {
      console.log('[WEBRTC Manager] Creating ICE restart offer...');
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
      callSignaling.sendMessage({
        type: 'sdp_offer',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: offer,
      });
    } catch (e) {
      console.error('[WEBRTC Manager] ICE restart failed', e);
    }
  }

  /**
   * Poll WebRTC stats every 3 seconds to detect stalled media.
   * If no bytes are received for 9 seconds (3 polls), log a warning.
   */
  private startHealthMonitoring() {
    this.stopHealthMonitoring();
    console.log('[WEBRTC Manager] Starting health monitoring');
    this.statsIntervalId = setInterval(async () => {
      if (!this.peerConnection) { this.stopHealthMonitoring(); return; }
      try {
        const stats = await this.peerConnection.getStats();
        let totalBytesReceived = 0;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            totalBytesReceived += report.bytesReceived || 0;
          }
        });
        if (totalBytesReceived === this.lastBytesReceived && totalBytesReceived > 0) {
          this.stalledSeconds += 3;
          console.warn(`[WEBRTC Manager] No new bytes received for ${this.stalledSeconds}s`);
          if (this.stalledSeconds >= 9) {
            console.error('[WEBRTC Manager] Media stalled for 9s — connection may be broken');
            this.stalledSeconds = 0;
          }
        } else {
          this.stalledSeconds = 0;
        }
        this.lastBytesReceived = totalBytesReceived;
      } catch (e) {
        // Stats not available, ignore
      }
    }, 3000);
  }

  private stopHealthMonitoring() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
    this.lastBytesReceived = 0;
    this.stalledSeconds = 0;
  }

  /**
   * Add all local tracks to the peer connection.
   */
  private addLocalTracks() {
    this.localStream?.getTracks().forEach(track => {
      if (this.peerConnection && this.localStream) {
        this.peerConnection.addTrack(track, this.localStream);
      }
    });
  }

  async startLocalStream(video: boolean = true, preAcquiredStream?: MediaStream) {
    try {
      if (preAcquiredStream) {
        this.localStream = preAcquiredStream;
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
      this.options.onError(err?.message || 'Failed to access camera or microphone');
      console.error(err);
      return false;
    }
  }

  /**
   * CALLER: initiateCall
   *
   * WhatsApp-style: create offer BEFORE sending call_request.
   * The offer SDP is bundled inside the call_request payload.
   * This is step 1 of the 2-step handshake.
   */
  async initiateCall(video: boolean, stream?: MediaStream) {
    console.log(`[WEBRTC Manager] initiateCall(video=${video})`);
    if (this.callState !== 'idle') {
      console.warn(`[WEBRTC Manager] initiateCall called but state is not idle: ${this.callState}`);
      return;
    }

    const success = await this.startLocalStream(video, stream);
    if (!success) return;

    this.setCallState('calling');
    await this.initializePeerConnection();
    this.addLocalTracks();

    try {
      // Create offer eagerly — bundle it with the call request (WhatsApp pattern)
      console.log(`[WEBRTC Manager] Creating offer to bundle with call_request...`);
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      console.log(`[WEBRTC Manager] Sending call_request with embedded offer...`);
      callSignaling.sendMessage({
        type: 'call_request',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: { video, offer },
      });
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to create offer for call_request', e);
      this.options.onError('Failed to initiate call');
    }
  }

  /**
   * RECEIVER: acceptCall
   *
   * WhatsApp-style: set the offer from call_request, create answer,
   * and send it back in call_accept. This is step 2 of the 2-step handshake.
   *
   * @param offerSdp - The SDP offer received inside the call_request payload
   */
  async acceptCall(video: boolean, offerSdp: RTCSessionDescriptionInit, stream?: MediaStream) {
    console.log(`[WEBRTC Manager] acceptCall(video=${video})`);
    const success = await this.startLocalStream(video, stream);
    if (!success) {
      console.error(`[WEBRTC Manager] Failed to start local stream, rejecting call`);
      this.rejectCall();
      return;
    }

    this.setCallState('connecting');
    await this.initializePeerConnection();
    this.addLocalTracks();

    try {
      // Set the caller's offer as remote description
      console.log(`[WEBRTC Manager] Setting remote description from call_request offer...`);
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offerSdp));
      await this.afterSetRemoteDescription();

      // Create and set the answer
      console.log(`[WEBRTC Manager] Creating answer...`);
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      // Send call_accept with the answer SDP embedded (step 2 of 2-step handshake)
      console.log(`[WEBRTC Manager] Sending call_accept with embedded answer...`);
      callSignaling.sendMessage({
        type: 'call_accept',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: { answer },
      });
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to create answer', e);
      this.options.onError('Failed to accept call');
    }
  }

  rejectCall() {
    console.log(`[WEBRTC Manager] rejectCall()`);
    callSignaling.sendMessage({
      type: 'call_reject',
      sender_id: this.myUserId,
      target_id: this.partnerId,
    });
    this.setCallState('idle');
  }

  /**
   * CALLER: handleAccept
   *
   * Receives the call_accept message which now contains the answer SDP.
   * Sets it as the remote description — completing the handshake.
   */
  async handleAccept(answerSdp: RTCSessionDescriptionInit) {
    console.log(`[WEBRTC Manager] handleAccept() — setting remote answer`);
    if (!this.peerConnection) {
      console.warn('[WEBRTC Manager] handleAccept called but peerConnection is null');
      return;
    }
    if (this.peerConnection.signalingState !== 'have-local-offer') {
      console.warn(`[WEBRTC Manager] Ignoring handleAccept — signalingState is ${this.peerConnection.signalingState} (expected have-local-offer)`);
      return;
    }
    try {
      this.setCallState('connecting');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
      await this.afterSetRemoteDescription();
      console.log(`[WEBRTC Manager] Remote answer set — ICE negotiation underway`);
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to set remote answer', e);
      this.options.onError('Failed to establish connection');
    }
  }

  /**
   * Handles an incoming SDP offer — used for ICE restart re-negotiation only.
   * The initial offer is now handled inside acceptCall().
   */
  async handleOffer(offer: RTCSessionDescriptionInit) {
    console.log(`[WEBRTC Manager] handleOffer() — ICE restart re-negotiation`);
    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      await this.afterSetRemoteDescription();
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      callSignaling.sendMessage({
        type: 'sdp_answer',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: answer,
      });
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to handle offer (re-negotiation)', e);
    }
  }

  /**
   * Handles an incoming SDP answer — used for ICE restart re-negotiation only.
   */
  async handleAnswer(answer: RTCSessionDescriptionInit) {
    console.log(`[WEBRTC Manager] handleAnswer() — ICE restart re-negotiation`);
    if (!this.peerConnection) return;
    if (this.peerConnection.signalingState !== 'have-local-offer') {
      console.warn(`[WEBRTC Manager] Ignoring handleAnswer — signalingState is ${this.peerConnection.signalingState}`);
      return;
    }
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      await this.afterSetRemoteDescription();
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to handle answer (re-negotiation)', e);
    }
  }

  /**
   * ICE candidate handler with queuing.
   *
   * If remote description is not yet set, queue the candidate.
   * After setRemoteDescription, the queue is flushed automatically.
   * This prevents the silent drop of early candidates — a primary cause of blank screen.
   */
  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.peerConnection) {
      console.warn('[WEBRTC Manager] handleIceCandidate: peerConnection is null, queuing');
      this.pendingIceCandidates.push(candidate);
      return;
    }
    if (!this.isRemoteDescriptionSet) {
      console.log(`[WEBRTC Manager] Remote description not set yet — queuing ICE candidate (queue size: ${this.pendingIceCandidates.length + 1})`);
      this.pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to add ICE candidate', e);
    }
  }

  toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  toggleAudio(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  endCall(notifyPartner: boolean = true) {
    console.log(`[WEBRTC Manager] endCall(notifyPartner=${notifyPartner})`);
    this.stopHealthMonitoring();

    if (notifyPartner) {
      callSignaling.sendMessage({
        type: 'call_end',
        sender_id: this.myUserId,
        target_id: this.partnerId,
      });
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.remoteStream = null;
    this.pendingIceCandidates = [];
    this.isRemoteDescriptionSet = false;
    this.setCallState('idle');
    this.options.onCallEnd();
  }
}
