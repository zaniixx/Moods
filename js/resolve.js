/* Moods - turn a pasted link (or a typed song name) into a playable track.
   Runs entirely in the browser: YouTube, Spotify and SoundCloud all send
   CORS headers on their oEmbed endpoints, so no backend is involved. */

import { parseInput, splitTitle } from './lib.js';
import { YOUTUBE_API_KEY } from './config.js';

const TIMEOUT = 8000;

async function getJSON(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

async function youtube(id) {
  const url = 'https://www.youtube.com/watch?v=' + id;
  let title = id, artist = '';
  let thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const d = await getJSON('https://www.youtube.com/oembed?format=json&url=' + enc(url));
    [title, artist] = splitTitle(d.title || id, '');
    const chan = (d.author_name || '').trim();
    // "Artist - Topic" channels are auto-generated music uploads
    if (chan.endsWith(' - Topic')) artist = chan.slice(0, -8).trim();
    else if (!artist) artist = chan;
    if (d.thumbnail_url) thumb = d.thumbnail_url;
  } catch { /* the id alone still plays */ }
  return { platform: 'youtube', ref: id, url, title, artist, thumb };
}

async function spotify(id) {
  const url = 'https://open.spotify.com/track/' + id;
  let title = 'Spotify track', artist = '', thumb = '';
  try {
    const d = await getJSON('https://open.spotify.com/oembed?url=' + enc(url));
    [title, artist] = splitTitle(d.title || title, '');
    thumb = d.thumbnail_url || '';
  } catch {}
  return { platform: 'spotify', ref: id, url, title, artist, thumb };
}

async function soundcloud(url) {
  let title = 'SoundCloud track', artist = '', thumb = '';
  try {
    const d = await getJSON('https://soundcloud.com/oembed?format=json&url=' + enc(url));
    [title, artist] = splitTitle(d.title || title, (d.author_name || '').trim());
    thumb = d.thumbnail_url || '';
  } catch {}
  return { platform: 'soundcloud', ref: url, url, title, artist, thumb };
}

function bareLink(url) {
  // Scraping og: tags would need a server, so show the host and let the
  // room open it manually.
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  return { platform: 'link', ref: url, url, title: host, artist: '', thumb: '' };
}

/** Typing a song name needs the YouTube Data API - the results page blocks CORS. */
export async function searchYouTube(text) {
  if (!YOUTUBE_API_KEY) {
    throw new Error('Paste a link — typing a song name needs a YouTube API key.');
  }
  const u = 'https://www.googleapis.com/youtube/v3/search'
          + '?part=snippet&type=video&maxResults=1&videoCategoryId=10'
          + '&q=' + enc(text) + '&key=' + enc(YOUTUBE_API_KEY);
  let d;
  try {
    d = await getJSON(u);
  } catch {
    throw new Error("Couldn't search right now. Try pasting a link.");
  }
  const hit = d.items && d.items[0];
  if (!hit) throw new Error("Couldn't find that one. Try pasting a link instead.");
  return youtube(hit.id.videoId);
}

export const searchAvailable = () => !!YOUTUBE_API_KEY;

/* Suggestions come from the iTunes catalogue: no key, no quota, and it sends
   CORS headers. Each YouTube search costs 1% of the daily quota, so it only
   runs once someone actually picks a song. */
const suggestCache = new Map();

export async function suggest(text) {
  const q = text.trim().toLowerCase();
  if (suggestCache.has(q)) return suggestCache.get(q);
  const d = await getJSON('https://itunes.apple.com/search?media=music&entity=song&limit=6&term=' + enc(q));
  const list = (d.results || []).map(r => ({
    title: r.trackName || '',
    artist: r.artistName || '',
    // 100px art is the default; the same URL serves any size
    thumb: (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
  })).filter(r => r.title);
  suggestCache.set(q, list);
  return list;
}

/** A picked suggestion: play the YouTube match, keep the catalogue's clean names. */
export async function resolvePick(s) {
  const yt = await searchYouTube(`${s.artist} ${s.title}`);
  return { ...yt, title: s.title, artist: s.artist, thumb: s.thumb || yt.thumb };
}

export const MAX_PLAYLIST = 50;

/** Every playable song in a YouTube playlist, up to MAX_PLAYLIST. */
export async function resolvePlaylist(raw) {
  const p = parseInput(raw);
  if (p.kind !== 'playlist') throw new Error("That isn't a playlist link.");
  if (p.platform === 'spotify') {
    throw new Error("Spotify playlists need a Spotify login. Try a YouTube playlist.");
  }
  if (!YOUTUBE_API_KEY) throw new Error('Playlists need a YouTube API key.');

  const u = 'https://www.googleapis.com/youtube/v3/playlistItems'
          + '?part=snippet&maxResults=' + MAX_PLAYLIST
          + '&playlistId=' + enc(p.ref) + '&key=' + enc(YOUTUBE_API_KEY);
  let d;
  try {
    d = await getJSON(u);
  } catch {
    // Mixes (RD...) and private playlists come back 404 as well
    throw new Error("Couldn't open that playlist. Is it public?");
  }

  const tracks = [];
  for (const it of d.items || []) {
    const sn = it.snippet || {};
    const id = sn.resourceId && sn.resourceId.videoId;
    if (!id || sn.title === 'Private video' || sn.title === 'Deleted video') continue;
    let [title, artist] = splitTitle(sn.title || id, '');
    const chan = (sn.videoOwnerChannelTitle || '').trim();
    if (chan.endsWith(' - Topic')) artist = chan.slice(0, -8).trim();
    else if (!artist) artist = chan;
    const th = sn.thumbnails || {};
    const thumb = (th.high || th.medium || th.default || {}).url
               || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    tracks.push({ platform: 'youtube', ref: id,
                  url: 'https://www.youtube.com/watch?v=' + id, title, artist, thumb });
  }
  if (!tracks.length) throw new Error('That playlist has nothing playable in it.');
  return tracks;
}

export async function resolve(raw) {
  const p = parseInput(raw);
  switch (p.kind) {
    case 'empty':   throw new Error('Give me a link or a song name.');
    case 'toolong': throw new Error("That's too long to be a link.");
    case 'search':  return searchYouTube(p.text);
    case 'playlist': throw new Error('That is a playlist link.');
    case 'track':
      if (p.platform === 'youtube')    return youtube(p.ref);
      if (p.platform === 'spotify')    return spotify(p.ref);
      if (p.platform === 'soundcloud') return soundcloud(p.url);
      return bareLink(p.url);
  }
  throw new Error("I couldn't make sense of that.");
}
