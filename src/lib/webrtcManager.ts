import { callSignaling } from './callSignaling';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended';

interface WebRTCManagerOptions {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onCallStateChange: (state: CallState) => void;
  onCallEnd: () => void;
  onError: (error: string) => void;
}

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

  constructor(myUserId: string, partnerId: string, options: WebRTCManagerOptions) {
    this.myUserId = myUserId;
    this.partnerId = partnerId;
    this.options = options;
  }

  setSessionKey(key: Uint8Array) {
    this.sessionKey = key;
  }

  private setCallState(state: CallState) {
    this.callState = state;
    this.options.onCallStateChange(state);
  }

  private async initializePeerConnection() {
    // STUN only, no TURN server per user request
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    this.peerConnection = new RTCPeerConnection(config);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WEBRTC Manager] Generated ICE candidate, sending to partner`);
        callSignaling.sendMessage({
          type: 'ice_candidate',
          sender_id: this.myUserId,
          target_id: this.partnerId,
          payload: event.candidate,
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      console.log(`[WEBRTC Manager] Received remote track: ${event.track.kind}`);
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        this.options.onRemoteStream(this.remoteStream);
      }
      this.remoteStream.addTrack(event.track);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log(`[WEBRTC Manager] Connection state changed to: ${this.peerConnection?.connectionState}`);
      switch (this.peerConnection?.connectionState) {
        case 'connected':
          this.setCallState('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.endCall(false);
          break;
      }
    };

    // Setup Encoded Transforms if supported and sessionKey is present
    if (this.sessionKey && 'RTCRtpScriptTransform' in window) {
      try {
        this.worker = new Worker(new URL('../workers/callEncryptionWorker.ts', import.meta.url), { type: 'module' });
        this.worker.postMessage({ operation: 'setKey', keyData: this.sessionKey });
      } catch (e) {
        console.warn('Could not initialize encryption worker', e);
      }
    }
  }

  private applyTransform(senderOrReceiver: RTCRtpSender | RTCRtpReceiver, operation: 'encrypt' | 'decrypt') {
    if (!this.worker || !('RTCRtpScriptTransform' in window)) return;
    
    try {
      const transform = new (window as any).RTCRtpScriptTransform(this.worker, { operation });
      if ('transform' in senderOrReceiver) {
        (senderOrReceiver as any).transform = transform;
      }
    } catch (e) {
      console.warn('Failed to apply RTCRtpScriptTransform:', e);
    }
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
          video: video ? { facingMode: 'user' } : false,
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

    // Add tracks and apply encryption
    this.localStream?.getTracks().forEach(track => {
      if (this.peerConnection && this.localStream) {
        const sender = this.peerConnection.addTrack(track, this.localStream);
        this.applyTransform(sender, 'encrypt');
      }
    });

    // We must also apply decryption to incoming receivers once established
    // We can hook this into the 'track' event later, but wait, RTCPeerConnection receiver
    // can be accessed when transceivers are created.

    console.log(`[WEBRTC Manager] Sending call_request...`);
    callSignaling.sendMessage({
      type: 'call_request',
      sender_id: this.myUserId,
      target_id: this.partnerId,
      payload: { video },
    });
  }

  async acceptCall(video: boolean, stream?: MediaStream) {
    console.log(`[WEBRTC Manager] acceptCall(video=${video})`);
    const success = await this.startLocalStream(video, stream);
    if (!success) {
      console.error(`[WEBRTC Manager] Failed to start local stream, rejecting call`);
      this.rejectCall();
      return;
    }

    this.setCallState('connecting');
    await this.initializePeerConnection();

    this.localStream?.getTracks().forEach(track => {
      if (this.peerConnection && this.localStream) {
        const sender = this.peerConnection.addTrack(track, this.localStream);
        this.applyTransform(sender, 'encrypt');
      }
    });

    console.log(`[WEBRTC Manager] Sending call_accept...`);
    callSignaling.sendMessage({
      type: 'call_accept',
      sender_id: this.myUserId,
      target_id: this.partnerId,
    });
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

  async handleAccept() {
    console.log(`[WEBRTC Manager] handleAccept()`);
    this.setCallState('connecting');
    
    if (!this.peerConnection) return;
    
    try {
      console.log(`[WEBRTC Manager] Creating offer...`);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      console.log(`[WEBRTC Manager] Sending sdp_offer...`);
      callSignaling.sendMessage({
        type: 'sdp_offer',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: offer,
      });

      // Apply decrypt transform to receivers
      this.peerConnection.getReceivers().forEach(receiver => {
        this.applyTransform(receiver, 'decrypt');
      });
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to create offer', e);
      this.options.onError('Failed to establish connection');
    }
  }

  async handleOffer(offer: RTCSessionDescriptionInit) {
    console.log(`[WEBRTC Manager] handleOffer() received`);
    if (!this.peerConnection) return;
    
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`[WEBRTC Manager] Creating answer...`);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      // Apply decrypt transform to receivers
      this.peerConnection.getReceivers().forEach(receiver => {
        this.applyTransform(receiver, 'decrypt');
      });
      
      console.log(`[WEBRTC Manager] Sending sdp_answer...`);
      callSignaling.sendMessage({
        type: 'sdp_answer',
        sender_id: this.myUserId,
        target_id: this.partnerId,
        payload: answer,
      });
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to handle offer', e);
    }
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    console.log(`[WEBRTC Manager] handleAnswer() received`);
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) {
      console.error('[WEBRTC Manager] Failed to handle answer', e);
    }
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    console.log(`[WEBRTC Manager] handleIceCandidate() received`);
    if (!this.peerConnection) return;
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
    if (notifyPartner) {
      console.log(`[WEBRTC Manager] Sending call_end...`);
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
    this.setCallState('idle');
    this.options.onCallEnd();
  }
}
