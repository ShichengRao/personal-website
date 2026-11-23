// Prototype shell: pick a game and a day, press Play, solve, leave feedback.
//
// Each game lives in games/<id>/ and provides:
//   generate.js  export function generate(day, rng) -> puzzle (run by worker.js and generate.mjs)
//   view.js      export const rules = [...]
//                export function mount(el, puzzle, { onSolved }) -> { reset(), reveal(), destroy() }
//                and optionally on that handle:
//                  undo()  revert the player's last action
//                  hint()  highlight the next step and return a sentence about it, or null
//   view.css     optional, loaded once
//
// A day's puzzle is made in the browser from the game and the date (lib/daily.js),
// in a worker per game, and kept in localStorage so it opens instantly next time.
// The board stays hidden until Play. The clock runs from Play to solve and pauses
// while the tab is hidden, so the recorded time is time spent looking at the puzzle.

import { GAMES, loadView } from './games/index.js';
import { DAYS } from './lib/days.js';
import { hashString } from './lib/rng.js';
import { today, parseDate, addDays, weekday, mondayOf } from './lib/daily.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value === '' || value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* storage unavailable: feedback just isn't kept */ }
  },
  keys() {
    try { return Object.keys(localStorage); } catch { return []; }
  },
};

// A small drawing of each game for the picker, in currentColor.
const ICONS = {
  'seating-chart': '<rect x="3" y="3" width="16" height="16" rx="2.5"/><path d="M8.33 3v16M13.67 3v16M3 8.33h16M3 13.67h16" opacity=".45"/><circle cx="11" cy="11" r="2.4" fill="currentColor" stroke="none"/>',
  'two-tone': '<circle cx="7" cy="11" r="4.2" fill="currentColor" stroke="none"/><circle cx="15.6" cy="11" r="3.4" stroke-width="2.2"/>',
  'paper-route': '<path d="M5 18v-7h6v6h6V5" stroke-width="2.2"/><circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/>',
  zoning: '<rect x="3" y="3" width="9.5" height="6.5" rx="1.5"/><rect x="3" y="12" width="9.5" height="7" rx="1.5"/><rect x="15" y="3" width="4" height="16" rx="1.5"/>',
  sudoku6: '<rect x="3" y="3" width="16" height="16" rx="2.5"/><path d="M11 3v16M3 8.33h16M3 13.67h16" opacity=".45"/><text x="7" y="7.4" font-size="5.2" font-weight="800" text-anchor="middle" fill="currentColor" stroke="none">6</text>',
};
const icon = (id) => {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] ?? ''}</svg>`;
  return span.firstChild;
};

const state = { game: GAMES[0].id, date: today() };
let current = null; // { puzzle, view }
let handle = null;
let phase = 'idle'; // idle | loading | playing | done
let firstTry = false; // only a puzzle's first attempt is recorded
let renders = 0; // a newer render makes an older one stop when its puzzle arrives

// Records are keyed by the puzzle's content, so a changed generator starts a day fresh.
const fingerprint = (p) =>
  (p._fp ??= hashString(JSON.stringify([p.size, p.solution, p.grade?.score])).toString(36));
const key = (kind, p = current.puzzle) => `dp:${kind}:${p.game}:${p.date}:${fingerprint(p)}`;
const RECORD = /^dp:(solved|revealed|felt|note|hints):([a-z0-9-]+):(\d{4}-\d{2}-\d{2}):([a-z0-9]+)$/;
const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function setTimer(text, tone = '') {
  $('timer').textContent = text;
  $('timer').className = tone ? `timer ${tone}` : 'timer';
}

const longDate = (date) =>
  parseDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.slice(0, 4) === today().slice(0, 4) ? {} : { year: 'numeric' }),
  });

function weekLabel(monday) {
  if (monday === mondayOf(today())) return 'This week';
  const a = parseDate(monday);
  const b = parseDate(addDays(monday, 6));
  const month = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()}–${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

// ---- clock -------------------------------------------------------------

const clock = {
  banked: 0, // ms from earlier stretches of play
  since: 0, // performance.now() when the current stretch began, 0 while paused
  ticker: null,
  elapsed() {
    return this.banked + (this.since ? performance.now() - this.since : 0);
  },
  start() {
    this.banked = 0;
    this.since = performance.now();
    setTimer('0:00');
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.show(), 250);
    this.show();
  },
  pause() {
    if (this.since) this.banked += performance.now() - this.since;
    this.since = 0;
  },
  resume() {
    if (!this.since) this.since = performance.now();
  },
  stop() {
    this.pause();
    clearInterval(this.ticker);
    this.ticker = null;
    return this.elapsed();
  },
  show() {
    $('timer').textContent = this.since ? fmt(this.elapsed()) : `${fmt(this.elapsed())} paused`;
  },
};

let shownToday = today();
document.addEventListener('visibilitychange', () => {
  // Past midnight, the picker moves on to the new day (the puzzle on screen stays).
  if (!document.hidden && today() !== shownToday) {
    shownToday = today();
    renderTabs();
    prefetch();
  }
  if (phase !== 'playing') return;
  if (document.hidden) clock.pause();
  else clock.resume();
  clock.show();
});

// ---- puzzles -----------------------------------------------------------

const version = (game) => GAMES.find((g) => g.id === game)?.v ?? 0;
const cacheKey = (game, date) => `dp:puzzle:${game}:${date}`;

function cached(game, date) {
  try {
    const hit = JSON.parse(store.get(cacheKey(game, date)));
    return hit?.v === version(game) ? hit.puzzle : null;
  } catch {
    return null;
  }
}

// Unplayed puzzles are dropped after two weeks. Played ones stay, so their
// feedback can still name the puzzle.
function pruneCache() {
  const played = new Set();
  for (const k of store.keys()) {
    const m = RECORD.exec(k);
    if (m) played.add(`${m[2]}:${m[3]}`);
  }
  const cutoff = addDays(today(), -14);
  for (const k of store.keys()) {
    if (!k.startsWith('dp:puzzle:')) continue;
    const [, , game, date] = k.split(':');
    if (!cached(game, date) || (date < cutoff && !played.has(`${game}:${date}`))) store.set(k, null);
  }
}

// One worker per game, so a slow Sudoku never holds up another game. Each works
// through its queue one date at a time, the date on screen first. If the worker
// is busy with another date when the player opens one, it starts over with theirs.
const workers = {}; // game -> { worker, running, queue }
const waiting = new Map(); // 'game|date' -> [{ resolve, reject }]

function slot(game) {
  return (workers[game] ??= { worker: null, running: null, queue: [] });
}

function settle(game, date, error, puzzle) {
  const fns = waiting.get(`${game}|${date}`) ?? [];
  waiting.delete(`${game}|${date}`);
  if (puzzle) store.set(cacheKey(game, date), JSON.stringify({ v: version(game), puzzle }));
  for (const f of fns) error ? f.reject(new Error(error)) : f.resolve(puzzle);
}

function spawn(s, game) {
  s.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  s.worker.onmessage = ({ data }) => {
    const date = s.running;
    s.running = null;
    settle(game, date, data.error, data.puzzle);
    pump(game);
  };
  s.worker.onerror = (e) => {
    e.preventDefault();
    const date = s.running;
    s.worker.terminate();
    Object.assign(s, { worker: null, running: null });
    settle(game, date, e.message || 'the puzzle maker stopped');
    pump(game);
  };
}

function pump(game) {
  const s = slot(game);
  const onScreen = state.game === game && s.queue.includes(state.date) ? state.date : null;
  if (s.running && onScreen) {
    s.worker.terminate();
    s.worker = null;
    s.queue.push(s.running);
    s.running = null;
  }
  if (s.running || !s.queue.length) return;
  const date = onScreen ?? s.queue[0];
  s.queue.splice(s.queue.indexOf(date), 1);
  if (!s.worker) spawn(s, game);
  s.running = date;
  s.worker.postMessage({ game, date });
}

function puzzleFor(game, date) {
  const hit = cached(game, date);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const k = `${game}|${date}`;
    if (!waiting.has(k)) {
      waiting.set(k, []);
      slot(game).queue.push(date);
    }
    waiting.get(k).push({ resolve, reject });
    pump(game);
  });
}

// Start on every game's puzzle for today, so switching games rarely waits.
function prefetch() {
  for (const g of GAMES) puzzleFor(g.id, today()).catch(() => {});
}

function readHash() {
  const [game, date] = location.hash.slice(1).split('/');
  if (GAMES.some((g) => g.id === game)) state.game = game;
  state.date = parseDate(date) && date <= today() ? date : today();
}

function ensureCss(id) {
  if (document.querySelector(`link[data-game="${id}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `games/${id}/view.css`;
  link.dataset.game = id;
  document.head.append(link);
}

// ---- page --------------------------------------------------------------

function renderTabs() {
  $('games').replaceChildren(
    ...GAMES.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.append(icon(g.id), g.name);
      b.title = g.genre;
      b.className = g.id === state.game ? 'on' : '';
      b.onclick = () => go({ game: g.id });
      return b;
    }),
  );

  // Keep the chosen game in view when the picker scrolls sideways on a phone.
  const on = $('games').querySelector('.on');
  const strip = $('games');
  if (on && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
    strip.scrollLeft = on.offsetLeft - 4;
  }

  const now = today();
  const monday = mondayOf(state.date);
  $('week-label').textContent = weekLabel(monday);
  $('week-next').disabled = monday >= mondayOf(now);

  $('days').replaceChildren(
    ...DAYS.map((d) => {
      const date = addDays(monday, d.day - 1);
      const b = document.createElement('button');
      b.type = 'button';
      const p = cached(state.game, date);
      const solved = p && store.get(key('solved', p));
      const ticks = document.createElement('span');
      ticks.className = 'ticks';
      ticks.setAttribute('aria-hidden', 'true');
      for (let k = 0; k < d.day; k++) ticks.append(document.createElement('i'));
      b.append(d.short, ticks);
      if (solved) {
        const done = document.createElement('span');
        done.className = 'done';
        done.textContent = '✓';
        done.setAttribute('aria-label', 'solved');
        b.append(done);
      }
      b.title = longDate(date);
      b.className = [date === state.date && 'on', date === now && 'today'].filter(Boolean).join(' ');
      if (date === now) b.setAttribute('aria-current', 'date');
      b.disabled = date > now;
      b.onclick = () => go({ date });
      return b;
    }),
  );
}

function describe(p) {
  const tech = Object.entries(p.grade?.techniques ?? {})
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  return [
    `size ${p.size}   score ${p.grade?.score}   hardest step: ${p.grade?.hardest}`,
    p.grade?.summary ?? '',
    tech ? `steps by technique:\n${tech}` : '',
    `generated in ${p.genMs} ms (seed ${p.seed})`,
  ].filter(Boolean).join('\n');
}

function clearBoard() {
  handle?.destroy?.();
  handle = null;
  // Views add classes and --n to the board; start each puzzle from a clean element.
  $('board').className = '';
  $('board').removeAttribute('style');
  $('board').replaceChildren();
  hideHint();
}

function setControls() {
  $('undo').disabled = phase !== 'playing' || !handle?.undo;
  $('hint').disabled = phase !== 'playing' || !handle?.hint;
  $('reset').disabled = phase === 'idle' || phase === 'loading';
  $('reveal').disabled = phase !== 'playing';
}

function hideHint() {
  $('hint-text').hidden = true;
  $('hint-text').textContent = '';
}

function undo() {
  if (phase !== 'playing') return;
  hideHint();
  handle?.undo?.();
}

// Shown while the worker makes the puzzle. It fades in late, so a quick puzzle never flashes it.
function showMaking() {
  const cover = document.createElement('div');
  cover.className = 'cover making';
  const text = document.createElement('p');
  text.textContent = state.date === today() ? "Making today's puzzle" : `Making ${DAYS[weekday(state.date) - 1].name}'s puzzle`;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.append(document.createElement('i'));
  cover.append(text, bar);
  $('board').style.setProperty('--n', 8);
  $('board').append(cover);
}

function showCover() {
  clearBoard();
  clock.stop();
  phase = 'idle';
  setControls();

  const solved = store.get(key('solved'));
  const revealed = store.get(key('revealed'));
  if (solved) setTimer(`Solved in ${fmt(Number(solved))}`, 'ok');
  else setTimer('0:00');

  const cover = document.createElement('div');
  cover.className = 'cover';
  $('board').style.setProperty('--n', current.puzzle.size);
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'play';
  play.textContent = solved || revealed ? 'Play again' : 'Play';
  play.onclick = startPlay;
  cover.append(play);
  if (solved || revealed) {
    const note = document.createElement('p');
    note.textContent = solved
      ? `Your first solve took ${fmt(Number(solved))}. Playing again won't change it.`
      : `You looked at the solution after ${fmt(Number(revealed))}.`;
    cover.append(note);
  }
  $('board').append(cover);
}

function startPlay() {
  clearBoard();
  phase = 'playing';
  firstTry = !store.get(key('solved')) && !store.get(key('revealed'));
  if (firstTry) store.set(key('hints'), null);
  handle = current.view.mount($('board'), current.puzzle, {
    onSolved() {
      if (phase !== 'playing') return;
      phase = 'done';
      setControls();
      const ms = clock.stop();
      setTimer(`Solved in ${fmt(ms)}`, 'ok');
      if (firstTry) store.set(key('solved'), String(Math.round(ms)));
      hideHint();
      renderTabs();
    },
  });
  setControls();
  clock.start();
}

function setRules(view) {
  $('rules').replaceChildren(
    ...(view.rules ?? []).map((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      return li;
    }),
  );
}

async function render() {
  const run = ++renders;
  const game = GAMES.find((g) => g.id === state.game);
  current = null;
  clearBoard();
  clock.stop();
  phase = 'loading';
  setControls();
  setTimer('0:00');
  renderTabs();
  renderRating();
  $('note').value = '';
  $('note').disabled = true;
  $('title').textContent = game.name;
  $('subtitle').textContent = longDate(state.date);
  $('board').dataset.game = game.id;
  $('stats').textContent = '';

  ensureCss(game.id);
  const viewP = loadView(game.id);
  // The rules can show while the puzzle is still being made.
  viewP.then((view) => { if (run === renders) setRules(view); }, () => {});
  const date = state.date;
  if (!cached(game.id, date)) showMaking();

  let puzzle, view;
  try {
    [puzzle, view] = await Promise.all([puzzleFor(game.id, date), viewP]);
  } catch (err) {
    if (run !== renders) return;
    clearBoard();
    $('board').textContent = `Couldn't make this puzzle: ${err.message}`;
    return;
  }
  if (run !== renders) return;

  $('stats').textContent = describe(puzzle);
  current = { puzzle, view };
  renderTabs();
  renderRating();
  $('note').value = store.get(key('note')) ?? '';
  $('note').disabled = false;
  showCover();
}

function go(change) {
  Object.assign(state, change);
  history.replaceState(null, '', `#${state.game}/${state.date}`);
  render();
}

// ---- feedback ----------------------------------------------------------

function feedbackText() {
  const byPuzzle = new Map(); // 'game|date|fp' -> { kind: value }
  for (const k of store.keys()) {
    const m = RECORD.exec(k);
    if (!m) continue;
    const id = `${m[2]}|${m[3]}|${m[4]}`;
    if (!byPuzzle.has(id)) byPuzzle.set(id, {});
    byPuzzle.get(id)[m[1]] = store.get(k);
  }
  const lines = [];
  for (const id of [...byPuzzle.keys()].sort()) {
    const r = byPuzzle.get(id);
    if (!r.solved && !r.revealed && !r.felt && !r.note) continue;
    const [game, date, fp] = id.split('|');
    const g = GAMES.find((x) => x.id === game);
    const p = cached(game, date);
    const bits = [`${g?.name ?? game} ${date} ${DAYS[weekday(date) - 1].short}`];
    if (p && fingerprint(p) === fp) bits.push(`size ${p.size}`, `grader ${p.grade.score} (${p.grade.hardest})`);
    if (r.solved) bits.push(`solved in ${fmt(Number(r.solved))}`);
    if (r.revealed) bits.push(`gave up after ${fmt(Number(r.revealed))}`);
    if (r.hints) bits.push(`${r.hints} hint${r.hints === '1' ? '' : 's'}`);
    if (r.felt) bits.push(`felt ${r.felt}/5`);
    lines.push(bits.join(' · ') + (r.note ? `\n    ${r.note.replace(/\n/g, '\n    ')}` : ''));
  }
  return lines.join('\n') || 'No feedback yet.';
}

$('week-prev').onclick = () => go({ date: addDays(state.date, -7) });
$('week-next').onclick = () => {
  const next = addDays(state.date, 7);
  go({ date: next > today() ? today() : next });
};
$('undo').onclick = undo;
$('hint').onclick = () => {
  if (phase !== 'playing' || !handle?.hint) return;
  const text = handle.hint();
  if (!text) return;
  $('hint-text').textContent = text;
  $('hint-text').hidden = false;
  if (firstTry) store.set(key('hints'), String(Number(store.get(key('hints')) ?? 0) + 1));
};
// A hint stays up until the player does something on the board.
$('board').addEventListener('pointerdown', hideHint);
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select');
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    undo();
  } else if (!typing && !e.metaKey && !e.ctrlKey && e.key.length === 1) {
    hideHint();
  }
});
$('reset').onclick = () => {
  if (phase === 'playing') handle?.reset?.(); // the clock keeps running: it measures the whole attempt
  else if (current) showCover();
};
$('reveal').onclick = () => {
  if (phase !== 'playing') return;
  handle?.reveal?.();
  phase = 'done';
  setControls();
  const ms = clock.stop();
  if (!store.get(key('solved')) && !store.get(key('revealed'))) {
    store.set(key('revealed'), String(Math.round(ms)));
  }
  setTimer(`Solution shown after ${fmt(ms)}`);
};
// How hard it felt, 1 to 5. Pressing the chosen number again clears it.
const FELT = ['trivial', 'easy', 'medium', 'hard', 'brutal'];
function renderRating() {
  const felt = current ? store.get(key('felt')) : null;
  $('felt').replaceChildren(
    ...FELT.map((word, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(k + 1);
      b.title = word;
      b.setAttribute('aria-label', `${k + 1}, ${word}`);
      b.setAttribute('aria-pressed', String(felt === String(k + 1)));
      b.className = felt === String(k + 1) ? 'on' : '';
      b.disabled = !current;
      b.onclick = () => {
        if (!current) return;
        store.set(key('felt'), felt === String(k + 1) ? '' : String(k + 1));
        renderRating();
      };
      return b;
    }),
  );
}
$('note').oninput = (e) => {
  if (current) store.set(key('note'), e.target.value);
};
$('copy').onclick = async () => {
  const text = feedbackText();
  $('copied').textContent = text;
  $('copied').hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy all feedback'; }, 1500);
  } catch { /* the text is shown below the button instead */ }
};

window.addEventListener('hashchange', () => {
  readHash();
  render();
});

pruneCache();
readHash();
go({});
prefetch();
