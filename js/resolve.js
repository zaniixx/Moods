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
async function search(text) {
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

export async function resolve(raw) {
  const p = parseInput(raw);
  switch (p.kind) {
    case 'empty':   throw new Error('Give me a link or a song name.');
    case 'toolong': throw new Error("That's too long to be a link.");
    case 'search':  return search(p.text);
    case 'track':
      if (p.platform === 'youtube')    return youtube(p.ref);
      if (p.platform === 'spotify')    return spotify(p.ref);
      if (p.platform === 'soundcloud') return soundcloud(p.url);
      return bareLink(p.url);
  }
  throw new Error("I couldn't make sense of that.");
}
