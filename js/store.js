/* Moods - all shared state, on Firebase Realtime Database.

   Every browser signs in anonymously, which gives it a stable uid. That uid
   is what the database rules check: the room records whoever created it as
   hostUid, and only they can move the needle. */

import { FIREBASE, configured } from './config.js';
import { roomCode, readRoom, nextVote, cleanName, findExisting, newTracksOnly, isExpired } from './lib.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';

let fb = null;          // the SDK, pulled in on first use
let db = null, uid = null, ready = null;

/**
 * Boots Firebase and signs in. Resolves with this browser's uid.
 * The SDK is imported on demand so the landing page doesn't pay for it.
 */
export function start() {
  if (ready) return ready;
  if (!configured()) return Promise.reject(new Error('NOT_CONFIGURED'));
  ready = (async () => {
    const [app_, auth_, db_] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-database.js'),
    ]);
    fb = { ...app_, ...auth_, ...db_ };

    const app = fb.initializeApp(FIREBASE);
    db = fb.getDatabase(app);
    const auth = fb.getAuth(app);
    await fb.signInAnonymously(auth);
    uid = await new Promise(res => {
      const off = fb.onAuthStateChanged(auth, u => { if (u) { off(); res(u.uid); } });
    });
    return uid;
  })();
  return ready;
}

export const myUid = () => uid;

const roomRef = code => fb.ref(db, 'rooms/' + code);

export async function createRoom() {
  await start();
  for (let i = 0; i < 40; i++) {
    const code = roomCode();
    const snap = await fb.get(roomRef(code));
    if (snap.exists()) continue;
    await fb.set(roomRef(code), {
      code,
      hostUid: uid,
      playing: true,
      createdAt: fb.serverTimestamp(),
    });
    return code;
  }
  throw new Error('Could not find a free room code. Try again.');
}

export async function roomExists(code) {
  await start();
  const snap = await fb.get(roomRef(code));
  // A stale room is treated as gone. Nothing deletes them server-side, so
  // this is what stops last week's code from still opening a dead room.
  return snap.exists() && !isExpired(snap.val());
}

/** Live view of a room. Returns an unsubscribe function. */
export function watchRoom(code, cb, onMissing) {
  return fb.onValue(roomRef(code), snap => {
    if (!snap.exists()) { onMissing && onMissing(); return; }
    cb(readRoom(snap.val(), uid));
  }, () => onMissing && onMissing());
}

/** Say you're here, and have Firebase clear it when this tab goes away. */
export async function joinPresence(code) {
  await start();
  const me = fb.ref(db, `rooms/${code}/presence/${uid}`);
  await fb.set(me, fb.serverTimestamp());
  fb.onDisconnect(me).remove();
}

export async function addTrack(code, meta, name) {
  await start();
  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) throw new Error('That room has closed.');
  const room = readRoom(snap.val(), uid);

  // Re-adding something already queued is an upvote, not a duplicate.
  const dupe = findExisting(room, meta.ref);
  if (dupe) {
    if (dupe.track.myVote === 1) {
      return { merged: true, message: "That one's already in the queue." };
    }
    const path = dupe.where === 'now'
      ? `rooms/${code}/now/votes/${uid}`
      : `rooms/${code}/queue/${dupe.track.id}/votes/${uid}`;
    await fb.set(fb.ref(db, path), 1);
    return { merged: true, message: 'Already queued — counted your vote.' };
  }

  const track = makeTrack(code, meta, name, Date.now());

  // Always append, never write `now` directly. Only the host may touch the
  // room node, and the first person to queue anything is usually a guest -
  // writing straight to the platter would be refused by the rules. The host
  // screen promotes it off an empty deck within a beat (see kick() there).
  await fb.set(fb.ref(db, `rooms/${code}/queue/${track.id}`), track);
  return { track };
}

function makeTrack(code, meta, name, ts) {
  return {
    id: fb.push(fb.ref(db, `rooms/${code}/queue`)).key,
    url: meta.url, platform: meta.platform, ref: meta.ref,
    title: meta.title, artist: meta.artist || '', thumb: meta.thumb || '',
    addedBy: cleanName(name), addedByUid: uid,
    ts,
    votes: { [uid]: 1 },          // you back your own pick
  };
}

/** Queue a whole playlist in one write, skipping anything already there. */
export async function addTracks(code, metas, name) {
  await start();
  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) throw new Error('That room has closed.');
  const fresh = newTracksOnly(readRoom(snap.val(), uid), metas);

  // One ms apart keeps the playlist's order among equal scores.
  const t0 = Date.now(), batch = {};
  fresh.forEach((m, i) => {
    const t = makeTrack(code, m, name, t0 + i);
    batch[t.id] = t;
  });
  if (fresh.length) await fb.update(fb.ref(db, `rooms/${code}/queue`), batch);
  return { added: fresh.length, skipped: metas.length - fresh.length };
}

export async function vote(code, trackId, dir, current) {
  await start();
  const want = nextVote(current, dir);
  const path = fb.ref(db, `rooms/${code}/queue/${trackId}/votes/${uid}`);
  if (want === null) await fb.remove(path);
  else await fb.set(path, want);
}

/* ---- host only: the rules reject these from anyone else ---------------- */

export async function playNext(code) {
  await start();
  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) return;
  const raw = snap.val();
  const winnerId = readRoom(raw, uid).queue[0]?.id;   // sorted by score, then age
  // Write the stored record, not the decorated one: score/myVote/mine are
  // derived per viewer and have no business being saved.
  const winner = winnerId ? raw.queue[winnerId] : null;
  // One write, so no one ever sees the winner both on the deck and queued.
  const patch = { now: winner || null, playing: true };
  if (winnerId) patch['queue/' + winnerId] = null;
  await fb.update(roomRef(code), patch);
}

export async function removeTrack(code, id) {
  await start();
  const snap = await fb.get(roomRef(code));
  if (snap.exists() && readRoom(snap.val(), uid).now?.id === id) return playNext(code);
  await fb.remove(fb.ref(db, `rooms/${code}/queue/${id}`));
}

export async function setPlaying(code, playing) {
  await start();
  await fb.update(roomRef(code), { playing: !!playing });
}

export async function closeRoom(code) {
  await start();
  await fb.remove(roomRef(code));
}
