/* Moods - the host screen: deck, players, QR */

import { $, ls, toast, renderQueue, PLATFORM, setupNeeded } from './ui.js';
import * as store from './store.js';
import { configured } from './config.js';

const params = new URLSearchParams(location.search);
const CODE = (params.get('r') || '').toUpperCase();

let IS_HOST = false;          // decided once we know our uid and the room's
const deck = $('#deck'), npLabel = $('#npLabel'), ext = $('#external');

let state = null;
let started = false;
let loadedId = null, loadedPlatform = null;
let advancedFrom = null;
let reportedPlaying = null;
let errorStreak = 0;     // stops a dead connection from draining the queue

/* Focus mode: duck the music to a preset level so people can hear each other,
   then put it back exactly where it was. The level is remembered per machine. */
const FOCUS_KEY = 'hearit.focus';
let focusOn = false;
let focusLevel = Math.min(80, Math.max(0, parseInt(ls.get(FOCUS_KEY, '25'), 10) || 0));
let priorVolume = 100;

const ICON_PLAY  = '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';

/* ---------------------------------------------------------------- QR ---- */

function drawQR(el, url, cell) {
  try {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: cell, margin: 1, scalable: true });
  } catch {
    el.textContent = url;   // the URL is still readable, just not scannable
  }
}

function joinUrl() {
  // Whatever address this page was opened on is the one phones can reach,
  // so the QR is just this URL pointed at the join page.
  const u = new URL(location.href);
  u.pathname = u.pathname.replace(/room\.html$/, 'join.html');
  if (!/join\.html$/.test(u.pathname)) u.pathname += 'join.html';
  u.search = '?r=' + CODE;
  u.hash = '';
  return u.toString();
}

function setupQR() {
  const url = joinUrl();

  drawQR($('#qrSmall'), url, 4);
  drawQR($('#qrBig'), url, 8);
  const pretty = url.replace(/^https?:\/\//, '');
  $('#joinUrl').textContent = pretty;
  $('#urlBig').textContent = pretty;
  $('#codeBig').textContent = CODE;
}

const qrfull = $('#qrfull');
const showQR = () => qrfull.classList.add('on');
$('#qrcard').onclick = showQR;
$('#qrcard').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showQR(); } };
qrfull.onclick = () => qrfull.classList.remove('on');
addEventListener('keydown', e => {
  if (e.key === 'Escape') qrfull.classList.remove('on');
  if (/input/i.test(document.activeElement.tagName)) return;
  if (e.key === 'q') qrfull.classList.toggle('on');
  if (e.key === 'f' && IS_HOST) setFocus(!focusOn);
});

/* ------------------------------------------------------------ players --- */

let ytApiP = null, ytPlayer = null;
function ytApi() {
  if (!ytApiP) {
    ytApiP = new Promise(res => {
      window.onYouTubeIframeAPIReady = () => res(window.YT);
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApiP;
}

async function playYouTube(vid) {
  const YT = await ytApi();
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(vid);
    return;
  }
  ytPlayer = new YT.Player('ytmount', {
    videoId: vid,
    playerVars: {
      autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1,
      rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0,
    },
    events: {
      onReady: e => { e.target.playVideo(); applyVolume(); },
      onStateChange: e => {
        const S = window.YT.PlayerState;
        if (e.data === S.ENDED) return advance();
        if (e.data === S.PLAYING) { errorStreak = 0; applyVolume(); }
        if (e.data === S.PLAYING || e.data === S.PAUSED || e.data === S.BUFFERING) {
          setSpinning(e.data !== S.PAUSED);
          report(e.data !== S.PAUSED);
        }
      },
      onError: () => {
        // One dud track is normal (embedding disabled, region-locked). Three
        // in a row means the connection is the problem, and skipping on would
        // just empty the queue without playing a note.
        if (++errorStreak >= 3) {
          toast('Nothing will play. Check this machine\'s connection.', true);
          setSpinning(false);
          return;
        }
        toast("That one won't play here — skipping it.", true);
        setTimeout(advance, 1400);
      },
    },
  });
}

function stopYouTube() {
  try { ytPlayer && ytPlayer.pauseVideo && ytPlayer.pauseVideo(); } catch {}
}

let spApiP = null, spCtrl = null;
function spotifyApi() {
  if (!spApiP) {
    spApiP = new Promise(res => {
      window.onSpotifyIframeApiReady = API => res(API);
      const s = document.createElement('script');
      s.src = 'https://open.spotify.com/embed/iframe-api/v1';
      document.head.appendChild(s);
    });
  }
  return spApiP;
}

async function playSpotify(tid) {
  const API = await spotifyApi();
  if (loadedPlatform !== 'spotify') return;   // moved on while the API loaded

  const mount = document.createElement('div');
  ext.innerHTML = '';
  ext.appendChild(mount);

  const note = document.createElement('div');
  note.className = 'credit dim';
  note.style.marginTop = '10px';
  note.style.fontSize = '11.5px';
  note.textContent = 'Spotify gives a 30-second preview unless this browser is signed in to Premium.';

  API.createController(mount, { uri: 'spotify:track:' + tid, width: '100%', height: 152 }, ctrl => {
    spCtrl = ctrl;
    ext.appendChild(note);
    ctrl.addListener('playback_update', e => {
      const d = e && e.data; if (!d) return;
      setSpinning(!d.isPaused);
      report(!d.isPaused);
      if (d.duration > 0 && d.position >= d.duration - 900) advance();
    });
    try { ctrl.play(); } catch {}
  });
}

function clearSpotify() {
  try { spCtrl && spCtrl.destroy && spCtrl.destroy(); } catch {}
  spCtrl = null;
  ext.innerHTML = '';
}

function showLinkCard(t) {
  ext.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'linkcard';
  const p = document.createElement('div');
  p.textContent = "hearIt can't play this one for you — open it and hit skip when it's done.";
  const a = document.createElement('a');
  a.href = t.url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = 'Open ' + (PLATFORM[t.platform] || 'link') + ' ↗';
  a.style.display = 'inline-block';
  a.style.marginTop = '10px';
  card.append(p, a);
  ext.appendChild(card);
}

/* ------------------------------------------------------------- driving -- */

function advance() {
  if (!IS_HOST) return;
  if (advancedFrom === loadedId) return;   // one skip per track, no runaway
  advancedFrom = loadedId;
  store.playNext(CODE).catch(() => {});
}

let kickTimer = null;
function kick() {
  if (!IS_HOST || kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    store.playNext(CODE).catch(() => {});
  }, 400);
}

function report(playing) {
  if (!IS_HOST || playing === reportedPlaying) return;
  reportedPlaying = playing;
  store.setPlaying(CODE, playing).catch(() => {});
}

function canSetVolume() {
  return loadedPlatform === 'youtube' && ytPlayer && ytPlayer.setVolume;
}

function applyVolume() {
  // Called on every toggle and again whenever a track loads, because a new
  // video otherwise comes in at full blast while focus is still engaged.
  if (!canSetVolume()) return;
  try { ytPlayer.setVolume(focusOn ? focusLevel : priorVolume); } catch {}
}

function paintFocus() {
  const btn = $('#focus');
  btn.setAttribute('aria-pressed', focusOn ? 'true' : 'false');
  $('#focusLabel').textContent = focusOn ? `Focus ${focusLevel}%` : 'Focus';
  $('#focusbar').hidden = !focusOn;
  $('#focusPct').textContent = focusLevel + '%';
  document.body.classList.toggle('focused', focusOn);
}

function setFocus(on) {
  if (on === focusOn) return;
  if (on && canSetVolume()) {
    try { priorVolume = ytPlayer.getVolume(); } catch { priorVolume = 100; }
    if (!priorVolume) priorVolume = 100;   // don't "restore" to silence
  }
  focusOn = on;
  applyVolume();
  paintFocus();
  if (on && !canSetVolume() && loadedPlatform === 'spotify') {
    toast("Spotify's player won't take a volume command — turn it down at the speakers.", true);
  }
}

function setSpinning(on) {
  deck.classList.toggle('spinning', !!on);
  npLabel.classList.toggle('paused', !on);
  $('#playPause').innerHTML = on ? ICON_PAUSE : ICON_PLAY;
}

function setLabelArt(thumb) {
  const wrap = $('#labelArt'), img = wrap.querySelector('img');
  if (!thumb) { wrap.classList.remove('on'); return; }
  if (img.dataset.src === thumb) { wrap.classList.add('on'); return; }
  img.dataset.src = thumb;
  img.onload = () => wrap.classList.add('on');
  img.onerror = () => wrap.classList.remove('on');
  wrap.classList.remove('on');
  img.src = thumb;
}

function syncPlayer(now) {
  if (!now) {
    loadedId = null; loadedPlatform = null;
    setSpinning(false); setLabelArt(null); clearSpotify(); stopYouTube();
    if (state && state.upcoming) kick();   // played songs don't count
    return;
  }

  setLabelArt(now.thumb);

  // A screen without the host token is a passive second display: it mirrors
  // the room but never starts a player, so two screens can't play over
  // each other. Spin state comes from whatever the host reported.
  if (!IS_HOST) {
    loadedId = now.id;
    setSpinning(!!(state && state.playing));
    return;
  }

  if (now.id === loadedId) return;

  loadedId = now.id;
  loadedPlatform = now.platform;
  advancedFrom = null;
  reportedPlaying = null;
  clearSpotify();

  if (!started) { setSpinning(false); return; }

  if (now.platform === 'youtube') {
    setSpinning(true);
    playYouTube(now.ref);
  } else if (now.platform === 'spotify') {
    stopYouTube();
    setSpinning(true);
    playSpotify(now.ref);
  } else {
    stopYouTube();
    setSpinning(false);
    showLinkCard(now);
  }
}

/* -------------------------------------------------------------- render -- */

const queueEl = $('#queue'), qEmpty = $('#qEmpty');

function render(s) {
  state = s;
  $('#code').textContent = s.code;

  const heads = s.listeners || 0;
  $('#people').hidden = heads < 1;
  $('#peopleN').textContent = heads === 1 ? '1 here' : `${heads} here`;

  $('#qCount').textContent = s.upcoming || s.played
    ? [s.upcoming && `${s.upcoming} song${s.upcoming === 1 ? '' : 's'}`, s.played && `${s.played} played`].filter(Boolean).join(' · ')
    : '';
  qEmpty.hidden = s.upcoming > 0;

  renderQueue(queueEl, s.queue, IS_HOST ? { onRemove: removeTrack } : {});

  const now = s.now;
  $('#npTitle').textContent = now ? now.title : 'Nothing on the deck yet';
  $('#npArtist').textContent = now ? (now.artist || '') : '';
  $('#npCredit').textContent = now ? `added by ${now.addedBy}` : '';
  $('#transport').style.visibility = now && IS_HOST ? 'visible' : 'hidden';

  syncPlayer(now);
}

function removeTrack(id) {
  store.removeTrack(CODE, id).catch(e => toast(e.message, true));
}

/* ------------------------------------------------------------ controls -- */

$('#skip').onclick = () => {
  advancedFrom = loadedId;
  store.playNext(CODE).catch(e => toast(e.message, true));
};

$('#playPause').onclick = () => {
  if (loadedPlatform === 'youtube' && ytPlayer && ytPlayer.getPlayerState) {
    const playing = ytPlayer.getPlayerState() === 1;
    playing ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
  } else if (loadedPlatform === 'spotify' && spCtrl) {
    try { spCtrl.togglePlay(); } catch {}
  }
};

$('#focus').onclick = () => setFocus(!focusOn);

$('#focusLevel').oninput = e => {
  focusLevel = parseInt(e.target.value, 10) || 0;
  ls.set(FOCUS_KEY, String(focusLevel));
  $('#focusPct').textContent = focusLevel + '%';
  $('#focusLabel').textContent = `Focus ${focusLevel}%`;
  applyVolume();                       // hear the change as you drag
};

$('#cinema').onclick = () => {
  const on = document.body.classList.toggle('cinema');
  $('#cinema').textContent = on ? 'Record' : 'Video';
};

$('#startBtn').onclick = () => {
  started = true;
  $('#start').classList.add('gone');
  loadedId = null;                 // force a (re)load of whatever's on the deck
  if (state) syncPlayer(state.now);
};

/* ---------------------------------------------------------------- boot -- */

function applyRole() {
  if (IS_HOST) return;
  $('#viewonly').hidden = false;
  $('#transport').style.display = 'none';
  $('#start').classList.add('gone');
}

function roomGone() {
  document.body.innerHTML =
    '<div style="display:grid;place-items:center;min-height:100dvh;text-align:center;padding:30px">' +
    '<div><h2 style="font-size:28px;margin-bottom:10px">This room has closed</h2>' +
    '<p style="color:#63636b;margin-bottom:24px">The needle came up a while ago.</p>' +
    '<a class="btn btn-solid" href="./">Open a new one</a></div></div>';
}

let roleKnown = false;

async function boot() {
  if (!configured()) return setupNeeded('room');
  if (!/^[A-Z0-9]{4}$/.test(CODE)) { location.href = './'; return; }

  setSpinning(false);
  $('#focusLevel').value = String(focusLevel);
  paintFocus();
  $('#code').textContent = CODE;
  setupQR();

  try {
    await store.start();
  } catch {
    return setupNeeded('room');
  }

  if (!(await store.roomExists(CODE))) return roomGone();
  store.joinPresence(CODE).catch(() => {});

  store.watchRoom(CODE, s => {
    if (!roleKnown) {
      roleKnown = true;
      IS_HOST = s.hostUid === store.myUid();
      applyRole();
    }
    render(s);
  }, roomGone);
}

boot();
