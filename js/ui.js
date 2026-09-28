/* Moods - shared UI bits: storage, toasts, and the animated queue list. */

export const ls = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const $ = s => document.querySelector(s);

/* toast ------------------------------------------------------------------ */
let toastEl, toastTimer;
export function toast(msg, bad) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.toggle('bad', !!bad);
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
}

/* queue ------------------------------------------------------------------ */
const CARET_UP   = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.4 14.2 12.6H1.8z"/></svg>';
const CARET_DOWN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.6 1.8 3.4h12.4z"/></svg>';

export const PLATFORM = {
  youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud', link: 'Link',
};

export function subtitle(t) {
  const bits = [];
  if (t.artist) bits.push(t.artist);
  bits.push('added by ' + t.addedBy);
  return bits.join('  ·  ');
}

function flash(btn) {
  btn.classList.remove('pulse');
  void btn.offsetWidth;
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 600);
}

function buildRow(t, i, opts) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = t.id;

  const rank = document.createElement('span');
  rank.className = 'rank mono';
  li.appendChild(rank);

  if (t.thumb) {
    const img = document.createElement('img');
    img.className = 'art';
    img.src = t.thumb;
    img.alt = '';
    img.onerror = () => img.remove();
    li.appendChild(img);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const title = document.createElement('div');
  title.className = 't truncate';
  const sub = document.createElement('div');
  sub.className = 's truncate';
  meta.append(title, sub);
  li.appendChild(meta);

  if (opts.onVote) {
    const votes = document.createElement('div');
    votes.className = 'votes';

    const up = document.createElement('button');
    up.className = 'vote up';
    up.innerHTML = CARET_UP;
    up.setAttribute('aria-label', 'Upvote');

    const score = document.createElement('span');
    score.className = 'score mono';

    const down = document.createElement('button');
    down.className = 'vote down';
    down.innerHTML = CARET_DOWN;
    down.setAttribute('aria-label', 'Downvote');

    up.onclick   = () => { flash(up);   opts.onVote(li._track, 1); };
    down.onclick = () => { flash(down); opts.onVote(li._track, -1); };

    votes.append(up, score, down);
    li.appendChild(votes);
  } else {
    const score = document.createElement('span');
    score.className = 'score mono';
    li.appendChild(score);
  }

  if (opts.onRemove) {
    const x = document.createElement('button');
    x.className = 'vote';
    x.textContent = '×';
    x.style.fontSize = '18px';
    x.setAttribute('aria-label', 'Remove');
    x.onclick = () => opts.onRemove(li._track.id);
    li.appendChild(x);
  }

  fillRow(li, t, i);
  return li;
}

function fillRow(li, t, i) {
  li._track = t;
  li.querySelector('.rank').textContent = String(i + 1).padStart(2, '0');

  const title = li.querySelector('.meta .t');
  if (title.textContent !== t.title) title.textContent = t.title;

  const sub = li.querySelector('.meta .s');
  const want = subtitle(t);
  if (sub.dataset.v !== want) {
    sub.textContent = '';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = PLATFORM[t.platform] || 'Link';
    sub.append(tag, document.createTextNode(want));
    sub.dataset.v = want;
  }

  const score = li.querySelector('.score');
  const next = String(t.score);
  if (score.textContent !== next) {
    if (score.textContent !== '') {
      score.classList.remove('bumped');
      void score.offsetWidth;
      score.classList.add('bumped');
    }
    score.textContent = next;
  }
  score.classList.toggle('neg', t.score < 0);
  score.title = `${t.up} up · ${t.down} down`;

  const up = li.querySelector('.vote.up');
  if (up) {
    up.classList.toggle('on', t.myVote === 1);
    li.querySelector('.vote.down').classList.toggle('on', t.myVote === -1);
  }
}

/** Render the list, animating any reorder (FLIP). */
export function renderQueue(ul, tracks, opts = {}) {
  const before = new Map();
  for (const li of ul.children) {
    if (li.dataset.id) before.set(li.dataset.id, li.getBoundingClientRect().top);
  }

  const existing = new Map();
  for (const li of ul.children) {
    if (li.dataset.id && !li.classList.contains('leaving')) existing.set(li.dataset.id, li);
  }

  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => {
    let li = existing.get(t.id);
    if (li) {
      existing.delete(t.id);
      fillRow(li, t, i);
    } else {
      li = buildRow(t, i, opts);
      li.classList.add('entering');
      setTimeout(() => li.classList.remove('entering'), 600);
    }
    frag.appendChild(li);
  });

  existing.forEach(li => {
    li.classList.add('leaving');
    li.removeAttribute('data-id');
    setTimeout(() => li.remove(), 360);
  });

  // kept rows first, departing rows trail behind while they fade
  ul.insertBefore(frag, ul.firstChild);

  requestAnimationFrame(() => {
    for (const li of ul.children) {
      const id = li.dataset.id;
      if (!id || !before.has(id)) continue;
      const delta = before.get(id) - li.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) continue;
      li.style.transition = 'none';
      li.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        li.style.transition = 'transform .52s cubic-bezier(.22,1,.36,1)';
        li.style.transform = '';
      });
    }
  });
}

/** Shown when config.js hasn't been filled in yet. */
export function setupNeeded(where) {
  document.body.innerHTML = `
    <div style="display:grid;place-items:center;min-height:100dvh;padding:30px;text-align:center">
      <div style="max-width:440px">
        <h2 style="font-size:26px;margin-bottom:12px;letter-spacing:-.03em">Moods needs a database</h2>
        <p style="color:#9c9ca4;margin-bottom:18px;line-height:1.5">
          Rooms live in Firebase. Create a free project, add a Realtime Database,
          and paste the config into <code style="color:#eceae6">js/config.js</code>.
        </p>
        <p style="color:#63636b;font-size:13px">The README walks through it — about two minutes.</p>
      </div>
    </div>`;
  console.warn('Moods: js/config.js is empty (' + where + ')');
}
