// Основная логика приложения: авторизация, друзья, группы, профиль, звонки, чат

let authMode = 'login';
let myProfile = null;
let currentGroupId = null;
let currentGroupName = null;
let chatState = null; // { type: 'direct'|'group', id, name }

// userId -> { nickname, avatarUrl } — чтобы подписывать аватарки в звонках/чатах
const peopleCache = {};

const $ = (id) => document.getElementById(id);

function cachePerson(p) {
  peopleCache[p.id] = { nickname: p.nickname || p.username, avatarUrl: p.avatarUrl || '' };
}

function defaultAvatar(name) {
  const letter = (name || '?').charAt(0).toUpperCase();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#5865f2"/><text x="50%" y="50%" fill="white" font-size="28" text-anchor="middle" dy=".35em" font-family="sans-serif">${letter}</text></svg>`
  );
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- AUTH ----------

$('authSwitchLink').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  updateAuthScreenText();
});

function updateAuthScreenText() {
  if (authMode === 'login') {
    $('authTitle').textContent = I18N.t('login_title');
    $('authSubmitBtn').textContent = I18N.t('login_button');
    $('authSwitchLink').textContent = I18N.t('no_account');
  } else {
    $('authTitle').textContent = I18N.t('register_title');
    $('authSubmitBtn').textContent = I18N.t('register_button');
    $('authSwitchLink').textContent = I18N.t('have_account');
  }
}

$('authSubmitBtn').addEventListener('click', async () => {
  const username = $('authUsername').value.trim();
  const password = $('authPassword').value;
  $('authError').textContent = '';
  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const data = await Api.post(endpoint, { username, password });
    Api.setToken(data.token);
    await onLoggedIn();
  } catch (e) {
    $('authError').textContent = e.message;
  }
});

$('logoutBtn').addEventListener('click', () => {
  Voice.endCall(true);
  Api.setToken(null);
  location.reload();
});

async function onLoggedIn() {
  myProfile = await Api.get('/api/profile/me');
  await I18N.load(myProfile.language || 'ru');
  updateAuthScreenText();

  $('authScreen').classList.add('hidden');
  $('mainLayout').classList.remove('hidden');

  cachePerson(myProfile);
  renderMyProfileHeader();
  fillProfileTab();

  Voice.myNickname = myProfile.nickname;
  Voice.connectSignaling(myProfile.id, Api.token);
  Voice.onCallStateChange = onCallStateChange;
  Voice.onIncomingCall = onIncomingCall;
  Voice.onIncomingCallCancelled = onIncomingCallCancelled;
  Voice.onGroupPeersChange = renderCallAvatars;
  Voice.onAppEvent = onAppEvent;

  await loadFriends();
  await loadRequests();
  await loadGroups();
}

function renderMyProfileHeader() {
  $('myNameSmall').textContent = myProfile.nickname || myProfile.username;
  $('myAvatarSmall').src = myProfile.avatarUrl || defaultAvatar(myProfile.nickname || myProfile.username);
}

// ---------- РЕАЛТАЙМ-СОБЫТИЯ (заявки в друзья, сообщения и т.д.) ----------

function onAppEvent(type, payload) {
  if (type === 'friend_request') {
    loadRequests();
  } else if (type === 'friend_accepted') {
    if (payload && payload.friend) cachePerson(payload.friend);
    loadFriends();
  } else if (type === 'added_to_group') {
    loadGroups();
  } else if (type === 'new_direct_message') {
    if (chatState && chatState.type === 'direct' && chatState.id === payload.senderId) {
      appendChatMessage(payload);
    }
  } else if (type === 'new_group_message') {
    if (chatState && chatState.type === 'group' && chatState.id === payload.groupId) {
      appendChatMessage(payload);
    }
  }
}

// ---------- TABS ----------

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    $('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.remove('hidden');
  });
});

// ---------- FRIENDS ----------

$('addFriendBtn').addEventListener('click', async () => {
  const username = $('addFriendInput').value.trim();
  if (!username) return;
  try {
    await Api.post(`/api/friends/request/${encodeURIComponent(username)}`);
    $('addFriendInput').value = '';
  } catch (e) {
    alert(e.message);
  }
});

async function loadFriends() {
  const friends = await Api.get('/api/friends');
  friends.forEach(cachePerson);

  const container = $('friendsList');
  container.innerHTML = '';
  if (friends.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted)">${I18N.t('no_friends')}</div>`;
    return;
  }
  friends.forEach(f => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.dataset.userId = f.id;
    row.innerHTML = `
      <img class="avatar-small" src="${f.avatarUrl || defaultAvatar(f.nickname)}">
      <div class="name">${escapeHtml(f.nickname)}${f.online ? '<span class="online-dot" title="' + I18N.t('online') + '"></span>' : ''}</div>
      <button class="btn-call" data-action="chat">💬</button>
      <button class="btn-call" data-action="call">${I18N.t('call')}</button>
      <button class="btn-remove" data-action="remove">${I18N.t('remove_friend')}</button>
    `;
    row.querySelector('[data-action="call"]').addEventListener('click', () => {
      Voice.startCall(f.id, f.nickname);
    });
    row.querySelector('[data-action="chat"]').addEventListener('click', () => {
      openChat('direct', f.id, f.nickname);
    });
    row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
      await Api.del(`/api/friends/${f.id}`);
      await loadFriends();
    });

    // ПКМ во время звонка с этим другом — регулировка громкости
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openVolumeMenu(e.pageX, e.pageY, f.id, f.nickname);
    });

    container.appendChild(row);
  });
}

async function loadRequests() {
  const requests = await Api.get('/api/friends/requests');
  const container = $('requestsList');
  container.innerHTML = '';
  if (requests.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted)">${I18N.t('no_requests')}</div>`;
    return;
  }
  requests.forEach(r => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `
      <img class="avatar-small" src="${r.avatarUrl || defaultAvatar(r.nickname)}">
      <div class="name">${escapeHtml(r.nickname)}</div>
      <button class="btn-accept" data-action="accept">${I18N.t('accept')}</button>
      <button class="btn-decline" data-action="decline">${I18N.t('decline')}</button>
    `;
    row.querySelector('[data-action="accept"]').addEventListener('click', async () => {
      await Api.post(`/api/friends/accept/${r.requestId}`);
      await loadRequests();
      await loadFriends();
    });
    row.querySelector('[data-action="decline"]').addEventListener('click', async () => {
      await Api.post(`/api/friends/decline/${r.requestId}`);
      await loadRequests();
    });
    container.appendChild(row);
  });
}

// ---------- GROUPS ----------

$('createGroupBtn').addEventListener('click', async () => {
  const name = $('createGroupInput').value.trim();
  if (!name) return;
  try {
    await Api.post('/api/groups', { name });
    $('createGroupInput').value = '';
    await loadGroups();
  } catch (e) {
    alert(e.message);
  }
});

async function loadGroups() {
  const groups = await Api.get('/api/groups');
  const container = $('groupsList');
  container.innerHTML = '';
  groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.style.cursor = 'pointer';
    row.innerHTML = `<div class="name">👥 ${escapeHtml(g.name)}</div>`;
    row.addEventListener('click', () => openGroup(g.id, g.name));
    container.appendChild(row);
  });
}

async function openGroup(groupId, name) {
  currentGroupId = groupId;
  currentGroupName = name;
  $('groupDetail').classList.remove('hidden');
  $('groupDetailName').textContent = name;

  const members = await Api.get(`/api/groups/${groupId}/members`);
  members.forEach(cachePerson);

  const container = $('groupMembersList');
  container.innerHTML = '';
  members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `
      <img class="avatar-small" src="${m.avatarUrl || defaultAvatar(m.nickname)}">
      <div class="name">${escapeHtml(m.nickname)}${m.online ? '<span class="online-dot" title="' + I18N.t('online') + '"></span>' : ''}</div>
    `;
    container.appendChild(row);
  });
}

$('groupCallBtn').addEventListener('click', () => {
  if (!currentGroupId) return;
  Voice.joinGroupCall(currentGroupId, currentGroupName);
});

$('groupChatBtn').addEventListener('click', () => {
  if (!currentGroupId) return;
  openChat('group', currentGroupId, currentGroupName);
});

// ---------- ДОБАВЛЕНИЕ УЧАСТНИКОВ В ГРУППУ (список друзей) ----------

$('openAddMembersBtn').addEventListener('click', async () => {
  if (!currentGroupId) return;
  const friends = await Api.get(`/api/groups/${currentGroupId}/addable-friends`);
  const container = $('addMembersList');
  container.innerHTML = '';
  if (friends.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted)">${I18N.t('no_addable_friends')}</div>`;
  } else {
    friends.forEach(f => {
      const row = document.createElement('label');
      row.className = 'pickable-row';
      row.innerHTML = `
        <img src="${f.avatarUrl || defaultAvatar(f.nickname)}">
        <span>${escapeHtml(f.nickname)}</span>
        <input type="checkbox" value="${escapeHtml(f.username)}">
      `;
      container.appendChild(row);
    });
  }
  $('addMembersModal').classList.remove('hidden');
});

$('addMembersCloseBtn').addEventListener('click', () => {
  $('addMembersModal').classList.add('hidden');
});

$('addMembersConfirmBtn').addEventListener('click', async () => {
  if (!currentGroupId) return;
  const checked = Array.from(document.querySelectorAll('#addMembersList input[type=checkbox]:checked'))
    .map(cb => cb.value);
  for (const username of checked) {
    try {
      await Api.post(`/api/groups/${currentGroupId}/members/${encodeURIComponent(username)}`);
    } catch (e) { /* пропускаем ошибки по отдельным пользователям */ }
  }
  $('addMembersModal').classList.add('hidden');
  await openGroup(currentGroupId, currentGroupName);
});

// ---------- ЧАТ ----------

function openChat(type, id, name) {
  chatState = { type, id, name };
  $('chatTitle').textContent = name;
  $('chatMessages').innerHTML = '';
  $('chatModal').classList.remove('hidden');
  loadChatHistory();
  $('chatInput').value = '';
  $('chatInput').focus();
}

$('chatCloseBtn').addEventListener('click', () => {
  $('chatModal').classList.add('hidden');
  chatState = null;
});

async function loadChatHistory() {
  if (!chatState) return;
  const url = chatState.type === 'direct'
    ? `/api/messages/direct/${chatState.id}`
    : `/api/messages/group/${chatState.id}`;
  try {
    const messages = await Api.get(url);
    const container = $('chatMessages');
    container.innerHTML = '';
    if (messages.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted); text-align:center;">${I18N.t('no_messages')}</div>`;
    } else {
      messages.forEach(m => appendChatMessage(m));
    }
  } catch (e) {
    alert(e.message);
  }
}

function appendChatMessage(m) {
  const container = $('chatMessages');
  const noMsgPlaceholder = container.querySelector('div[style*="text-align:center"]');
  if (noMsgPlaceholder) container.innerHTML = '';

  const mine = m.senderId === myProfile.id;
  const senderName = mine ? (myProfile.nickname || myProfile.username)
    : (peopleCache[m.senderId] ? peopleCache[m.senderId].nickname : ('#' + m.senderId));
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const div = document.createElement('div');
  div.className = 'chat-message' + (mine ? ' mine' : '');
  div.innerHTML = `<div class="meta">${chatState && chatState.type === 'group' && !mine ? escapeHtml(senderName) + ' · ' : ''}${time}</div>${escapeHtml(m.content)}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  if (!chatState) return;
  const content = $('chatInput').value.trim();
  if (!content) return;
  const url = chatState.type === 'direct'
    ? `/api/messages/direct/${chatState.id}`
    : `/api/messages/group/${chatState.id}`;
  try {
    const saved = await Api.post(url, { content });
    appendChatMessage(saved);
    $('chatInput').value = '';
  } catch (e) {
    alert(e.message);
  }
}

$('chatSendBtn').addEventListener('click', sendChatMessage);
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

// ---------- PROFILE ----------

function fillProfileTab() {
  $('nicknameInput').value = myProfile.nickname || '';
  $('profileAvatarPreview').src = myProfile.avatarUrl || defaultAvatar(myProfile.nickname);
  $('languageSelect').value = myProfile.language || 'ru';
}

$('saveNicknameBtn').addEventListener('click', async () => {
  const nickname = $('nicknameInput').value.trim();
  try {
    const res = await Api.put('/api/profile/nickname', { nickname });
    myProfile.nickname = res.nickname;
    cachePerson(myProfile);
    renderMyProfileHeader();
    await loadFriends();
  } catch (e) {
    alert(e.message);
  }
});

$('chooseAvatarBtn').addEventListener('click', () => $('avatarFileInput').click());

$('avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await Api.postForm('/api/profile/avatar', formData);
    myProfile.avatarUrl = res.avatarUrl;
    cachePerson(myProfile);
    $('profileAvatarPreview').src = res.avatarUrl;
    renderMyProfileHeader();
  } catch (e2) {
    alert(e2.message);
  }
});

$('languageSelect').addEventListener('change', async (e) => {
  const lang = e.target.value;
  try {
    await Api.put('/api/profile/language', { language: lang });
    myProfile.language = lang;
    await I18N.load(lang);
    await loadFriends();
    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- ПОЛНОЭКРАННЫЙ ЗВОНОК ----------

function showCallOverlay() {
  $('callOverlay').classList.remove('hidden');
}

function hideCallOverlay() {
  $('callOverlay').classList.add('hidden');
  $('callIncomingButtons').classList.add('hidden');
  $('callActiveButtons').classList.add('hidden');
}

function renderCallAvatars() {
  const container = $('callOverlayAvatars');
  container.innerHTML = '';

  if (Voice.callType === 'direct') {
    const peerId = Voice.callId;
    const info = peopleCache[peerId] || { nickname: Voice.callName || ('#' + peerId), avatarUrl: '' };
    container.appendChild(makeAvatarItem(info));
  } else if (Voice.callType === 'group') {
    for (const [peerId] of Voice.peers) {
      const info = peopleCache[peerId] || { nickname: '#' + peerId, avatarUrl: '' };
      container.appendChild(makeAvatarItem(info));
    }
    if (Voice.peers.size === 0) {
      const info = { nickname: Voice.callName || '', avatarUrl: '' };
      container.appendChild(makeAvatarItem(info));
    }
  }
}

function makeAvatarItem(info) {
  const div = document.createElement('div');
  div.className = 'call-avatar-item';
  div.innerHTML = `
    <img src="${info.avatarUrl || defaultAvatar(info.nickname)}">
    <div class="peer-name">${escapeHtml(info.nickname)}</div>
  `;
  return div;
}

function onCallStateChange(state) {
  if (state === 'connecting' || state === 'connecting-group') {
    showCallOverlay();
    $('callOverlayTitle').textContent = Voice.callName || '';
    $('callOverlayStatus').textContent = I18N.t('connecting');
    $('callIncomingButtons').classList.add('hidden');
    $('callActiveButtons').classList.add('hidden');
    renderCallAvatars();
  } else if (state === 'connected') {
    showCallOverlay();
    $('callOverlayTitle').textContent = Voice.callName || '';
    $('callOverlayStatus').textContent = I18N.t('in_call');
    $('callIncomingButtons').classList.add('hidden');
    $('callActiveButtons').classList.remove('hidden');
    renderCallAvatars();
  } else if (state === 'ended') {
    hideCallOverlay();
  }
}

function onIncomingCall(fromId, fromName) {
  showCallOverlay();
  const info = peopleCache[fromId] || { nickname: fromName, avatarUrl: '' };
  $('callOverlayAvatars').innerHTML = '';
  $('callOverlayAvatars').appendChild(makeAvatarItem(info));
  $('callOverlayTitle').textContent = fromName;
  $('callOverlayStatus').textContent = I18N.t('incoming_call');
  $('callIncomingButtons').classList.remove('hidden');
  $('callActiveButtons').classList.add('hidden');
}

function onIncomingCallCancelled() {
  if (!$('callIncomingButtons').classList.contains('hidden')) {
    hideCallOverlay();
  }
}

$('callAcceptBtn').addEventListener('click', () => {
  Voice.acceptIncomingCall();
});

$('callDeclineBtn').addEventListener('click', () => {
  Voice.declineIncomingCall();
  hideCallOverlay();
});

$('callMuteBtn').addEventListener('click', () => {
  const muted = Voice.toggleMute();
  $('callMuteBtn').classList.toggle('active', muted);
  $('callMuteBtn').textContent = muted ? '🔇' : '🎤';
  updateQuickButtons();
});

$('callDeafenBtn').addEventListener('click', () => {
  const deafened = Voice.toggleDeafen();
  $('callDeafenBtn').classList.toggle('active', deafened);
  $('callDeafenBtn').textContent = deafened ? '🔇' : '🔊';
  $('callMuteBtn').classList.toggle('active', deafened || Voice.isMuted);
  updateQuickButtons();
});

$('callEndBtn').addEventListener('click', () => {
  Voice.endCall(true);
});

// Быстрые кнопки mute/deafen на панели пользователя (доступны всегда)
$('quickMuteBtn').addEventListener('click', () => {
  const muted = Voice.toggleMute();
  $('quickMuteBtn').textContent = muted ? '🔇' : '🎤';
  $('callMuteBtn').textContent = muted ? '🔇' : '🎤';
  $('callMuteBtn').classList.toggle('active', muted);
});

$('quickDeafenBtn').addEventListener('click', () => {
  const deafened = Voice.toggleDeafen();
  $('quickDeafenBtn').textContent = deafened ? '🔇' : '🔊';
  $('callDeafenBtn').textContent = deafened ? '🔇' : '🔊';
  $('callDeafenBtn').classList.toggle('active', deafened);
  updateQuickButtons();
});

function updateQuickButtons() {
  $('quickMuteBtn').textContent = Voice.isMuted ? '🔇' : '🎤';
  $('quickDeafenBtn').textContent = Voice.isDeafened ? '🔇' : '🔊';
}

// ---------- VOLUME CONTEXT MENU (ПКМ по другу) ----------

function openVolumeMenu(x, y, friendId, friendName) {
  const menu = $('volumeContextMenu');
  $('volumeMenuName').textContent = friendName;
  const current = Voice.getVolumeForPeer(friendId);
  $('volumeSlider').value = Math.round(current * 100);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.remove('hidden');

  const slider = $('volumeSlider');
  slider.oninput = () => {
    const value = slider.value / 100;
    Voice.setVolumeForPeer(friendId, value);
  };
}

document.addEventListener('click', (e) => {
  const menu = $('volumeContextMenu');
  if (!menu.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// ---------- INIT ----------

(async function init() {
  await I18N.load(localStorage.getItem('uiLanguageBeforeLogin') || 'ru');
  updateAuthScreenText();

  if (Api.token) {
    try {
      await onLoggedIn();
    } catch (e) {
      Api.setToken(null);
    }
  }
})();
