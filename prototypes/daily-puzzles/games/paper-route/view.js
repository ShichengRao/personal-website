// Paper Route board: draw one route through every cell, passing the numbered
// stops in order. Pointer events drive it, so mouse and touch behave the same.
// Red marks only real rule breaks in the drawn route: a stop reached out of
// order, or the last stop reached while cells are still empty. A break turns
// red once that step has stood for two seconds. Hints use amber.

import { makeBoard, hintState, findHint, LINE } from './solver.js';
import { makeGrace } from '../../lib/grace.js';

export const rules = [
  'Draw one route from stop 1 to the highest number.',
  'Pass the numbered stops in order.',
  'Visit every cell exactly once.',
  'Move up, down, left or right, never through a thick wall.',
  'Drag from 1, or from the end of your route, to draw. Drag back to undo.',
  'Tap any cell on the route to cut it back to there.',
];

const SVG = 'http://www.w3.org/2000/svg';
const S = 100; // svg units per cell (whole numbers keep text sizes sane)

function svgEl(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.append(node);
  return node;
}

export function mount(el, puzzle, { onSolved } = {}) {
  const N = puzzle.size;
  const V = N * N;
  const stops = puzzle.stops;
  const K = stops.length;
  const first = stops[0];
  const last = stops[K - 1];
  const stopAt = new Map(stops.map((v, i) => [v, i + 1]));
  const wallSet = new Set();
  const walls = puzzle.walls ?? [];
  for (let i = 0; i + 1 < walls.length; i += 2) {
    wallSet.add(Math.min(walls[i], walls[i + 1]) * V + Math.max(walls[i], walls[i + 1]));
  }
  const rowOf = (v) => Math.floor(v / N);
  const colOf = (v) => v % N;
  const adjacent = (a, b) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1;
  const walled = (a, b) => wallSet.has(Math.min(a, b) * V + Math.max(a, b));
  const cx = (v) => (colOf(v) + 0.5) * S;
  const cy = (v) => (rowOf(v) + 0.5) * S;

  // ------------------------------------------------------------- markup ----
  el.style.setProperty('--n', N);
  el.classList.add('pr-host');
  el.classList.remove('solved');

  const board = document.createElement('div');
  board.className = 'grid pr-board';
  const cells = [];
  for (let v = 0; v < V; v++) {
    const cell = document.createElement('div');
    cell.className = 'pr-cell';
    board.append(cell);
    cells.push(cell);
  }

  const svg = svgEl('svg', { class: 'pr-svg', viewBox: `0 0 ${N * S} ${N * S}`, 'aria-hidden': 'true' });
  const wallLayer = svgEl('g', { class: 'pr-walls' }, svg);
  const routeOk = svgEl('polyline', { class: 'pr-route' }, svg);
  const routeBad = svgEl('polyline', { class: 'pr-route pr-route-bad' }, svg);
  const head = svgEl('circle', { class: 'pr-head', r: 17 }, svg);
  const hintLayer = svgEl('g', { class: 'pr-hint-marks' }, svg);
  const stopLayer = svgEl('g', { class: 'pr-stops' }, svg);

  for (let i = 0; i + 1 < walls.length; i += 2) {
    const a = Math.min(walls[i], walls[i + 1]);
    const b = Math.max(walls[i], walls[i + 1]);
    const r = rowOf(a);
    const c = colOf(a);
    // b is right of a (same row) or below it.
    const attrs = b === a + 1
      ? { x1: (c + 1) * S, y1: r * S, x2: (c + 1) * S, y2: (r + 1) * S }
      : { x1: c * S, y1: (r + 1) * S, x2: (c + 1) * S, y2: (r + 1) * S };
    svgEl('line', attrs, wallLayer);
  }

  const stopNodes = new Map();
  stops.forEach((v, i) => {
    const g = svgEl('g', { class: 'pr-stop' }, stopLayer);
    svgEl('circle', { cx: cx(v), cy: cy(v), r: 34 }, g);
    const text = svgEl('text', { x: cx(v), y: cy(v) }, g);
    text.textContent = String(i + 1);
    stopNodes.set(v, g);
  });

  board.append(svg);
  el.replaceChildren(board);

  // -------------------------------------------------------------- state ----
  let route = [];
  let onRoute = new Map(); // cell -> index in route
  let solvedOnce = false;
  let revealed = false;
  let dragId = null;
  let lastSeen = -1; // cell under the pointer at the previous move, edges included
  let history = []; // routes before each stroke, tap or extension
  let strokeStart = null; // route when the current press began
  let facts = []; // [cellA, cellB, LINE|CROSS] that earlier hints proved
  let hinted = new Set(); // cells the current hint highlights
  const board0 = makeBoard(N, stops, walls);

  const centre = (v) => `${cx(v)},${cy(v)}`;

  // Index of the first step that breaks a rule, or -1.
  function firstFault() {
    let due = 1;
    for (let i = 0; i < route.length; i++) {
      const k = stopAt.get(route[i]);
      if (!k) continue;
      if (k !== due) return i; // stop out of order
      if (k === K && i < V - 1) return i; // reached the end with cells left
      due++;
    }
    return -1;
  }

  function isSolved() {
    return route.length === V && firstFault() < 0 && route[V - 1] === last;
  }

  const grace = makeGrace(() => render());

  function render() {
    // Each cell's place on the route, so the grace clock restarts whenever
    // the step behind a break moves.
    grace.see(Array.from({ length: V }, (_, v) => onRoute.get(v) ?? -1));
    const raw = firstFault();
    const fault = raw >= 0 && grace.ripe([route[raw]]) ? raw : -1;
    const goodEnd = fault < 0 ? route.length : fault + 1;
    routeOk.setAttribute('points', route.slice(0, goodEnd).map(centre).join(' '));
    routeBad.setAttribute('points', fault < 0 ? '' : route.slice(fault).map(centre).join(' '));

    for (let v = 0; v < V; v++) {
      cells[v].classList.toggle('pr-on', onRoute.has(v));
      cells[v].classList.toggle('pr-hint', hinted.has(v));
    }

    let due = 1;
    for (const v of route) {
      if (stopAt.get(v) === due) due++;
      else if (stopAt.has(v)) break;
    }
    for (const [v, g] of stopNodes) {
      const k = stopAt.get(v);
      const idx = onRoute.get(v);
      g.classList.toggle('pr-hit', idx !== undefined && (fault < 0 || idx < fault));
      g.classList.toggle('pr-bad', fault >= 0 && idx === fault);
      g.classList.toggle('pr-next', fault < 0 && k === due && (route.length > 0 || k === 1));
    }

    if (route.length && !stopAt.has(route[route.length - 1])) {
      const v = route[route.length - 1];
      head.setAttribute('cx', cx(v));
      head.setAttribute('cy', cy(v));
      head.classList.toggle('pr-head-bad', fault >= 0);
      head.style.display = '';
    } else {
      head.style.display = 'none';
    }

    const solved = route.length === V && raw < 0 && route[V - 1] === last;
    el.classList.toggle('solved', solved && !revealed);
    if (solved && !solvedOnce && !revealed) {
      solvedOnce = true;
      onSolved?.();
    }
  }

  function setRoute(next) {
    route = next;
    onRoute = new Map(route.map((v, i) => [v, i]));
    render();
  }

  // Moves the route's head one cell to v if allowed: back onto the previous
  // cell retracts, a free neighbour extends. Returns whether anything changed.
  function step(v) {
    const n = route.length;
    if (!n) return false;
    const tail = route[n - 1];
    if (n >= 2 && v === route[n - 2]) {
      onRoute.delete(tail);
      route.pop();
      return true;
    }
    if (!adjacent(tail, v) || walled(tail, v) || onRoute.has(v)) return false;
    onRoute.set(v, n);
    route.push(v);
    return true;
  }

  const canExtend = (a, b) => adjacent(a, b) && !walled(a, b) && !onRoute.has(b);

  // Follows the pointer to cell v. Fast drags can skip cells, so straight
  // runs are walked one cell at a time, a corner cut diagonally goes through
  // whichever corner cell works (preferring the one the pointer crossed), and
  // a jump back onto one of the last few route cells retracts to it.
  function dragTo(v, crossed) {
    const n = route.length;
    if (!n || v === route[n - 1]) return;
    const tail = route[n - 1];
    const dr = rowOf(v) - rowOf(tail);
    const dc = colOf(v) - colOf(tail);
    let changed = false;
    if (!dr || !dc) {
      const stepBy = Math.sign(dr) * N + Math.sign(dc);
      let at = tail;
      while (at !== v && step(at + stepBy)) {
        changed = true;
        at = route[route.length - 1];
      }
    } else if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      const viaRow = rowOf(tail) * N + colOf(v);
      const viaCol = rowOf(v) * N + colOf(tail);
      const order = crossed === viaCol ? [viaCol, viaRow] : [viaRow, viaCol];
      for (const via of order) {
        if (canExtend(tail, via) && canExtend(via, v)) {
          step(via);
          step(v);
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      const idx = onRoute.get(v);
      if (idx !== undefined && idx >= n - 3) {
        for (const gone of route.splice(idx + 1)) onRoute.delete(gone);
        changed = true;
      }
    }
    if (changed) render();
  }

  function cellAt(e, inset) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = ((e.clientX - rect.left) / rect.width) * N;
    const y = ((e.clientY - rect.top) / rect.height) * N;
    if (x < 0 || y < 0 || x >= N || y >= N) return -1;
    const c = Math.floor(x);
    const r = Math.floor(y);
    // While dragging, ignore the strip along cell edges so the route doesn't
    // flicker between two cells.
    const fx = x - c;
    const fy = y - r;
    if (fx < inset || fx > 1 - inset || fy < inset || fy > 1 - inset) return -1;
    return r * N + c;
  }

  // ------------------------------------------------------------ pointer ----
  function down(e) {
    if (dragId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const v = cellAt(e, 0);
    if (v < 0) return;
    e.preventDefault();
    clearHint();
    const before = route.slice();
    if (!route.length) {
      if (v !== first) return;
      setRoute([first]);
    } else if (onRoute.has(v)) {
      if (onRoute.get(v) !== route.length - 1) setRoute(route.slice(0, onRoute.get(v) + 1));
    } else if (step(v)) {
      render(); // pressing a free neighbour of the head extends onto it
    } else {
      return;
    }
    strokeStart = before;
    dragId = e.pointerId;
    lastSeen = v;
    try { board.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }

  function move(e) {
    if (e.pointerId !== dragId) return;
    const v = cellAt(e, 0.14);
    if (v >= 0) dragTo(v, lastSeen);
    lastSeen = cellAt(e, 0);
  }

  // One press, from pointerdown to pointerup, is one undo step.
  function commitStroke() {
    if (strokeStart && (strokeStart.length !== route.length || strokeStart.some((v, i) => v !== route[i]))) {
      history.push(strokeStart);
    }
    strokeStart = null;
  }

  function up(e) {
    if (e.pointerId !== dragId) return;
    dragId = null;
    commitStroke();
    try { board.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }

  // ------------------------------------------------------------- hints ----
  function clearHint() {
    if (!hinted.size && !hintLayer.firstChild) return;
    hinted = new Set();
    hintLayer.replaceChildren();
    render();
  }

  // Highlights cells and marks edges: a dashed line for a step the route must
  // take, a cross for one it can't.
  function showHint(cellList, marks) {
    hinted = new Set(cellList);
    hintLayer.replaceChildren();
    for (const [a, b, val] of marks) {
      const g = svgEl('g', { class: val === LINE ? 'pr-mark pr-mark-use' : 'pr-mark pr-mark-skip', 'data-a': a, 'data-b': b }, hintLayer);
      if (val === LINE) {
        svgEl('line', { x1: cx(a), y1: cy(a), x2: cx(b), y2: cy(b) }, g);
      } else {
        const mx = (cx(a) + cx(b)) / 2;
        const my = (cy(a) + cy(b)) / 2;
        svgEl('line', { x1: mx - 13, y1: my - 13, x2: mx + 13, y2: my + 13 }, g);
        svgEl('line', { x1: mx - 13, y1: my + 13, x2: mx + 13, y2: my - 13 }, g);
      }
    }
    render();
  }

  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const stopName = (v) => `stop ${stopAt.get(v)}`;

  function explain(h) {
    switch (h.kind) {
      case 'forced': {
        const k = stopAt.get(h.cell);
        if (k === 1) return 'Stop 1 has only one open side, so the route must leave through it.';
        if (k === K) return `Stop ${K} has only one open side, so the route must arrive through it.`;
        const corner = (h.cell === 0 || h.cell === N - 1 || h.cell === V - N || h.cell === V - 1) && board0.deg[h.cell] === 2;
        if (corner) return 'This corner cell has only two open sides, so the route must use both.';
        if (board0.deg[h.cell] === 2) return 'Walls leave this cell only two open sides, so the route must use both.';
        return 'This cell has only two open sides left, so the route must pass through both.';
      }
      case 'loop':
        return 'The route can\'t step between these two cells, because that would close a loop.';
      case 'early':
        return `The route can't step between these two cells, because it would reach stop ${K} before every cell is filled.`;
      case 'order': {
        const [x, y] = h.stops;
        const lo = Math.min(x, y);
        const hi = Math.max(x, y);
        if (lo && hi - lo > 1) return `The route can't step between these two cells, because it would go from stop ${lo} to stop ${hi} without passing stop ${lo + 1}.`;
        return 'The route can\'t step between these two cells, because it would pass the stops in the wrong order.';
      }
      case 'bridge':
        return 'This step is the only way into the highlighted area, so the route must use it.';
      case 'doors':
        return h.inside
          ? `The highlighted area holds stop ${K} and has two ways in, and the route already uses one, so it can't use the other.`
          : 'The highlighted area has only two ways in, so the route must come in through one and leave through the other.';
      case 'look': {
        let result;
        const k = h.cell !== undefined ? stopAt.get(h.cell) : 0;
        switch (h.why) {
          case 'dead': result = k === 1 || k === K ? `leave ${stopName(h.cell)} with no way in` : 'leave this cell a dead end'; break;
          case 'full': result = 'force a third line through this cell'; break;
          case 'loop': result = 'close a loop'; break;
          case 'order': result = 'take the stops out of order'; break;
          case 'early': result = `reach stop ${K} too soon`; break;
          default: result = 'cut off the highlighted area';
        }
        const later = h.steps === 0 ? '' : ` ${WORDS[h.steps] ?? h.steps} forced move${h.steps === 1 ? '' : 's'} later`;
        return h.tried === LINE
          ? `If the route stepped between these two cells, it would ${result}${later}, so it can't go that way.`
          : `If the route skipped the step between these two cells, it would ${result}${later}, so it must take that step.`;
      }
      default:
        return 'Look at the highlighted cells.';
    }
  }

  function hint() {
    clearHint();
    if (isSolved()) return null;
    const sol = puzzle.solution;
    let i = 0;
    while (i < route.length && route[i] === sol[i]) i++;
    if (i < route.length) {
      // The route has left the solution: point at the last good cell.
      const back = route[i - 1];
      showHint([back], [[back, route[i], 0]]);
      return 'The route goes wrong here. Pull it back to this cell.';
    }
    const headCell = route.length ? route[route.length - 1] : first;
    if (route.length) {
      for (const [a, b, val] of facts) {
        if (val !== LINE || (a !== headCell && b !== headCell)) continue;
        const next = a === headCell ? b : a;
        if (onRoute.has(next)) continue;
        showHint([headCell, next], [[headCell, next, LINE]]);
        return 'An earlier hint already settles this: the route goes into this cell next.';
      }
    }
    let st = hintState(board0, route, facts);
    if (!st) {
      facts = [];
      st = hintState(board0, route, facts);
    }
    const h = st && findHint(board0, st, headCell);
    if (!h) {
      const next = sol[route.length];
      showHint([next], route.length ? [[headCell, next, LINE]] : []);
      return route.length ? 'The route goes into this cell next.' : 'Start the route at stop 1.';
    }
    facts.push(...h.set);
    showHint(h.cells, h.set);
    return explain(h);
  }

  board.addEventListener('pointerdown', down);
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', up);
  board.addEventListener('pointercancel', up);
  board.addEventListener('lostpointercapture', up);

  render();

  return {
    reset() {
      solvedOnce = false;
      revealed = false;
      dragId = null;
      strokeStart = null;
      history = [];
      facts = [];
      hinted = new Set();
      hintLayer.replaceChildren();
      setRoute([]);
    },
    reveal() {
      revealed = true;
      dragId = null;
      strokeStart = null;
      history = [];
      hinted = new Set();
      hintLayer.replaceChildren();
      setRoute(puzzle.solution.slice());
    },
    undo() {
      if (dragId !== null) {
        dragId = null;
        commitStroke();
      }
      hinted = new Set();
      hintLayer.replaceChildren();
      if (!history.length) {
        render();
        return false;
      }
      setRoute(history.pop());
      return true;
    },
    hint,
    destroy() {
      grace.stop();
      board.removeEventListener('pointerdown', down);
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', up);
      board.removeEventListener('pointercancel', up);
      board.removeEventListener('lostpointercapture', up);
      el.classList.remove('pr-host', 'solved');
      el.style.removeProperty('--n');
      el.replaceChildren();
    },
  };
}
