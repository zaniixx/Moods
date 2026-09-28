/* Moods - the phone: suggest a song and vote on everyone else's. */

import { $, ls, toast, renderQueue, setupNeeded } from './ui.js';
import * as store from './store.js';
import { configured } from './config.js';
import { resolve, resolvePick, resolvePlaylist, suggest, searchAvailable, MAX_PLAYLIST } from './resolve.js';
import { parseInput } from './lib.js';

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
const sugEl = $('#sugs');
const HINT = searchAvailable()
  ? 'Type a song · or paste a YouTube, Spotify, SoundCloud link or playlist'
  : 'Paste a YouTube, Spotify or SoundCloud link';
let busy = false;

/** Spinner, toast and error handling around anything that adds songs. */
async function run(task) {
  if (busy) return;
  busy = true;
  hideSugs();
  go.disabled = true;
  go.innerHTML = '<span class="spinner"></span>';
  hint.textContent = 'Looking it up…';

  try {
    const msg = await task();
    if (msg === null) return;          // they backed out
    input.value = '';
    input.blur();
    buzz(14);
    toast(msg);
  } catch (err) {
    toast(err.message || 'That did not work.', true);
    buzz([8, 40, 8]);
  } finally {
    busy = false;
    go.disabled = false;
    go.textContent = '↑';
    hint.textContent = HINT;
  }
}

async function addOne(getMeta) {
  const r = await store.addTrack(CODE, await getMeta(), myName);
  return r.merged ? r.message : `Queued “${r.track.title}”`;
}

async function addPlaylist(q) {
  const tracks = await resolvePlaylist(q);
  const more = tracks.length === MAX_PLAYLIST ? ` (the first ${MAX_PLAYLIST})` : '';
  if (!confirm(`Add ${tracks.length} songs from this playlist${more}?`)) return null;
  const { added, skipped } = await store.addTracks(CODE, tracks, myName);
  if (!added) return 'Everything in that playlist is already queued.';
  return `Queued ${added} song${added === 1 ? '' : 's'}`
       + (skipped ? ` · ${skipped} already there` : '');
}

form.onsubmit = e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  if (active >= 0 && sugs[active]) return pick(sugs[active]);
  run(() => parseInput(q).kind === 'playlist' ? addPlaylist(q) : addOne(() => resolve(q)));
};

input.addEventListener('paste', () => setTimeout(() => {
  if (/^https?:\/\//.test(input.value.trim())) form.requestSubmit();
}, 30));

/* ------------------------------------------------------- suggestions ---- */

let sugs = [], active = -1, sugTimer = null, sugSeq = 0;

function hideSugs() {
  clearTimeout(sugTimer);
  sugSeq++;                          // anything still in flight is stale now
  sugs = []; active = -1;
  sugEl.hidden = true;
  sugEl.innerHTML = '';
  input.removeAttribute('aria-activedescendant');
}

function pick(s) {
  run(() => addOne(() => resolvePick(s)));
}

function paintSugs() {
  sugEl.innerHTML = '';
  sugs.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'sug' + (i === active ? ' on' : '');
    li.id = 'sug' + i;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === active ? 'true' : 'false');

    const art = document.createElement(s.thumb ? 'img' : 'span');
    art.className = 'art';
    if (s.thumb) { art.src = s.thumb; art.alt = ''; }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 't truncate';
    t.textContent = s.title;
    const a = document.createElement('div');
    a.className = 's truncate';
    a.textContent = s.artist;
    meta.append(t, a);
    li.append(art, meta);

    li.onclick = () => pick(s);
    sugEl.appendChild(li);
  });
  sugEl.hidden = !sugs.length;
  if (active >= 0) input.setAttribute('aria-activedescendant', 'sug' + active);
  else input.removeAttribute('aria-activedescendant');
}

input.addEventListener('input', () => {
  const q = input.value.trim();
  clearTimeout(sugTimer);
  if (!searchAvailable() || q.length < 2 || parseInput(q).kind !== 'search') return hideSugs();
  const seq = ++sugSeq;
  sugTimer = setTimeout(async () => {
    let list = [];
    try { list = await suggest(q); } catch { /* Enter still searches YouTube */ }
    if (seq !== sugSeq || busy) return;
    sugs = list; active = -1;
    paintSugs();
  }, 280);
});

input.addEventListener('keydown', e => {
  if (sugEl.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = sugs.length, step = e.key === 'ArrowDown' ? 1 : -1;
    active = active < 0 ? (step > 0 ? 0 : n - 1) : (active + step + n) % n;
    paintSugs();
  } else if (e.key === 'Escape') {
    hideSugs();
  }
});

// Keep focus in the field while tapping a suggestion, so the keyboard stays up.
sugEl.addEventListener('pointerdown', e => e.preventDefault());
input.addEventListener('blur', () => setTimeout(() => { if (!busy) hideSugs(); }, 150));

function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

/* -------------------------------------------------------------- vote ---- */

async function vote(track, dir) {
  buzz(8);

  // Move the UI now; Firebase echoes the real value back a beat later.
  const t = state && state.queue.find(x => x.id === track.id);
  const was = track.myVote;
  if (t) {
    const next = was === dir ? 0 : dir;
    t.score += next - was;
    if (next === 1) t.up++; else if (was === 1) t.up--;
    if (next === -1) t.down++; else if (was === -1) t.down--;
    t.myVote = next;
    paint(state);
  }

  try {
    await store.vote(CODE, track.id, dir, was);
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
  input.placeholder = searchAvailable() ? 'Type a song, or paste a link' : 'Paste a link';

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
