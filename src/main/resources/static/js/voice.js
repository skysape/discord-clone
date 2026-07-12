// Модуль голосовых звонков на WebRTC: и 1-на-1, и групповые (mesh: каждый с каждым).
// Сигналинг идёт через единый WebSocket /ws/voice, который также используется
// для мгновенных push-уведомлений (см. onAppEvent).

const Voice = {
  ws: null,
  myUserId: null,
  myNickname: null,

  // Тип текущего звонка: null | 'direct' | 'group'
  callType: null,
  // Для direct — userId собеседника; для group — groupId
  callId: null,
  // Отображаемое имя (имя друга или название группы)
  callName: null,

  // userId -> { pc: RTCPeerConnection, name, audioEl, gainNode }
  peers: new Map(),

  localStream: null,
  audioCtx: null,

  // Входящий 1-на-1 звонок, ожидающий ответа пользователя
  incomingOffer: null, // { fromId, fromName, sdp }

  isMuted: false,
  isDeafened: false,

  // громкость по каждому собеседнику (0..2), сохраняется в localStorage
  volumes: JSON.parse(localStorage.getItem('friendVolumes') || '{}'),

  // Колбэки, назначаются в app.js
  onCallStateChange: null,      // (state) state: 'connecting' | 'connecting-group' | 'connected' | 'ended'
  onIncomingCall: null,         // (fromId, fromName)
  onIncomingCallCancelled: null,
  onGroupPeersChange: null,     // () - когда состав участников групп-звонка меняется
  onAppEvent: null,             // (type, payload) - все прочие push-уведомления (друзья, сообщения...)

  connectSignaling(userId, token) {
    this.myUserId = userId;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws/voice?token=${encodeURIComponent(token)}`);

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const callSignalTypes = ['offer', 'answer', 'candidate', 'end'];
      const groupCallTypes = ['group_call_joined', 'group_call_peer_joined', 'group_call_peer_left'];

      if (callSignalTypes.includes(msg.type)) {
        this.handleSignal(msg);
      } else if (groupCallTypes.includes(msg.type)) {
        this.handleGroupCallEvent(msg.type, msg.payload);
      } else if (this.onAppEvent) {
        this.onAppEvent(msg.type, msg.payload);
      }
    };

    this.ws.onclose = () => {
      setTimeout(() => {
        if (Api.token) this.connectSignaling(this.myUserId, Api.token);
      }, 3000);
    };
  },

  sendRaw(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  },

  sendSignal(type, to, groupId, payload) {
    this.sendRaw({ type, to, groupId: groupId || null, payload: payload || {} });
  },

  // ---------- Обработка сигналов WebRTC ----------

  async handleSignal(msg) {
    const { type, from, groupId, payload } = msg;

    if (type === 'offer') {
      if (groupId) {
        // Оффер от участника групп-звонка (mesh) — принимаем только если мы реально в этом звонке
        if (this.callType === 'group' && this.callId === groupId) {
          await this.acceptGroupPeerOffer(from, payload.sdp);
        }
        return;
      }
      // Входящий 1-на-1 звонок
      if (this.callType) {
        // мы уже заняты другим звонком — отклоняем автоматически
        this.sendSignal('end', from, null, {});
        return;
      }
      this.incomingOffer = { fromId: from, fromName: payload.callerName || ('#' + from), sdp: payload.sdp };
      if (this.onIncomingCall) this.onIncomingCall(from, this.incomingOffer.fromName);
      return;
    }

    if (type === 'answer') {
      const entry = this.peers.get(from);
      if (entry) {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        if (this.callType === 'direct' && this.onCallStateChange) this.onCallStateChange('connected');
      }
      return;
    }

    if (type === 'candidate') {
      const entry = this.peers.get(from);
      if (entry) {
        try { await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) { /* игнор гонок */ }
      }
      return;
    }

    if (type === 'end') {
      if (this.callType === 'direct' && this.callId === from) {
        this.endCall(false);
      } else if (this.incomingOffer && this.incomingOffer.fromId === from) {
        this.incomingOffer = null;
        if (this.onIncomingCallCancelled) this.onIncomingCallCancelled();
      }
      return;
    }
  },

  handleGroupCallEvent(type, payload) {
    if (type === 'group_call_joined') {
      if (this.callType === 'group' && this.callId === payload.groupId) {
        if (this.onCallStateChange) this.onCallStateChange('connected');
      }
    } else if (type === 'group_call_peer_joined') {
      if (this.callType === 'group' && this.callId === payload.groupId) {
        this.createGroupOfferTo(payload.userId);
      }
    } else if (type === 'group_call_peer_left') {
      if (this.callType === 'group' && this.callId === payload.groupId) {
        this.removePeer(payload.userId);
        if (this.onGroupPeersChange) this.onGroupPeersChange();
      }
    }
  },

  // ---------- Peer connection helpers ----------

  createPeerConnectionFor(peerId) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const gid = this.callType === 'group' ? this.callId : null;
        this.sendSignal('candidate', peerId, gid, { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => this.attachRemoteStream(peerId, event.streams[0]);

    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        if (this.callType === 'direct' && this.callId === peerId) {
          this.endCall(false);
        } else if (this.callType === 'group') {
          this.removePeer(peerId);
          if (this.onGroupPeersChange) this.onGroupPeersChange();
        }
      }
    };

    return pc;
  },

  attachRemoteStream(peerId, stream) {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(stream);
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.value = this.isDeafened ? 0 : this.getVolumeForPeer(peerId);
    source.connect(gainNode);

    const dest = this.audioCtx.createMediaStreamDestination();
    gainNode.connect(dest);

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = dest.stream;
    document.body.appendChild(audioEl);

    const entry = this.peers.get(peerId);
    if (entry) {
      entry.gainNode = gainNode;
      entry.audioEl = audioEl;
    }
    if (this.onGroupPeersChange) this.onGroupPeersChange();
  },

  removePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (entry) {
      entry.pc.close();
      if (entry.audioEl) entry.audioEl.remove();
      this.peers.delete(peerId);
    }
  },

  // ---------- 1-на-1 звонок ----------

  async startCall(peerId, peerName) {
    if (this.callType) return;
    this.callType = 'direct';
    this.callId = peerId;
    this.callName = peerName;
    this.peers = new Map();

    if (this.onCallStateChange) this.onCallStateChange('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = false);

    const pc = this.createPeerConnectionFor(peerId);
    this.peers.set(peerId, { pc, name: peerName });
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal('offer', peerId, null, { sdp: offer, callerName: this.myNickname || '' });
  },

  async acceptIncomingCall() {
    if (!this.incomingOffer) return;
    const { fromId, fromName, sdp } = this.incomingOffer;

    this.callType = 'direct';
    this.callId = fromId;
    this.callName = fromName;
    this.peers = new Map();

    if (this.onCallStateChange) this.onCallStateChange('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = false);

    const pc = this.createPeerConnectionFor(fromId);
    this.peers.set(fromId, { pc, name: fromName });
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignal('answer', fromId, null, { sdp: answer });

    this.incomingOffer = null;
    if (this.onCallStateChange) this.onCallStateChange('connected');
  },

  declineIncomingCall() {
    if (!this.incomingOffer) return;
    this.sendSignal('end', this.incomingOffer.fromId, null, {});
    this.incomingOffer = null;
  },

  // ---------- Групповой звонок ----------

  async joinGroupCall(groupId, groupName) {
    if (this.callType) return;
    this.callType = 'group';
    this.callId = groupId;
    this.callName = groupName;
    this.peers = new Map();

    if (this.onCallStateChange) this.onCallStateChange('connecting-group');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.isMuted) this.localStream.getAudioTracks().forEach(t => t.enabled = false);

    this.sendRaw({ type: 'join_group_call', groupId });
  },

  async createGroupOfferTo(userId) {
    const pc = this.createPeerConnectionFor(userId);
    this.peers.set(userId, { pc, name: null });
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal('offer', userId, this.callId, { sdp: offer });
    if (this.onGroupPeersChange) this.onGroupPeersChange();
  },

  async acceptGroupPeerOffer(fromId, sdp) {
    let entry = this.peers.get(fromId);
    if (!entry) {
      const pc = this.createPeerConnectionFor(fromId);
      entry = { pc, name: null };
      this.peers.set(fromId, entry);
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription(answer);
    this.sendSignal('answer', fromId, this.callId, { sdp: answer });
    if (this.onGroupPeersChange) this.onGroupPeersChange();
  },

  // ---------- Общее: громкость / mute / deafen / завершение ----------

  setVolumeForPeer(peerId, value /* 0..2 */) {
    this.volumes[peerId] = value;
    localStorage.setItem('friendVolumes', JSON.stringify(this.volumes));
    const entry = this.peers.get(peerId);
    if (entry && entry.gainNode && !this.isDeafened) {
      entry.gainNode.gain.value = value;
    }
  },

  getVolumeForPeer(peerId) {
    return this.volumes[peerId] !== undefined ? this.volumes[peerId] : 1.0;
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
    for (const [peerId, entry] of this.peers) {
      if (entry.gainNode) entry.gainNode.gain.value = this.isDeafened ? 0 : this.getVolumeForPeer(peerId);
    }
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isDeafened && !this.isMuted);
    }
    return this.isDeafened;
  },

  endCall(notifyPeer = true) {
    if (notifyPeer) {
      if (this.callType === 'direct' && this.callId) {
        this.sendSignal('end', this.callId, null, {});
      } else if (this.callType === 'group' && this.callId) {
        this.sendRaw({ type: 'leave_group_call', groupId: this.callId });
      }
    }
    for (const [, entry] of this.peers) {
      entry.pc.close();
      if (entry.audioEl) entry.audioEl.remove();
    }
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    this.callType = null;
    this.callId = null;
    this.callName = null;

    if (this.onCallStateChange) this.onCallStateChange('ended');
  }
};
