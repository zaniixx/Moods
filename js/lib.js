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

/** A vote is stored as { v: 1 | -1, name }. Bare numbers predate the names. */
export const voteValue = x => (typeof x === 'number' ? x : (x && x.v) || 0);

export function score(track) {
  const v = (track && track.votes) || {};
  let n = 0;
  for (const k in v) n += voteValue(v[k]);
  return n;
}

/** How many each way, and who: the name each vote was stamped with. */
export function tally(track) {
  const v = (track && track.votes) || {};
  let up = 0, down = 0;
  const upBy = [], downBy = [];
  for (const k in v) {
    const val = voteValue(v[k]), name = v[k] && v[k].name;
    if (val > 0) { up++; if (name) upBy.push(name); }
    else if (val < 0) { down++; if (name) downBy.push(name); }
  }
  return { up, down, upBy, downBy };
}

/** "▲ Alice, Bob   ▼ Dan" - who's behind a song's score. */
export function voterLine(t) {
  const bits = [];
  if (t.upBy && t.upBy.length) bits.push('▲ ' + t.upBy.join(', '));
  if (t.downBy && t.downBy.length) bits.push('▼ ' + t.downBy.join(', '));
  return bits.join('   ');
}

/**
 * Two tiers. Songs still to play come first: highest score, then whoever
 * asked first. Played songs follow in the order they'll come back round:
 * highest score, then whichever played longest ago.
 */
export function sortQueue(tracks) {
  return [...tracks].sort((a, b) =>
    (!!a.playedAt - !!b.playedAt) ||
    (score(b) - score(a)) ||
    (a.playedAt ? a.playedAt - b.playedAt : a.ts - b.ts));
}

// Votes and play stamps belong to one trip through the queue, not the song.
function bare(track) {
  const { votes, playedAt, startedAt, ...rest } = track;
  return rest;
}

/** Onto the deck. `startedAt` tells a repeat apart from the last play. */
export const asPlaying = (track, at) => ({ ...bare(track), startedAt: at });

/** Into the played queue, votes back to zero. */
export const asPlayed = (track, at) => ({ ...bare(track), playedAt: at });

/**
 * What goes on after the current song. Anything not yet played beats
 * everything that has; played songs only come back once nothing else is
 * left. A room with a single song just repeats it.
 */
export function pickNext(room) {
  return (room.queue && room.queue[0]) || room.now || null;
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
    return { ...t, ...tally(t), score: score(t),
             myVote: voteValue(t.votes && t.votes[uid]),
             mine: t.addedByUid === uid,
             played: !!t.playedAt };
  };
  const queue = sortQueue(Object.values(room.queue || {})).map(decorate);
  const presence = room.presence || {};
  return {
    code: room.code || '',
    playing: room.playing !== false,
    hostUid: room.hostUid || '',
    createdAt: room.createdAt || 0,
    now: decorate(room.now),
    queue,                                    // everything, in play order
    upNext: queue.filter(t => !t.played),
    played: queue.filter(t => t.played),
    listeners: Object.keys(presence).length,
  };
}

/** Is this already queued, played, or on the deck? Re-adding should vote, not duplicate. */
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
