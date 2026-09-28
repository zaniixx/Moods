# Moods

A shared listening room. Put it on whatever's plugged into the speakers, let
everyone scan the QR code, and the queue sorts itself out by vote.

No accounts for your guests, no app to install. It's a static site — it runs on
GitHub Pages with Firebase holding the rooms.

**[Open Moods →](https://YOUR-USERNAME.github.io/moods/)**  ← update after deploying

---

## How a night runs

1. **Open a room** on the machine hooked up to the speakers. You get a
   four-character code and a QR card.
2. **Everyone scans it** with their phone camera. It opens a web page — nothing
   to install, no sign-up.
3. **They paste a link** — YouTube, Spotify, SoundCloud — and Moods looks up the
   title and artwork.
4. **Everyone votes.** Highest score plays next, downvotes bury a track, and a
   tie goes to whoever asked first.

Press `F` to duck the volume when you want to talk over it, `Q` to throw the QR
code up full-screen so the back of the room can scan.

## Setup

You need a free Firebase project. It takes about two minutes.

### 1. Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   **Add project**. Analytics is not needed.
2. **Build → Realtime Database → Create Database.** Pick a location and start in
   **locked mode** — the rules below replace the defaults.
3. **Build → Authentication → Get started → Anonymous → Enable.**
   Every browser signs in anonymously; that's what identifies a vote as yours
   and marks the room's host.
4. **Project settings → General → Your apps → Web (`</>`)**, register the app,
   and copy the `firebaseConfig` values.

### 2. Paste the config

Put those values in [`js/config.js`](js/config.js):

```js
export const FIREBASE = {
  apiKey:      "AIza…",
  authDomain:  "moods-1234.firebaseapp.com",
  databaseURL: "https://moods-1234-default-rtdb.firebaseio.com",
  projectId:   "moods-1234",
  appId:       "1:…:web:…",
};
```

These are meant to be public. They identify the project; they don't grant
access. Access is decided by the rules below.

### 3. Set the database rules

**Realtime Database → Rules**, paste this, and publish:

```json
{
  "rules": {
    "rooms": {
      "$code": {
        ".read": true,
        ".write": "auth != null && (!data.exists() || data.child('hostUid').val() === auth.uid)",

        "code":      { ".validate": "newData.val() === $code" },
        "hostUid":   { ".validate": "newData.isString() && newData.val() === auth.uid" },
        "playing":   { ".validate": "newData.isBoolean()" },
        "createdAt": { ".validate": "newData.isNumber()" },

        "now": {
          "votes": {
            "$uid": {
              ".write": "auth != null && $uid === auth.uid",
              ".validate": "newData.val() === 1 || newData.val() === -1"
            }
          }
        },

        "queue": {
          "$track": {
            ".write": "auth != null && ((!data.exists() && newData.exists()) || (data.exists() && !newData.exists() && root.child('rooms').child($code).child('hostUid').val() === auth.uid))",
            ".validate": "newData.hasChildren(['title','platform','ref','addedByUid','ts'])",

            "addedByUid": { ".validate": "newData.val() === auth.uid" },
            "addedBy":    { ".validate": "newData.isString() && newData.val().length <= 18" },
            "title":      { ".validate": "newData.isString() && newData.val().length <= 200" },
            "artist":     { ".validate": "newData.isString() && newData.val().length <= 200" },
            "url":        { ".validate": "newData.isString() && newData.val().length <= 600" },
            "thumb":      { ".validate": "newData.isString() && newData.val().length <= 600" },
            "ref":        { ".validate": "newData.isString() && newData.val().length <= 600" },
            "platform":   { ".validate": "newData.val() === 'youtube' || newData.val() === 'spotify' || newData.val() === 'soundcloud' || newData.val() === 'link'" },
            "ts":         { ".validate": "newData.isNumber()" },
            "id":         { ".validate": "newData.val() === $track" },

            "votes": {
              "$uid": {
                ".write": "auth != null && $uid === auth.uid",
                ".validate": "newData.val() === 1 || newData.val() === -1"
              }
            },
            "$other": { ".validate": false }
          }
        },

        "presence": {
          "$uid": {
            ".write": "auth != null && $uid === auth.uid",
            ".validate": "newData.isNumber()"
          }
        }
      }
    }
  }
}
```

What these actually enforce:

- **Only the room's creator can skip, remove or close it.** `hostUid` is written
  once at creation and can only ever be set to your own uid, so nobody can
  rewrite themselves into the host seat.
- **A vote can only be cast under your own uid**, and can only be `1` or `-1`.
- **A queued track can be created but never edited** — only the host can delete
  one. Without that, whoever added a song could rewrite its `votes` afterwards
  and quietly boost themselves.
- **Fields are shape- and length-checked**, and `$other` rejects anything not
  listed, so the room can't be used as free storage for someone else's data.

### 4. Deploy

Push to GitHub, then **Settings → Pages → Source: GitHub Actions**. The included
workflow publishes the repo as-is on every push to `main`.

Or serve it yourself — it's just files:

```
python3 -m http.server 8080
```

## Optional: typing a song name

Pasting links needs nothing extra. If you also want people to type
`weird fishes radiohead` and have it resolve, add a YouTube key:

1. In the [Google Cloud console](https://console.cloud.google.com) for the same
   project, enable **YouTube Data API v3**.
2. Create an API key and restrict it to your Pages domain.
3. Put it in `js/config.js` as `YOUTUBE_API_KEY`.

Without a key the composer just says "paste a link" and everything else works.
This is the one thing that can't be done from the browser alone — YouTube's
search results page doesn't send CORS headers, unlike their oEmbed endpoint.

## What you can queue

| You paste | What happens |
|---|---|
| A YouTube link (`youtube.com/watch`, `youtu.be`, Shorts, Music) | Plays in full, advances on its own |
| A Spotify track link | Plays through Spotify's embed — see below |
| A SoundCloud track link | Queued with title and artwork |
| Any other link | Queued under its hostname; open it and hit skip when it's done |
| Plain text, e.g. `weird fishes radiohead` | Needs the optional YouTube key above |

Re-adding a song that's already queued doesn't duplicate it — it counts as an
upvote for the one that's there.

**About Spotify:** their embed only plays a 30-second preview unless the browser
running the room is signed in to Spotify Premium. For full tracks with no fuss,
YouTube links are the reliable path. The room says so on screen too.

## The host's screen

- **Play/pause** and **skip** sit under the record.
- **Focus** ducks the music to a preset level so people can hear each other, and
  puts it back exactly where it was. Drag the slider to taste; it's remembered.
  (`F` toggles it. YouTube only — Spotify's embed won't take a volume command.)
- **×** next to a queued track drops it.
- **Video** switches the background between a blurred ambient wash and the
  actual music video, grayscale either way.
- Opening the same room link on a second screen gives a **read-only display** —
  it mirrors the room but never plays audio, so two screens can't talk over each
  other. Only the browser that opened the room can control it.

## Tests

Two of them.

`python3 smoke-test.py` runs against your live Firebase project: it signs two
browsers in anonymously, creates a room, queues and votes, and then checks that
the rules actually refuse a guest trying to seize the room, vote as someone
else, forge votes on a track, or exceed the field limits. It cleans up after
itself. Run it once after setup and you'll know the whole path works.

Open [`tests.html`](tests.html) in a browser. It runs the logic — link parsing,
vote arithmetic, ordering and tie-breaks, room decoding, duplicate detection —
and prints a pass/fail summary at the top. No build step, no test runner.

## How it works

- **Static front end.** Three pages and a handful of ES modules. Nothing is
  compiled or bundled.
- **[`js/lib.js`](js/lib.js)** is pure logic with no DOM, network or Firebase in
  it — which is what makes `tests.html` possible.
- **[`js/store.js`](js/store.js)** is the only file that talks to Firebase. A
  room is one object; every client subscribes to it and re-renders on change, so
  there's no polling anywhere.
- **[`js/resolve.js`](js/resolve.js)** turns a link into a track entirely in the
  browser. YouTube, Spotify and SoundCloud all send CORS headers on their oEmbed
  endpoints, so no backend is involved.
- **The QR code** is generated locally by a vendored copy of `qrcode-generator`
  (MIT) and points at whatever address the room page was opened on — so on a
  laptop at `192.168.x.x` it hands phones the LAN address, and on Pages it hands
  them the public one.
- **Presence** uses Firebase's `onDisconnect`, so the listener count drops by
  itself when a tab closes.

```
index.html      landing: open a room, or join by code
room.html       the host screen: deck, players, QR
join.html       the phone: suggest and vote
tests.html      logic tests
js/
  config.js     your Firebase project (the only file you edit)
  lib.js        pure logic
  store.js      Firebase: rooms, queue, votes, presence
  resolve.js    link -> track metadata
  ui.js         toasts and the animated queue list
  room.js       host screen
  join.js       phone
assets/         stylesheet, favicon, vendored QR generator
```

## Is it safe to publish the config?

Yes — and you have to, since it's a static site.

The `apiKey` in `js/config.js` is **not a secret**. Firebase web API keys
identify your project; they don't authorise anything. Every Firebase web app
ships one in its client bundle. Access is decided entirely by the database
rules above, never by the key.

What *is* secret, and must never go in the repo:

- a **service account JSON** (full project admin)
- the **OAuth token** the Firebase CLI or VS Code extension stores after login
  (`~/.config/configstore/firebase-tools.json`)
- any **Google account password**

None of those are needed to run Moods.

Two things worth doing anyway:

- **Restrict the keys.** Google Cloud console → APIs & Services → Credentials →
  your key → *Application restrictions* → **HTTP referrers**, set to your Pages
  domain. This matters most for the optional `YOUTUBE_API_KEY`, which has a real
  daily quota someone could otherwise burn on your behalf.
- **Consider App Check** if the room link ever goes properly public. The rules
  stop people forging votes or hijacking a room, but anything signed in
  anonymously can still create rooms, and anonymous sign-in is open by design.

The honest trust model: anyone with the four-character code can read the room,
queue songs and vote. That's the point at a party. The rules stop impersonation
and hijacking — they don't stop someone queueing something dreadful.

## Known limits

- Spotify entries show the track title but no artist — Spotify's oEmbed doesn't
  return one, and their pages don't expose it to a plain fetch.
- Rooms aren't garbage collected. They're a few kilobytes each and the join page
  refuses anything older than 12 hours, but nothing deletes them for you. The
  free tier has room for a great many parties.
- The trust model is deliberately loose — see
  [Is it safe to publish the config?](#is-it-safe-to-publish-the-config) above.
- An earlier version ran on a Python server with no external services, for
  offline/LAN use. It's in the first commit if you ever want it back.
