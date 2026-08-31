import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.LINKCHAT_CONFIG || {};
const configured = cfg.supabaseUrl && cfg.supabaseKey && !cfg.supabaseUrl.includes('PASTE_') && !cfg.supabaseKey.includes('PASTE_');
const setupBanner = document.getElementById('setupBanner');
if (!configured) setupBanner.classList.remove('hidden');

const supabase = configured ? createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const $ = (id) => document.getElementById(id);
const state = {
  mode: 'signin',
  user: null,
  profile: null,
  friends: [],
  requests: [],
  selected: null,
  clearAt: null,
  imageFile: null,
  subscriptions: [],
  call: {
    id: null,
    friendshipId: null,
    peerId: null,
    peerProfile: null,
    mode: null,
    direction: null,
    status: 'idle',
    pc: null,
    localStream: null,
    remoteStream: null,
    pendingOffer: null,
    remoteIce: [],
    localIce: [],
    signalReady: false,
    timer: null,
    muted: false,
    cameraOff: false
  }
};

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const savedTheme = localStorage.getItem('linkchat-theme') || 'blue';
document.documentElement.dataset.theme = ['blue','red','green','purple','orange'].includes(savedTheme) ? savedTheme : 'blue';

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function initials(name='?') {
  return name.trim().split(/\s+/).slice(0,2).map(x => x[0]?.toUpperCase() || '').join('') || '?';
}
function toast(message, type='') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3600);
}
function authStatus(message='', type='') {
  $('authStatus').textContent = message;
  $('authStatus').className = `status ${type}`;
}
function explain(error) {
  const m = error?.message || String(error || 'Something went wrong');
  return m
    .replace(/^Database error saving new user$/i, 'That username may already be taken. Try another one.')
    .replace(/invalid login credentials/i, 'Wrong username or password.');
}
function setMode(mode) {
  state.mode = mode;
  const signup = mode === 'signup';
  $('signInTab').classList.toggle('active', !signup);
  $('signUpTab').classList.toggle('active', signup);
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('authSubmit').textContent = signup ? 'Create account' : 'Sign in';
  authStatus('');
}

$('signInTab').onclick = () => setMode('signin');
$('signUpTab').onclick = () => setMode('signup');

$('themeSelect').value = document.documentElement.dataset.theme;
$('themeSelect').addEventListener('change', () => {
  const theme = $('themeSelect').value;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('linkchat-theme', theme);
});

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!configured) return authStatus('Connect Supabase in config.js first.', 'error');
  const password = $('password').value;
  const username = $('username').value.trim().toLowerCase();
  const internalEmail = `${username}@students.linkchat.invalid`;
  $('authSubmit').disabled = true;
  authStatus(state.mode === 'signup' ? 'Creating account…' : 'Signing in…');
  try {
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('Username must be 3–24 characters using letters, numbers, or underscores.');
    if (password.length < 8 || password.length > 72) throw new Error('Password must be 8–72 characters.');

    if (state.mode === 'signup') {
      const response = await fetch(`${cfg.supabaseUrl}/functions/v1/register-username`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.supabaseKey
        },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not create account.');

      const { error } = await supabase.auth.signInWithPassword({ email: internalEmail, password });
      if (error) throw error;
      authStatus('Account created.', 'good');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: internalEmail, password });
      if (error) throw error;
    }
  } catch (err) {
    authStatus(explain(err), 'error');
  } finally {
    $('authSubmit').disabled = false;
  }
});

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('id,username,display_name').eq('id', state.user.id).single();
  if (error) throw error;
  state.profile = data;
  $('myName').textContent = data.display_name;
  $('myUsername').textContent = '@' + data.username;
  $('myAvatar').textContent = initials(data.display_name);
}

async function loadFriends() {
  const { data: links, error } = await supabase.from('friendships').select('id,user_a,user_b,created_at').order('created_at');
  if (error) throw error;
  const others = (links || []).map(f => f.user_a === state.user.id ? f.user_b : f.user_a);
  let profiles = [];
  if (others.length) {
    const res = await supabase.from('profiles').select('id,username,display_name').in('id', others);
    if (res.error) throw res.error;
    profiles = res.data || [];
  }
  const map = new Map(profiles.map(p => [p.id, p]));
  state.friends = (links || []).map(f => {
    const otherId = f.user_a === state.user.id ? f.user_b : f.user_a;
    return { ...f, profile: map.get(otherId) };
  }).filter(x => x.profile);
  renderFriends();
  if (state.selected) {
    const updated = state.friends.find(f => f.id === state.selected.id);
    if (!updated) closeChat(); else state.selected = updated;
  }
}

async function loadRequests() {
  const { data: rows, error } = await supabase.from('friend_requests').select('id,sender_id,receiver_id,created_at').order('created_at', { ascending: false });
  if (error) throw error;
  const ids = [...new Set((rows || []).flatMap(r => [r.sender_id, r.receiver_id]).filter(id => id !== state.user.id))];
  let profiles = [];
  if (ids.length) {
    const res = await supabase.from('profiles').select('id,username,display_name').in('id', ids);
    if (res.error) throw res.error;
    profiles = res.data || [];
  }
  const map = new Map(profiles.map(p => [p.id, p]));
  state.requests = (rows || []).map(r => ({ ...r, profile: map.get(r.sender_id === state.user.id ? r.receiver_id : r.sender_id) })).filter(x => x.profile);
  renderRequests();
}

function renderFriends() {
  $('friendCount').textContent = state.friends.length ? String(state.friends.length) : '';
  $('friendsList').innerHTML = '';
  if (!state.friends.length) {
    $('friendsList').innerHTML = '<div class="friend-sub" style="padding:10px">No friends yet. Add somebody by username.</div>';
    return;
  }
  for (const friend of state.friends) {
    const b = document.createElement('button');
    b.className = `friend-card ${state.selected?.id === friend.id ? 'active' : ''}`;
    b.innerHTML = `<div class="avatar">${esc(initials(friend.profile.display_name))}</div><div class="friend-copy"><div class="friend-title">${esc(friend.profile.display_name)}</div><div class="friend-sub">@${esc(friend.profile.username)}</div></div>`;
    b.onclick = () => openChat(friend);
    $('friendsList').append(b);
  }
}

function renderRequests() {
  const incoming = state.requests.filter(r => r.receiver_id === state.user.id);
  $('requestCount').textContent = incoming.length;
  $('requestCount').classList.toggle('hidden', incoming.length === 0);
  $('requestsList').innerHTML = '';
  if (!state.requests.length) {
    $('requestsList').innerHTML = '<div class="friend-sub" style="padding:10px">No pending requests.</div>';
    return;
  }
  for (const req of state.requests) {
    const incomingReq = req.receiver_id === state.user.id;
    const card = document.createElement('div');
    card.className = 'request-card';
    card.innerHTML = `<div class="avatar">${esc(initials(req.profile.display_name))}</div><div class="friend-copy"><div class="friend-title">${esc(req.profile.display_name)}</div><div class="friend-sub">${incomingReq ? 'wants to add you' : 'request sent'} · @${esc(req.profile.username)}</div></div><div class="request-actions"></div>`;
    const actions = card.querySelector('.request-actions');
    if (incomingReq) {
      const accept = document.createElement('button'); accept.className='mini ok'; accept.textContent='Accept';
      accept.onclick = () => acceptRequest(req.id);
      const decline = document.createElement('button'); decline.className='mini danger'; decline.textContent='×';
      decline.onclick = () => declineRequest(req.id);
      actions.append(accept, decline);
    } else {
      const cancel = document.createElement('button'); cancel.className='mini'; cancel.textContent='Cancel';
      cancel.onclick = () => cancelRequest(req.id);
      actions.append(cancel);
    }
    $('requestsList').append(card);
  }
}

$('addFriendBtn').onclick = async () => {
  const username = $('friendUsername').value.trim();
  if (!username) return;
  $('addFriendBtn').disabled = true;
  try {
    const { error } = await supabase.rpc('send_friend_request', { p_username: username });
    if (error) throw error;
    $('friendUsername').value = '';
    toast('Friend request sent.');
    await loadRequests();
  } catch (err) { toast(explain(err), 'error'); }
  finally { $('addFriendBtn').disabled = false; }
};
$('friendUsername').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('addFriendBtn').click(); } });

async function acceptRequest(id) {
  try {
    const { error } = await supabase.rpc('accept_friend_request', { p_request_id: id });
    if (error) throw error;
    toast('Friend added.');
    await Promise.all([loadRequests(), loadFriends()]);
  } catch (err) { toast(explain(err), 'error'); }
}
async function declineRequest(id) {
  try { const { error } = await supabase.rpc('decline_friend_request', { p_request_id: id }); if (error) throw error; await loadRequests(); }
  catch (err) { toast(explain(err), 'error'); }
}
async function cancelRequest(id) {
  try { const { error } = await supabase.rpc('cancel_friend_request', { p_request_id: id }); if (error) throw error; await loadRequests(); }
  catch (err) { toast(explain(err), 'error'); }
}

async function openChat(friend) {
  state.selected = friend;
  state.imageFile = null;
  clearImagePreview();
  $('emptyChat').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  $('chatName').textContent = friend.profile.display_name;
  $('chatUsername').textContent = '@' + friend.profile.username;
  $('chatAvatar').textContent = initials(friend.profile.display_name);
  $('chatPanel').classList.add('mobile-open');
  renderFriends();
  await loadMessages();
}
function closeChat() {
  state.selected = null;
  $('chatView').classList.add('hidden');
  $('emptyChat').classList.remove('hidden');
  $('chatPanel').classList.remove('mobile-open');
  renderFriends();
}
$('mobileBack').onclick = () => $('chatPanel').classList.remove('mobile-open');

function getFriendForCall(friendshipId, peerId) {
  return state.friends.find(f => f.id === friendshipId && f.profile?.id === peerId) || null;
}

function resetCallState() {
  state.call = {
    id: null,
    friendshipId: null,
    peerId: null,
    peerProfile: null,
    mode: null,
    direction: null,
    status: 'idle',
    pc: null,
    localStream: null,
    remoteStream: null,
    pendingOffer: null,
    remoteIce: [],
    localIce: [],
    signalReady: false,
    timer: null,
    muted: false,
    cameraOff: false
  };
}

function updateCallUi() {
  const call = state.call;
  const active = call.status !== 'idle';
  $('callModal').classList.toggle('hidden', !active);
  $('voiceCallBtn').disabled = active;
  $('videoCallBtn').disabled = active;
  if (!active) return;

  const name = call.peerProfile?.display_name || 'Friend';
  const username = call.peerProfile?.username || '';
  $('callPeerName').textContent = name;
  $('callPeerUsername').textContent = username ? '@' + username : '';
  $('remoteCallAvatar').textContent = initials(name);
  $('localCallAvatar').textContent = initials(state.profile?.display_name || 'Me');
  $('callModeBadge').textContent = call.mode === 'voice' ? 'Voice' : 'Video';

  const statusText = {
    preparing: call.mode === 'voice' ? 'Starting microphone…' : 'Starting camera…',
    ringing: 'Ringing…',
    incoming: `Incoming ${call.mode === 'voice' ? 'voice' : 'video'} call`,
    connecting: 'Connecting…',
    connected: 'Connected'
  }[call.status] || 'Connecting…';
  $('callStatus').textContent = statusText;

  $('incomingCallActions').classList.toggle('hidden', call.status !== 'incoming');
  $('activeCallControls').classList.toggle('hidden', call.status === 'incoming' || call.status === 'preparing');
  $('cameraCallBtn').classList.toggle('hidden', call.mode === 'voice');
  $('muteCallBtn').classList.toggle('active', call.muted);
  $('cameraCallBtn').classList.toggle('active', call.cameraOff);
  $('muteCallBtn').textContent = call.muted ? '🔇' : '🎙';
  $('cameraCallBtn').textContent = call.cameraOff ? '🚫📷' : '📷';

  const stage = $('videoStage');
  stage.classList.toggle('voice-only', call.mode === 'voice');
  stage.classList.toggle('camera-off', call.cameraOff);
  stage.classList.toggle('waiting-video', call.mode === 'video' && !call.remoteStream);
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function attachRemoteStream(stream) {
  state.call.remoteStream = stream;
  $('remoteVideo').srcObject = stream;
  $('remoteAudio').srcObject = stream;
  $('remoteVideo').muted = state.call.mode === 'voice';
  $('remoteAudio').muted = state.call.mode !== 'voice';
  $('remoteVideo').play().catch(() => {});
  $('remoteAudio').play().catch(() => {});
  updateCallUi();
}

async function getLocalMedia(mode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone calls require HTTPS and a supported browser.');
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: mode === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}

async function sendCallSignal(kind, payload = {}, meta = {}) {
  if (!state.user) return;
  const row = {
    friendship_id: meta.friendshipId || state.call.friendshipId,
    call_id: meta.callId || state.call.id,
    sender_id: state.user.id,
    receiver_id: meta.receiverId || state.call.peerId,
    kind,
    payload
  };
  if (!row.friendship_id || !row.call_id || !row.receiver_id) return;
  const { error } = await supabase.from('call_signals').insert(row);
  if (error) throw error;
}

async function flushLocalIce() {
  if (!state.call.signalReady || !state.call.localIce.length) return;
  const queued = state.call.localIce.splice(0);
  for (const candidate of queued) {
    try { await sendCallSignal('ice', { candidate }); }
    catch (err) { console.warn('Could not send ICE candidate', err); }
  }
}

async function drainRemoteIce() {
  const pc = state.call.pc;
  if (!pc?.remoteDescription || !state.call.remoteIce.length) return;
  const queued = state.call.remoteIce.splice(0);
  for (const candidate of queued) {
    try { await pc.addIceCandidate(candidate); }
    catch (err) { console.warn('Could not add ICE candidate', err); }
  }
}

function createPeerConnection() {
  const callId = state.call.id;
  const pc = new RTCPeerConnection(rtcConfig);
  state.call.pc = pc;

  pc.onicecandidate = (event) => {
    if (!event.candidate || state.call.id !== callId) return;
    const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
    if (state.call.signalReady) {
      sendCallSignal('ice', { candidate }).catch(err => console.warn('ICE signal failed', err));
    } else {
      state.call.localIce.push(candidate);
    }
  };

  pc.ontrack = (event) => {
    if (state.call.id !== callId) return;
    if (event.streams?.[0]) {
      attachRemoteStream(event.streams[0]);
    } else {
      const stream = state.call.remoteStream || new MediaStream();
      if (!stream.getTracks().some(t => t.id === event.track.id)) stream.addTrack(event.track);
      attachRemoteStream(stream);
    }
  };

  pc.onconnectionstatechange = () => {
    if (state.call.id !== callId) return;
    if (pc.connectionState === 'connected') {
      state.call.status = 'connected';
      if (state.call.timer) { clearTimeout(state.call.timer); state.call.timer = null; }
      updateCallUi();
    } else if (pc.connectionState === 'failed') {
      toast('Call connection failed. The network may be blocking WebRTC.', 'error');
      finishCall(false);
    }
  };

  return pc;
}

function attachLocalStream(stream, pc) {
  state.call.localStream = stream;
  $('localVideo').srcObject = stream;
  $('localVideo').play().catch(() => {});
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
}

async function startCall(mode) {
  if (!state.selected || state.call.status !== 'idle') return;
  const friend = state.selected;
  resetCallState();
  Object.assign(state.call, {
    id: crypto.randomUUID(),
    friendshipId: friend.id,
    peerId: friend.profile.id,
    peerProfile: friend.profile,
    mode,
    direction: 'outgoing',
    status: 'preparing'
  });
  const callId = state.call.id;
  updateCallUi();

  try {
    const stream = await getLocalMedia(mode);
    if (state.call.id !== callId) { stopStream(stream); return; }
    const pc = createPeerConnection();
    attachLocalStream(stream, pc);
    const offer = await pc.createOffer();
    if (state.call.id !== callId) return;
    await pc.setLocalDescription(offer);
    if (state.call.id !== callId) return;
    await sendCallSignal('offer', {
      mode,
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
    });
    if (state.call.id !== callId) return;
    state.call.signalReady = true;
    await flushLocalIce();
    state.call.status = 'ringing';
    state.call.timer = setTimeout(async () => {
      if (state.call.status === 'ringing') {
        try { await sendCallSignal('hangup', { reason: 'no-answer' }); } catch {}
        toast('No answer.');
        finishCall(false);
      }
    }, 45000);
    updateCallUi();
  } catch (err) {
    toast(explain(err), 'error');
    finishCall(false);
  }
}

async function acceptIncomingCall() {
  if (state.call.status !== 'incoming' || !state.call.pendingOffer) return;
  const callId = state.call.id;
  $('acceptCallBtn').disabled = true;
  $('declineCallBtn').disabled = true;
  try {
    state.call.status = 'preparing';
    updateCallUi();
    const stream = await getLocalMedia(state.call.mode);
    if (state.call.id !== callId) { stopStream(stream); return; }
    const pc = createPeerConnection();
    attachLocalStream(stream, pc);
    await pc.setRemoteDescription(state.call.pendingOffer);
    if (state.call.id !== callId) return;
    await drainRemoteIce();
    const answer = await pc.createAnswer();
    if (state.call.id !== callId) return;
    await pc.setLocalDescription(answer);
    if (state.call.id !== callId) return;
    await sendCallSignal('answer', {
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
    });
    if (state.call.id !== callId) return;
    state.call.signalReady = true;
    await flushLocalIce();
    state.call.status = 'connecting';
    updateCallUi();
  } catch (err) {
    toast(explain(err), 'error');
    try { await sendCallSignal('decline', { reason: 'media-error' }); } catch {}
    finishCall(false);
  } finally {
    $('acceptCallBtn').disabled = false;
    $('declineCallBtn').disabled = false;
  }
}

async function declineIncomingCall() {
  if (state.call.status !== 'incoming') return;
  try { await sendCallSignal('decline'); } catch {}
  finishCall(false);
}

async function hangupCall() {
  if (state.call.status === 'idle') return;
  try { await sendCallSignal('hangup'); } catch {}
  finishCall(false);
}

function finishCall(showToast = false) {
  const call = state.call;
  if (call.timer) clearTimeout(call.timer);
  if (call.pc) {
    call.pc.onicecandidate = null;
    call.pc.ontrack = null;
    call.pc.onconnectionstatechange = null;
    try { call.pc.close(); } catch {}
  }
  stopStream(call.localStream);
  if (call.remoteStream) {
    for (const track of call.remoteStream.getTracks()) track.stop();
  }
  $('localVideo').srcObject = null;
  $('remoteVideo').srcObject = null;
  $('remoteAudio').srcObject = null;
  resetCallState();
  updateCallUi();
  if (showToast) toast('Call ended.');
}

async function handleCallSignal(row) {
  if (!row || row.receiver_id !== state.user?.id) return;
  try {
    if (row.kind === 'offer') {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age > 90000) return;
      if (state.call.status !== 'idle') {
        await sendCallSignal('busy', {}, { callId: row.call_id, friendshipId: row.friendship_id, receiverId: row.sender_id });
        return;
      }
      const friend = getFriendForCall(row.friendship_id, row.sender_id);
      if (!friend || !row.payload?.sdp) return;
      const mode = row.payload.mode === 'voice' ? 'voice' : 'video';
      resetCallState();
      Object.assign(state.call, {
        id: row.call_id,
        friendshipId: row.friendship_id,
        peerId: row.sender_id,
        peerProfile: friend.profile,
        mode,
        direction: 'incoming',
        status: 'incoming',
        pendingOffer: row.payload.sdp
      });
      state.call.timer = setTimeout(() => {
        if (state.call.status === 'incoming') declineIncomingCall().catch(() => finishCall(false));
      }, 60000);
      updateCallUi();
      return;
    }

    if (row.call_id !== state.call.id) return;

    if (row.kind === 'answer' && state.call.direction === 'outgoing' && state.call.pc && row.payload?.sdp) {
      await state.call.pc.setRemoteDescription(row.payload.sdp);
      await drainRemoteIce();
      state.call.status = 'connecting';
      updateCallUi();
    } else if (row.kind === 'ice' && row.payload?.candidate) {
      if (state.call.pc?.remoteDescription) await state.call.pc.addIceCandidate(row.payload.candidate);
      else state.call.remoteIce.push(row.payload.candidate);
    } else if (row.kind === 'decline') {
      toast('Call declined.');
      finishCall(false);
    } else if (row.kind === 'busy') {
      toast('They are already on another call.');
      finishCall(false);
    } else if (row.kind === 'hangup') {
      const noAnswer = row.payload?.reason === 'no-answer';
      toast(noAnswer ? 'Call ended.' : 'Call ended.');
      finishCall(false);
    }
  } catch (err) {
    console.warn('Call signal error', err);
    if (row.call_id === state.call.id) {
      toast('The call could not connect.', 'error');
      finishCall(false);
    }
  } finally {
    supabase.from('call_signals').delete().eq('id', row.id).then(() => {});
  }
}

$('voiceCallBtn').onclick = () => startCall('voice');
$('videoCallBtn').onclick = () => startCall('video');
$('acceptCallBtn').onclick = acceptIncomingCall;
$('declineCallBtn').onclick = declineIncomingCall;
$('hangupCallBtn').onclick = hangupCall;
$('muteCallBtn').onclick = () => {
  const tracks = state.call.localStream?.getAudioTracks() || [];
  if (!tracks.length) return;
  state.call.muted = !state.call.muted;
  for (const track of tracks) track.enabled = !state.call.muted;
  updateCallUi();
};
$('cameraCallBtn').onclick = () => {
  const tracks = state.call.localStream?.getVideoTracks() || [];
  if (!tracks.length) return;
  state.call.cameraOff = !state.call.cameraOff;
  for (const track of tracks) track.enabled = !state.call.cameraOff;
  updateCallUi();
};
$('callModal').addEventListener('click', () => {
  $('remoteVideo').play().catch(() => {});
  $('remoteAudio').play().catch(() => {});
});

async function loadMessages() {
  if (!state.selected) return;
  const fid = state.selected.id;
  const { data: clearRow } = await supabase.from('chat_clears').select('cleared_at').eq('friendship_id', fid).eq('user_id', state.user.id).maybeSingle();
  state.clearAt = clearRow?.cleared_at || null;
  let q = supabase.from('messages').select('id,friendship_id,sender_id,body,image_path,created_at').eq('friendship_id', fid).order('created_at', { ascending: true }).limit(500);
  if (state.clearAt) q = q.gt('created_at', state.clearAt);
  const { data, error } = await q;
  if (error) return toast(explain(error), 'error');
  if (!state.selected || state.selected.id !== fid) return;
  $('messages').innerHTML = '';
  for (const msg of (data || [])) await appendMessage(msg, false);
  scrollBottom();
}

async function imageUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('chat-images').createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
async function appendMessage(msg, scroll=true) {
  if (!state.selected || msg.friendship_id !== state.selected.id) return;
  if (state.clearAt && new Date(msg.created_at) <= new Date(state.clearAt)) return;
  const row = document.createElement('div');
  row.className = `msg-row ${msg.sender_id === state.user.id ? 'mine' : ''}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (msg.image_path) {
    const url = await imageUrl(msg.image_path);
    if (url) {
      const img = document.createElement('img'); img.src = url; img.alt = 'Shared picture'; img.loading = 'lazy'; img.onclick = () => window.open(url, '_blank', 'noopener');
      img.addEventListener('load', () => scrollBottom(), { once: true });
      bubble.append(img);
    }
  }
  if (msg.body) {
    const text = document.createElement('div'); text.className = 'bubble-text'; text.textContent = msg.body; bubble.append(text);
  }
  const time = document.createElement('div'); time.className = 'bubble-time'; time.textContent = new Date(msg.created_at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); bubble.append(time);
  row.append(bubble);
  $('messages').append(row);
  if (scroll) scrollBottom();
}
function scrollBottom() {
  const box = $('messages');
  if (!box) return;
  requestAnimationFrame(() => {
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  });
  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 120);
}
window.addEventListener('resize', () => { if (state.selected) scrollBottom(); });
window.visualViewport?.addEventListener('resize', () => { if (state.selected) scrollBottom(); });

$('imageInput').addEventListener('change', () => {
  const file = $('imageInput').files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Image must be 10 MB or smaller.', 'error'); $('imageInput').value=''; return; }
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { toast('Use a JPG, PNG, WebP, or GIF.', 'error'); $('imageInput').value=''; return; }
  state.imageFile = file;
  $('previewImg').src = URL.createObjectURL(file);
  $('previewName').textContent = file.name;
  $('imagePreview').classList.remove('hidden');
});
function clearImagePreview() {
  if ($('previewImg').src?.startsWith('blob:')) URL.revokeObjectURL($('previewImg').src);
  $('previewImg').removeAttribute('src');
  $('imageInput').value = '';
  $('imagePreview').classList.add('hidden');
  state.imageFile = null;
}
$('removeImageBtn').onclick = clearImagePreview;

$('messageInput').addEventListener('input', () => {
  const el = $('messageInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
});
$('messageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('messageForm').requestSubmit(); }
});
$('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selected) return;
  const body = $('messageInput').value.trim();
  const file = state.imageFile;
  if (!body && !file) return;
  $('sendBtn').disabled = true;
  const fid = state.selected.id;
  try {
    let imagePath = null;
    if (file) {
      const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'jpg').replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
      imagePath = `${fid}/${state.user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('chat-images').upload(imagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
    }
    const { error } = await supabase.from('messages').insert({ friendship_id: fid, sender_id: state.user.id, body: body || null, image_path: imagePath });
    if (error) throw error;
    $('messageInput').value = '';
    $('messageInput').style.height = 'auto';
    clearImagePreview();
  } catch (err) { toast(explain(err), 'error'); }
  finally { $('sendBtn').disabled = false; }
});

$('deleteChatBtn').onclick = () => $('confirmModal').classList.remove('hidden');
$('cancelDeleteBtn').onclick = () => $('confirmModal').classList.add('hidden');
$('confirmDeleteBtn').onclick = async () => {
  if (!state.selected) return;
  $('confirmDeleteBtn').disabled = true;
  try {
    const { data, error } = await supabase.rpc('clear_chat', { p_friendship_id: state.selected.id });
    if (error) throw error;
    state.clearAt = data;
    $('messages').innerHTML = '';
    $('confirmModal').classList.add('hidden');
    toast('Chat deleted for you. Friend kept.');
  } catch (err) { toast(explain(err), 'error'); }
  finally { $('confirmDeleteBtn').disabled = false; }
};

$('signOutBtn').onclick = async () => {
  if (state.call.status !== 'idle') {
    try { await sendCallSignal('hangup'); } catch {}
    finishCall(false);
  }
  await supabase.auth.signOut();
};

async function subscribeRealtime() {
  for (const sub of state.subscriptions) await supabase.removeChannel(sub);
  state.subscriptions = [];
  const messagesChannel = supabase.channel(`messages:${state.user.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => appendMessage(payload.new))
    .subscribe();
  const requestsChannel = supabase.channel(`requests:${state.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => loadRequests().catch(()=>{}))
    .subscribe();
  const friendsChannel = supabase.channel(`friends:${state.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => loadFriends().catch(()=>{}))
    .subscribe();
  const callsChannel = supabase.channel(`calls:${state.user.id}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'call_signals',
      filter: `receiver_id=eq.${state.user.id}`
    }, payload => handleCallSignal(payload.new))
    .subscribe();
  state.subscriptions.push(messagesChannel, requestsChannel, friendsChannel, callsChannel);
}

async function enterApp(user) {
  state.user = user;
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  try {
    await loadProfile();
    await Promise.all([loadFriends(), loadRequests()]);
    await supabase.from('call_signals').delete().eq('receiver_id', state.user.id).lt('created_at', new Date(Date.now() - 90000).toISOString());
    await subscribeRealtime();
  } catch (err) { toast(explain(err), 'error'); }
}
async function leaveApp() {
  if (state.call.status !== 'idle') finishCall(false);
  state.user = null; state.profile = null; state.friends = []; state.requests = []; state.selected = null;
  if (supabase) for (const sub of state.subscriptions) await supabase.removeChannel(sub);
  state.subscriptions = [];
  $('appScreen').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  closeChat();
}

if (supabase) {
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      if (state.user?.id !== session.user.id) await enterApp(session.user);
    } else if (state.user) {
      await leaveApp();
    }
  });
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) await enterApp(session.user);
}

window.addEventListener('beforeunload', () => stopStream(state.call.localStream));
