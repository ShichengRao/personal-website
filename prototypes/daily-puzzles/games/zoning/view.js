// Zoning view: drag across the grid to draw a lot, tap a lot to remove it.
// undo() steps back one draw or removal. hint() names a mistake, or explains
// the next deduction from the grader, and highlights it until the next action.

import { buildBoard, initState, place as placeRect, kill, findNext } from './grader.js';
import { makeGrace } from '../../lib/grace.js';
import { safeHue } from '../../lib/hue.js';

export const rules = [
  'Split the grid into rectangles.',
  'Each rectangle holds exactly one number.',
  'The number is how many cells its rectangle covers.',
  'On easier days, a small mark under a number shows its rectangle’s shape: square, wide or tall.',
  'Drag from one corner to the opposite corner to draw a rectangle. Tap a rectangle to remove it.',
];

const SHAPE_NAME = { S: 'square', W: 'wide', T: 'tall' };

export function mount(el, puzzle, { onSolved }) {
  const N = puzzle.size;
  const clues = [];
  for (let i = 0; i < puzzle.clues.length; i += 2) {
    const cell = puzzle.clues[i];
    const shape = puzzle.shapes?.[i / 2];
    clues.push({
      r: Math.floor(cell / N),
      c: cell % N,
      area: puzzle.clues[i + 1],
      shape: SHAPE_NAME[shape] ? shape : '',
    });
  }
  const clueAt = new Map(clues.map((cl, k) => [cl.r * N + cl.c, k]));

  el.classList.add('zoning');
  el.classList.remove('solved');
  el.style.setProperty('--n', N);

  const grid = document.createElement('div');
  grid.className = 'grid zoning-grid';
  const put = (node, r, c, h = 1, w = 1) => {
    node.style.gridRow = `${r + 1} / span ${h}`;
    node.style.gridColumn = `${c + 1} / span ${w}`;
  };

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'zoning-cell';
      if (c === N - 1) cell.classList.add('zoning-last-col');
      if (r === N - 1) cell.classList.add('zoning-last-row');
      put(cell, r, c);
      grid.append(cell);
    }
  }

  const lotLayer = [];
  const preview = document.createElement('div');
  preview.className = 'zoning-preview';
  preview.hidden = true;
  grid.append(preview);

  const clueEls = clues.map((cl) => {
    const node = document.createElement('div');
    node.className = 'zoning-clue';
    const num = document.createElement('span');
    num.textContent = String(cl.area);
    node.append(num);
    if (cl.shape) {
      const mark = document.createElement('span');
      mark.className = `zoning-shape zoning-shape-${cl.shape}`;
      mark.title = SHAPE_NAME[cl.shape];
      node.append(mark);
    }
    put(node, cl.r, cl.c);
    grid.append(node);
    return node;
  });

  el.append(grid);

  // ---- state ---------------------------------------------------------------

  let lots = []; // { r, c, h, w }, never mutated, so history can share them
  const history = []; // earlier versions of lots, for undo
  let drag = null; // { id, a, b, moved }
  let locked = false; // after solving or revealing, until reset

  const overlaps = (p, q) => p.r < q.r + q.h && q.r < p.r + p.h && p.c < q.c + q.w && q.c < p.c + p.w;
  const contains = (p, r, c) => r >= p.r && r < p.r + p.h && c >= p.c && c < p.c + p.w;
  const shapeOk = (s, h, w) => !s || (s === 'S' ? h === w : s === 'W' ? w > h : h > w);
  const cluesIn = (lot) => clues.flatMap((cl, k) => (contains(lot, cl.r, cl.c) ? [k] : []));

  // A lot is settled when it holds exactly one number, of its own area
  // and shape. Returns that clue's index, or -1.
  function settledClue(lot) {
    let found = -1;
    for (let k = 0; k < clues.length; k++) {
      if (!contains(lot, clues[k].r, clues[k].c)) continue;
      if (found >= 0) return -1;
      found = k;
    }
    if (found < 0) return -1;
    const cl = clues[found];
    return cl.area === lot.h * lot.w && shapeOk(cl.shape, lot.h, lot.w) ? found : -1;
  }

  const grace = makeGrace(() => render());
  const cellsOf = (lot) => {
    const out = [];
    for (let r = lot.r; r < lot.r + lot.h; r++) for (let c = lot.c; c < lot.c + lot.w; c++) out.push(r * N + c);
    return out;
  };

  function render() {
    for (const node of lotLayer) node.remove();
    lotLayer.length = 0;
    // Which lot covers each cell, so the grace clock restarts when a lot
    // there is drawn, removed or undone. A wrong lot turns red once it has
    // stood for two seconds. Until then it shows as a plain dashed outline.
    const owner = new Array(N * N).fill(null);
    for (const lot of lots) for (const i of cellsOf(lot)) owner[i] = lot;
    grace.see(owner);
    const badClue = new Set();
    let covered = 0;
    let allOk = true;
    for (const lot of lots) {
      const k = settledClue(lot);
      const node = document.createElement('div');
      node.className = 'zoning-lot';
      put(node, lot.r, lot.c, lot.h, lot.w);
      if (k >= 0) {
        node.classList.add('zoning-ok');
        node.style.setProperty('--hue', String(safeHue(k)));
      } else {
        allOk = false;
        if (grace.ripe(cellsOf(lot))) {
          node.classList.add('zoning-bad');
          clues.forEach((cl, j) => { if (contains(lot, cl.r, cl.c)) badClue.add(j); });
        } else {
          node.classList.add('zoning-wait');
        }
      }
      covered += lot.h * lot.w;
      grid.insertBefore(node, preview);
      lotLayer.push(node);
    }
    clueEls.forEach((node, k) => node.classList.toggle('zoning-wrong', badClue.has(k)));
    return allOk && covered === N * N;
  }

  function update() {
    const solved = render();
    if (solved && !locked) {
      locked = true;
      el.classList.add('solved');
      onSolved?.();
    }
  }

  function commit(next) {
    history.push(lots);
    lots = next;
    update();
  }

  function addLot(lot) {
    commit([...lots.filter((q) => !overlaps(q, lot)), lot]);
  }

  function tap(r, c) {
    const i = lots.findIndex((q) => contains(q, r, c));
    if (i >= 0) {
      commit(lots.filter((_, j) => j !== i));
      return;
    }
    const k = clueAt.get(r * N + c);
    if (k !== undefined && clues[k].area === 1) addLot({ r, c, h: 1, w: 1 });
  }

  // ---- hints ----------------------------------------------------------------

  const board = buildBoard(N, clues.map((cl) => ({ cell: cl.r * N + cl.c, area: cl.area, shape: cl.shape })));
  const solution = clues.map((_, k) => {
    const [r, c, h, w] = puzzle.solution.slice(k * 4, k * 4 + 4);
    return { r, c, h, w };
  });
  const sameLot = (p, q) => p.r === q.r && p.c === q.c && p.h === q.h && p.w === q.w;
  const rectOf = (i) => {
    const [r, c, h, w] = board.cRect[i];
    return { r, c, h, w };
  };
  const solutionRect = solution.map((s, k) => board.clueCands[k].find((i) => sameLot(rectOf(i), s)));
  const known = new Set(); // rectangles earlier hints ruled out (always true facts)
  const hintEls = [];

  function clearHint() {
    for (const node of hintEls) node.remove();
    hintEls.length = 0;
  }

  // kind 'on' tints cells, 'out' outlines a rectangle.
  function showHint(parts) {
    for (const { r, c, h = 1, w = 1, kind } of parts) {
      const node = document.createElement('div');
      node.className = `zoning-hint zoning-hint-${kind}`;
      put(node, r, c, h, w);
      grid.insertBefore(node, preview);
      hintEls.push(node);
    }
  }

  const isRight = (lot) => {
    const inside = cluesIn(lot);
    return inside.length === 1 && sameLot(lot, solution[inside[0]]);
  };

  function mistakeText(lot) {
    const inside = cluesIn(lot);
    if (!inside.length) return 'This rectangle has no number in it.';
    if (inside.length > 1) return 'This rectangle holds more than one number.';
    const cl = clues[inside[0]];
    const area = lot.h * lot.w;
    if (area !== cl.area) return `This rectangle covers ${area} cells, but its number is ${cl.area}.`;
    if (!shapeOk(cl.shape, lot.h, lot.w)) return `This ${cl.area} is marked ${SHAPE_NAME[cl.shape]}, but its rectangle isn't.`;
    return `This rectangle fits the ${cl.area}, but the ${cl.area} goes somewhere else.`;
  }

  const sizeWords = ({ h, w }) => (h === 1 ? `a row of ${w}` : w === 1 ? `a column of ${h}` : h === w ? `${h} by ${w}` : `${h} tall and ${w} wide`);
  const cellAtIndex = (i) => ({ r: Math.floor(i / N), c: i % N });
  const clueMark = (k) => ({ r: clues[k].r, c: clues[k].c, kind: 'on' });

  function stepHint(step) {
    const A = clues[step.k].area;
    switch (step.t) {
      case 'single fit':
        showHint([{ ...rectOf(step.i), kind: 'on' }]);
        return `The ${A} here can only fit one way: ${sizeWords(rectOf(step.i))}.`;
      case 'single reach':
        showHint([clueMark(step.k), { ...cellAtIndex(step.cell), kind: 'on' }]);
        return `Only the ${A} can reach the marked cell.`;
      case 'overlap':
        showHint([clueMark(step.k), ...step.cells.map((i) => ({ ...cellAtIndex(i), kind: 'on' }))]);
        return `However the ${A} is placed, it covers the marked cells.`;
      case 'squeeze': {
        const parts = [clueMark(step.k), { ...rectOf(step.i), kind: 'out' }];
        const { clue, cell } = step.broken;
        if (clue !== undefined) {
          parts.push(clueMark(clue));
          showHint(parts);
          const other = clues[clue].area === A ? `other ${A}` : String(clues[clue].area);
          return `The ${A} can't take the outlined spot, or the ${other} would have no room.`;
        }
        if (cell !== undefined) parts.push({ ...cellAtIndex(cell), kind: 'on' });
        showHint(parts);
        return `The ${A} can't take the outlined spot, or the marked cell could not be covered.`;
      }
      default: {
        showHint([clueMark(step.k), { ...rectOf(step.i), kind: 'out' }]);
        const moves = step.d === 1 ? 'one forced move' : `${step.d} forced moves`;
        return `If the ${A} took the outlined spot, ${moves} later something would run out of room, so it goes elsewhere.`;
      }
    }
  }

  function hint() {
    clearHint();
    if (locked) return null;
    for (let x = lots.length - 1; x >= 0; x--) {
      if (!isRight(lots[x])) {
        showHint([{ ...lots[x], kind: 'out' }]);
        return mistakeText(lots[x]);
      }
    }
    const st = initState(board);
    for (const lot of lots) placeRect(board, st, solutionRect[cluesIn(lot)[0]]);
    for (const i of known) kill(board, st, i);
    const step = st.bad ? null : findNext(board, st, { maxTier: 4, maxChain: 12 });
    if (step) {
      if (step.kills) for (const i of step.kills) known.add(i);
      return stepHint(step);
    }
    // Fallback, not expected: show one rectangle that isn't drawn yet.
    const k = solution.findIndex((s) => !lots.some((q) => sameLot(q, s)));
    if (k < 0) return null;
    showHint([{ ...solution[k], kind: 'on' }]);
    return `The ${clues[k].area} here goes in the marked spot.`;
  }

  // ---- pointer input -------------------------------------------------------

  function cellAt(e) {
    const box = grid.getBoundingClientRect();
    const size = grid.clientWidth / N;
    const clamp = (v) => Math.max(0, Math.min(N - 1, v));
    return {
      r: clamp(Math.floor((e.clientY - box.top - grid.clientTop) / size)),
      c: clamp(Math.floor((e.clientX - box.left - grid.clientLeft) / size)),
    };
  }

  const span = (a, b) => ({
    r: Math.min(a.r, b.r),
    c: Math.min(a.c, b.c),
    h: Math.abs(a.r - b.r) + 1,
    w: Math.abs(a.c - b.c) + 1,
  });

  function showPreview() {
    const s = span(drag.a, drag.b);
    put(preview, s.r, s.c, s.h, s.w);
    preview.textContent = String(s.h * s.w);
    preview.hidden = false;
  }

  function endDrag() {
    drag = null;
    preview.hidden = true;
  }

  function onDown(e) {
    if (locked || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    clearHint();
    try { grid.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const p = cellAt(e);
    drag = { id: e.pointerId, a: p, b: p, moved: false };
    showPreview();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const p = cellAt(e);
    if (p.r === drag.b.r && p.c === drag.b.c) return;
    drag.b = p;
    drag.moved = true;
    showPreview();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { a, b, moved } = drag;
    endDrag();
    if (a.r !== b.r || a.c !== b.c) addLot(span(a, b));
    else if (!moved) tap(a.r, a.c);
    // Dragging away and back to the start cell cancels.
  }

  function onCancel(e) {
    if (drag && e.pointerId === drag.id) endDrag();
  }

  grid.addEventListener('pointerdown', onDown);
  grid.addEventListener('pointermove', onMove);
  grid.addEventListener('pointerup', onUp);
  grid.addEventListener('pointercancel', onCancel);
  grid.addEventListener('lostpointercapture', onCancel);

  update();

  return {
    undo() {
      endDrag();
      clearHint();
      if (locked || !history.length) return;
      lots = history.pop();
      update();
    },
    hint,
    reset() {
      endDrag();
      clearHint();
      lots = [];
      history.length = 0;
      known.clear();
      locked = false;
      el.classList.remove('solved');
      update();
    },
    reveal() {
      endDrag();
      clearHint();
      lots = clues.map((_, k) => {
        const [r, c, h, w] = puzzle.solution.slice(k * 4, k * 4 + 4);
        return { r, c, h, w };
      });
      locked = true;
      render();
    },
    destroy() {
      grace.stop();
      endDrag();
      clearHint();
      grid.removeEventListener('pointerdown', onDown);
      grid.removeEventListener('pointermove', onMove);
      grid.removeEventListener('pointerup', onUp);
      grid.removeEventListener('pointercancel', onCancel);
      grid.removeEventListener('lostpointercapture', onCancel);
      grid.remove();
      el.classList.remove('zoning', 'solved');
      el.style.removeProperty('--n');
    },
  };
}
