#!/usr/bin/env python3
"""Live check against the real Firebase project, over the REST API.
Proves anonymous auth works, the app's writes are permitted, and the
security rules refuse what they're supposed to refuse."""
import json, random, string, sys, time, urllib.error, urllib.request

KEY = "AIzaSyBDQgReck8DpIKCBROHdlJC-GZybO-EKVY"
DB  = "https://moods-53eed-default-rtdb.europe-west1.firebasedatabase.app"
ok = fail = 0

def call(url, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw

def t(label, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  \033[32m✓\033[0m {label}")
    else:    fail += 1; print(f"  \033[31m✗\033[0m {label}   \033[2m{extra}\033[0m")

def signin(who):
    s, d = call(f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={KEY}",
                {"returnSecureToken": True})
    if s != 200:
        msg = (d or {}).get("error", {}).get("message", d)
        print(f"\n  \033[31mAnonymous sign-in failed: {msg}\033[0m")
        if msg in ("ADMIN_ONLY_OPERATION", "OPERATION_NOT_ALLOWED"):
            print("  → Firebase console → Authentication → Sign-in method → Anonymous → Enable\n")
        sys.exit(1)
    print(f"  {who} signed in as {d['localId'][:12]}…")
    return d["idToken"], d["localId"]

def put(path, tok, val):    return call(f"{DB}/{path}.json?auth={tok}", val, "PUT")
def patch(path, tok, val):  return call(f"{DB}/{path}.json?auth={tok}", val, "PATCH")
def delete(path, tok):      return call(f"{DB}/{path}.json?auth={tok}", None, "DELETE")
def get(path, tok=None):
    return call(f"{DB}/{path}.json" + (f"?auth={tok}" if tok else ""))

print("\n\033[1mauthentication\033[0m")
hostTok, hostUid = signin("host ")
guestTok, guestUid = signin("guest")
t("anonymous sign-in is enabled", True)
t("two browsers get distinct uids", hostUid != guestUid)

CODE = "T" + "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(3))
print(f"\n\033[1mroom {CODE}\033[0m")

s, d = put(f"rooms/{CODE}", hostTok,
           {"code": CODE, "hostUid": hostUid, "playing": True, "createdAt": int(time.time()*1000)})
t("host can create a room", s == 200, d)
if s != 200:
    print("\n  \033[33mIf this says 'Permission denied', the rules from the README"
          "\n  haven't been published yet (a locked-mode database denies everything).\033[0m\n")
    sys.exit(1)

s, d = get(f"rooms/{CODE}")
t("a room is readable without a token", s == 200 and d and d.get("code") == CODE, d)

print("\n\033[1mwhat a guest is allowed to do\033[0m")
tid = "-Ntest" + "".join(random.choice(string.ascii_letters) for _ in range(6))
track = {"id": tid, "title": "Test Track", "artist": "Nobody", "url": "https://youtu.be/dQw4w9WgXcQ",
         "thumb": "", "ref": "dQw4w9WgXcQ", "platform": "youtube",
         "addedBy": "Guest", "addedByUid": guestUid, "ts": int(time.time()*1000),
         "votes": {guestUid: 1}}
s, d = put(f"rooms/{CODE}/queue/{tid}", guestTok, track)
t("guest can queue a song", s == 200, d)

s, d = put(f"rooms/{CODE}/queue/{tid}/votes/{hostUid}", hostTok, 1)
t("host can upvote it", s == 200, d)
s, d = put(f"rooms/{CODE}/queue/{tid}/votes/{guestUid}", guestTok, -1)
t("guest can change their own vote", s == 200, d)
s, d = delete(f"rooms/{CODE}/queue/{tid}/votes/{guestUid}", guestTok)
t("guest can withdraw their own vote", s == 200, d)
s, d = put(f"rooms/{CODE}/presence/{guestUid}", guestTok, int(time.time()*1000))
t("guest can mark themselves present", s == 200, d)
s, d = put(f"rooms/{CODE}/now/votes/{guestUid}", guestTok, 1)
t("guest can upvote what's playing", s == 200, d)

print("\n\033[1mwhat the rules must refuse\033[0m")
s, d = put(f"rooms/{CODE}/queue/{tid}/votes/{hostUid}", guestTok, 1)
t("guest cannot vote as someone else", s == 401, f"got {s}")
s, d = delete(f"rooms/{CODE}/queue/{tid}/votes/{hostUid}", guestTok)
t("guest cannot remove someone else's vote", s == 401, f"got {s}")
s, d = delete(f"rooms/{CODE}/queue/{tid}/votes", guestTok)
t("guest cannot wipe a track's votes", s == 401, f"got {s}")
s, d = put(f"rooms/{CODE}/queue/{tid}/playedAt", guestTok, 1)
t("guest cannot mark a song played", s == 401, f"got {s}")
s, d = get(f"rooms/{CODE}/queue/{tid}/votes/{hostUid}", guestTok)
t("the host's vote is still there", d == 1, f"got {d}")
s, d = patch(f"rooms/{CODE}", guestTok, {"playing": False})
t("guest cannot control playback", s == 401, f"got {s}")
s, d = patch(f"rooms/{CODE}", guestTok, {"hostUid": guestUid})
t("guest cannot seize the room", s == 401, f"got {s}")
s, d = delete(f"rooms/{CODE}/queue/{tid}", guestTok)
t("guest cannot remove a track", s == 401, f"got {s}")
forged = dict(track); forged["votes"] = {guestUid: 1, hostUid: 1, "x1": 1, "x2": 1}
s, d = put(f"rooms/{CODE}/queue/{tid}", guestTok, forged)
t("nobody can rewrite a track to forge votes", s == 401, f"got {s}")
s, d = put(f"rooms/{CODE}/queue/{tid}/votes/{guestUid}", guestTok, 99)
t("a vote can only be +1 or -1", s == 401, f"got {s}")
bad = dict(track); bad["platform"] = "napster"
s, d = put(f"rooms/{CODE}/queue/x{tid}", guestTok, bad)
t("unknown platforms are rejected", s == 401, f"got {s}")
huge = dict(track); huge["title"] = "x" * 5000
s, d = put(f"rooms/{CODE}/queue/y{tid}", guestTok, huge)
t("oversized fields are rejected", s == 401, f"got {s}")
s, d = put(f"rooms/{CODE}/queue/z{tid}", guestTok, dict(track, junk="payload"))
t("unknown fields are rejected", s == 401, f"got {s}")
s, d = delete(f"rooms/{CODE}", guestTok)
t("guest cannot close the room", s == 401, f"got {s}")

print("\n\033[1mwhat the host can do\033[0m")
s, d = patch(f"rooms/{CODE}", hostTok, {"playing": False})
t("host can pause", s == 200, d)
s, d = delete(f"rooms/{CODE}/queue/{tid}", hostTok)
t("host can remove a track", s == 200, d)

print("\n\033[1mcleanup\033[0m")
s, d = delete(f"rooms/{CODE}", hostTok)
t("host can close the room", s == 200, d)
s, d = get(f"rooms/{CODE}")
t("the room is gone", d is None, d)

print("\n" + "─" * 52)
print(f"  \033[32mall {ok} passed\033[0m" if not fail else f"  \033[31m{fail} of {ok+fail} failed\033[0m")
print("─" * 52 + "\n")
sys.exit(1 if fail else 0)
