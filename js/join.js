/* Moods - the phone: suggest a song and vote on everyone else's. */

import { $, ls, toast, renderQueue, setupNeeded } from './ui.js';
import * as store from './store.js';
import { configured } from './config.js';
import { resolve, searchAvailable } from './resolve.js';

const params = new URLSearchParams(location.search);
const CODE = (params.get('r') || '').toUpperCase();

let state = null;
let myName = ls.get('moods.name', '');

/* -------------------------------------------------------------- name ---- */

const gate = $('#gate');
if (myName) gate.classList.add('gone');

$('#nameForm').onsubmit = e => {
  e.preventDefault();
  const v = $('#name').value.trim().slice(0, 18);
  if (!v) { $('#name').focus(); return; }
  myName = v;
  ls.set('moods.name', v);
  gate.classList.add('gone');
  setTimeout(() => $('#q').focus(), 350);
};

/* --------------------------------------------------------------- add ---- */

const form = $('#addForm'), input = $('#q'), go = $('#go'), hint = $('#hint');
const HINT = searchAvailable()
  ? 'YouTube · Spotify · SoundCloud · or just a song name'
  : 'Paste a YouTube, Spotify or SoundCloud link';
let busy = false;

form.onsubmit = async e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || busy) return;

  busy = true;
  go.disabled = true;
  go.innerHTML = '<span class="spinner"></span>';
  hint.textContent = 'Looking it up…';

  try {
    const meta = await resolve(q);
    const r = await store.addTrack(CODE, meta, myName);
    input.value = '';
    input.blur();
    buzz(14);
    if (r.merged) toast(r.message);
    else toast(`Queued “${r.track.title}”`);
  } catch (err) {
    toast(err.message || 'That did not work.', true);
    buzz([8, 40, 8]);
  } finally {
    busy = false;
    go.disabled = false;
    go.textContent = '↑';
    hint.textContent = HINT;
  }
};

input.addEventListener('paste', () => setTimeout(() => {
  if (/^https?:\/\//.test(input.value.trim())) form.requestSubmit();
}, 30));

function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

/* -------------------------------------------------------------- vote ---- */

async function vote(track, dir) {
  buzz(8);

  // Move the UI now; Firebase echoes the real value back a beat later.
  const t = state && state.queue.find(x => x.id === track.id);
  if (t) {
    const was = t.myVote;
    const next = was === dir ? 0 : dir;
    t.score += next - was;
    if (next === 1) t.up++; else if (was === 1) t.up--;
    if (next === -1) t.down++; else if (was === -1) t.down--;
    t.myVote = next;
    paint(state);
  }

  try {
    await store.vote(CODE, track.id, dir, track.myVote);
  } catch (e) {
    toast(e.message || 'Vote did not save.', true);
  }
}

/* ------------------------------------------------------------ render ---- */

const queueEl = $('#queue'), qEmpty = $('#qEmpty');

function paint(s) {
  const n = s.queue.length;
  $('#qCount').textContent = n ? `${n} song${n === 1 ? '' : 's'}` : '';
  qEmpty.hidden = n > 0;
  renderQueue(queueEl, s.queue, { onVote: vote });

  const now = s.now;
  $('#nowWrap').hidden = !now;
  if (now) {
    $('#nowTitle').textContent = now.title;
    $('#nowArtist').textContent =
      [now.artist, 'added by ' + now.addedBy].filter(Boolean).join('  ·  ');
    $('#mini').classList.toggle('spinning', !!s.playing);
    $('#nowLabel').classList.toggle('paused', !s.playing);

    const art = $('#miniArt');
    if (now.thumb && art.dataset.src !== now.thumb) {
      art.dataset.src = now.thumb;
      art.src = now.thumb;
      art.hidden = false;
    } else if (!now.thumb) {
      art.hidden = true;
    }
  }
}

function roomGone() {
  document.body.innerHTML =
    '<div style="display:grid;place-items:center;min-height:100dvh;text-align:center;padding:30px">' +
    '<div><h2 style="font-size:26px;margin-bottom:10px">Room\'s closed</h2>' +
    '<p style="color:#63636b;margin-bottom:22px">Ask whoever started it for a fresh code.</p>' +
    '<a class="btn" href="./">Back to the start</a></div></div>';
}

/* ---------------------------------------------------------------- boot -- */

async function boot() {
  if (!configured()) return setupNeeded('join');
  if (!/^[A-Z0-9]{4}$/.test(CODE)) { location.href = './'; return; }

  $('#code').textContent = CODE;
  document.title = `Moods — room ${CODE}`;
  hint.textContent = HINT;
  if (!searchAvailable()) input.placeholder = 'Paste a link';

  try {
    await store.start();
  } catch {
    return setupNeeded('join');
  }

  if (!(await store.roomExists(CODE))) return roomGone();
  store.joinPresence(CODE).catch(() => {});

  store.watchRoom(CODE, s => { state = s; paint(s); }, roomGone);
}

boot();
