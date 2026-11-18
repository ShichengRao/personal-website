// Prototype shell: pick a game, week and day, press Play, solve, leave feedback.
//
// Each game lives in games/<id>/ and provides:
//   generate.js  export function generate(day, rng) -> puzzle (used by generate.mjs)
//   view.js      export const rules = [...]
//                export function mount(el, puzzle, { onSolved }) -> { reset(), reveal(), destroy() }
//                and optionally on that handle:
//                  undo()  revert the player's last action
//                  hint()  highlight the next step and return a sentence about it, or null
//   view.css     optional, loaded once
//
// The board stays hidden until Play. The clock runs from Play to solve and pauses
// while the tab is hidden, so the recorded time is time spent looking at the puzzle.

import { GAMES, loadView } from './games/index.js';
import { DAYS } from './lib/days.js';
import { hashString } from './lib/rng.js';

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
};

const data = new Map();
const state = { game: GAMES[0].id, week: 1, day: 1 };
let current = null; // { set, puzzle, view }
let handle = null;
let phase = 'idle'; // idle | playing | done
let firstTry = false; // only a puzzle's first attempt is recorded

// Records are keyed by the puzzle's content, so regenerating a day starts it fresh.
const fingerprint = (p) =>
  (p._fp ??= hashString(JSON.stringify([p.size, p.solution, p.grade?.score])).toString(36));
const key = (kind, p = current.puzzle) =>
  `dp:${kind}:${p.game}:${p.week}:${p.day}:${fingerprint(p)}`;
const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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

document.addEventListener('visibilitychange', () => {
  if (phase !== 'playing') return;
  if (document.hidden) clock.pause();
  else clock.resume();
  clock.show();
});

// ---- data --------------------------------------------------------------

function readHash() {
  const [game, week, day] = location.hash.slice(1).split('/');
  if (GAMES.some((g) => g.id === game)) state.game = game;
  if (Number(week) > 0) state.week = Number(week);
  if (Number(day) >= 1 && Number(day) <= 7) state.day = Number(day);
}

async function loadData(id) {
  if (!data.has(id)) {
    const res = await fetch(`data/${id}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`data/${id}.json not found. Run: node generate.mjs --game ${id}`);
    data.set(id, await res.json());
  }
  return data.get(id);
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

function renderTabs(set) {
  $('games').replaceChildren(
    ...GAMES.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g.name;
      b.title = g.genre;
      b.className = g.id === state.game ? 'on' : '';
      b.onclick = () => go({ game: g.id });
      return b;
    }),
  );

  const weeks = set.weeks ?? 1;
  if (state.week > weeks) state.week = 1;
  $('week').replaceChildren(
    ...Array.from({ length: weeks }, (_, i) => new Option(String(i + 1), String(i + 1))),
  );
  $('week').value = String(state.week);

  $('days').replaceChildren(
    ...DAYS.map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      const p = set.puzzles?.find((q) => q.week === state.week && q.day === d.day);
      const solved = p && store.get(key('solved', p));
      b.textContent = solved ? `${d.short} ✓` : d.short;
      b.className = d.day === state.day ? 'on' : '';
      b.onclick = () => go({ day: d.day });
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
  $('reset').disabled = phase === 'idle';
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

function showCover() {
  clearBoard();
  clock.stop();
  phase = 'idle';
  setControls();

  const solved = store.get(key('solved'));
  const revealed = store.get(key('revealed'));
  $('timer').textContent = solved ? `Solved in ${fmt(Number(solved))}` : '0:00';

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
      $('timer').textContent = `Solved in ${fmt(ms)}`;
      if (firstTry) store.set(key('solved'), String(Math.round(ms)));
      hideHint();
      renderTabs(current.set);
    },
  });
  setControls();
  clock.start();
}

async function render() {
  const game = GAMES.find((g) => g.id === state.game);
  clearBoard();
  clock.stop();
  phase = 'idle';
  setControls();
  $('stats').hidden = !$('show-stats').checked;

  let set;
  try {
    set = await loadData(game.id);
  } catch (err) {
    renderTabs({ weeks: 1 });
    $('title').textContent = game.name;
    $('board').textContent = err.message;
    return;
  }
  renderTabs(set);

  const puzzle = set.puzzles.find((p) => p.week === state.week && p.day === state.day);
  $('title').textContent = `${game.name} · ${DAYS[state.day - 1].name}, week ${state.week}`;
  if (!puzzle) {
    $('board').textContent = 'No puzzle generated for this day.';
    return;
  }

  ensureCss(game.id);
  const view = await loadView(game.id);
  $('rules').replaceChildren(
    ...(view.rules ?? []).map((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      return li;
    }),
  );
  $('stats').textContent = describe(puzzle);
  current = { set, puzzle, view };
  $('felt').value = store.get(key('felt')) ?? '';
  $('note').value = store.get(key('note')) ?? '';
  showCover();
}

function go(change) {
  Object.assign(state, change);
  history.replaceState(null, '', `#${state.game}/${state.week}/${state.day}`);
  render();
}

// ---- feedback ----------------------------------------------------------

async function feedbackText() {
  const lines = [];
  for (const g of GAMES) {
    const set = await loadData(g.id).catch(() => null);
    for (const p of set?.puzzles ?? []) {
      const solved = store.get(key('solved', p));
      const revealed = store.get(key('revealed', p));
      const felt = store.get(key('felt', p));
      const note = store.get(key('note', p));
      const hints = store.get(key('hints', p));
      if (!solved && !revealed && !felt && !note) continue;
      const bits = [
        `${g.name} w${p.week} ${DAYS[p.day - 1].short}`,
        `size ${p.size}`,
        `grader ${p.grade.score} (${p.grade.hardest})`,
      ];
      if (solved) bits.push(`solved in ${fmt(Number(solved))}`);
      if (revealed) bits.push(`gave up after ${fmt(Number(revealed))}`);
      if (hints) bits.push(`${hints} hint${hints === '1' ? '' : 's'}`);
      if (felt) bits.push(`felt ${felt}/5`);
      lines.push(bits.join(' · ') + (note ? `\n    ${note.replace(/\n/g, '\n    ')}` : ''));
    }
  }
  return lines.join('\n') || 'No feedback yet.';
}

$('week').onchange = (e) => go({ week: Number(e.target.value) });
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
  else showCover();
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
  $('timer').textContent = `Solution shown after ${fmt(ms)}`;
};
$('show-stats').onchange = (e) => {
  $('stats').hidden = !e.target.checked;
};
$('felt').onchange = (e) => store.set(key('felt'), e.target.value);
$('note').oninput = (e) => store.set(key('note'), e.target.value);
$('copy').onclick = async () => {
  const text = await feedbackText();
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

readHash();
go({});
// Load every game's data up front so copying feedback doesn't wait on the network.
for (const g of GAMES) loadData(g.id).catch(() => {});
