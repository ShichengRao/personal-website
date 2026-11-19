// 6×6 Sudoku: digits 1–6 in a 6×6 grid of 2-row × 3-column boxes.
//
// Puzzle JSON: { size: 6, box: [2, 3], givens, solution, grade, tries }
//   givens    36 digits row by row, 0 for an empty cell
//   solution  36 digits row by row
//
// Every candidate is graded by a step-by-step human-style solver (grade()).
// It always takes the easiest step available, never guesses, and records the
// techniques it needed. A puzzle the grader finishes has exactly one solution.

const N = 6;
const ALL = 0x3f;

const rowOf = (i) => (i / N) | 0;
const colOf = (i) => i % N;
const boxOf = (i) => (rowOf(i) >> 1) * 2 + ((colOf(i) / 3) | 0);

// 18 units: rows 0–5, columns 6–11, boxes 12–17.
const UNITS = [];
for (let r = 0; r < N; r++) UNITS.push([0, 1, 2, 3, 4, 5].map((c) => r * N + c));
for (let c = 0; c < N; c++) UNITS.push([0, 1, 2, 3, 4, 5].map((r) => r * N + c));
for (let b = 0; b < N; b++) {
  const cells = [];
  for (let i = 0; i < 36; i++) if (boxOf(i) === b) cells.push(i);
  UNITS.push(cells);
}
const CELL_UNITS = [];
const PEERS = [];
const SEES = []; // SEES[i][j] true when i and j share a unit
for (let i = 0; i < 36; i++) {
  CELL_UNITS.push([rowOf(i), 6 + colOf(i), 12 + boxOf(i)]);
  const ps = [];
  for (let j = 0; j < 36; j++) {
    if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) ps.push(j);
  }
  PEERS.push(ps);
}
for (let i = 0; i < 36; i++) {
  const row = new Uint8Array(36);
  for (const j of PEERS[i]) row[j] = 1;
  SEES.push(row);
}

const POP = new Uint8Array(64);
for (let m = 1; m < 64; m++) POP[m] = POP[m >> 1] + (m & 1);
const DIGIT = new Uint8Array(64); // lowest digit (1-based) in a mask
for (let m = 1; m < 64; m++) DIGIT[m] = 31 - Math.clz32(m & -m) + 1;
const bit = (d) => 1 << (d - 1);

// ---------------------------------------------------------------- grids

/** Random complete grid by randomized backtracking. Returns Int8Array(36). */
export function randomGrid(rng) {
  const g = new Int8Array(36);
  const rows = new Uint8Array(6);
  const cols = new Uint8Array(6);
  const boxes = new Uint8Array(6);
  const fill = (i) => {
    if (i === 36) return true;
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    const free = ALL & ~(rows[r] | cols[c] | boxes[b]);
    const ds = [];
    for (let d = 1; d <= 6; d++) if (free & bit(d)) ds.push(d);
    rng.shuffle(ds);
    for (const d of ds) {
      const m = bit(d);
      g[i] = d; rows[r] |= m; cols[c] |= m; boxes[b] |= m;
      if (fill(i + 1)) return true;
      rows[r] &= ~m; cols[c] &= ~m; boxes[b] &= ~m;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

/** Number of solutions of a 36-cell puzzle (0 = empty), stopping at `limit`. */
export function countSolutions(cells, limit = 2) {
  const g = Int8Array.from(cells);
  const rows = new Uint8Array(6);
  const cols = new Uint8Array(6);
  const boxes = new Uint8Array(6);
  for (let i = 0; i < 36; i++) {
    const d = g[i];
    if (!d) continue;
    const m = bit(d);
    const r = rowOf(i), c = colOf(i), b = boxOf(i);
    if ((rows[r] | cols[c] | boxes[b]) & m) return 0;
    rows[r] |= m; cols[c] |= m; boxes[b] |= m;
  }
  let count = 0;
  const search = () => {
    let best = -1, bestFree = 0, bestN = 7;
    for (let i = 0; i < 36; i++) {
      if (g[i]) continue;
      const free = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = POP[free];
      if (n < bestN) { best = i; bestFree = free; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; return; }
    if (bestN === 0) return;
    const r = rowOf(best), c = colOf(best), b = boxOf(best);
    let free = bestFree;
    while (free) {
      const m = free & -free;
      free ^= m;
      g[best] = DIGIT[m];
      rows[r] |= m; cols[c] |= m; boxes[b] |= m;
      search();
      rows[r] &= ~m; cols[c] &= ~m; boxes[b] &= ~m;
      g[best] = 0;
      if (count >= limit) return;
    }
  };
  search();
  return count;
}

// ---------------------------------------------------------------- grader state

function newState(givens) {
  const s = { v: new Int8Array(36), c: new Uint8Array(36).fill(ALL), left: 36 };
  for (let i = 0; i < 36; i++) {
    if (givens[i]) {
      if (!(s.c[i] & bit(givens[i]))) return null;
      place(s, i, givens[i]);
    }
  }
  return s;
}

function cloneState(s) {
  return { v: Int8Array.from(s.v), c: Uint8Array.from(s.c), left: s.left };
}

function place(s, i, d) {
  const m = bit(d);
  s.v[i] = d;
  s.c[i] = 0;
  s.left--;
  for (const p of PEERS[i]) s.c[p] &= ~m;
}

function placedMask(s, u) {
  let m = 0;
  for (const i of UNITS[u]) if (s.v[i]) m |= bit(s.v[i]);
  return m;
}

/** True when the state can no longer be completed. */
function broken(s) {
  for (let i = 0; i < 36; i++) if (!s.v[i] && !s.c[i]) return true;
  for (let u = 0; u < 18; u++) {
    let have = 0;
    for (const i of UNITS[u]) have |= s.v[i] ? bit(s.v[i]) : s.c[i];
    if (have !== ALL) return true;
  }
  return false;
}

// ---------------------------------------------------------------- techniques
// Each finder returns a step { place: [cell, digit] } or { elim: [[cell, mask], ...] }
// or null. Elimination steps are only returned when they remove something.

function fullHouse(s) {
  for (let u = 0; u < 18; u++) {
    let empty = -1, n = 0;
    for (const i of UNITS[u]) if (!s.v[i]) { n++; empty = i; }
    if (n === 1 && POP[s.c[empty]] === 1) return { place: [empty, DIGIT[s.c[empty]]], unit: u };
  }
  return null;
}

function hiddenSingleIn(s, from, to) {
  for (let u = from; u < to; u++) {
    const placed = placedMask(s, u);
    for (let d = 1; d <= 6; d++) {
      const m = bit(d);
      if (placed & m) continue;
      let at = -1, n = 0;
      for (const i of UNITS[u]) if (s.c[i] & m) { n++; at = i; }
      if (n === 1) return { place: [at, d], unit: u };
    }
  }
  return null;
}

const hiddenSingleBox = (s) => hiddenSingleIn(s, 12, 18);
const hiddenSingleLine = (s) => hiddenSingleIn(s, 0, 12);

function nakedSingle(s) {
  for (let i = 0; i < 36; i++) if (!s.v[i] && POP[s.c[i]] === 1) return { place: [i, DIGIT[s.c[i]]] };
  return null;
}

// Pointing: a digit's spots in a box all lie on one row or column.
function pointing(s) {
  for (let b = 12; b < 18; b++) {
    const placed = placedMask(s, b);
    for (let d = 1; d <= 6; d++) {
      const m = bit(d);
      if (placed & m) continue;
      const spots = UNITS[b].filter((i) => s.c[i] & m);
      if (spots.length < 2) continue;
      for (const lineOf of [rowOf, colOf]) {
        const line = lineOf(spots[0]);
        if (!spots.every((i) => lineOf(i) === line)) continue;
        const u = lineOf === rowOf ? line : 6 + line;
        const out = [];
        for (const i of UNITS[u]) if (boxOf(i) !== b - 12 && (s.c[i] & m)) out.push([i, m]);
        if (out.length) return { elim: out, digit: d, unit: b, line: u, cells: spots };
      }
    }
  }
  return null;
}

// Box-line reduction: a digit's spots in a row or column all lie in one box.
function boxLine(s) {
  for (let u = 0; u < 12; u++) {
    const placed = placedMask(s, u);
    for (let d = 1; d <= 6; d++) {
      const m = bit(d);
      if (placed & m) continue;
      const spots = UNITS[u].filter((i) => s.c[i] & m);
      if (spots.length < 2) continue;
      const b = boxOf(spots[0]);
      if (!spots.every((i) => boxOf(i) === b)) continue;
      const out = [];
      for (const i of UNITS[12 + b]) if (!UNITS[u].includes(i) && (s.c[i] & m)) out.push([i, m]);
      if (out.length) return { elim: out, digit: d, unit: u, cells: spots };
    }
  }
  return null;
}

function combos(arr, k, start = 0, acc = [], out = []) {
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]);
    combos(arr, k, i + 1, acc, out);
    acc.pop();
  }
  return out;
}

// Naked subset: k cells in a unit whose candidates together are k digits.
function nakedSubset(k) {
  return (s) => {
    for (let u = 0; u < 18; u++) {
      const cells = UNITS[u].filter((i) => !s.v[i] && POP[s.c[i]] >= 2 && POP[s.c[i]] <= k);
      if (cells.length < k) continue;
      for (const set of combos(cells, k)) {
        let m = 0;
        for (const i of set) m |= s.c[i];
        if (POP[m] !== k) continue;
        const out = [];
        for (const i of UNITS[u]) if (!set.includes(i) && (s.c[i] & m)) out.push([i, m]);
        if (out.length) return { elim: out, unit: u, cells: set, digits: m };
      }
    }
    return null;
  };
}

// Hidden subset: k digits in a unit that fit only in the same k cells.
function hiddenSubset(k) {
  return (s) => {
    for (let u = 0; u < 18; u++) {
      const cellsOf = [];
      const digits = [];
      for (let d = 1; d <= 6; d++) {
        let pos = 0;
        UNITS[u].forEach((i, x) => { if (s.c[i] & bit(d)) pos |= 1 << x; });
        cellsOf[d] = pos;
        if (POP[pos] >= 2 && POP[pos] <= k) digits.push(d);
      }
      if (digits.length < k) continue;
      for (const set of combos(digits, k)) {
        let pos = 0, dm = 0;
        for (const d of set) { pos |= cellsOf[d]; dm |= bit(d); }
        if (POP[pos] !== k) continue;
        const out = [];
        const cells = UNITS[u].filter((i, x) => (pos >> x) & 1);
        for (const i of cells) if (s.c[i] & ~dm) out.push([i, s.c[i] & ~dm]);
        if (out.length) return { elim: out, unit: u, cells, digits: dm };
      }
    }
    return null;
  };
}

// Fish: k rows (or columns) where a digit's spots fall in the same k columns (or rows).
function fish(k) {
  return (s) => {
    for (let d = 1; d <= 6; d++) {
      const m = bit(d);
      for (const [base, cover] of [[0, 6], [6, 0]]) {
        const lines = [];
        const posOf = [];
        for (let x = 0; x < 6; x++) {
          let pos = 0;
          UNITS[base + x].forEach((i, y) => { if (s.c[i] & m) pos |= 1 << y; });
          posOf[x] = pos;
          if (POP[pos] >= 2 && POP[pos] <= k) lines.push(x);
        }
        if (lines.length < k) continue;
        for (const set of combos(lines, k)) {
          let pos = 0;
          for (const x of set) pos |= posOf[x];
          if (POP[pos] !== k) continue;
          const out = [];
          for (let y = 0; y < 6; y++) {
            if (!((pos >> y) & 1)) continue;
            UNITS[cover + y].forEach((i, x) => {
              if (!set.includes(x) && (s.c[i] & m)) out.push([i, m]);
            });
          }
          if (out.length) {
            const cells = set.flatMap((x) => UNITS[base + x].filter((i) => s.c[i] & m));
            return { elim: out, digit: d, lines: base === 0 ? 'rows' : 'columns', cells };
          }
        }
      }
    }
    return null;
  };
}

// XY-wing: pivot {a,b} sees pincers {a,c} and {b,c}; c goes from cells seeing both pincers.
function xyWing(s) {
  for (let p = 0; p < 36; p++) {
    if (s.v[p] || POP[s.c[p]] !== 2) continue;
    const pm = s.c[p];
    const wings = PEERS[p].filter((i) => !s.v[i] && POP[s.c[i]] === 2 && POP[s.c[i] & pm] === 1);
    for (let x = 0; x < wings.length; x++) {
      for (let y = x + 1; y < wings.length; y++) {
        const A = wings[x], B = wings[y];
        const cm = s.c[A] & ~pm;
        if ((s.c[B] & ~pm) !== cm || (s.c[A] & pm) === (s.c[B] & pm)) continue;
        const out = [];
        for (let i = 0; i < 36; i++) {
          if (i !== A && i !== B && i !== p && SEES[i][A] && SEES[i][B] && (s.c[i] & cm)) out.push([i, cm]);
        }
        if (out.length) return { elim: out, cells: [p, A, B], digits: pm, digit: DIGIT[cm] };
      }
    }
  }
  return null;
}

// XYZ-wing: pivot {a,b,c} sees pincers {a,c} and {b,c}; c goes from cells seeing all three.
function xyzWing(s) {
  for (let p = 0; p < 36; p++) {
    if (s.v[p] || POP[s.c[p]] !== 3) continue;
    const pm = s.c[p];
    const wings = PEERS[p].filter((i) => !s.v[i] && POP[s.c[i]] === 2 && (s.c[i] & ~pm) === 0);
    for (let x = 0; x < wings.length; x++) {
      for (let y = x + 1; y < wings.length; y++) {
        const A = wings[x], B = wings[y];
        const cm = s.c[A] & s.c[B];
        if (POP[cm] !== 1 || (s.c[A] | s.c[B]) !== pm) continue;
        const out = [];
        for (let i = 0; i < 36; i++) {
          if (i !== A && i !== B && i !== p && SEES[i][A] && SEES[i][B] && SEES[i][p] && (s.c[i] & cm)) out.push([i, cm]);
        }
        if (out.length) return { elim: out, cells: [p, A, B], digits: pm, digit: DIGIT[cm] };
      }
    }
  }
  return null;
}

// Singles only, used inside contradiction chains.
const SINGLES = [fullHouse, hiddenSingleBox, hiddenSingleLine, nakedSingle];

function propagate(s, limit) {
  let n = 0;
  while (n < limit) {
    if (broken(s)) return n;
    let step = null;
    for (const f of SINGLES) { step = f(s); if (step) break; }
    if (!step) return -1;
    place(s, step.place[0], step.place[1]);
    n++;
  }
  return broken(s) ? n : -1;
}

// Contradiction: assuming a candidate leads, by singles alone, to a cell or unit
// with nothing left. The shortest such chain is taken; its length rides on the step.
function contradiction(maxLen) {
  return (s) => {
    let best = null;
    for (let i = 0; i < 36; i++) {
      if (s.v[i]) continue;
      let cm = s.c[i];
      while (cm) {
        const m = cm & -cm;
        cm ^= m;
        const t = cloneState(s);
        place(t, i, DIGIT[m]);
        const n = propagate(t, best ? best.len - 2 : maxLen);
        if (n >= 0 && (!best || n + 1 < best.len)) best = { elim: [[i, m]], len: n + 1 };
      }
    }
    return best;
  };
}

// Alternating chains. Nodes are (cell, digit), id = cell * 6 + digit - 1.
// Strong link (one of the two is true): the two digits of a two-candidate cell,
// or the only two spots for a digit in a unit. Weak link (not both true): two
// digits of one cell, or one digit in two cells that see each other.
// A chain that starts and ends on strong links proves one of its two ends true,
// so any candidate that sees both ends goes.
const nodeCell = (n) => (n / 6) | 0;
const nodeDigit = (n) => (n % 6) + 1;
const seesNode = (a, b) => {
  const ca = nodeCell(a), cb = nodeCell(b);
  return ca === cb ? a !== b : a % 6 === b % 6 && SEES[ca][cb] === 1;
};

const CHAIN_NODES = 12;
const CONTRADICTION_LEN = 12;

function chains(maxNodes) {
  return (s) => {
    const strong = [];
    const weak = [];
    const nodes = [];
    for (let i = 0; i < 36; i++) {
      if (s.v[i]) continue;
      const cm = s.c[i];
      for (let d = 1; d <= 6; d++) {
        if (!(cm & bit(d))) continue;
        const n = i * 6 + d - 1;
        nodes.push(n);
        const st = [], wk = [];
        for (let e = 1; e <= 6; e++) {
          if (e === d || !(cm & bit(e))) continue;
          wk.push(i * 6 + e - 1);
          if (POP[cm] === 2) st.push(i * 6 + e - 1);
        }
        for (const p of PEERS[i]) if (s.c[p] & bit(d)) wk.push(p * 6 + d - 1);
        for (const u of CELL_UNITS[i]) {
          const spots = UNITS[u].filter((j) => s.c[j] & bit(d));
          if (spots.length === 2) {
            const o = spots[0] === i ? spots[1] : spots[0];
            if (!st.includes(o * 6 + d - 1)) st.push(o * 6 + d - 1);
          }
        }
        strong[n] = st;
        weak[n] = wk;
      }
    }

    let best = null;
    const par = new Int16Array(432);
    const dist = new Uint8Array(432);
    for (const n0 of nodes) {
      const limit = best ? best.len - 1 : maxNodes;
      const nearN0 = nodes.filter((x) => seesNode(x, n0));
      dist.fill(0);
      dist[n0 * 2] = 1;
      par[n0 * 2] = -1;
      const queue = [n0 * 2];
      let found = null;
      for (let q = 0; q < queue.length && !found; q++) {
        const st = queue[q];
        if (dist[st] >= limit) continue;
        const node = st >> 1, t = st & 1;
        for (const m of t === 0 ? strong[node] : weak[node]) {
          const st2 = m * 2 + (1 - t);
          if (dist[st2]) continue;
          dist[st2] = dist[st] + 1;
          par[st2] = st;
          if (t === 0) {
            const gone = nearN0.filter((x) => x !== m && seesNode(x, m));
            if (gone.length) { found = { st: st2, gone }; break; }
          }
          queue.push(st2);
        }
      }
      if (!found) continue;
      const path = [];
      for (let st = found.st; st >= 0; st = par[st]) path.unshift(st >> 1);
      const elim = new Map();
      for (const x of found.gone) elim.set(nodeCell(x), (elim.get(nodeCell(x)) ?? 0) | bit(nodeDigit(x)));
      best = { elim: [...elim], len: path.length, path, kind: chainKind(path) };
    }
    return best;
  };
}

function chainKind(path) {
  if (path.every((n) => n % 6 === path[0] % 6)) return 'X-chain';
  for (let k = 0; k + 1 < path.length; k++) {
    const sameCell = nodeCell(path[k]) === nodeCell(path[k + 1]);
    if (sameCell !== (k % 2 === 0)) return 'Alternating chain';
  }
  return 'XY-chain';
}

// ---------------------------------------------------------------- grader

// tier: 1 singles, 2 pairs and locked candidates, 3 everything harder.
// cost: score points per use. Chains and contradictions add points per link.
export const TECHNIQUES = [
  { name: 'Full house', tier: 1, cost: 1, find: fullHouse },
  { name: 'Hidden single', tier: 1, cost: 1.5, find: hiddenSingleBox },
  { name: 'Hidden single', tier: 1, cost: 2, find: hiddenSingleLine },
  { name: 'Naked single', tier: 1, cost: 3, find: nakedSingle },
  { name: 'Pointing', tier: 2, cost: 6, find: pointing },
  { name: 'Box-line reduction', tier: 2, cost: 7, find: boxLine },
  { name: 'Naked pair', tier: 2, cost: 8, find: nakedSubset(2) },
  { name: 'Hidden pair', tier: 2, cost: 10, find: hiddenSubset(2) },
  { name: 'X-wing', tier: 3, cost: 14, find: fish(2) },
  { name: 'Naked triple', tier: 3, cost: 14, find: nakedSubset(3) },
  { name: 'Hidden triple', tier: 3, cost: 16, find: hiddenSubset(3) },
  { name: 'XY-wing', tier: 3, cost: 18, find: xyWing },
  { name: 'XYZ-wing', tier: 3, cost: 20, find: xyzWing },
  { name: 'Swordfish', tier: 3, cost: 20, find: fish(3) },
  { name: 'Chain', tier: 3, cost: 12, perLink: 2, find: chains(CHAIN_NODES) },
  { name: 'Contradiction', tier: 3, cost: 20, perLink: 4, find: contradiction(CONTRADICTION_LEN) },
];
// Every name a step can carry, easiest first.
const ORDER = [
  'Full house', 'Hidden single', 'Naked single', 'Pointing', 'Box-line reduction', 'Naked pair',
  'Hidden pair', 'X-wing', 'Naked triple', 'Hidden triple', 'XY-wing', 'XYZ-wing', 'Swordfish',
  'X-chain', 'XY-chain', 'Alternating chain', 'Contradiction',
];
export const RANK = new Map(ORDER.map((name, x) => [name, x]));
const KIND_EXTRA = { 'X-chain': 0, 'XY-chain': 0, 'Alternating chain': 4 };

/** How many cells could be filled right now by some single. */
function singlesAvailable(s) {
  const cells = new Set();
  for (let i = 0; i < 36; i++) if (!s.v[i] && POP[s.c[i]] === 1) cells.add(i);
  for (let u = 0; u < 18; u++) {
    const placed = placedMask(s, u);
    for (let d = 1; d <= 6; d++) {
      if (placed & bit(d)) continue;
      let at = -1, n = 0;
      for (const i of UNITS[u]) if (s.c[i] & bit(d)) { n++; at = i; }
      if (n === 1) cells.add(at);
    }
  }
  return cells.size;
}

/**
 * Solve step by step with the easiest technique available, trying finders
 * only up to and including the one named `cap`. Pass the solution as `truth`
 * to have every step checked against it (a self-test of the techniques).
 */
export function grade(givens, cap = 'Contradiction', truth = null) {
  const finders = TECHNIQUES.slice(0, TECHNIQUES.findLastIndex((t) => t.name === cap) + 1);
  const s = newState(givens);
  if (!s) return { solved: false };
  const placements = s.left;
  const techniques = {};
  let score = 0;
  let hardest = null;
  let scarce = 0; // placements where only one cell could be filled
  let open = 0; // sum over placements of how many cells could be filled
  let chain = 0; // longest chain, in candidates
  let whatIf = 0; // longest contradiction, in placements
  const runway = [0, 0, -1, -1]; // runway[t]: cells filled before the first tier-t step (-1: none)
  while (s.left > 0) {
    let step = null, tech = null;
    for (const t of finders) {
      step = t.find(s);
      if (step) { tech = t; break; }
    }
    if (!step) return { solved: false, techniques };
    const name = step.kind ?? tech.name;
    let cost = tech.cost + (KIND_EXTRA[name] ?? 0);
    if (step.place) {
      const [i, d] = step.place;
      if (truth && truth[i] !== d) throw new Error(`${name} placed ${d} at ${i}`);
      const avail = singlesAvailable(s);
      open += avail;
      if (avail === 1 && s.left > 1) { scarce++; cost += 1.5; } else if (avail === 2 && s.left > 2) cost += 0.5;
      place(s, i, d);
    } else {
      for (const [i, m] of step.elim) {
        if (truth && (m & bit(truth[i]))) throw new Error(`${name} removed ${truth[i]} from ${i}`);
        s.c[i] &= ~m;
      }
      if (step.len) {
        cost += tech.perLink * step.len;
        if (name === 'Contradiction') whatIf = Math.max(whatIf, step.len);
        else chain = Math.max(chain, step.len);
      }
    }
    score += cost;
    for (let t = 2; t <= tech.tier; t++) if (runway[t] < 0) runway[t] = placements - s.left;
    techniques[name] = (techniques[name] ?? 0) + 1;
    if (!hardest || RANK.get(name) > RANK.get(hardest)) hardest = name;
    if (broken(s)) return { solved: false, techniques };
  }
  return {
    solved: true, score: Math.round(score), hardest, techniques, scarce, chain, whatIf, runway, placements,
    open: Math.round((open / placements) * 10) / 10,
  };
}

// ---------------------------------------------------------------- hints

const unitName = (u) => ['row', 'column', 'box'][(u / 6) | 0];
const lineName = (u) => (u < 6 ? 'row' : 'column');
function digitList(mask, join) {
  const ds = [];
  for (let d = 1; d <= 6; d++) if (mask & bit(d)) ds.push(d);
  return ds.length < 2 ? `${ds[0]}` : `${ds.slice(0, -1).join(', ')} ${join} ${ds[ds.length - 1]}`;
}

// Words for one step, said in terms of the board: outlined cells (keys) carry
// the reasoning, shaded cells (goals) are where something follows.
function explain(s, step, name) {
  const goals = step.place ? [step.place[0]] : step.elim.map(([i]) => i);
  let gone = 0;
  for (const [, m] of step.elim ?? []) gone |= m;
  const shaded = goals.length > 1 ? 'the shaded cells' : 'the shaded cell';
  const after = ' Hint again for the next step.';
  const h = { name, area: [], keys: step.cells ?? [], goals, place: step.place ?? null, elim: step.elim ?? null };
  const d = step.place ? step.place[1] : step.digit;

  switch (name) {
    case 'Full house':
      h.area = UNITS[step.unit];
      h.text = `This ${unitName(step.unit)} has one empty cell left, and the digit it is missing is ${d}.`;
      break;
    case 'Hidden single': {
      const t = step.place[0];
      const blockers = new Set();
      let open = false;
      for (const j of UNITS[step.unit]) {
        if (j === t || s.v[j]) continue;
        const k = PEERS[j].find((x) => s.v[x] === d);
        if (k === undefined) open = true;
        else blockers.add(k);
      }
      h.area = UNITS[step.unit];
      h.keys = [...blockers];
      h.text = open
        ? `This ${unitName(step.unit)} still needs a ${d}, and after the earlier steps this is the only cell in it that can take one.`
        : `This ${unitName(step.unit)} still needs a ${d}, and the outlined ${d}s block every other empty cell in it, so the ${d} goes here.`;
      break;
    }
    case 'Naked single': {
      const t = step.place[0];
      let seen = 0;
      for (const j of PEERS[t]) if (s.v[j]) seen |= bit(s.v[j]);
      h.area = PEERS[t];
      h.text = (seen | bit(d)) === ALL
        ? `Every other digit already appears in this cell's row, column or box, so it can only be ${d}.`
        : `Every other digit is in this cell's row, column or box or was ruled out by the earlier steps, so it must be ${d}.`;
      break;
    }
    case 'Pointing':
      h.area = UNITS[step.unit];
      h.text = `In this box the ${d} can only go in the outlined cells, which all lie in one ${lineName(step.line)}, so no other cell in that ${lineName(step.line)} can be ${d}.${after}`;
      break;
    case 'Box-line reduction':
      h.area = UNITS[step.unit];
      h.text = `In this ${lineName(step.unit)} the ${d} can only go in the outlined cells, which all lie in one box, so no other cell in that box can be ${d}.${after}`;
      break;
    case 'Naked pair':
    case 'Naked triple': {
      const k = step.cells.length;
      h.area = UNITS[step.unit];
      h.text = `${k === 3 ? 'Naked triple: the three' : 'The two'} outlined cells can only hold ${digitList(step.digits, 'and')} between them, so no other cell in this ${unitName(step.unit)} can be ${digitList(step.digits, 'or')}.${after}`;
      break;
    }
    case 'Hidden pair':
    case 'Hidden triple': {
      const k = step.cells.length;
      h.area = UNITS[step.unit];
      h.text = `${k === 3 ? 'Hidden triple: in' : 'In'} this ${unitName(step.unit)}, ${digitList(step.digits, 'and')} fit only in the ${k === 3 ? 'three' : 'two'} outlined cells, so those cells can't hold anything else.${after}`;
      break;
    }
    case 'X-wing':
    case 'Swordfish': {
      const other = step.lines === 'rows' ? 'columns' : 'rows';
      const k = name === 'X-wing' ? 'two' : 'three';
      h.text = `${name}: in ${k} ${step.lines} the ${d} can only go in the outlined cells, which share the same ${k} ${other}. Those ${other} get their ${d}s from these cells, so no other cell in them can be ${d}.${after}`;
      break;
    }
    case 'XY-wing':
      h.text = `XY-wing: the middle outlined cell is ${digitList(step.digits, 'or')}. Either way one of the other two outlined cells must be ${d}, so a cell that shares a row, column or box with both of them can't be ${d}.${after}`;
      break;
    case 'XYZ-wing':
      h.text = `XYZ-wing: whichever of ${digitList(step.digits, 'or')} the middle outlined cell takes, one of the three outlined cells is ${d}, so a cell that shares a row, column or box with all three can't be ${d}.${after}`;
      break;
    case 'Contradiction':
      h.text = `If the shaded cell were ${digitList(gone, 'or')}, the singles that follow would leave some digit with no room in a row, column or box, so it can't be ${digitList(gone, 'or')}.${after}`;
      break;
    default: {
      // X-chain, XY-chain, Alternating chain
      const path = step.path;
      const first = path[0], last = path[path.length - 1];
      h.keys = [...new Set(path.map(nodeCell))];
      h.text = `${name}: along the outlined cells each link is either-or, so if the first one isn't ${nodeDigit(first)}, the last one is ${nodeDigit(last)}. Either way ${shaded} can't be ${digitList(gone, 'or')}.${after}`;
    }
  }
  return h;
}

/**
 * The steps from the digits on the board (36 numbers, 0 = empty) to the next
 * placement: any eliminations it takes, then the placement itself. Each step
 * is { name, text, area, keys, goals, place, elim } with cell indices.
 */
export function hintSteps(cells) {
  const s = newState(cells);
  const steps = [];
  if (!s) return steps;
  while (s.left > 0 && steps.length < 40) {
    let step = null, tech = null;
    for (const t of TECHNIQUES) {
      step = t.find(s);
      if (step) { tech = t; break; }
    }
    if (!step) break;
    steps.push(explain(s, step, step.kind ?? tech.name));
    if (step.place) break;
    for (const [i, m] of step.elim) s.c[i] &= ~m;
  }
  return steps;
}

// ---------------------------------------------------------------- generation

const toString = (cells) => Array.from(cells).join('');

const TIER2 = new Set(['Pointing', 'Box-line reduction', 'Naked pair', 'Hidden pair']);
const isTier3 = (name) => RANK.get(name) >= RANK.get('X-wing');

function profile(g) {
  let t2 = 0, t3 = 0, variety = 0;
  for (const [name, n] of Object.entries(g.techniques)) {
    if (isTier3(name)) { t3 += n; variety++; } else if (TIER2.has(name)) { t2 += n; variety++; }
  }
  return { t2, t3, variety };
}

// The week. Monday to Wednesday dig to `givens` clues while the puzzle stays
// solvable within `cap`, so they keep spare clues and plenty of cells ready to
// fill. The other days dig until no clue can go without losing uniqueness
// (a minimal puzzle) and keep it if its grade lands in the day's band: a
// score range plus `ok`. A minimal puzzle that is `tooHard` gets one more try
// with a symmetric pair of clues put back. t2 and t3 count tier-2 and tier-3 steps.
// `top` is the day's top tier: its first step must wait for a runway (below).
const WEEK = {
  // Mon: 18-20 givens, singles only, always at least two cells ready to fill.
  1: { givens: [18, 20], cap: 'Naked single', score: [14, 24], ok: (g) => g.scarce === 0 && g.open >= 6 },
  // Tue: 14-16 givens, hidden singles only, never down to one ready cell, but
  // fewer ready at a time than Monday.
  2: {
    givens: [14, 16], cap: 'Hidden single', score: [18, 30],
    ok: (g) => g.scarce === 0 && g.open >= 4.5 && g.open <= 6.5,
  },
  // Wed: 12-14 givens and one pointing step, the gentlest tier-2 idea.
  3: {
    givens: [12, 14], cap: 'Pointing', top: 2, score: [28, 45],
    ok: (g, p) => p.t2 === 1 && p.t3 === 0 && g.scarce <= 3,
  },
  // Thu: two or more tier-2 steps.
  4: {
    top: 2,
    score: [49, 64],
    ok: (g, p) => p.t2 >= 2 && p.t3 === 0,
    tooHard: (g, p) => p.t3 > 0,
  },
  // Fri: one or two tier-3 patterns, chains no longer than four candidates.
  5: {
    top: 3,
    score: [65, 85],
    ok: (g, p) => p.t3 >= 1 && p.t3 <= 2 && g.chain <= 4,
    tooHard: (g, p) => p.t3 > 2 || g.chain > 4,
  },
  // Sat: two or more tier-3 steps.
  6: { top: 3, score: [86, 125], ok: (g, p) => p.t3 >= 2 && !g.whatIf, tooHard: () => false },
  // Sun: three or more tier-3 steps of at least three kinds, including a chain of six or more.
  7: { top: 3, score: [130, 220], ok: (g, p) => p.t3 >= 3 && p.variety >= 3 && g.chain >= 6 },
};
const MAX_CANDIDATES = 60000; // about 4 s; after that the closest miss is kept

// Runway: every puzzle opens with a single, and the first step at the day's top
// tier comes only after this share of the empty cells is filled by easier steps.
const RUNWAY = 0.2;
const runwayOk = (g, top) => g.runway[2] !== 0 && (!top || g.runway[top] >= RUNWAY * g.placements);

/** Remove clues in random 180°-symmetric pairs while the puzzle stays solvable. */
function dig(solution, rng, { givens, cap }) {
  const p = Int8Array.from(solution);
  const floor = givens ? rng.pick(givens.filter((n) => n % 2 === 0)) : 0;
  let count = 36;
  for (const i of rng.shuffle([...Array(18).keys()])) {
    if (count - 2 < floor) break;
    const j = 35 - i;
    p[i] = 0;
    p[j] = 0;
    const ok = cap ? grade(p, cap).solved : countSolutions(p, 2) === 1;
    if (ok) count -= 2;
    else { p[i] = solution[i]; p[j] = solution[j]; }
  }
  return p;
}

function judge(target, givens) {
  const g = grade(givens, target.cap);
  if (!g.solved) return null;
  const p = profile(g);
  const [lo, hi] = target.score;
  const content = target.ok(g, p);
  const runway = runwayOk(g, target.top);
  const miss = (content && runway ? 0 : 1000) + Math.max(0, lo - g.score, g.score - hi);
  const tooHard = !!target.tooHard && (g.score > hi || target.tooHard(g, p));
  // Worth putting a clue pair back: too hard, or hard enough but stuck too early.
  return { givens, g, p, miss, repair: !!target.top && (tooHard || (content && !runway)) };
}

/** Quick screen: what singles alone get done. */
function singlesRun(givens) {
  const s = newState(givens);
  const start = s.left;
  for (;;) {
    let step = null;
    for (const f of SINGLES) {
      step = f(s);
      if (step) break;
    }
    if (!step) break;
    place(s, step.place[0], step.place[1]);
  }
  return { placed: start - s.left, solved: s.left === 0 };
}

function summarize(givens, g, top) {
  const clues = givens.reduce((n, d) => n + (d ? 1 : 0), 0);
  const advanced = Object.entries(g.techniques)
    .filter(([name]) => TIER2.has(name) || isTier3(name))
    .sort((a, b) => RANK.get(b[0]) - RANK.get(a[0]))
    .map(([name, n]) => name.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()) + (n > 1 ? ` ×${n}` : ''));
  if (!advanced.length) return `${clues} givens. Singles only, about ${Math.round(g.open)} cells open per step.`;
  const wait = top ? ` The first tier-${top} step comes after ${g.runway[top]} of ${g.placements} cells.` : '';
  return `${clues} givens. Needs ${advanced.join(', ')}. The rest is singles.${wait}`;
}

export function generate(day, rng) {
  const target = WEEK[day];
  let best = null;
  let tries = 0;
  while (tries < MAX_CANDIDATES && !(best && best.miss === 0)) {
    tries++;
    const solution = randomGrid(rng);
    const givens = dig(solution, rng, target);
    if (target.top && best) {
      // Most minimal puzzles fall to singles, or open with a harder step: skip them cheaply.
      const quick = singlesRun(givens);
      if (quick.solved || quick.placed === 0) continue;
    }
    let c = judge(target, givens);
    if (!c) continue;
    if (c.miss && c.repair) {
      const holes = [...Array(18).keys()].filter((i) => !c.givens[i]);
      for (const i of rng.shuffle(holes)) {
        const q = Int8Array.from(c.givens);
        q[i] = solution[i];
        q[35 - i] = solution[35 - i];
        const r = judge(target, q);
        if (r && r.miss < c.miss) { c = r; if (!r.miss) break; }
      }
    }
    if (!best || c.miss < best.miss) best = { ...c, solution };
  }
  const { givens, solution, g, miss } = best;
  return {
    size: N,
    box: [2, 3],
    givens: toString(givens),
    solution: toString(solution),
    grade: {
      score: g.score,
      hardest: g.hardest,
      techniques: g.techniques,
      summary: summarize(givens, g, target.top) + (miss ? " Missed the day's target." : ''),
    },
    tries,
  };
}
