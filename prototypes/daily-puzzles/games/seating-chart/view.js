// Seating Chart view: tap to cycle empty → × → guest, drag from an empty
// cell to cross out every cell you pass (drag from a × to clear them).

import { hint as findHint } from './generate.js';
import { makeGrace } from '../../lib/grace.js';
import { safeHue } from '../../lib/hue.js';

export const rules = [
  'Seat one guest in every row, every column and every table.',
  'A table is one colored area with a bold outline.',
  'Guests may not sit next to each other, not even diagonally.',
  'Tap a cell to cycle through empty, × and guest.',
  'Drag from an empty cell to put × on every cell you pass. Drag from a × to clear them.',
];

const EMPTY = 0;
const CROSS = 1;
const GUEST = 2;

export function mount(el, puzzle, { onSolved } = {}) {
  const n = puzzle.size;
  const size = n * n;
  const reg = Array.from(puzzle.regions, (ch) => ch.charCodeAt(0) - 97);
  const marks = new Uint8Array(size);
  const history = []; // marks before each tap or drag
  let fired = false;
  let shown = null; // the hint on screen: { target, area, ghost } as Sets

  const touches = (a, b) =>
    a !== b && Math.abs(((a / n) | 0) - ((b / n) | 0)) <= 1 && Math.abs((a % n) - (b % n)) <= 1;
  const sameUnit = (a, b) =>
    ((a / n) | 0) === ((b / n) | 0) || a % n === b % n || reg[a] === reg[b];

  el.classList.remove('solved');
  el.style.setProperty('--n', n);

  const board = document.createElement('div');
  board.className = 'grid sc-board';
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', `Seating chart, ${n} by ${n}`);

  const cells = [];
  const base = [];
  for (let i = 0; i < size; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    const g = reg[i];
    const cls = ['sc-cell'];
    if (r === 0) cls.push('sc-r0');
    else if (reg[i - n] !== g) cls.push('sc-t');
    if (c === 0) cls.push('sc-c0');
    else if (reg[i - 1] !== g) cls.push('sc-l');
    base.push(cls.join(' '));

    const cell = document.createElement('div');
    cell.className = base[i];
    // golden-angle hues keep tables apart; alternate lightness too
    cell.style.setProperty('--sc-h', String(safeHue(g)));
    cell.style.setProperty('--sc-lit', g % 2 ? '84%' : '90%');
    cell.style.setProperty('--sc-dim', g % 2 ? '27%' : '33%');
    cell.setAttribute('role', 'gridcell');
    const glyph = document.createElement('span');
    cell.append(glyph);
    cells.push(cell);
    board.append(cell);
  }
  el.replaceChildren(board);

  const grace = makeGrace(() => render());

  // Red only for clashes between seated guests: same row, column or table,
  // or touching. A clash turns red once both guests have sat still for two
  // seconds.
  function clashes() {
    const bad = new Uint8Array(size);
    const guests = [];
    let clash = false;
    for (let i = 0; i < size; i++) if (marks[i] === GUEST) guests.push(i);
    for (let a = 0; a < guests.length; a++) {
      for (let b = a + 1; b < guests.length; b++) {
        const x = guests[a];
        const y = guests[b];
        if (!sameUnit(x, y) && !touches(x, y)) continue;
        clash = true;
        if (grace.ripe([x, y])) { bad[x] = 1; bad[y] = 1; }
      }
    }
    return { bad, ok: guests.length === n && !clash };
  }

  function render() {
    grace.see(marks);
    const { bad, ok } = clashes();
    for (let i = 0; i < size; i++) {
      let cls = base[i];
      if (marks[i] === CROSS) cls += ' sc-x';
      else if (marks[i] === GUEST) cls += ' sc-g';
      if (bad[i]) cls += ' sc-bad';
      if (shown?.area.has(i)) cls += ' sc-hint-area';
      if (shown?.target.has(i)) cls += ' sc-hint-target';
      cells[i].className = cls;
      const glyph = cells[i].firstChild;
      if (marks[i] === GUEST) glyph.className = 'sc-guest';
      else if (marks[i] === CROSS) glyph.className = 'sc-cross';
      else if (shown?.ghost.has(i)) glyph.className = 'sc-guest sc-faint';
      else glyph.className = '';
      glyph.textContent = marks[i] === CROSS ? '×' : '';
    }
    board.classList.toggle('sc-solved', ok);
    el.classList.toggle('solved', ok);
    if (ok && !fired) {
      fired = true;
      onSolved?.();
    }
  }

  function clearHint() {
    if (!shown) return false;
    shown = null;
    return true;
  }

  // --- pointer input -------------------------------------------------------

  let drag = null;

  function cellAt(e) {
    const rect = board.getBoundingClientRect();
    const x = e.clientX - rect.left - board.clientLeft;
    const y = e.clientY - rect.top - board.clientTop;
    const c = Math.floor(x / (board.clientWidth / n));
    const r = Math.floor(y / (board.clientHeight / n));
    if (r < 0 || r >= n || c < 0 || c >= n) return -1;
    return r * n + c;
  }

  function paint(i) {
    if (drag.mode === 'cross' && marks[i] === EMPTY) marks[i] = CROSS;
    else if (drag.mode === 'clear' && marks[i] === CROSS) marks[i] = EMPTY;
  }

  function onDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const i = cellAt(e);
    if (i < 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, start: i, last: i, moved: false, mode: null, before: marks.slice() };
    if (clearHint()) render();
    try { board.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const i = cellAt(e);
    if (i < 0 || i === drag.last) return;
    if (!drag.moved) {
      drag.moved = true;
      const from = marks[drag.start];
      drag.mode = from === EMPTY ? 'cross' : from === CROSS ? 'clear' : null;
      if (drag.mode) paint(drag.start);
    }
    drag.last = i;
    if (drag.mode) {
      paint(i);
      render();
    }
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      const i = drag.start;
      marks[i] = (marks[i] + 1) % 3;
    }
    // one undo step per tap or drag, and only if something changed
    if (marks.some((m, i) => m !== drag.before[i])) history.push(drag.before);
    drag = null;
    render();
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // keep whatever a cancelled drag already painted, as one undo step
    if (marks.some((m, i) => m !== drag.before[i])) history.push(drag.before);
    drag = null;
  }

  const stop = (e) => e.preventDefault();

  board.addEventListener('pointerdown', onDown);
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onCancel);
  board.addEventListener('lostpointercapture', onCancel);
  board.addEventListener('contextmenu', stop);

  render();

  return {
    reset() {
      marks.fill(EMPTY);
      history.length = 0;
      fired = false;
      drag = null;
      shown = null;
      render();
    },
    reveal() {
      marks.fill(EMPTY);
      puzzle.solution.forEach((c, r) => { marks[r * n + c] = GUEST; });
      history.length = 0;
      fired = true; // showing the answer is not solving it
      drag = null;
      shown = null;
      render();
    },
    undo() {
      if (drag) return;
      const before = history.pop();
      if (!before) return;
      marks.set(before);
      shown = null;
      render();
    },
    hint() {
      const h = findHint(puzzle, marks);
      shown = h && { target: new Set(h.target), area: new Set(h.area), ghost: new Set(h.ghost) };
      render();
      return h ? h.text : null;
    },
    destroy() {
      grace.stop();
      board.removeEventListener('pointerdown', onDown);
      board.removeEventListener('pointermove', onMove);
      board.removeEventListener('pointerup', onUp);
      board.removeEventListener('pointercancel', onCancel);
      board.removeEventListener('lostpointercapture', onCancel);
      board.removeEventListener('contextmenu', stop);
      el.classList.remove('solved');
      board.remove();
    },
  };
}
