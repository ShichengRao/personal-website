// Two Tone: a binary grid puzzle (Takuzu family) with = and × edge signs.
//
// Rules: fill an N×N grid (N even) with pieces A and B so that every row and
// column holds N/2 of each, no three equal pieces sit in a row horizontally or
// vertically, "=" joins two cells holding the same piece and "×" two cells
// holding different pieces.
//
// Puzzle JSON (strings keep it compact):
//   size      N
//   solution  N*N chars of A/B, row-major
//   givens    N*N chars, A/B or '.'
//   hsigns    N rows of N-1 chars, row-major: the sign between (r,c) and (r,c+1),
//             '=', 'x' or '.'
//   vsigns    N-1 rows of N chars, row-major: the sign between (r,c) and (r+1,c)
//   grade     { score, hardest, techniques, summary, tier, clues, tries }
//
// The grader is a step-by-step solver that uses only human-style deductions,
// always the easiest one available. Techniques by tier:
//   1 basics        sign, pair, gap, full line
//   2 sign tricks   twin (an = pair beside a piece), split (an × pair counts
//                   as one of each when totalling a line)
//   3 line          every valid filling of one row or column agrees on a cell
//   4 linked lines  the same, for two neighbouring lines joined by signs
//   5 what-if       assume a piece, follow basics and sign tricks to a
//                   contradiction within a few placements
//   6 deep what-if  the same, but the follow-up may use line analysis
//
// Generation: a random valid grid starts with every piece and every sign as a
// clue. Clues are removed in random order, each removal kept only if the
// grader, limited to the day's tiers, still solves the puzzle. A logical
// solve that fills the grid proves the solution is unique. Candidates repeat
// until one lands in the day's target band.

export const A = 1;
export const B = 2;
const EQ = 1;
const NEQ = 2;

const pop = (x) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

// ---------------------------------------------------------------- geometry

const geoCache = new Map();

export function geometry(n) {
  let G = geoCache.get(n);
  if (G) return G;
  const half = n / 2;
  const full = (1 << n) - 1;
  // Every line that obeys the line rules on its own, as a bitmask (bit i = A).
  const valid = [];
  for (let x = 0; x <= full; x++) {
    const y = ~x & full;
    if (pop(x) !== half) continue;
    if (x & (x >> 1) & (x >> 2)) continue;
    if (y & (y >> 1) & (y >> 2)) continue;
    valid.push(x);
  }
  // Edges: horizontal ones first (r*(n-1)+c), then vertical (H + r*n + c).
  const H = n * (n - 1);
  const E = 2 * H;
  const ea = new Int16Array(E);
  const eb = new Int16Array(E);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n - 1; c++) {
      ea[r * (n - 1) + c] = r * n + c;
      eb[r * (n - 1) + c] = r * n + c + 1;
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n; c++) {
      ea[H + r * n + c] = r * n + c;
      eb[H + r * n + c] = (r + 1) * n + c;
    }
  }
  // Lines: rows 0..n-1, then columns n..2n-1.
  const L = 2 * n;
  const lc = new Int16Array(L * n); // cells of each line, in order
  const le = new Int16Array(L * (n - 1)); // edge between consecutive cells
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n; i++) {
      lc[r * n + i] = r * n + i;
      if (i < n - 1) le[r * (n - 1) + i] = r * (n - 1) + i;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < n; i++) {
      lc[(n + c) * n + i] = i * n + c;
      if (i < n - 1) le[(n + c) * (n - 1) + i] = H + i * n + c;
    }
  }
  // Per cell: [neighbour, edge, neighbour, edge, ...]
  const nb = Array.from({ length: n * n }, () => []);
  for (let e = 0; e < E; e++) {
    nb[ea[e]].push(eb[e], e);
    nb[eb[e]].push(ea[e], e);
  }
  G = {
    n, half, full, valid, H, E, ea, eb, L, lc, le, nb, N2: n * n,
    scratch: new Int8Array(n * n),
    queue: new Int16Array(n * n + 4),
  };
  geoCache.set(n, G);
  return G;
}

// ---------------------------------------------------------------- techniques
// Each finder returns instances { cells: [cell, value, cell, value, ...], extra },
// where extra (if any) measures how hard that instance is to see. The other
// fields (why: the cells that justify it, line, v, ...) are for hints.

function findSign(G, g, sg) {
  const out = [];
  for (let e = 0; e < G.E; e++) {
    const s = sg[e];
    if (!s) continue;
    const a = G.ea[e];
    const b = G.eb[e];
    const va = g[a];
    const vb = g[b];
    if (va && !vb) out.push({ cells: [b, s === EQ ? va : 3 - va], why: [a], s });
    else if (vb && !va) out.push({ cells: [a, s === EQ ? vb : 3 - vb], why: [b], s });
  }
  return out;
}

// XX → the cells on either side take the other piece.
function findPair(G, g) {
  const out = [];
  const n = G.n;
  for (let l = 0; l < G.L; l++) {
    const o = l * n;
    for (let i = 0; i < n - 1; i++) {
      const v = g[G.lc[o + i]];
      if (!v || g[G.lc[o + i + 1]] !== v) continue;
      const cells = [];
      if (i > 0 && !g[G.lc[o + i - 1]]) cells.push(G.lc[o + i - 1], 3 - v);
      if (i + 2 < n && !g[G.lc[o + i + 2]]) cells.push(G.lc[o + i + 2], 3 - v);
      if (cells.length) out.push({ cells, why: [G.lc[o + i], G.lc[o + i + 1]], line: l, v });
    }
  }
  return out;
}

// X_X → the gap takes the other piece.
function findGap(G, g) {
  const out = [];
  const n = G.n;
  for (let l = 0; l < G.L; l++) {
    const o = l * n;
    for (let i = 0; i < n - 2; i++) {
      const v = g[G.lc[o + i]];
      if (v && !g[G.lc[o + i + 1]] && g[G.lc[o + i + 2]] === v) {
        out.push({ cells: [G.lc[o + i + 1], 3 - v], why: [G.lc[o + i], G.lc[o + i + 2]], line: l, v });
      }
    }
  }
  return out;
}

// A line that has all its A (or B) takes the other piece everywhere else.
function findFull(G, g) {
  const out = [];
  const n = G.n;
  for (let l = 0; l < G.L; l++) {
    const o = l * n;
    let ca = 0;
    let cb = 0;
    for (let i = 0; i < n; i++) {
      const v = g[G.lc[o + i]];
      if (v === A) ca++;
      else if (v === B) cb++;
    }
    if (ca + cb === n) continue;
    let fill = 0;
    if (ca === G.half) fill = B;
    else if (cb === G.half) fill = A;
    if (!fill) continue;
    const cells = [];
    const why = [];
    for (let i = 0; i < n; i++) {
      const c = G.lc[o + i];
      if (!g[c]) cells.push(c, fill);
      else if (g[c] !== fill) why.push(c);
    }
    out.push({ cells, why, line: l, v: 3 - fill });
  }
  return out;
}

// Two empty cells joined by "=" next to a piece: both take the other piece.
function findTwin(G, g, sg) {
  const out = [];
  const n = G.n;
  for (let l = 0; l < G.L; l++) {
    const o = l * n;
    for (let i = 0; i < n - 1; i++) {
      if (sg[G.le[l * (n - 1) + i]] !== EQ) continue;
      const a = G.lc[o + i];
      const b = G.lc[o + i + 1];
      if (g[a] || g[b]) continue;
      const side = i > 0 && g[G.lc[o + i - 1]] ? G.lc[o + i - 1] : i + 2 < n && g[G.lc[o + i + 2]] ? G.lc[o + i + 2] : -1;
      if (side < 0) continue;
      const v = g[side];
      out.push({ cells: [a, 3 - v, b, 3 - v], why: [side], line: l, v });
    }
  }
  return out;
}

// Pairs the empty cells of line l that are joined by "×" (left to right,
// without overlap). Returns { ca, cb, pairs, singles, paired }.
function splitLine(G, g, sg, l) {
  const n = G.n;
  const o = l * n;
  let ca = 0;
  let cb = 0;
  let pairs = 0;
  const singles = [];
  const paired = [];
  for (let i = 0; i < n; i++) {
    const c = G.lc[o + i];
    const v = g[c];
    if (v === A) ca++;
    else if (v === B) cb++;
    else if (i + 1 < n && !g[G.lc[o + i + 1]] && sg[G.le[l * (n - 1) + i]] === NEQ) {
      pairs++;
      paired.push(c, G.lc[o + i + 1]);
      i++;
    } else singles.push(c);
  }
  return { ca, cb, pairs, singles, paired };
}

// Empty cells joined by "×" hold one of each, so they count toward both
// totals. When that completes a piece's total, the other empties take the
// other piece.
function findSplit(G, g, sg) {
  const out = [];
  for (let l = 0; l < G.L; l++) {
    const { ca, cb, pairs, singles, paired } = splitLine(G, g, sg, l);
    if (!pairs || !singles.length) continue;
    let fill = 0;
    if (ca + pairs === G.half) fill = B;
    else if (cb + pairs === G.half) fill = A;
    if (!fill) continue;
    const cells = [];
    for (const c of singles) cells.push(c, fill);
    out.push({ cells, why: paired, line: l, v: 3 - fill });
  }
  return out;
}

// Fillings of line l that fit its pieces and its own signs.
function lineCands(G, g, sg, l) {
  const n = G.n;
  const o = l * n;
  let km = 0;
  let kv = 0;
  let eqm = 0;
  let nem = 0;
  for (let i = 0; i < n; i++) {
    const v = g[G.lc[o + i]];
    if (v) {
      km |= 1 << i;
      if (v === A) kv |= 1 << i;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const s = sg[G.le[l * (n - 1) + i]];
    if (s === EQ) eqm |= 1 << i;
    else if (s === NEQ) nem |= 1 << i;
  }
  const dm = (1 << (n - 1)) - 1;
  const out = [];
  const V = G.valid;
  for (let k = 0; k < V.length; k++) {
    const x = V[k];
    if ((x & km) !== kv) continue;
    const d = (x ^ (x >> 1)) & dm;
    if (d & eqm || (d & nem) !== nem) continue;
    out.push(x);
  }
  return out;
}

// What every filling of line l agrees on: { cnt, unk, forcedA, forcedB }.
function lineScan(G, g, sg, l) {
  const n = G.n;
  let km = 0;
  let unk = 0;
  for (let i = 0; i < n; i++) {
    if (g[G.lc[l * n + i]]) km |= 1 << i;
    else unk++;
  }
  const xs = lineCands(G, g, sg, l);
  let and = G.full;
  let or = 0;
  for (const x of xs) {
    and &= x;
    or |= x;
  }
  return { cnt: xs.length, unk, forcedA: and & ~km & G.full, forcedB: ~or & ~km & G.full };
}

function findLine(G, g, sg) {
  const out = [];
  const n = G.n;
  for (let l = 0; l < G.L; l++) {
    const r = lineScan(G, g, sg, l);
    if (!r.unk || !r.cnt || (!r.forcedA && !r.forcedB)) continue;
    const cells = [];
    for (let i = 0; i < n; i++) {
      if (r.forcedA & (1 << i)) cells.push(G.lc[l * n + i], A);
      else if (r.forcedB & (1 << i)) cells.push(G.lc[l * n + i], B);
    }
    out.push({ cells, extra: r.unk, line: l });
  }
  return out;
}

// Two neighbouring parallel lines joined by signs, analysed together: keep
// only the pairs of fillings that agree with the signs between them.
function findLinked(G, g, sg) {
  const out = [];
  const n = G.n;
  for (let dir = 0; dir < 2; dir++) {
    for (let k = 0; k < n - 1; k++) {
      const l1 = dir * n + k;
      const l2 = l1 + 1;
      let eqm = 0;
      let nem = 0;
      for (let i = 0; i < n; i++) {
        const e = dir === 0 ? G.H + k * n + i : i * (n - 1) + k;
        const s = sg[e];
        if (!s || g[G.lc[l1 * n + i]] || g[G.lc[l2 * n + i]]) continue;
        if (s === EQ) eqm |= 1 << i;
        else nem |= 1 << i;
      }
      if (!eqm && !nem) continue;
      const X1 = lineCands(G, g, sg, l1);
      const X2 = lineCands(G, g, sg, l2);
      let and1 = G.full;
      let or1 = 0;
      let and2 = G.full;
      let or2 = 0;
      let any = false;
      for (const x1 of X1) {
        let ok = false;
        for (const x2 of X2) {
          const d = x1 ^ x2;
          if (d & eqm || ~d & nem) continue;
          and2 &= x2;
          or2 |= x2;
          ok = true;
        }
        if (ok) {
          and1 &= x1;
          or1 |= x1;
          any = true;
        }
      }
      if (!any) continue;
      const cells = [];
      let unk = 0;
      for (const [l, and, or] of [[l1, and1, or1], [l2, and2, or2]]) {
        for (let i = 0; i < n; i++) {
          const c = G.lc[l * n + i];
          if (g[c]) continue;
          unk++;
          if (and & (1 << i)) cells.push(c, A);
          else if (!(or & (1 << i))) cells.push(c, B);
        }
      }
      if (cells.length) out.push({ cells, extra: unk, lines: [l1, l2] });
    }
  }
  return out;
}

// --------------------------------------------------------------- what-if

// Basic and sign-trick deductions inside line l, as a flat [cell, value]
// list. A cell listed with both values signals a contradiction.
function lineLocal(G, g, sg, l) {
  const n = G.n;
  const o = l * n;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (g[G.lc[o + i]]) continue;
    const l1 = i > 0 ? g[G.lc[o + i - 1]] : 0;
    const l2 = i > 1 ? g[G.lc[o + i - 2]] : 0;
    const r1 = i + 1 < n ? g[G.lc[o + i + 1]] : 0;
    const r2 = i + 2 < n ? g[G.lc[o + i + 2]] : 0;
    if (l1 && l1 === l2) out.push(G.lc[o + i], 3 - l1);
    if (r1 && r1 === r2) out.push(G.lc[o + i], 3 - r1);
    if (l1 && l1 === r1) out.push(G.lc[o + i], 3 - l1);
  }
  for (let i = 0; i < n - 1; i++) {
    if (sg[G.le[l * (n - 1) + i]] !== EQ) continue;
    const a = G.lc[o + i];
    const b = G.lc[o + i + 1];
    if (g[a] || g[b]) continue;
    const lv = i > 0 ? g[G.lc[o + i - 1]] : 0;
    const rv = i + 2 < n ? g[G.lc[o + i + 2]] : 0;
    if (lv) out.push(a, 3 - lv, b, 3 - lv);
    if (rv) out.push(a, 3 - rv, b, 3 - rv);
  }
  const { ca, cb, pairs, singles } = splitLine(G, g, sg, l);
  if (ca + pairs > G.half || cb + pairs > G.half) {
    const c = singles[0] ?? G.lc[o];
    out.push(c, A, c, B);
  } else if (singles.length) {
    let fill = 0;
    if (ca + pairs === G.half) fill = B;
    else if (cb + pairs === G.half) fill = A;
    if (fill) for (const c of singles) out.push(c, fill);
  }
  return out;
}

// Assume cell c0 holds v0 and follow forced moves breadth first. Returns the
// number of placements that led to a contradiction, or -1 if none appears
// within `limit` placements. On a contradiction G.brk says what broke:
// { kind: 'line', index: line } | { kind: 'sign', index: edge } | { kind: 'cell', index: cell }.
function whatIf(G, g0, sg, c0, v0, limit, useLine) {
  const g = G.scratch;
  g.set(g0);
  const q = G.queue;
  const n = G.n;
  const half = G.half;
  let qh = 0;
  let qt = 0;
  let placed = 0;

  const broke = (index) => {
    G.brk = { kind: 'line', index };
    return false;
  };

  const okAt = (c) => {
    const v = g[c];
    const r = (c / n) | 0;
    const k = c % n;
    let cr = 0;
    let cc = 0;
    for (let i = 0; i < n; i++) {
      if (g[r * n + i] === v) cr++;
      if (g[i * n + k] === v) cc++;
    }
    if (cr > half) return broke(r);
    if (cc > half) return broke(n + k);
    for (let s = -2; s <= 0; s++) {
      const a = k + s;
      if (a >= 0 && a + 2 < n && g[r * n + a] === v && g[r * n + a + 1] === v && g[r * n + a + 2] === v) return broke(r);
      const b = r + s;
      if (b >= 0 && b + 2 < n && g[b * n + k] === v && g[(b + 1) * n + k] === v && g[(b + 2) * n + k] === v) return broke(n + k);
    }
    const nbs = G.nb[c];
    for (let j = 0; j < nbs.length; j += 2) {
      const s = sg[nbs[j + 1]];
      const w = g[nbs[j]];
      if (s && w && (s === EQ) !== (w === v)) return (G.brk = { kind: 'sign', index: nbs[j + 1] }), false;
    }
    return true;
  };

  // 1 = fine, 0 = contradiction, -1 = over the limit.
  const place = (c, v) => {
    if (g[c] === v) return 1;
    if (g[c]) return (G.brk = { kind: 'cell', index: c }), 0;
    if (++placed > limit) return -1;
    g[c] = v;
    q[qt++] = c;
    return okAt(c) ? 1 : 0;
  };

  const fromLine = (l) => {
    const cells = lineLocal(G, g, sg, l);
    for (let k = 0; k < cells.length; k += 2) {
      const r = place(cells[k], cells[k + 1]);
      if (r === 0 && G.brk.kind === 'cell') G.brk = { kind: 'line', index: l };
      if (r < 1) return r;
    }
    if (useLine) {
      const s = lineScan(G, g, sg, l);
      if (!s.cnt) return (G.brk = { kind: 'line', index: l }), 0;
      for (let i = 0; i < n; i++) {
        const v = s.forcedA & (1 << i) ? A : s.forcedB & (1 << i) ? B : 0;
        if (!v) continue;
        const r = place(G.lc[l * n + i], v);
        if (r < 1) return r;
      }
    }
    return 1;
  };

  g[c0] = v0;
  q[qt++] = c0;
  if (!okAt(c0)) return 0;
  while (qh < qt) {
    const c = q[qh++];
    const v = g[c];
    const nbs = G.nb[c];
    for (let j = 0; j < nbs.length; j += 2) {
      const s = sg[nbs[j + 1]];
      if (!s) continue;
      const r = place(nbs[j], s === EQ ? v : 3 - v);
      if (r === 0 && G.brk.kind === 'cell') G.brk = { kind: 'sign', index: nbs[j + 1] };
      if (r === 0) return placed;
      if (r < 0) return -1;
    }
    for (const l of [(c / n) | 0, n + (c % n)]) {
      const r = fromLine(l);
      if (r === 0) return placed;
      if (r < 0) return -1;
    }
  }
  return -1;
}

function findChain(G, g, sg, useLine, limit) {
  let best = null;
  for (let c = 0; c < G.N2; c++) {
    if (g[c]) continue;
    for (let v = A; v <= B; v++) {
      const cap = best ? best.len - 1 : limit;
      if (cap < 0) continue;
      const len = whatIf(G, g, sg, c, v, cap, useLine);
      if (len >= 0 && (!best || len < best.len)) best = { c, v: 3 - v, len, brk: G.brk };
    }
  }
  return best ? [{ cells: [best.c, best.v], extra: best.len, assume: 3 - best.v, brk: best.brk }] : [];
}

// ---------------------------------------------------------------- grader

// w is the score for one use, plus xw per unit of the instance's extra.
export const TECHNIQUES = [
  { name: 'sign', tier: 1, w: 1, all: true, find: findSign },
  { name: 'pair', tier: 1, w: 1, all: true, find: findPair },
  { name: 'gap', tier: 1, w: 1, all: true, find: findGap },
  { name: 'full line', tier: 1, w: 1.5, all: true, find: findFull },
  { name: 'twin', tier: 2, w: 3, all: true, find: findTwin },
  { name: 'split', tier: 2, w: 3, all: true, find: findSplit },
  { name: 'line', tier: 3, w: 4, xw: 0.5, find: findLine },
  { name: 'linked lines', tier: 4, w: 8, xw: 0.5, find: findLinked },
  { name: 'what-if', tier: 5, w: 10, xw: 1, find: (G, g, sg, o) => findChain(G, g, sg, false, o.chainLimit ?? 8) },
  { name: 'deep what-if', tier: 6, w: 16, xw: 1.5, find: (G, g, sg, o) => findChain(G, g, sg, true, o.chainLimit ?? 8) },
];

// How many cells the basics could fill right now.
function basicOptions(G, g, sg) {
  const seen = new Set();
  for (let t = 0; t < 4; t++) {
    for (const it of TECHNIQUES[t].find(G, g, sg)) {
      for (let k = 0; k < it.cells.length; k += 2) seen.add(it.cells[k]);
    }
  }
  return seen.size;
}

/**
 * Solve with techniques up to opt.maxTier, always the easiest one available.
 * Easy techniques (tiers 1-2) apply every instance they find at once; harder
 * ones apply only their easiest instance before the solver starts over.
 * opt: { maxTier, chainLimit, wide, log } where wide > 0 counts "tight" steps,
 * at which the basics offered fewer than `wide` cells to fill, and log(name,
 * instance, grid) is called after each step.
 */
export function solveLogic(G, givens, sg, opt = {}) {
  const maxTier = opt.maxTier ?? 6;
  const wide = opt.wide ?? 0;
  const g = Int8Array.from(givens);
  let unknown = 0;
  for (let i = 0; i < G.N2; i++) if (!g[i]) unknown++;
  const counts = {};
  const tierCounts = [0, 0, 0, 0, 0, 0, 0];
  const chains = [];
  let score = 0;
  let hardestTier = 0;
  let hardestIdx = -1;
  let tight = 0;
  const open = unknown;
  // firstAt[t]: cells filled before the first step of tier t or above.
  const firstAt = new Array(TECHNIQUES.at(-1).tier + 1).fill(-1);
  outer: while (unknown > 0) {
    const filled = open - unknown;
    if (wide && basicOptions(G, g, sg) < Math.min(wide, unknown)) tight++;
    for (let t = 0; t < TECHNIQUES.length; t++) {
      const T = TECHNIQUES[t];
      if (T.tier > maxTier) break;
      let inst = T.find(G, g, sg, opt);
      if (!inst.length) continue;
      if (!T.all) {
        let best = inst[0];
        for (const it of inst) if ((it.extra ?? 0) < (best.extra ?? 0)) best = it;
        inst = [best];
      }
      let used = 0;
      for (const it of inst) {
        let fresh = 0;
        for (let k = 0; k < it.cells.length; k += 2) {
          const c = it.cells[k];
          if (!g[c]) {
            g[c] = it.cells[k + 1];
            unknown--;
            fresh++;
          }
        }
        if (!fresh) continue;
        used++;
        counts[T.name] = (counts[T.name] ?? 0) + 1;
        tierCounts[T.tier]++;
        score += T.w + (T.xw ?? 0) * (it.extra ?? 0);
        if (T.tier >= 5) chains.push(it.extra);
        opt.log?.(T.name, it, g);
      }
      if (!used) continue;
      for (let k = 1; k <= T.tier; k++) if (firstAt[k] < 0) firstAt[k] = filled;
      if (t > hardestIdx) hardestIdx = t;
      if (T.tier > hardestTier) hardestTier = T.tier;
      continue outer;
    }
    break;
  }
  return {
    solved: unknown === 0,
    grid: g,
    counts,
    score,
    hardestTier,
    hardest: hardestIdx >= 0 ? TECHNIQUES[hardestIdx].name : 'none',
    tierCounts,
    tight,
    chains,
    firstAt: firstAt.map((x) => (x < 0 ? G.N2 : x)),
  };
}

// ---------------------------------------------------------------- full grids

export function randomSolution(G, rng) {
  const n = G.n;
  const half = G.half;
  const rows = new Array(n);
  const colA = new Int8Array(n);
  const rec = (r) => {
    if (r === n) return true;
    for (const x of rng.shuffle(G.valid.slice())) {
      if (r >= 2 && ~(rows[r - 1] ^ rows[r - 2]) & ~(rows[r - 1] ^ x) & G.full) continue;
      let ok = true;
      for (let j = 0; j < n && ok; j++) {
        const a = colA[j] + ((x >> j) & 1);
        if (a > half || r + 1 - a > half) ok = false;
      }
      if (!ok) continue;
      rows[r] = x;
      for (let j = 0; j < n; j++) colA[j] += (x >> j) & 1;
      if (rec(r + 1)) return true;
      for (let j = 0; j < n; j++) colA[j] -= (x >> j) & 1;
    }
    return false;
  };
  rec(0);
  const sol = new Int8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) sol[r * n + c] = (rows[r] >> c) & 1 ? A : B;
  return sol;
}

// ---------------------------------------------------------------- generation

// Removes clues from a full grid, in random order, keeping each removal only
// if the puzzle stays solvable within the plan. A positive bias removes
// pieces earlier than signs (leaving a sign-heavy puzzle), a negative one the
// reverse.
export function makePuzzle(G, sol, rng, plan) {
  const givens = Int8Array.from(sol);
  const sg = new Int8Array(G.E);
  for (let e = 0; e < G.E; e++) sg[e] = sol[G.ea[e]] === sol[G.eb[e]] ? EQ : NEQ;
  const bias = plan.bias ?? 0;
  const key = new Float64Array(G.N2 + G.E);
  const ids = [];
  for (let i = 0; i < G.N2 + G.E; i++) {
    ids.push(i);
    key[i] = rng.next() + (i < G.N2 ? bias : 0);
  }
  ids.sort((a, b) => key[b] - key[a]);
  const ok = () => {
    const r = solveLogic(G, givens, sg, plan);
    if (!r.solved || r.tight > (plan.tight ?? Infinity)) return false;
    const [t, share] = plan.runway ?? [1, 0];
    return r.firstAt[t] >= share * G.N2;
  };
  for (const id of ids) {
    if (id < G.N2) {
      const v = givens[id];
      givens[id] = 0;
      if (!ok()) givens[id] = v;
    } else {
      const e = id - G.N2;
      const s = sg[e];
      sg[e] = 0;
      if (!ok()) sg[e] = s;
    }
  }
  return { givens, sg };
}

export function encode(G, sol, givens, sg) {
  const ch = (v) => (v === A ? 'A' : v === B ? 'B' : '.');
  const sc = (s) => (s === EQ ? '=' : s === NEQ ? 'x' : '.');
  return {
    size: G.n,
    solution: Array.from(sol, ch).join(''),
    givens: Array.from(givens, ch).join(''),
    hsigns: Array.from(sg.subarray(0, G.H), sc).join(''),
    vsigns: Array.from(sg.subarray(G.H), sc).join(''),
  };
}

export function decode(p) {
  const G = geometry(p.size);
  const cv = (ch) => (ch === 'A' ? A : ch === 'B' ? B : 0);
  const sv = (ch) => (ch === '=' ? EQ : ch === 'x' ? NEQ : 0);
  const sg = new Int8Array(G.E);
  for (let i = 0; i < G.H; i++) {
    sg[i] = sv(p.hsigns[i]);
    sg[G.H + i] = sv(p.vsigns[i]);
  }
  return { G, givens: Int8Array.from(p.givens, cv), sg, solution: Int8Array.from(p.solution, cv) };
}

// Steps at tier t or above, and how many different techniques of those tiers.
const tier = (r, t) => r.tierCounts.slice(t).reduce((a, b) => a + b, 0);
const kinds = (r, t) => TECHNIQUES.filter((x) => x.tier >= t && r.counts[x.name]).length;

// Every day is 6×6. Difficulty comes from the techniques a day needs, not the
// board size, so the hardest days top out lower than a bigger board would.
// Per day: the techniques the grader may use (maxTier), the clue mix (bias,
// see makePuzzle), what the solve must use (need), the target score band,
// and for what-if days the longest chain allowed. runway [t, share] asks that
// at least share of the board can be filled before the first step of tier t,
// so the hard part never comes first. Monday also asks that the basics
// always offer at least `wide` cells (no bottlenecks).
export const DAY_PLAN = {
  1: { n: 6, maxTier: 1, bias: -0.3, wide: 3, tight: 0, band: [20, 30], need: (r) => (r.counts.sign ?? 0) >= 2 },
  2: { n: 6, maxTier: 1, bias: 0.05, band: [33, 40], need: (r) => (r.counts.sign ?? 0) >= 3 },
  3: { n: 6, maxTier: 2, bias: 0.05, runway: [2, 0.15], band: [38, 48], tries: 2000, need: (r) => r.tierCounts[2] >= 3 },
  4: {
    n: 6, maxTier: 3, bias: 0.1, runway: [3, 0.2], band: [48, 62], tries: 2000,
    need: (r) => r.tierCounts[3] >= 2,
  },
  5: {
    n: 6, maxTier: 4, bias: 0.15, runway: [3, 0.2], band: [58, 78], tries: 3000,
    need: (r) => r.tierCounts[4] >= 1 && tier(r, 3) >= 3,
  },
  6: {
    n: 6, maxTier: 5, bias: 0.3, chainLimit: 6, runway: [4, 0.2], band: [72, 100], tries: 3000,
    need: (r) => r.tierCounts[5] >= 1 && kinds(r, 3) >= 2,
  },
  7: {
    n: 6, maxTier: 6, bias: 0.4, chainLimit: 8, runway: [4, 0.2], band: [95, 160], tries: 4000,
    need: (r) => tier(r, 5) >= 2 && kinds(r, 3) >= 2,
  },
};

export function generate(day, rng) {
  const plan = DAY_PLAN[day];
  const G = geometry(plan.n);
  const [lo, hi] = plan.band;
  let best = null;
  let tries = 0;
  // A fixed number of tries (not a clock) keeps the output reproducible.
  while (tries < (plan.tries ?? 200)) {
    tries++;
    const sol = randomSolution(G, rng);
    const { givens, sg } = makePuzzle(G, sol, rng, plan);
    const r = solveLogic(G, givens, sg, plan);
    const miss = (plan.need(r) ? 0 : 1000) + Math.max(0, lo - r.score, r.score - hi);
    if (!best || miss < best.miss) best = { miss, sol, givens, sg, r };
    if (miss === 0) break;
  }
  const { sol, givens, sg, r } = best;
  return { ...encode(G, sol, givens, sg), grade: gradeOf(G, givens, sg, r, best.miss, tries) };
}

const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

function gradeOf(G, givens, sg, r, miss, tries) {
  let pieces = 0;
  let signs = 0;
  for (const v of givens) if (v) pieces++;
  for (const s of sg) if (s) signs++;
  const parts = [];
  for (const t of TECHNIQUES) {
    const k = r.counts[t.name];
    if (t.tier >= 2 && k) parts.push(`${t.name} ×${k}`);
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return {
    score: Math.round(r.score),
    hardest: r.hardest,
    techniques: r.counts,
    summary: `${plural(pieces, 'piece')} and ${plural(signs, 'sign')} given. ` +
      (list ? `Beyond the basics it needs ${list}.` : 'Basics only.') +
      (r.chains.length ? ` What-if lengths ${r.chains.join(', ')}.` : '') +
      (miss ? ' Missed its target band.' : ''),
    tier: r.hardestTier,
    clues: { pieces, signs },
    tries,
  };
}

// ---------------------------------------------------------------- hints

/**
 * The easiest deduction on a partly filled board, for the view's hint.
 * cells holds 0 (empty), 1 (A) or 2 (B) per cell and must agree with the
 * solution. Returns the technique name and its instance (cells, why, line,
 * lines, v, s, assume, brk), or null when nothing is found.
 */
export function nextStep(puzzle, cells) {
  const { G, sg } = decode(puzzle);
  const g = Int8Array.from(cells);
  const opt = { chainLimit: 8 };
  for (const T of TECHNIQUES) {
    const inst = T.find(G, g, sg, opt);
    if (!inst.length) continue;
    let best = inst[0];
    if (!T.all) for (const it of inst) if ((it.extra ?? 0) < (best.extra ?? 0)) best = it;
    return { name: T.name, ...best };
  }
  return null;
}
