// Основная логика приложения: авторизация, друзья, группы, профиль, звонки

let authMode = 'login'; // или 'register'
let myProfile = null;
let currentGroupId = null;

const $ = (id) => document.getElementById(id);

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

  renderMyProfileHeader();
  fillProfileTab();

  Voice.myNickname = myProfile.nickname;
  Voice.connectSignaling(myProfile.id, Api.token);
  Voice.onCallStateChange = onCallStateChange;
  Voice.onIncomingCall = onIncomingCall;

  await loadFriends();
  await loadRequests();
  await loadGroups();
}

function renderMyProfileHeader() {
  $('myNameSmall').textContent = myProfile.nickname || myProfile.username;
  $('myAvatarSmall').src = myProfile.avatarUrl || defaultAvatar(myProfile.nickname || myProfile.username);
}

function defaultAvatar(name) {
  const letter = (name || '?').charAt(0).toUpperCase();
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#5865f2"/><text x="50%" y="50%" fill="white" font-size="28" text-anchor="middle" dy=".35em" font-family="sans-serif">${letter}</text></svg>`
  );
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
    alert('OK: ' + username);
  } catch (e) {
    alert(e.message);
  }
});

async function loadFriends() {
  const friends = await Api.get('/api/friends');
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
      <div class="name">${escapeHtml(f.nickname)}</div>
      <button class="btn-call" data-action="call">${I18N.t('call')}</button>
      <button class="btn-remove" data-action="remove">${I18N.t('remove_friend')}</button>
    `;
    row.querySelector('[data-action="call"]').addEventListener('click', () => {
      Voice.startCall(f.id, f.nickname);
      showCallPanel(f.nickname);
    });
    row.querySelector('[data-action="remove"]').addEventListener('click', async () => {
      await Api.del(`/api/friends/${f.id}`);
      await loadFriends();
    });

    // ПКМ — регулировка громкости (работает во время активного звонка с этим другом)
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
  $('groupDetail').classList.remove('hidden');
  const members = await Api.get(`/api/groups/${groupId}/members`);
  const container = $('groupMembersList');
  container.innerHTML = '';
  members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'list-card';
    row.innerHTML = `
      <img class="avatar-small" src="${m.avatarUrl || defaultAvatar(m.nickname)}">
      <div class="name">${escapeHtml(m.nickname)}</div>
    `;
    container.appendChild(row);
  });
}

$('addMemberBtn').addEventListener('click', async () => {
  if (!currentGroupId) return;
  const username = $('addMemberInput').value.trim();
  if (!username) return;
  try {
    await Api.post(`/api/groups/${currentGroupId}/members/${encodeURIComponent(username)}`);
    $('addMemberInput').value = '';
    await openGroup(currentGroupId);
  } catch (e) {
    alert(e.message);
  }
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
    // перерисовываем динамические списки, чтобы применить новый язык к кнопкам
    await loadFriends();
    await loadRequests();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- CALL PANEL ----------

function showCallPanel(peerName) {
  $('callWithName').textContent = peerName;
  $('callStatus').textContent = I18N.t('connecting');
  $('callPanel').classList.remove('hidden');
}

function onCallStateChange(state) {
  if (state === 'connecting') {
    $('callStatus').textContent = I18N.t('connecting');
  } else if (state === 'connected') {
    $('callWithName').textContent = Voice.peerName || '';
    $('callStatus').textContent = I18N.t('in_call');
    $('callPanel').classList.remove('hidden');
  } else if (state === 'ended') {
    $('callPanel').classList.add('hidden');
    $('volumeContextMenu').classList.add('hidden');
  }
}

function onIncomingCall(fromId, fromName, offerSdp) {
  const accept = confirm(`${fromName}: ${I18N.t('call_with')}. ${I18N.t('accept')}?`);
  if (accept) {
    showCallPanel(fromName);
    Voice.acceptIncomingCall(offerSdp);
  } else {
    Voice.declineIncomingCall();
  }
}

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
  // при deafen также обновляем кнопку mute, т.к. звук микрофона отключается
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

// ---------- UTILS ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

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
