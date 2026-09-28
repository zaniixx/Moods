/* Moods - pure logic. No DOM, no network, no Firebase.
   Everything in here is exercised by tests.html. */

// Codes skip characters that get misread on a screen or read aloud.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function roomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

export const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
export const SPOTIFY_RE = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
export const SC_RE = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+/;
// Only a bare playlist link counts. A watch?v=...&list=... link is someone
// sharing one song they happened to hear inside a playlist.
export const YT_LIST_RE = /youtube\.com\/playlist\?(?:.*&)?list=([A-Za-z0-9_-]+)/;
export const SPOTIFY_LIST_RE = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:playlist|album)\/([A-Za-z0-9]{22})/;

/** What did someone just paste or type? */
export function parseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return { kind: 'empty' };
  if (s.length > 600) return { kind: 'toolong' };

  let m = s.match(YT_LIST_RE);
  if (m) return { kind: 'playlist', platform: 'youtube', ref: m[1],
                  url: 'https://www.youtube.com/playlist?list=' + m[1] };

  m = s.match(SPOTIFY_LIST_RE);
  if (m) return { kind: 'playlist', platform: 'spotify', ref: m[1], url: s };

  m = s.match(YT_RE);
  if (m) return { kind: 'track', platform: 'youtube', ref: m[1],
                  url: 'https://www.youtube.com/watch?v=' + m[1] };

  m = s.match(SPOTIFY_RE);
  if (m) return { kind: 'track', platform: 'spotify', ref: m[1],
                  url: 'https://open.spotify.com/track/' + m[1] };

  m = s.match(SC_RE);
  if (m) return { kind: 'track', platform: 'soundcloud', ref: m[0], url: m[0] };

  if (/^https?:\/\//i.test(s)) return { kind: 'track', platform: 'link', ref: s, url: s };

  return { kind: 'search', text: s };
}

/** YouTube titles are usually "Artist - Song". Pull them apart when we can. */
export function splitTitle(title, artist) {
  if (artist) return [title, artist];
  for (const sep of [' - ', ' – ', ' — ', ' | ']) {
    const i = title.indexOf(sep);
    if (i > 0) return [title.slice(i + sep.length).trim(), title.slice(0, i).trim()];
  }
  return [title, ''];
}

export function cleanName(name) {
  const n = (name || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return n || 'someone';
}

export function score(track) {
  const v = (track && track.votes) || {};
  let n = 0;
  for (const k in v) n += v[k];
  return n;
}

export function tally(track) {
  const v = (track && track.votes) || {};
  let up = 0, down = 0;
  for (const k in v) (v[k] > 0 ? up++ : v[k] < 0 && down++);
  return { up, down };
}

/** Highest score first; a tie goes to whoever asked first. */
export function sortQueue(tracks) {
  return [...tracks].sort((a, b) => (score(b) - score(a)) || (a.ts - b.ts));
}

/**
 * One vote per person. Tapping the arrow you already chose takes it back,
 * so the value you want written is sometimes "nothing at all" (null).
 */
export function nextVote(current, dir) {
  const d = Math.max(-1, Math.min(1, dir | 0));
  if (d === 0 || current === d) return null;
  return d;
}

/** Turn the room object Firebase hands back into something renderable. */
export function readRoom(raw, uid) {
  const room = raw || {};
  const decorate = t => {
    if (!t) return null;
    const { up, down } = tally(t);
    return { ...t, score: score(t), up, down,
             myVote: (t.votes && t.votes[uid]) || 0,
             mine: t.addedByUid === uid };
  };
  const queue = sortQueue(Object.values(room.queue || {})).map(decorate);
  const presence = room.presence || {};
  return {
    code: room.code || '',
    playing: room.playing !== false,
    hostUid: room.hostUid || '',
    createdAt: room.createdAt || 0,
    now: decorate(room.now),
    queue,
    listeners: Object.keys(presence).length,
  };
}

/** Is this already queued (or on the deck)? Re-adding should vote, not duplicate. */
export function findExisting(room, ref) {
  if (room.now && room.now.ref === ref) return { where: 'now', track: room.now };
  const hit = (room.queue || []).find(t => t.ref === ref);
  return hit ? { where: 'queue', track: hit } : null;
}

/** The part of a playlist that isn't queued yet, each song once. */
export function newTracksOnly(room, metas) {
  const seen = new Set();
  return metas.filter(m => {
    if (seen.has(m.ref) || findExisting(room, m.ref)) return false;
    seen.add(m.ref);
    return true;
  });
}

export const ROOM_TTL_MS = 12 * 3600 * 1000;
export const isExpired = (room, now = Date.now()) =>
  !!room.createdAt && (now - room.createdAt) > ROOM_TTL_MS;
