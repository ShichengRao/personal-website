// Zoning (Shikaku): candidate rectangles and a step-by-step logical grader.
//
// The grader solves like a person would: at every step it uses the easiest
// technique that makes progress, and records what it needed.
//
//   tier 1  single fit    a number has only one rectangle left that fits
//           single reach  an open cell that only one number can still reach
//   tier 2  overlap       cells every remaining rectangle of a number covers
//                         belong to it, so other numbers can't use them
//   tier 3  squeeze       a rectangle would leave another number no room,
//                         or strand a cell no number could cover
//   tier 4  what-if       assume a rectangle, follow tier 1-2 steps, and hit
//                         a contradiction (the chain length is recorded)

export const TECHNIQUES = {
  'single fit': { tier: 1, weight: 1 },
  'single reach': { tier: 1, weight: 1.5 },
  overlap: { tier: 2, weight: 4 },
  squeeze: { tier: 3, weight: 10 },
  'what-if': { tier: 4, weight: 16 }, // plus WHATIF_STEP per chain step
};
const WHATIF_STEP = 4;

export function shapeOk(shape, h, w) {
  if (shape === 'S') return h === w;
  if (shape === 'W') return w > h;
  if (shape === 'T') return h > w;
  return true;
}

export function shapeOf(h, w) {
  return h === w ? 'S' : w > h ? 'W' : 'T';
}

// clues: [{ cell, area, shape }] with shape 'S' | 'W' | 'T' | '' (no hint).
export function buildBoard(N, clues) {
  const M = N * N;
  const W = (M + 31) >>> 5;
  const K = clues.length;
  const clueAt = new Int16Array(M).fill(-1);
  clues.forEach((cl, k) => { clueAt[cl.cell] = k; });

  const cK = [];
  const cRect = [];
  const cCells = [];
  const clueCands = clues.map(() => []);
  for (let k = 0; k < K; k++) {
    const { cell, area: A, shape } = clues[k];
    const r0 = (cell / N) | 0;
    const c0 = cell % N;
    for (let h = 1; h <= Math.min(A, N); h++) {
      if (A % h) continue;
      const w = A / h;
      if (w > N || !shapeOk(shape, h, w)) continue;
      for (let top = Math.max(0, r0 - h + 1); top <= Math.min(r0, N - h); top++) {
        for (let left = Math.max(0, c0 - w + 1); left <= Math.min(c0, N - w); left++) {
          const cells = [];
          let ok = true;
          for (let r = top; r < top + h && ok; r++) {
            for (let c = left; c < left + w; c++) {
              const i = r * N + c;
              if (clueAt[i] >= 0 && clueAt[i] !== k) { ok = false; break; }
              cells.push(i);
            }
          }
          if (!ok) continue;
          clueCands[k].push(cK.length);
          cK.push(k);
          cRect.push([top, left, h, w]);
          cCells.push(cells);
        }
      }
    }
  }

  const nc = cK.length;
  const mask = new Uint32Array(nc * W);
  const cellCands = Array.from({ length: M }, () => []);
  for (let i = 0; i < nc; i++) {
    for (const c of cCells[i]) {
      mask[i * W + (c >>> 5)] |= 1 << (c & 31);
      cellCands[c].push(i);
    }
  }
  return {
    N, M, W, K, nc,
    cK: Int16Array.from(cK), cRect, cCells, mask, clueCands, cellCands,
    clueCell: clues.map((c) => c.cell),
  };
}

// ---- solving state ------------------------------------------------------

export function initState(B) {
  const st = {
    alive: new Uint8Array(B.nc).fill(1),
    cnt: Int32Array.from(B.clueCands, (l) => l.length),
    placed: new Int32Array(B.K).fill(-1),
    covered: new Uint8Array(B.M),
    cellAlive: Int32Array.from(B.cellCands, (l) => l.length),
    nPlaced: 0,
    bad: false,
  };
  st.bad = st.cnt.some((n) => n === 0) || st.cellAlive.some((n) => n === 0);
  return st;
}

export function cloneState(st) {
  return {
    alive: st.alive.slice(),
    cnt: st.cnt.slice(),
    placed: st.placed.slice(),
    covered: st.covered.slice(),
    cellAlive: st.cellAlive.slice(),
    nPlaced: st.nPlaced,
    bad: st.bad,
  };
}

export function kill(B, st, i) {
  if (!st.alive[i]) return;
  st.alive[i] = 0;
  if (--st.cnt[B.cK[i]] === 0) st.bad = true;
  for (const c of B.cCells[i]) if (--st.cellAlive[c] === 0) st.bad = true;
}

export function place(B, st, i) {
  const k = B.cK[i];
  st.placed[k] = i;
  st.nPlaced++;
  for (const j of B.clueCands[k]) if (j !== i) kill(B, st, j);
  for (const c of B.cCells[i]) {
    st.covered[c] = 1;
    for (const j of B.cellCands[c]) if (j !== i) kill(B, st, j);
  }
}

const covers = (B, i, c) => (B.mask[i * B.W + (c >>> 5)] >>> (c & 31)) & 1;

// ---- techniques ---------------------------------------------------------
//
// Each find* looks for one deduction without changing the state and returns
// a step object (or null). apply() carries a step out. The view's hint()
// uses the same steps to explain the next move.

function findSingleFit(B, st) {
  for (let k = 0; k < B.K; k++) {
    if (st.placed[k] >= 0 || st.cnt[k] !== 1) continue;
    for (const j of B.clueCands[k]) {
      if (st.alive[j]) return { t: 'single fit', k, i: j };
    }
  }
  return null;
}

function findSingleReach(B, st) {
  for (let c = 0; c < B.M; c++) {
    if (st.covered[c]) continue;
    let k1 = -1;
    let n1 = 0;
    let multi = false;
    for (const j of B.cellCands[c]) {
      if (!st.alive[j]) continue;
      const k = B.cK[j];
      if (k1 < 0) k1 = k;
      else if (k !== k1) { multi = true; break; }
      n1++;
    }
    if (multi || k1 < 0 || n1 === st.cnt[k1]) continue;
    const kills = B.clueCands[k1].filter((j) => st.alive[j] && !covers(B, j, c));
    return { t: 'single reach', k: k1, cell: c, kills };
  }
  return null;
}

function findOverlap(B, st, inter) {
  const W = B.W;
  for (let k = 0; k < B.K; k++) {
    if (st.placed[k] >= 0 || st.cnt[k] < 2) continue;
    inter.fill(0xffffffff);
    for (const j of B.clueCands[k]) {
      if (!st.alive[j]) continue;
      for (let w = 0; w < W; w++) inter[w] &= B.mask[j * W + w];
    }
    const cells = [];
    const kills = [];
    for (let w = 0; w < W; w++) {
      let bits = inter[w];
      while (bits) {
        const b = 31 - Math.clz32(bits);
        bits ^= 1 << b;
        const c = (w << 5) + b;
        if (c === B.clueCell[k]) continue;
        cells.push(c);
        for (const j of B.cellCands[c]) {
          if (st.alive[j] && B.cK[j] !== k) kills.push(j);
        }
      }
    }
    if (kills.length) return { t: 'overlap', k, cells, kills };
  }
  return null;
}

// Candidates of unplaced numbers, numbers with fewer options first.
function openCandidates(B, st) {
  const ks = [];
  for (let k = 0; k < B.K; k++) if (st.placed[k] < 0 && st.cnt[k] >= 2) ks.push(k);
  ks.sort((a, b) => st.cnt[a] - st.cnt[b] || a - b);
  const out = [];
  for (const k of ks) for (const j of B.clueCands[k]) if (st.alive[j]) out.push(j);
  return out;
}

// What placing i would break: a number left with no room, or a cell no
// number can reach. t is the state after placing i.
function brokenBy(B, t, i) {
  for (let j = 0; j < B.K; j++) if (j !== B.cK[i] && t.cnt[j] === 0) return { clue: j };
  for (let c = 0; c < B.M; c++) if (t.cellAlive[c] === 0) return { cell: c };
  return {};
}

function findSqueeze(B, st) {
  for (const i of openCandidates(B, st)) {
    const t = cloneState(st);
    place(B, t, i);
    if (t.bad) return { t: 'squeeze', k: B.cK[i], i, broken: brokenBy(B, t, i), kills: [i] };
  }
  return null;
}

function findSimple(B, st, inter) {
  return findSingleFit(B, st) || findSingleReach(B, st) || findOverlap(B, st, inter);
}

// Shortest contradiction chain over all open candidates, by stepping every
// assumption forward together.
function findWhatIf(B, st, maxChain, inter) {
  let runs = openCandidates(B, st).map((i) => {
    const t = cloneState(st);
    place(B, t, i);
    return { i, t };
  });
  for (let d = 1; d <= maxChain && runs.length; d++) {
    const next = [];
    for (const run of runs) {
      const step = findSimple(B, run.t, inter);
      if (!step) continue;
      apply(B, run.t, step);
      if (run.t.bad) return { t: 'what-if', k: B.cK[run.i], i: run.i, d, kills: [run.i] };
      if (run.t.nPlaced < B.K) next.push(run);
    }
    runs = next;
  }
  return null;
}

export function apply(B, st, step) {
  if (step.t === 'single fit') place(B, st, step.i);
  else for (const j of step.kills) kill(B, st, j);
}

// The easiest deduction available, or null when stuck.
export function findNext(B, st, { maxTier = 4, maxChain = 8 } = {}, inter = new Uint32Array(B.W)) {
  return findSingleFit(B, st)
    || findSingleReach(B, st)
    || (maxTier >= 2 ? findOverlap(B, st, inter) : null)
    || (maxTier >= 3 ? findSqueeze(B, st) : null)
    || (maxTier >= 4 ? findWhatIf(B, st, maxChain, inter) : null);
}

// ---- grading ------------------------------------------------------------

export function grade(B, { maxTier = 4, maxChain = 8 } = {}) {
  const st = initState(B);
  const inter = new Uint32Array(B.W);
  const techniques = {};
  const chains = [];
  let score = 0;
  let hardestTier = 0;
  let hardest = 'none';
  let steps = 0;
  const fail = (why) => ({ solved: false, why, techniques, score, hardest, hardestTier, steps, chains });
  if (st.bad) return fail('no fit');

  while (st.nPlaced < B.K) {
    const step = findNext(B, st, { maxTier, maxChain }, inter);
    if (!step) return fail('stuck');
    apply(B, st, step);
    if (st.bad) throw new Error('grader reached a contradiction on the real board');
    const { t } = step;
    steps++;
    techniques[t] = (techniques[t] ?? 0) + 1;
    const { tier, weight } = TECHNIQUES[t];
    score += weight;
    if (t === 'what-if') {
      chains.push(step.d);
      score += WHATIF_STEP * step.d;
    }
    if (!TECHNIQUES[hardest] || weight > TECHNIQUES[hardest].weight) {
      hardestTier = tier;
      hardest = t;
    }
  }
  return {
    solved: true,
    techniques,
    score: Math.round(score),
    hardest,
    hardestTier,
    steps,
    chains,
    solution: Array.from(st.placed),
  };
}
