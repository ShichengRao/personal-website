// Two Tone board. Pieces are stored as 0 (empty), 1 (A, teal disc) and
// 2 (B, plum ring). Tap or click a cell to cycle empty → A → B → empty,
// right-click to cycle backwards, and drag to paint the same value across
// more cells. Red marks only real rule breaks between placed pieces: three
// in a row, more than N/2 of one piece in a line, or a broken sign between
// two filled cells. A break turns red only after its cells have been left
// alone for two seconds (lib/grace.js), so tapping through teal on the way to
// plum never flashes red.

import { nextStep } from './generate.js';
import { makeGrace } from '../../lib/grace.js';

export const rules = [
  'Fill every cell with a teal disc or a plum ring.',
  'Each row and each column holds as many teal as plum.',
  'No three of the same in a row, across or down.',
  'Cells joined by = hold the same piece. Cells joined by × hold different pieces.',
  'Shaded cells are given and stay fixed.',
  'Tap a cell to cycle teal, plum, empty. Drag to paint. Right-click goes backwards.',
];

const code = (ch) => (ch === 'A' ? 1 : ch === 'B' ? 2 : 0);
const NAME = ['', 'teal', 'plum'];

export function mount(el, puzzle, { onSolved } = {}) {
  const n = puzzle.size;
  const half = n / 2;
  const given = Array.from(puzzle.givens, code);
  const answer = Array.from(puzzle.solution, code);
  let val = given.slice();
  let bad = new Uint8Array(n * n);
  let locked = false;
  let fired = false;
  let history = []; // one entry per tap or drag: [[cell, value before], ...]
  let action = null; // the entry the current tap or drag is writing to

  el.style.setProperty('--n', n);
  el.classList.remove('solved');

  const root = document.createElement('div');
  root.className = 'tt';
  const grid = document.createElement('div');
  grid.className = 'grid tt-grid';
  root.append(grid);

  const cells = [];
  for (let i = 0; i < n * n; i++) {
    const cell = document.createElement('div');
    cell.className = 'tt-cell';
    if (i % n === n - 1) cell.classList.add('tt-right');
    if (i >= n * (n - 1)) cell.classList.add('tt-bottom');
    if (given[i]) cell.classList.add('tt-given');
    cell.dataset.i = String(i);
    const disc = document.createElement('span');
    disc.className = 'tt-disc';
    cell.append(disc);
    grid.append(cell);
    cells.push(cell);
  }

  // Signs sit on the shared edge of their two cells.
  const signs = [];
  const addSign = (ch, a, b, x, y, dir) => {
    if (ch !== '=' && ch !== 'x') return;
    const s = document.createElement('span');
    s.className = `tt-sign tt-${dir}`;
    s.textContent = ch === '=' ? '=' : '×';
    s.style.left = `calc(var(--cell) * ${x})`;
    s.style.top = `calc(var(--cell) * ${y})`;
    grid.append(s);
    signs.push({ same: ch === '=', a, b, el: s });
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n - 1; c++) {
      addSign(puzzle.hsigns[r * (n - 1) + c], r * n + c, r * n + c + 1, c + 1, r + 0.5, 'h');
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n; c++) {
      addSign(puzzle.vsigns[r * n + c], r * n + c, (r + 1) * n + c, c + 0.5, r + 1, 'v');
    }
  }

  el.append(root);

  // Lines 0..n-1 are rows, n..2n-1 columns (the generator's numbering).
  const lines = [];
  for (let k = 0; k < n; k++) lines.push(Array.from({ length: n }, (_, i) => k * n + i));
  for (let k = 0; k < n; k++) lines.push(Array.from({ length: n }, (_, i) => i * n + k));

  const isSolved = () => val.every((v, i) => v === answer[i]);

  const grace = makeGrace(() => render());

  function render() {
    grace.see(val);
    bad = new Uint8Array(n * n);
    // Marks one rule break red, once its cells have been still long enough.
    const mark = (group) => {
      if (!grace.ripe(group)) return false;
      for (const i of group) bad[i] = 1;
      return true;
    };
    for (const line of lines) {
      const count = [0, 0, 0];
      for (const i of line) count[val[i]]++;
      for (const v of [1, 2]) {
        if (count[v] > half) mark(line.filter((i) => val[i] === v));
      }
      for (let k = 0; k + 2 < n; k++) {
        const v = val[line[k]];
        if (v && val[line[k + 1]] === v && val[line[k + 2]] === v) mark([line[k], line[k + 1], line[k + 2]]);
      }
    }
    for (const s of signs) {
      const va = val[s.a];
      const vb = val[s.b];
      const broken = !!va && !!vb && (va === vb) !== s.same && mark([s.a, s.b]);
      s.el.classList.toggle('tt-bad', broken);
    }
    for (let i = 0; i < n * n; i++) {
      const c = cells[i];
      c.classList.toggle('tt-a', val[i] === 1);
      c.classList.toggle('tt-b', val[i] === 2);
      c.classList.toggle('tt-bad', !!bad[i]);
    }
  }

  function update() {
    render();
    if (locked || !isSolved()) return;
    locked = true;
    el.classList.add('solved');
    if (!fired) {
      fired = true;
      onSolved?.();
    }
  }

  // ---- hints

  const clearHint = () => {
    for (const c of cells) c.classList.remove('tt-hint', 'tt-hint-why');
  };

  const showHint = (targets, why) => {
    clearHint();
    for (const i of why) cells[i].classList.add('tt-hint-why');
    for (const i of targets) {
      cells[i].classList.remove('tt-hint-why');
      cells[i].classList.add('tt-hint');
    }
  };

  const lineName = (l) => (l < n ? `row ${l + 1}` : `column ${l - n + 1}`);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const pieces = (k, v) => `${k} ${NAME[v]} piece${k === 1 ? '' : 's'}`;
  const targetsOf = (step) => step.cells.filter((_, k) => k % 2 === 0);

  // Turns a grader step into one plain sentence plus the cells to outline.
  function explain(step) {
    const t = step.cells[0];
    const tv = step.cells[1];
    const all = targetsOf(step);
    switch (step.name) {
      case 'sign': {
        const ch = step.s === 1 ? '=' : '×';
        return {
          text: `The ${ch} sign ties this cell to a ${NAME[val[step.why[0]]]} neighbour, ` +
            `so it must be ${NAME[tv]}${ch === '=' ? ' too' : ''}.`,
          targets: [t],
          why: step.why,
        };
      }
      case 'pair':
        return {
          text: `These two ${NAME[step.v]} pieces sit side by side, so the ` +
            `${all.length > 1 ? 'cells on either side' : 'cell next to them'} must be ${NAME[3 - step.v]}.`,
          targets: all,
          why: step.why,
        };
      case 'gap':
        return {
          text: `This cell sits between two ${NAME[step.v]} pieces, so it must be ${NAME[3 - step.v]}.`,
          targets: [t],
          why: step.why,
        };
      case 'full line':
        return {
          text: `${cap(lineName(step.line))} already has its ${pieces(half, step.v)}, ` +
            `so its other cells must be ${NAME[3 - step.v]}.`,
          targets: all,
          why: step.why,
        };
      case 'twin':
        return {
          text: `These two cells must match, and two more ${NAME[step.v]} beside that ${NAME[step.v]} piece ` +
            `would make three in a row, so both must be ${NAME[3 - step.v]}.`,
          targets: all,
          why: step.why,
        };
      case 'split':
        return {
          text: `Each × pair in ${lineName(step.line)} holds one ${NAME[step.v]}, which brings it to ` +
            `${half} ${NAME[step.v]}, so its other empty cells must be ${NAME[3 - step.v]}.`,
          targets: all,
          why: step.why,
        };
      case 'line':
        return {
          text: `Every way to finish ${lineName(step.line)} without breaking a rule puts ${NAME[tv]} in this cell.`,
          targets: [t],
          why: lines[step.line],
        };
      case 'linked lines': {
        const [l1, l2] = step.lines;
        const kind = l1 < n ? 'Rows' : 'Columns';
        const num = (l) => (l < n ? l + 1 : l - n + 1);
        return {
          text: `${kind} ${num(l1)} and ${num(l2)} are tied together by signs, and every way to finish ` +
            `both without breaking a rule puts ${NAME[tv]} in this cell.`,
          targets: [t],
          why: [...lines[l1], ...lines[l2]],
        };
      }
      default: {
        // what-if and deep what-if
        const brk = step.brk ?? { kind: 'cell', index: t };
        let outcome;
        let why;
        if (brk.kind === 'line') {
          outcome = `break ${lineName(brk.index)}`;
          why = lines[brk.index];
        } else if (brk.kind === 'sign') {
          outcome = 'break a sign';
          const e = brk.index;
          const H = n * (n - 1);
          const r = Math.floor(e / (n - 1));
          why = e < H ? [r * n + (e % (n - 1)), r * n + (e % (n - 1)) + 1] : [e - H, e - H + n];
        } else {
          outcome = 'need one cell to be both teal and plum';
          why = [brk.index];
        }
        return {
          text: `If this cell were ${NAME[step.assume]}, the moves it forces would ${outcome}, ` +
            `so it must be ${NAME[tv]}.`,
          targets: [t],
          why,
        };
      }
    }
  }

  function hint() {
    if (locked || isSolved()) return null;
    // Mistakes first, preferring one that is already part of a red rule break.
    const wrong = [];
    for (let i = 0; i < n * n; i++) if (val[i] && val[i] !== answer[i]) wrong.push(i);
    if (wrong.length) {
      const i = wrong.find((k) => bad[k]) ?? wrong[0];
      showHint([i], []);
      return `This ${NAME[val[i]]} piece is a mistake and should be ${NAME[answer[i]]}.`;
    }
    const step = nextStep(puzzle, val);
    if (!step) {
      // Not expected: the grader can always move on a correct board. Give a cell.
      const i = val.findIndex((v) => !v);
      showHint([i], []);
      return `This cell is ${NAME[answer[i]]}.`;
    }
    const { text, targets, why } = explain(step);
    showHint(targets, why);
    return text;
  }

  // ---- input: pointer events cover mouse, pen and touch
  let paint = -1; // value being painted while a pointer is down
  let pointer = null;
  let last = -1;

  const cellAt = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    const cell = hit?.closest?.('.tt-cell');
    return cell && grid.contains(cell) ? Number(cell.dataset.i) : -1;
  };

  const set = (i, v) => {
    if (given[i] || val[i] === v) return;
    action?.push([i, val[i]]);
    val[i] = v;
    update();
  };

  const endDrag = () => {
    if (action?.length) history.push(action);
    action = null;
    pointer = null;
    paint = -1;
    last = -1;
  };

  const onDown = (e) => {
    if (locked || pointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    const cell = e.target.closest?.('.tt-cell');
    if (!cell || !grid.contains(cell)) return;
    e.preventDefault();
    clearHint();
    const i = Number(cell.dataset.i);
    if (given[i]) return;
    paint = e.button === 2 ? (val[i] + 2) % 3 : (val[i] + 1) % 3;
    pointer = e.pointerId;
    last = i;
    action = [];
    try {
      grid.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety: painting still works inside the grid */
    }
    set(i, paint);
  };

  const onMove = (e) => {
    if (e.pointerId !== pointer || locked) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || i === last) return;
    last = i;
    set(i, paint);
  };

  const onEnd = (e) => {
    if (e.pointerId === pointer) endDrag();
  };

  const onMenu = (e) => e.preventDefault();

  grid.addEventListener('pointerdown', onDown);
  grid.addEventListener('pointermove', onMove);
  grid.addEventListener('pointerup', onEnd);
  grid.addEventListener('pointercancel', onEnd);
  grid.addEventListener('lostpointercapture', onEnd);
  grid.addEventListener('contextmenu', onMenu);

  render();

  return {
    reset() {
      val = given.slice();
      locked = false;
      fired = false;
      history = [];
      action = null;
      pointer = null;
      clearHint();
      el.classList.remove('solved');
      render();
    },
    reveal() {
      val = answer.slice();
      locked = true;
      action = null;
      pointer = null;
      clearHint();
      render();
    },
    undo() {
      if (locked) return;
      if (pointer !== null) endDrag();
      const step = history.pop();
      if (!step) return;
      clearHint();
      for (let k = step.length - 1; k >= 0; k--) val[step[k][0]] = step[k][1];
      update();
    },
    hint,
    destroy() {
      grace.stop();
      grid.removeEventListener('pointerdown', onDown);
      grid.removeEventListener('pointermove', onMove);
      grid.removeEventListener('pointerup', onEnd);
      grid.removeEventListener('pointercancel', onEnd);
      grid.removeEventListener('lostpointercapture', onEnd);
      grid.removeEventListener('contextmenu', onMenu);
      root.remove();
      el.classList.remove('solved');
      el.style.removeProperty('--n');
    },
  };
}
