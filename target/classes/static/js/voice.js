// Модуль голосовых звонков на WebRTC.
// Сигналинг (обмен offer/answer/ICE-кандидатами) идёт через WebSocket /ws/voice.

const Voice = {
  ws: null,
  pc: null,
  localStream: null,
  audioCtx: null,
  gainNode: null,
  remoteAudioEl: null,

  myUserId: null,
  peerId: null,
  peerName: null,

  isMuted: false,
  isDeafened: false,

  // громкость по каждому другу (0..2), сохраняется в localStorage
  volumes: JSON.parse(localStorage.getItem('friendVolumes') || '{}'),

  onCallStateChange: null, // колбэк для обновления UI, задаётся в app.js
  onIncomingCall: null,    // колбэк уведомления о входящем звонке

  connectSignaling(userId, token) {
    this.myUserId = userId;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/voice?token=${encodeURIComponent(token)}`);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleSignal(msg);
    };
    this.ws.onclose = () => {
      // попытка переподключения через 3 секунды
      setTimeout(() => {
        if (Api.token) this.connectSignaling(this.myUserId, Api.token);
      }, 3000);
    };
  },

  send(type, to, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, to, payload: payload || {} }));
    }
  },

  async handleSignal(msg) {
    const { type, from, payload } = msg;

    if (type === 'offer') {
      if (this.peerId && this.peerId !== from) {
        // уже в другом звонке — отклоняем
        this.send('end', from, {});
        return;
      }
      this.peerId = from;
      this.peerName = payload.callerName || ('#' + from);
      if (this.onIncomingCall) this.onIncomingCall(from, this.peerName, payload.sdp);
      return;
    }

    if (!this.pc) return;

    if (type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      if (this.onCallStateChange) this.onCallStateChange('connected');
    } else if (type === 'candidate') {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (e) { /* игнорируем гонки кандидатов */ }
    } else if (type === 'end') {
      this.endCall(false);
    }
  },

  createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.peerId) {
        this.send('candidate', this.peerId, { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      this.attachRemoteStream(event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.endCall(false);
      }
    };

    return pc;
  },

  attachRemoteStream(stream) {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.gainNode = this.audioCtx.createGain();
    const savedVolume = this.volumes[this.peerId] !== undefined ? this.volumes[this.peerId] : 1.0;
    this.gainNode.gain.value = this.isDeafened ? 0 : savedVolume;

    source.connect(this.gainNode);

    // MediaStreamDestination + audio-элемент, чтобы звук реально проигрывался
    const dest = this.audioCtx.createMediaStreamDestination();
    this.gainNode.connect(dest);

    if (this.remoteAudioEl) {
      this.remoteAudioEl.remove();
    }
    this.remoteAudioEl = document.createElement('audio');
    this.remoteAudioEl.autoplay = true;
    this.remoteAudioEl.srcObject = dest.stream;
    document.body.appendChild(this.remoteAudioEl);
  },

  setVolumeForPeer(peerId, value /* 0..2 */) {
    this.volumes[peerId] = value;
    localStorage.setItem('friendVolumes', JSON.stringify(this.volumes));
    if (this.peerId === peerId && this.gainNode && !this.isDeafened) {
      this.gainNode.gain.value = value;
    }
  },

  getVolumeForPeer(peerId) {
    return this.volumes[peerId] !== undefined ? this.volumes[peerId] : 1.0;
  },

  async startCall(peerId, peerName) {
    if (this.peerId) return; // уже в звонке
    this.peerId = peerId;
    this.peerName = peerName;

    if (this.onCallStateChange) this.onCallStateChange('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc = this.createPeerConnection();
    this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

    if (this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = false);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.send('offer', peerId, { sdp: offer, callerName: this.myNickname || '' });
  },

  async acceptIncomingCall(offerSdp) {
    if (this.onCallStateChange) this.onCallStateChange('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc = this.createPeerConnection();
    this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

    if (this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = false);

    await this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send('answer', this.peerId, { sdp: answer });

    if (this.onCallStateChange) this.onCallStateChange('connected');
  },

  declineIncomingCall() {
    if (this.peerId) this.send('end', this.peerId, {});
    this.peerId = null;
    this.peerName = null;
  },

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted && !this.isDeafened);
    }
    return this.isMuted;
  },

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    if (this.isDeafened) {
      if (this.gainNode) this.gainNode.gain.value = 0;
      if (this.localStream) this.localStream.getAudioTracks().forEach(t => t.enabled = false);
    } else {
      if (this.gainNode) this.gainNode.gain.value = this.getVolumeForPeer(this.peerId);
      if (this.localStream && !this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = true);
    }
    return this.isDeafened;
  },

  endCall(notifyPeer = true) {
    if (notifyPeer && this.peerId) {
      this.send('end', this.peerId, {});
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.remoteAudioEl) {
      this.remoteAudioEl.remove();
      this.remoteAudioEl = null;
    }
    this.gainNode = null;
    this.peerId = null;
    this.peerName = null;

    if (this.onCallStateChange) this.onCallStateChange('ended');
  }
};
