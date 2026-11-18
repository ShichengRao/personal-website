// Sudoku 6×6 board: tap a cell, then type 1–6 or use the pad under the grid.

import { hintSteps } from './generate.js';
import { makeGrace } from '../../lib/grace.js';

export const rules = [
  'Every row, column and 2×3 box holds the digits 1 to 6, each exactly once.',
  'Tap a cell, then type a digit or use the pad. Backspace or Clear empties it.',
  'Turn on Notes to pencil in small candidates instead.',
  'Digits that clash turn red.',
  'On a keyboard, arrow keys move and N switches notes.',
];

const FIELD = 'input, textarea, select, [contenteditable]';

export function mount(el, puzzle, { onSolved }) {
  const n = puzzle.size;
  const [boxRows, boxCols] = puzzle.box ?? [2, 3];
  const cells = n * n;
  const given = Array.from(puzzle.givens, Number);
  const solution = Array.from(puzzle.solution, Number);

  const rowOf = (i) => Math.floor(i / n);
  const colOf = (i) => i % n;
  const boxOf = (i) => Math.floor(rowOf(i) / boxRows) * (n / boxCols) + Math.floor(colOf(i) / boxCols);
  const peers = Array.from({ length: cells }, (_, i) => {
    const out = [];
    for (let j = 0; j < cells; j++) {
      if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.push(j);
    }
    return out;
  });

  // Each cell's row, column and box, for the flash when one is completed.
  const unitsOf = (i) => [
    Array.from({ length: n }, (_, k) => rowOf(i) * n + k),
    Array.from({ length: n }, (_, k) => k * n + colOf(i)),
    Array.from({ length: cells }, (_, j) => j).filter((j) => boxOf(j) === boxOf(i)),
  ];

  let entry = new Array(cells).fill(0); // player's digits
  let notes = new Array(cells).fill(0); // bit d-1 set when d is pencilled in
  let selected = -1;
  let notesMode = false;
  let locked = false; // after solving or revealing, until reset
  let shown = false; // the solution was revealed
  let history = []; // board before each of the player's edits, for undo
  let marks = null; // the current hint's cells: { area, keys, goals }, until the next edit
  let plan = null; // hint steps for the digits on the board, and how far the player has asked

  el.classList.remove('solved');
  el.classList.add('s6');
  el.style.setProperty('--n', n);

  // ---------------------------------------------------------------- DOM
  const grid = document.createElement('div');
  grid.className = 'grid s6-grid';
  const cellEls = [];
  for (let i = 0; i < cells; i++) {
    const c = document.createElement('div');
    c.className = 's6-cell';
    c.dataset.i = String(i);
    const r = rowOf(i), k = colOf(i);
    if (k < n - 1) c.classList.add((k + 1) % boxCols === 0 ? 'bx' : 'lx');
    if (r < n - 1) c.classList.add((r + 1) % boxRows === 0 ? 'by' : 'ly');
    if (given[i]) c.classList.add('given');
    grid.append(c);
    cellEls.push(c);
  }

  const pad = document.createElement('div');
  pad.className = 's6-pad';
  const digitBtns = [];
  for (let d = 1; d <= n; d++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 's6-digit';
    b.textContent = String(d);
    b.dataset.d = String(d);
    pad.append(b);
    digitBtns.push(b);
  }
  const notesBtn = document.createElement('button');
  notesBtn.type = 'button';
  notesBtn.className = 's6-wide';
  notesBtn.textContent = 'Notes';
  notesBtn.setAttribute('aria-pressed', 'false');
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 's6-wide';
  clearBtn.textContent = 'Clear';
  pad.append(notesBtn, clearBtn);

  el.append(grid, pad);

  // ---------------------------------------------------------------- state
  const value = (i) => given[i] || entry[i];

  const grace = makeGrace(() => render());

  // A clash turns red once both digits have stood for two seconds, so a
  // quick retype never flashes red.
  function conflicts() {
    const bad = new Array(cells).fill(false);
    for (let i = 0; i < cells; i++) {
      const v = value(i);
      if (!v) continue;
      for (const j of peers[i]) if (value(j) === v && grace.ripe([i, j])) { bad[i] = true; break; }
    }
    return bad;
  }

  function render() {
    grace.see(Array.from({ length: cells }, (_, i) => value(i)));
    const bad = conflicts();
    const sel = selected;
    const selDigit = sel >= 0 ? value(sel) : 0;
    const counts = new Array(n + 1).fill(0);
    const area = new Set(marks?.area);
    const keys = new Set(marks?.keys);
    const goals = new Set(marks?.goals);
    for (let i = 0; i < cells; i++) {
      const c = cellEls[i];
      const v = value(i);
      counts[v]++;
      c.classList.toggle('sel', i === sel);
      c.classList.toggle('same', !!selDigit && i !== sel && v === selDigit);
      c.classList.toggle('bad', bad[i]);
      c.classList.toggle('shown', shown && !given[i]);
      c.classList.toggle('hint-area', area.has(i));
      c.classList.toggle('hint-key', keys.has(i));
      c.classList.toggle('hint-goal', goals.has(i));
      if (v) {
        c.textContent = String(v);
      } else if (notes[i]) {
        const box = document.createElement('div');
        box.className = 's6-notes';
        for (let d = 1; d <= n; d++) {
          const s = document.createElement('span');
          s.textContent = notes[i] & (1 << (d - 1)) ? String(d) : '';
          box.append(s);
        }
        c.replaceChildren(box);
      } else {
        c.textContent = '';
      }
    }
    for (let d = 1; d <= n; d++) digitBtns[d - 1].classList.toggle('done', counts[d] >= n);
    notesBtn.classList.toggle('on', notesMode);
    notesBtn.setAttribute('aria-pressed', String(notesMode));
    el.classList.toggle('s6-notes-mode', notesMode);
  }

  function checkSolved() {
    for (let i = 0; i < cells; i++) if (value(i) !== solution[i]) return;
    locked = true;
    selected = -1;
    el.classList.add('solved');
    render();
    onSolved?.();
  }

  // ---------------------------------------------------------------- input
  function select(i) {
    selected = i;
    render();
  }

  /** Run one player edit on cell i, keeping the board before it for undo. */
  function edit(i, change) {
    const before = { entry: entry.slice(), notes: notes.slice(), cell: i };
    change();
    const changed = entry.some((v, k) => v !== before.entry[k]) || notes.some((v, k) => v !== before.notes[k]);
    if (!changed) return;
    history.push(before);
    if (history.length > 500) history.shift();
    marks = null;
    render();
    if (entry[i] && entry[i] !== before.entry[i]) flashDone(i);
    checkSolved();
  }

  // A row, column or box that the digit in cell i just completed correctly
  // pulses bold once, in a quick wave out from that cell.
  function flashDone(i) {
    for (const unit of unitsOf(i)) {
      if (!unit.every((j) => value(j) === solution[j])) continue;
      for (const j of unit) {
        const c = cellEls[j];
        const delay = (Math.abs(rowOf(j) - rowOf(i)) + Math.abs(colOf(j) - colOf(i))) * 45;
        clearTimeout(flashTimers[j]);
        c.classList.remove('s6-flash');
        void c.offsetWidth; // restart the animation if it is already running
        c.style.animationDelay = `${delay}ms`;
        c.classList.add('s6-flash');
        // A timer, not animationend, so a paused background tab still clears it.
        flashTimers[j] = setTimeout(() => {
          c.classList.remove('s6-flash');
          c.style.animationDelay = '';
        }, delay + 750);
      }
    }
  }
  const flashTimers = new Array(cells).fill(0);

  function input(d) {
    const i = selected;
    if (locked || i < 0 || given[i]) return;
    const bit = 1 << (d - 1);
    edit(i, () => {
      if (notesMode) {
        entry[i] = 0;
        notes[i] ^= bit;
      } else {
        entry[i] = d;
        // Tidy the pencil marks this digit rules out.
        for (const j of peers[i]) notes[j] &= ~bit;
      }
    });
  }

  function clear() {
    const i = selected;
    if (locked || i < 0 || given[i]) return;
    edit(i, () => {
      if (entry[i]) entry[i] = 0;
      else notes[i] = 0;
    });
  }

  function show(h, sel) {
    marks = h;
    selected = sel;
    render();
  }

  function toggleNotes() {
    notesMode = !notesMode;
    render();
  }

  function move(dr, dc) {
    const r = (rowOf(selected) + dr + n) % n;
    const c = (colOf(selected) + dc + n) % n;
    select(r * n + c);
  }

  function onGridDown(e) {
    const c = e.target.closest('.s6-cell');
    if (!c || !grid.contains(c)) return;
    e.preventDefault();
    // Let typing reach the board if a text field had focus.
    if (document.activeElement?.matches?.(FIELD)) document.activeElement.blur();
    select(Number(c.dataset.i));
  }

  function onPadClick(e) {
    const b = e.target.closest('button');
    if (!b || !pad.contains(b)) return;
    if (b.dataset.d) input(Number(b.dataset.d));
    else if (b === notesBtn) toggleNotes();
    else if (b === clearBtn) clear();
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.(FIELD)) return;
    if (e.key === 'n' || e.key === 'N') {
      toggleNotes();
      e.preventDefault();
      return;
    }
    // Everything else needs a selected cell, so arrows still scroll the page otherwise.
    if (selected < 0) return;
    const d = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
    if (d >= 1 && d <= n) {
      input(d);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      clear();
    } else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === 'Escape') select(-1);
    else return;
    e.preventDefault();
  }

  grid.addEventListener('pointerdown', onGridDown);
  pad.addEventListener('click', onPadClick);
  document.addEventListener('keydown', onKey);
  render();

  return {
    reset() {
      entry = new Array(cells).fill(0);
      notes = new Array(cells).fill(0);
      locked = false;
      shown = false;
      selected = -1;
      history = [];
      marks = null;
      plan = null;
      el.classList.remove('solved');
      render();
    },
    reveal() {
      // Fill in the answer without counting it as solved.
      entry = solution.map((d, i) => (given[i] ? 0 : d));
      notes = new Array(cells).fill(0);
      locked = true;
      shown = true;
      selected = -1;
      history = [];
      marks = null;
      render();
    },
    undo() {
      if (locked || !history.length) return;
      const before = history.pop();
      entry = before.entry;
      notes = before.notes;
      marks = null;
      selected = before.cell;
      render();
    },
    hint() {
      if (locked) return null;
      // Mistakes first: a placed digit that isn't the solution's.
      const wrong = [];
      for (let i = 0; i < cells; i++) if (entry[i] && entry[i] !== solution[i]) wrong.push(i);
      if (wrong.length) {
        const i = wrong[0];
        show({ area: [], keys: [], goals: [i] }, i);
        const more = wrong.length - 1;
        return `This ${entry[i]} is wrong` + (more ? `, and ${more} other digit${more > 1 ? 's are' : ' is'} too.` : '.');
      }
      // Otherwise the next deduction from the digits on the board. Asking again
      // without placing a digit moves on to the following step.
      const board = Array.from({ length: cells }, (_, i) => value(i));
      const key = board.join('');
      if (plan?.key === key) plan.at = Math.min(plan.at + 1, plan.steps.length - 1);
      else plan = { key, steps: hintSteps(board), at: 0 };
      const h = plan.steps[plan.at];
      if (!h) {
        const i = board.indexOf(0);
        if (i < 0) return null;
        show({ area: [], keys: [], goals: [i] }, i);
        return `This cell is ${solution[i]}.`;
      }
      show(h, h.place ? h.place[0] : -1);
      return h.text;
    },
    destroy() {
      grace.stop();
      flashTimers.forEach(clearTimeout);
      grid.removeEventListener('pointerdown', onGridDown);
      pad.removeEventListener('click', onPadClick);
      document.removeEventListener('keydown', onKey);
      el.classList.remove('s6', 's6-notes-mode', 'solved');
      el.style.removeProperty('--n');
      el.replaceChildren();
    },
  };
}
