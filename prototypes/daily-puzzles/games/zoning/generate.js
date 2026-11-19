// Zoning (Shikaku) generator: random partition into rectangles, one clue per
// rectangle, repaired until the solution is unique, then graded by the
// step-by-step solver in grader.js until it lands in the day's band.

import { buildBoard, initState, cloneState, place, grade, shapeOf, TECHNIQUES } from './grader.js';

// ---- random partition -----------------------------------------------------

// Long thin strips make dull lots: 1x5 is the thinnest allowed.
function aspectWeight(h, w) {
  const a = Math.max(h, w) / Math.min(h, w);
  return a <= 2 ? 1 : a <= 3 ? 0.7 : a <= 4 ? 0.4 : a <= 5 ? 0.2 : 0;
}

const lotOk = (h, w, S) => h >= 1 && w >= 1 && h * w >= S.minA && h * w <= S.maxA && aspectWeight(h, w) > 0;

// Greedy row-major fill: the first open cell is always a rectangle's top-left
// corner. Retries when the bottom row strands a single cell.
export function randomPartition(N, rng, { minA, maxA, areaWeight }) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const owner = new Int16Array(N * N).fill(-1);
    const rects = [];
    let ok = true;
    for (let idx = 0; idx < N * N && ok; idx++) {
      if (owner[idx] >= 0) continue;
      const r = (idx / N) | 0;
      const c = idx % N;
      let maxW = 0;
      while (c + maxW < N && owner[r * N + c + maxW] < 0) maxW++;
      const opts = [];
      let total = 0;
      for (let w = 1; w <= maxW; w++) {
        // On the last row, never leave a single open cell behind.
        if (r === N - 1 && maxW - w === 1) continue;
        for (let h = 1; h <= N - r; h++) {
          const a = h * w;
          if (a < minA || a > maxA) continue;
          const wt = areaWeight(a) * aspectWeight(h, w);
          if (wt <= 0) continue;
          opts.push([h, w, wt]);
          total += wt;
        }
      }
      if (!opts.length) { ok = false; break; }
      let x = rng.next() * total;
      let pick = opts[opts.length - 1];
      for (const o of opts) { x -= o[2]; if (x <= 0) { pick = o; break; } }
      const [h, w] = pick;
      const id = rects.length;
      rects.push([r, c, h, w]);
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) owner[rr * N + cc] = id;
    }
    if (ok) return symmetry(N, rects, rng.int(8));
  }
  return null;
}

// One of the 8 symmetries of the square, so the fill order leaves no bias.
function symmetry(N, rects, s) {
  return rects.map(([r, c, h, w]) => {
    if (s & 1) [r, c, h, w] = [c, r, w, h]; // transpose
    if (s & 2) c = N - c - w; // mirror
    if (s & 4) r = N - r - h; // flip
    return [r, c, h, w];
  });
}

// ---- uniqueness -------------------------------------------------------------

// Exact cover over the clues' candidate rectangles. Returns up to `limit`
// solutions, each an array of candidate ids (one per clue).
export function solveAll(B, limit = 2) {
  const sols = [];
  const rec = (st) => {
    for (;;) {
      if (st.bad) return;
      let forced = -1;
      for (let k = 0; k < B.K && forced < 0; k++) {
        if (st.placed[k] < 0 && st.cnt[k] === 1) {
          forced = B.clueCands[k].find((j) => st.alive[j]);
        }
      }
      if (forced < 0) break;
      place(B, st, forced);
    }
    if (st.nPlaced === B.K) { sols.push(Array.from(st.placed)); return; }
    let best = -1;
    let bestN = Infinity;
    for (let c = 0; c < B.M; c++) {
      if (!st.covered[c] && st.cellAlive[c] < bestN) { bestN = st.cellAlive[c]; best = c; }
    }
    for (const j of B.cellCands[best]) {
      if (!st.alive[j]) continue;
      const t = cloneState(st);
      place(B, t, j);
      rec(t);
      if (sols.length >= limit) return;
    }
  };
  rec(initState(B));
  return sols;
}

// ---- puzzle assembly --------------------------------------------------------

function makeClues(N, rects, cluePos, hints) {
  return rects.map(([r, c, h, w], k) => ({
    cell: cluePos[k],
    area: h * w,
    shape: hints[k] ? shapeOf(h, w) : '',
  }));
}

const sameRect = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// Move clues inside their own rectangles until the solution is unique.
// Returns the unique board or null.
export function makeUnique(N, rects, cluePos, hints, rng, tries = 40) {
  for (let t = 0; t < tries; t++) {
    const clues = makeClues(N, rects, cluePos, hints);
    const B = buildBoard(N, clues);
    const sols = solveAll(B, 2);
    if (sols.length === 1) return { B, clues };
    if (!sols.length) throw new Error('intended solution lost');
    const alt = sols.find((s) => s.some((i, k) => !sameRect(B.cRect[i], rects[k])));
    const diff = [];
    alt.forEach((i, k) => { if (!sameRect(B.cRect[i], rects[k])) diff.push(k); });
    const k = rng.pick(diff);
    const [r, c, h, w] = rects[k];
    cluePos[k] = (r + rng.int(h)) * N + (c + rng.int(w));
  }
  return null;
}

export function randomCluePos(N, rects, rng) {
  return rects.map(([r, c, h, w]) => (r + rng.int(h)) * N + (c + rng.int(w)));
}

// Compact JSON: clues as [cell, area, ...], shapes as one char per clue,
// solution as [top, left, height, width, ...] in clue order.
export function pack(N, rects, clues, g) {
  const order = clues.map((_, k) => k).sort((a, b) => clues[a].cell - clues[b].cell);
  const out = {
    size: N,
    clues: order.flatMap((k) => [clues[k].cell, clues[k].area]),
  };
  if (clues.some((c) => c.shape)) out.shapes = order.map((k) => clues[k].shape || '.').join('');
  out.solution = order.flatMap((k) => rects[k]);
  out.grade = g;
  return out;
}

// ---- mutations for the difficulty search --------------------------------------

// Each returns new { rects, pos } or null. All keep the partition valid and
// every clue inside its own rectangle.
function mutMove(N, rects, pos, rng) {
  const k = rng.int(rects.length);
  const [r, c, h, w] = rects[k];
  if (h * w === 1) return null;
  const cell = (r + rng.int(h)) * N + (c + rng.int(w));
  if (cell === pos[k]) return null;
  const p = pos.slice();
  p[k] = cell;
  return { rects, pos: p };
}

const inside = (N, [r, c, h, w], cell) => {
  const rr = (cell / N) | 0;
  const cc = cell % N;
  return rr >= r && rr < r + h && cc >= c && cc < c + w;
};

// Rectangles j that share a full side with k: returns [j, side] pairs.
function fullNeighbors(rects, k) {
  const [r, c, h, w] = rects[k];
  const out = [];
  rects.forEach(([r2, c2, h2, w2], j) => {
    if (j === k) return;
    if (r2 === r && h2 === h && c2 === c + w) out.push([j, 'right']);
    if (r2 === r && h2 === h && c2 + w2 === c) out.push([j, 'left']);
    if (c2 === c && w2 === w && r2 === r + h) out.push([j, 'down']);
    if (c2 === c && w2 === w && r2 + h2 === r) out.push([j, 'up']);
  });
  return out;
}

// Move the shared side of two rectangles by one row or column.
function mutShift(N, rects, pos, rng, S) {
  const k = rng.int(rects.length);
  const nb = fullNeighbors(rects, k);
  if (!nb.length) return null;
  const [j, side] = rng.pick(nb);
  const grow = rng.chance(0.5);
  const a = rects[k].slice();
  const b = rects[j].slice();
  // Normalise so that a is left/top of b.
  const horiz = side === 'right' || side === 'left';
  let [x, y, kx, ky] = side === 'right' || side === 'down' ? [a, b, k, j] : [b, a, j, k];
  if (horiz) {
    if (grow) { x[3]++; y[1]++; y[3]--; } else { x[3]--; y[1]--; y[3]++; }
  } else if (grow) { x[2]++; y[0]++; y[2]--; } else { x[2]--; y[0]--; y[2]++; }
  if (!lotOk(x[2], x[3], S) || !lotOk(y[2], y[3], S)) return null;
  if (!inside(N, x, pos[kx]) || !inside(N, y, pos[ky])) return null;
  const nr = rects.slice();
  nr[kx] = x;
  nr[ky] = y;
  return { rects: nr, pos };
}

function mutMerge(N, rects, pos, rng, S) {
  const k = rng.int(rects.length);
  const nb = fullNeighbors(rects, k);
  if (!nb.length) return null;
  const [j] = rng.pick(nb);
  const [r1, c1, h1, w1] = rects[k];
  const [r2, c2, h2, w2] = rects[j];
  const r = Math.min(r1, r2);
  const c = Math.min(c1, c2);
  const merged = [r, c, Math.max(r1 + h1, r2 + h2) - r, Math.max(c1 + w1, c2 + w2) - c];
  if (!lotOk(merged[2], merged[3], S)) return null;
  const nr = [];
  const np = [];
  rects.forEach((q, i) => { if (i !== k && i !== j) { nr.push(q); np.push(pos[i]); } });
  nr.push(merged);
  np.push(rng.chance(0.5) ? pos[k] : pos[j]);
  return { rects: nr, pos: np };
}

function mutSplit(N, rects, pos, rng, S) {
  const k = rng.int(rects.length);
  const [r, c, h, w] = rects[k];
  const cuts = [];
  for (let t = 1; t < h; t++) if (lotOk(t, w, S) && lotOk(h - t, w, S)) cuts.push([[r, c, t, w], [r + t, c, h - t, w]]);
  for (let t = 1; t < w; t++) if (lotOk(h, t, S) && lotOk(h, w - t, S)) cuts.push([[r, c, h, t], [r, c + t, h, w - t]]);
  if (!cuts.length) return null;
  const [p1, p2] = rng.pick(cuts);
  const [keep, fresh] = inside(N, p1, pos[k]) ? [p1, p2] : [p2, p1];
  const nr = rects.slice();
  const np = pos.slice();
  nr[k] = keep;
  nr.push(fresh);
  np.push((fresh[0] + rng.int(fresh[2])) * N + (fresh[1] + rng.int(fresh[3])));
  return { rects: nr, pos: np };
}

export function mutate(N, rects, pos, rng, S) {
  const x = rng.next();
  if (x < 0.55) return mutMove(N, rects, pos, rng);
  if (x < 0.85) return mutShift(N, rects, pos, rng, S);
  if (x < 0.93) return mutMerge(N, rects, pos, rng, S);
  return mutSplit(N, rects, pos, rng, S);
}

// ---- day settings -----------------------------------------------------------

// Area weights: few 2s, mostly mid-size lots.
const areas = (maxA) => (a) => (a < 2 || a > maxA ? 0 : a === 2 ? 0.5 : a === 3 ? 0.8 : 1);

// need: technique -> [min, max] count. chain: longest what-if chain [min, max].
// score: [lo, hi]. hints: share of clues that show their lot's shape.
// maxTier/maxChain: what the grader may use. Boards stay at 8×8 or smaller.
export const DAY_SETTINGS = {
  1: { N: 6, maxA: 6, hints: 1, maxTier: 1, score: [9, 14], need: { 'single reach': [0, 1] } },
  2: { N: 6, maxA: 8, hints: 0.4, maxTier: 1, score: [14, 22], need: {} },
  3: { N: 7, maxA: 9, hints: 0, maxTier: 2, score: [26, 40], need: { overlap: [2, 4] } },
  4: { N: 7, maxA: 10, hints: 0, maxTier: 3, score: [48, 72], need: { overlap: [2, 8], squeeze: [2, 4] } },
  5: { N: 8, maxA: 12, hints: 0, maxTier: 3, score: [80, 125], need: { squeeze: [3, 8] } },
  6: { N: 8, maxA: 12, hints: 0, maxTier: 4, maxChain: 3, score: [125, 170], need: { squeeze: [3, 12], 'what-if': [1, 2] } },
  7: { N: 8, maxA: 14, hints: 0, maxTier: 4, maxChain: 5, score: [195, 300], need: { 'what-if': [3, 7] }, chain: [2, 5] },
};

// How far a grade is from the day's targets (0 = on target).
function miss(g, S) {
  if (!g.solved) return Infinity;
  let d = 0;
  const [lo, hi] = S.score;
  if (g.score < lo) d += (lo - g.score) / 10;
  if (g.score > hi) d += (g.score - hi) / 10;
  for (const [t, [min, max]] of Object.entries(S.need)) {
    const n = g.techniques[t] ?? 0;
    if (n < min) d += min - n;
    if (n > max) d += n - max;
  }
  if (S.chain) {
    const longest = Math.max(0, ...g.chains);
    if (longest < S.chain[0]) d += S.chain[0] - longest;
    if (longest > S.chain[1]) d += longest - S.chain[1];
  }
  return d;
}

const MAX_EVALS = 6000;
const STALE = 250;

function freshStart(N, S, rng) {
  for (;;) {
    const rects = randomPartition(N, rng, S);
    if (!rects) continue;
    const pos = randomCluePos(N, rects, rng);
    const hints = rects.map(() => rng.chance(S.hints));
    const u = makeUnique(N, rects, pos, hints, rng);
    if (u) return { rects, pos, hints, B: u.B, clues: u.clues };
  }
}

export function generate(day, rng, base = DAY_SETTINGS[day]) {
  const S = { ...base, minA: 2, maxChain: base.maxChain ?? 0, areaWeight: areas(base.maxA) };
  const N = S.N;
  const opts = { maxTier: S.maxTier, maxChain: S.maxChain };
  let best = null;
  let evals = 0;
  while (evals < MAX_EVALS) {
    let cur = freshStart(N, S, rng);
    let g = grade(cur.B, opts);
    evals++;
    let m = miss(g, S);
    let stale = 0;
    while (m > 0 && stale < STALE && evals < MAX_EVALS) {
      stale++;
      const mu = mutate(N, cur.rects, cur.pos, rng, S);
      if (!mu) continue;
      const hints = mu.rects.length === cur.rects.length ? cur.hints : mu.rects.map(() => rng.chance(S.hints));
      const clues = makeClues(N, mu.rects, mu.pos, hints);
      const B = buildBoard(N, clues);
      if (solveAll(B, 2).length !== 1) continue;
      const g2 = grade(B, opts);
      evals++;
      const m2 = miss(g2, S);
      if (m2 <= m) {
        if (m2 < m) stale = 0;
        cur = { rects: mu.rects, pos: mu.pos, hints, B, clues };
        g = g2;
        m = m2;
      }
    }
    if (!best || m < best.m) best = { ...cur, g, m };
    if (m === 0) break;
  }
  // Out of budget without a solvable start: grade with every technique so the
  // puzzle is still playable, and say it missed.
  if (!best.g.solved) best.g = grade(best.B, { maxTier: 4, maxChain: 40 });
  if (!best.g.solved) throw new Error(`day ${day}: no gradable puzzle found`);
  const { g } = best;
  // Techniques listed easiest first.
  const techniques = {};
  for (const t of Object.keys(TECHNIQUES)) if (g.techniques[t]) techniques[t] = g.techniques[t];
  const counts = Object.entries(techniques).map(([t, n]) => `${n} ${t}`).join(', ');
  const chain = g.chains.length ? `, longest what-if chain ${Math.max(...g.chains)}` : '';
  const grade_ = {
    score: g.score,
    hardest: g.hardest,
    techniques,
    summary: `${best.rects.length} lots, ${g.steps} steps: ${counts}${chain}` + (best.m > 0 ? ' (missed target band)' : ''),
  };
  const sol = g.solution.map((i) => best.B.cRect[i]);
  if (sol.some((r, k) => !sameRect(r, best.rects[k]))) throw new Error('grader found a different solution');
  return pack(N, best.rects, best.clues, grade_);
}
