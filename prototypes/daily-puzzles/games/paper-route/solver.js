// Paper Route grader: a step-by-step logical solver that works the way a
// person does, one deduction at a time, always reaching for the easiest one.
//
// The board is modelled as edges between orthogonal neighbours. Each edge is
// unknown, part of the route (a line) or ruled out (a cross). Lines form
// strands; a strand's two ends are the only places it can grow.
//
// Tiers (easiest first):
//   1 Forced cell      a cell (or the start/end stop) has exactly as many open
//                      sides as the route needs there, so it uses them all
//   2 No loop          joining a strand to itself would close a loop, and
//                      joining the strand from 1 to the strand reaching the last
//                      stop would finish the route early
//   2 Stop order       joining two strands would visit stops out of order or
//                      skip one
//   3 Only way in      an edge is the only link between two parts of the board
//   3 Dead end ahead   drawing (or ruling out) an edge leaves a cell with too
//                      few exits (or makes a loop or breaks stop order) straight
//                      away, after at most one forced move
//   4 Two doors        an area joined to the rest by exactly two edges: with no
//                      route end inside, the route must use both; with one end
//                      inside, exactly one
//   4 Short what-if    assuming an edge leads, through Forced cell, No loop,
//                      Stop order and Only way in steps, to a contradiction
//                      (including an area cut off from the route) within 2 steps
//   5 What-if          the same within 6 steps
//   6 Long what-if     the same within 12 steps
//
// The lookahead tiers are one search: every unknown edge is tried both ways
// and the shortest refutation wins, so the chain length is the depth of
// planning the step needed.

export const UNKNOWN = 0;
export const LINE = 1;
export const CROSS = 2;

export const TECHNIQUES = {
  'Forced cell': { tier: 1, weight: 1 },
  'No loop': { tier: 2, weight: 2 },
  'Stop order': { tier: 2, weight: 2 },
  'Only way in': { tier: 3, weight: 4 },
  'Dead end ahead': { tier: 3, weight: 5 },
  'Two doors': { tier: 4, weight: 8 },
  'Short what-if': { tier: 4, weight: 8 },
  'What-if': { tier: 5, weight: 14 },
  'Long what-if': { tier: 6, weight: 24 },
};

// Longest chain allowed at tiers 4, 5 and 6.
const CHAIN = { 4: 2, 5: 6, 6: 12 };

// ---------------------------------------------------------------- board ----

export function makeBoard(N, stops, walls = []) {
  const V = N * N;
  const blocked = new Set();
  for (let i = 0; i + 1 < walls.length; i += 2) {
    const a = walls[i];
    const b = walls[i + 1];
    blocked.add(a < b ? a * V + b : b * V + a);
  }
  const ea = [];
  const eb = [];
  const adj = new Int16Array(V * 4).fill(-1);
  const deg = new Uint8Array(V);
  const link = (v, u) => {
    const e = ea.length;
    ea.push(v);
    eb.push(u);
    adj[v * 4 + deg[v]++] = e;
    adj[u * 4 + deg[u]++] = e;
  };
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = r * N + c;
      if (c + 1 < N && !blocked.has(v * V + v + 1)) link(v, v + 1);
      if (r + 1 < N && !blocked.has(v * V + v + N)) link(v, v + N);
    }
  }
  const K = stops.length;
  const stopAt = new Int16Array(V);
  stops.forEach((v, i) => { stopAt[v] = i + 1; });
  const need = new Uint8Array(V).fill(2);
  need[stops[0]] = 1;
  need[stops[K - 1]] = 1;
  return {
    N, V, E: ea.length, K, s: stops[0], t: stops[K - 1],
    ea: Int16Array.from(ea), eb: Int16Array.from(eb), adj, deg, stopAt, need,
    // scratch space for the connectivity scans
    disc: new Int16Array(V), low: new Int16Array(V), tin: new Uint8Array(V), pe: new Int16Array(V),
    stk: new Int16Array(V), it: new Uint8Array(V),
    br: new Uint8Array(ea.length),
  };
}

// ---------------------------------------------------------------- state ----

function newState(B) {
  const { V, E } = B;
  const st = {
    es: new Uint8Array(E),
    ld: new Uint8Array(V), // lines at each cell
    av: new Uint8Array(V), // lines + unknowns at each cell
    oth: new Int16Array(V), // for a strand end: the strand's other end
    size: new Int16Array(V), // for a strand end: cells in the strand
    lo: new Int16Array(V), // for a strand end: lowest stop on the strand (0 if none)
    hi: new Int16Array(V), // highest stop on the strand
    near: new Int16Array(V), // stop on the strand nearest to this end
    unknown: E,
    crosses: 0, // bumps whenever an edge is ruled out
  };
  for (let v = 0; v < V; v++) {
    st.av[v] = B.deg[v];
    st.oth[v] = v;
    st.size[v] = 1;
    st.lo[v] = st.hi[v] = st.near[v] = B.stopAt[v];
  }
  return st;
}

function copyState(dst, st) {
  dst.es.set(st.es); dst.ld.set(st.ld); dst.av.set(st.av); dst.oth.set(st.oth);
  dst.size.set(st.size); dst.lo.set(st.lo); dst.hi.set(st.hi); dst.near.set(st.near);
  dst.unknown = st.unknown;
  dst.crosses = st.crosses;
  return dst;
}

// 0: fine, 1: closes a loop, 2: stops out of order, 3: finishes the route early.
// a and b must both be strand ends.
function mergeCode(B, st, a, b) {
  if (st.oth[a] === b) return 1;
  const la = st.lo[a];
  const lb = st.lo[b];
  let lo;
  let hi;
  if (la && lb) {
    const na = st.near[a];
    const nb = st.near[b];
    const ha = st.hi[a];
    const hb = st.hi[b];
    const up = na === ha && nb === lb && lb === ha + 1;
    const down = na === la && nb === hb && hb === la - 1;
    if (!up && !down) return 2;
    lo = la < lb ? la : lb;
    hi = ha > hb ? ha : hb;
  } else if (la) {
    lo = la; hi = st.hi[a];
  } else if (lb) {
    lo = lb; hi = st.hi[b];
  } else {
    return 0;
  }
  if (lo === 1 && hi === B.K && st.size[a] + st.size[b] < B.V) return 3;
  return 0;
}

function doMerge(st, a, b) {
  const a2 = st.oth[a];
  const b2 = st.oth[b];
  const la = st.lo[a];
  const lb = st.lo[b];
  const nearA2 = la ? st.near[a2] : st.near[b];
  const nearB2 = lb ? st.near[b2] : st.near[a];
  let lo = 0;
  let hi = 0;
  if (la && lb) {
    lo = Math.min(la, lb); hi = Math.max(st.hi[a], st.hi[b]);
  } else if (la) {
    lo = la; hi = st.hi[a];
  } else if (lb) {
    lo = lb; hi = st.hi[b];
  }
  const size = st.size[a] + st.size[b];
  st.oth[a2] = b2; st.oth[b2] = a2;
  st.size[a2] = st.size[b2] = size;
  st.lo[a2] = st.lo[b2] = lo;
  st.hi[a2] = st.hi[b2] = hi;
  st.near[a2] = nearA2;
  st.near[b2] = nearB2;
}

// Why the last change failed, for hints: { kind, cell | a, b | w }.
let why = null;
const MERGE_KINDS = ['', 'loop', 'order', 'early'];

// Each returns false when the change makes the position impossible.
function setLine(B, st, e) {
  const cur = st.es[e];
  if (cur) return cur === LINE;
  const a = B.ea[e];
  const b = B.eb[e];
  if (st.ld[a] >= B.need[a] || st.ld[b] >= B.need[b]) {
    why = { kind: 'full', cell: st.ld[a] >= B.need[a] ? a : b };
    return false;
  }
  const code = mergeCode(B, st, a, b);
  if (code) {
    why = { kind: MERGE_KINDS[code], a, b };
    return false;
  }
  st.es[e] = LINE;
  st.unknown--;
  st.ld[a]++;
  st.ld[b]++;
  doMerge(st, a, b);
  return true;
}

function setCross(B, st, e) {
  const cur = st.es[e];
  if (cur) return cur === CROSS;
  const a = B.ea[e];
  const b = B.eb[e];
  st.es[e] = CROSS;
  st.unknown--;
  st.crosses++;
  st.av[a]--;
  st.av[b]--;
  if (st.av[a] >= B.need[a] && st.av[b] >= B.need[b]) return true;
  why = { kind: 'dead', cell: st.av[a] < B.need[a] ? a : b };
  return false;
}

// Free bookkeeping: a cell that already has all its lines rules out its other sides.
function tidy(B, st) {
  for (let v = 0; v < B.V; v++) {
    if (st.ld[v] === B.need[v] && st.av[v] > st.ld[v]) {
      for (let k = v * 4, end = k + B.deg[v]; k < end; k++) {
        const e = B.adj[k];
        if (st.es[e] === UNKNOWN && !setCross(B, st, e)) return false;
      }
    }
  }
  return true;
}

// ------------------------------------------------------ connectivity scan ----
// Depth-first search from the start stop over usable edges (lines and
// unknowns), recording discovery times, low links (for bridges) and whether
// each subtree holds the last stop.

function scan(B, st, skip) {
  const { disc, low, tin, pe, adj, ea, eb, deg, stk, it } = B;
  const es = st.es;
  const s = B.s;
  const t = B.t;
  disc.fill(-1);
  let time = 0;
  let top = 0;
  disc[s] = low[s] = time++;
  tin[s] = s === t ? 1 : 0;
  pe[s] = -1;
  it[s] = 0;
  stk[top++] = s;
  while (top > 0) {
    const u = stk[top - 1];
    if (it[u] < deg[u]) {
      const e = adj[u * 4 + it[u]++];
      if (e === pe[u] || e === skip || es[e] === CROSS) continue;
      const w = ea[e] === u ? eb[e] : ea[e];
      if (disc[w] < 0) {
        disc[w] = low[w] = time++;
        tin[w] = w === t ? 1 : 0;
        pe[w] = e;
        it[w] = 0;
        stk[top++] = w;
      } else if (disc[w] < low[u]) {
        low[u] = disc[w];
      }
    } else if (--top > 0) {
      const p = stk[top - 1];
      if (low[u] < low[p]) low[p] = low[u];
      tin[p] += tin[u];
    }
  }
  return time;
}

// Whole-board sanity: every cell reachable, and every single-edge cut must
// separate the start from the end (an area hanging off one edge with no route
// end inside it can never be covered).
function globalOK(B, st) {
  if (scan(B, st, -1) < B.V) {
    why = { kind: 'split' };
    return false;
  }
  const { disc, low, tin } = B;
  for (let w = 0; w < B.V; w++) {
    if (w !== B.s && low[w] === disc[w] && !tin[w]) {
      why = { kind: 'cut', w };
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------ techniques ----
// Each returns 1 on progress, -1 on contradiction, 0 when it finds nothing.

function forcedCell(B, st) {
  for (let v = 0; v < B.V; v++) {
    if (st.ld[v] < B.need[v] && st.av[v] === B.need[v]) {
      for (let k = v * 4, end = k + B.deg[v]; k < end; k++) {
        const e = B.adj[k];
        if (st.es[e] === UNKNOWN && !setLine(B, st, e)) return -1;
      }
      return 1;
    }
  }
  return 0;
}

// Returns 0, or the merge code of the edge it crossed (negative on contradiction).
function loopOrder(B, st) {
  for (let e = 0; e < B.E; e++) {
    if (st.es[e] !== UNKNOWN) continue;
    const code = mergeCode(B, st, B.ea[e], B.eb[e]);
    if (code) return setCross(B, st, e) ? code : -code;
  }
  return 0;
}

// Uses the scan left behind by globalOK.
function bridgeLine(B, st) {
  const { disc, low, pe } = B;
  for (let w = 0; w < B.V; w++) {
    if (w === B.s || low[w] !== disc[w]) continue;
    const e = pe[w];
    if (st.es[e] === UNKNOWN) return setLine(B, st, e) ? 1 : -1;
  }
  return 0;
}

// Areas cut off by exactly two usable edges (the doors). With no route end
// inside, the route must come in and go out, so both doors are used. With the
// last stop inside, exactly one is, so a used door rules out the other.
// Calls take(e1, e2, w, set) for each area that yields something, where w is
// a cell inside and set lists [edge, value] changes; stops when take is true.
function twoDoorScan(B, st, take) {
  const { disc, low, pe, tin, br } = B;
  scan(B, st, -1);
  br.fill(0);
  for (let w = 0; w < B.V; w++) {
    if (w !== B.s && low[w] === disc[w]) br[pe[w]] = 1;
  }
  for (let e1 = 0; e1 < B.E; e1++) {
    if (st.es[e1] === CROSS || br[e1]) continue;
    scan(B, st, e1);
    for (let w = 0; w < B.V; w++) {
      if (w === B.s || low[w] !== disc[w]) continue;
      const e2 = pe[w];
      if (e2 < e1 || br[e2]) continue;
      const s1 = st.es[e1];
      const s2 = st.es[e2];
      if (s1 !== UNKNOWN && s2 !== UNKNOWN) continue;
      let set;
      if (!tin[w]) set = [[e1, LINE], [e2, LINE]].filter(([e]) => st.es[e] === UNKNOWN);
      else if (s1 === LINE) set = [[e2, CROSS]];
      else if (s2 === LINE) set = [[e1, CROSS]];
      else continue;
      if (take(e1, e2, w, set)) return;
    }
  }
}

function twoDoors(B, st) {
  let found = null;
  twoDoorScan(B, st, (e1, e2, w, set) => { found = set; return true; });
  if (!found) return 0;
  for (const [e, val] of found) {
    if (!(val === LINE ? setLine(B, st, e) : setCross(B, st, e))) return -1;
  }
  return 1;
}

// Propagates easy deductions on a hypothetical position. Returns the number
// of steps taken before a contradiction showed up, or -1 if none did within
// the limit. Shallow lookahead (Dead end ahead) only notices local trouble: a
// cell left with too few exits, a loop, stops out of order. Deep lookahead
// (What-if) also uses Only way in and notices areas that get cut off.
function propagate(B, st, limit, deep) {
  let steps = 0;
  let scanned = -1;
  for (;;) {
    if (!tidy(B, st)) return steps;
    // Lines never change which edges are usable, so rescan only after a cross.
    if (deep && scanned !== st.crosses) {
      if (!globalOK(B, st)) return steps;
      scanned = st.crosses;
    }
    if (st.unknown === 0 || steps >= limit) return -1;
    steps++;
    let r = forcedCell(B, st);
    if (!r) r = loopOrder(B, st);
    if (!r && deep) r = bridgeLine(B, st);
    if (r < 0) return steps;
    if (!r) return -1;
  }
}

// Tries every unknown edge both ways and returns the shortest refutation.
// With near(edge) given, ties go to the edge nearest the player's focus.
function whatIf(B, st, limit, deep, near) {
  let best = null;
  let bestSteps = limit + 1;
  let bestNear = Infinity;
  const h = B.hyp ?? (B.hyp = newState(B));
  for (let e = 0; e < B.E; e++) {
    if (st.es[e] !== UNKNOWN) continue;
    const d = near ? near(e) : 0;
    for (let val = LINE; val <= CROSS; val++) {
      const cap = near && d < bestNear ? bestSteps : bestSteps - 1;
      if (cap < 0) break;
      copyState(h, st);
      const ok = val === LINE ? setLine(B, h, e) : setCross(B, h, e);
      const steps = ok ? propagate(B, h, cap, deep) : 0;
      if (steps < 0) continue;
      if (steps < bestSteps || (near && steps === bestSteps && d < bestNear)) {
        best = { e, val, steps };
        bestSteps = steps;
        bestNear = d;
        if (steps === 0 && d === 0) return best;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- solve ----

// Solves using techniques up to maxTier. Returns
// { solved, path, counts, score, hardest, hardestTier, chains }.
export function solve(B, maxTier = 6) {
  const st = newState(B);
  const counts = {};
  const chains = [];
  let score = 0;
  let steps = 0;
  const note = (name, extra = 0) => {
    counts[name] = (counts[name] ?? 0) + 1;
    score += TECHNIQUES[name].weight + extra;
    steps++;
  };
  const fail = (why) => ({ solved: false, why, counts, score, steps });

  for (let v = 0; v < B.V; v++) if (st.av[v] < B.need[v]) return fail('blocked cell');

  for (;;) {
    if (!tidy(B, st)) return fail('contradiction');
    if (st.unknown === 0) break;

    let r = forcedCell(B, st);
    if (r) {
      if (r < 0) return fail('contradiction');
      note('Forced cell');
      continue;
    }
    if (maxTier < 2) return fail('stuck');
    r = loopOrder(B, st);
    if (r) {
      if (r < 0) return fail('contradiction');
      note(r === 2 ? 'Stop order' : 'No loop');
      continue;
    }
    if (maxTier < 3) return fail('stuck');
    if (!globalOK(B, st)) return fail('contradiction');
    r = bridgeLine(B, st);
    if (r) {
      if (r < 0) return fail('contradiction');
      note('Only way in');
      continue;
    }
    let h = whatIf(B, st, 1, false);
    if (h) {
      const ok = h.val === LINE ? setCross(B, st, h.e) : setLine(B, st, h.e);
      if (!ok) return fail('contradiction');
      chains.push(h.steps);
      note('Dead end ahead', h.steps);
      continue;
    }
    if (maxTier < 4) return fail('stuck');
    r = twoDoors(B, st);
    if (r) {
      if (r < 0) return fail('contradiction');
      note('Two doors');
      continue;
    }
    h = whatIf(B, st, CHAIN[Math.min(maxTier, 6)], true);
    if (h) {
      const ok = h.val === LINE ? setCross(B, st, h.e) : setLine(B, st, h.e);
      if (!ok) return fail('contradiction');
      chains.push(h.steps);
      const name = h.steps <= CHAIN[4] ? 'Short what-if' : h.steps <= CHAIN[5] ? 'What-if' : 'Long what-if';
      note(name, h.steps);
      continue;
    }
    return fail('stuck');
  }

  // Every edge decided: read the route off from the start.
  const path = [B.s];
  let prev = -1;
  let cur = B.s;
  while (path.length < B.V) {
    let next = -1;
    for (let k = cur * 4, end = k + B.deg[cur]; k < end; k++) {
      const e = B.adj[k];
      if (st.es[e] !== LINE) continue;
      const w = B.ea[e] === cur ? B.eb[e] : B.ea[e];
      if (w !== prev) { next = w; break; }
    }
    if (next < 0) return fail('broken route');
    prev = cur;
    cur = next;
    path.push(cur);
  }
  if (cur !== B.t) return fail('wrong end');

  let hardest = 'Forced cell';
  for (const name of Object.keys(counts)) {
    const a = TECHNIQUES[name];
    const b = TECHNIQUES[hardest];
    if (a.tier > b.tier || (a.tier === b.tier && a.weight > b.weight)) hardest = name;
  }
  return {
    solved: true, path, counts, score, steps, chains,
    hardest, hardestTier: TECHNIQUES[hardest].tier,
  };
}

// ---------------------------------------------------------------- hints ----
// The view asks for hints with the player's route (a correct start of the
// solution) plus facts earlier hints established, as [cellA, cellB, value].

function edgeBetween(B, a, b) {
  for (let k = a * 4, end = k + B.deg[a]; k < end; k++) {
    const e = B.adj[k];
    if (B.ea[e] === b || B.eb[e] === b) return e;
  }
  return -1;
}

// A position with the route's steps drawn and the facts applied, or null if
// they don't fit together.
export function hintState(B, route, facts = []) {
  const st = newState(B);
  for (let i = 1; i < route.length; i++) {
    const e = edgeBetween(B, route[i - 1], route[i]);
    if (e < 0 || !setLine(B, st, e)) return null;
  }
  for (const [a, b, val] of facts) {
    const e = edgeBetween(B, a, b);
    if (e < 0 || !(val === LINE ? setLine(B, st, e) : setCross(B, st, e))) return null;
  }
  return tidy(B, st) ? st : null;
}

// Cells reachable from start over usable edges, not crossing edges x1 or x2.
function areaFrom(B, st, start, x1, x2) {
  const seen = new Uint8Array(B.V);
  const out = [start];
  seen[start] = 1;
  for (let i = 0; i < out.length; i++) {
    const u = out[i];
    for (let k = u * 4, end = k + B.deg[u]; k < end; k++) {
      const e = B.adj[k];
      if (e === x1 || e === x2 || st.es[e] === CROSS) continue;
      const w = B.ea[e] === u ? B.eb[e] : B.ea[e];
      if (!seen[w]) {
        seen[w] = 1;
        out.push(w);
      }
    }
  }
  return out;
}

// Replays a refuted assumption to see what goes wrong and where.
function consequence(B, st, e, val, deep, limit) {
  const h = copyState(newState(B), st);
  why = null;
  const ok = val === LINE ? setLine(B, h, e) : setCross(B, h, e);
  if (ok) propagate(B, h, limit, deep);
  const w = why ?? { kind: 'dead', cell: B.ea[e] };
  let cells = [];
  if (w.kind === 'split') {
    for (let v = 0; v < B.V; v++) if (B.disc[v] < 0) cells.push(v);
  } else if (w.kind === 'cut') {
    cells = areaFrom(B, h, w.w, B.pe[w.w], -1);
  } else if (w.cell !== undefined) {
    cells = [w.cell];
  } else {
    cells = [w.a, w.b];
  }
  return { why: w.kind === 'split' ? 'cut' : w.kind, cells, cell: w.cell };
}

// The easiest next deduction, preferring ones near `focus` (the route's end)
// among equally easy ones. Returns null when nothing is left to find, else
// { kind, set: [[a, b, value]], cells, ... } where set is what it proves.
//   forced  { cell }                     a cell with as many open sides as it needs
//   loop | early | order  { stops }      a step that can't be taken
//   bridge                               the only way into the area in cells
//   doors   { inside }                   an area with two ways in
//   look    { tried, steps, why, cell }  assuming the opposite fails after
//                                        `steps` forced moves, because of `why`
export function findHint(B, st, focus) {
  if (!tidy(B, st) || st.unknown === 0) return null;
  const { N, ea, eb } = B;
  const fr = Math.floor(focus / N);
  const fc = focus % N;
  const dist = (v) => Math.abs(Math.floor(v / N) - fr) + Math.abs((v % N) - fc);
  const near = (e) => Math.min(dist(ea[e]), dist(eb[e]));
  const pair = (e, val) => [ea[e], eb[e], val];
  let best = null;
  let bestD = Infinity;
  const offer = (d, make) => {
    if (d < bestD) {
      bestD = d;
      best = make;
    }
  };
  const look = (h, deep) => () => {
    const c = consequence(B, st, h.e, h.val, deep, h.steps);
    return {
      kind: 'look', tried: h.val, steps: h.steps, why: c.why, cell: c.cell,
      set: [pair(h.e, h.val === LINE ? CROSS : LINE)],
      cells: [ea[h.e], eb[h.e], ...c.cells],
    };
  };

  // One spot at a time: forced cells, loops, stop order.
  for (let v = 0; v < B.V; v++) {
    if (st.ld[v] >= B.need[v] || st.av[v] !== B.need[v]) continue;
    offer(dist(v), () => {
      const set = [];
      for (let k = v * 4, end = k + B.deg[v]; k < end; k++) {
        if (st.es[B.adj[k]] === UNKNOWN) set.push(pair(B.adj[k], LINE));
      }
      return { kind: 'forced', cell: v, set, cells: [v] };
    });
  }
  for (let e = 0; e < B.E; e++) {
    if (st.es[e] !== UNKNOWN) continue;
    const code = mergeCode(B, st, ea[e], eb[e]);
    if (!code) continue;
    offer(near(e), () => ({
      kind: MERGE_KINDS[code], set: [pair(e, CROSS)], cells: [ea[e], eb[e]],
      stops: [st.near[ea[e]], st.near[eb[e]]],
    }));
  }
  if (best) return best();

  // A wider look: the only way into an area, or a step that strands a cell.
  if (!globalOK(B, st)) return null;
  for (let w = 0; w < B.V; w++) {
    if (w === B.s || B.low[w] !== B.disc[w] || st.es[B.pe[w]] !== UNKNOWN) continue;
    const e = B.pe[w];
    offer(near(e), () => ({ kind: 'bridge', set: [pair(e, LINE)], cells: areaFrom(B, st, w, e, -1) }));
  }
  const shallow = whatIf(B, st, 1, false, near);
  if (shallow) offer(near(shallow.e), look(shallow, false));
  if (best) return best();

  twoDoorScan(B, st, (e1, e2, w, set) => {
    const inside = B.tin[w] > 0; // read now: later scans reuse the scratch space
    offer(Math.min(near(e1), near(e2)), () => ({
      kind: 'doors', inside, set: set.map(([e, val]) => pair(e, val)),
      cells: areaFrom(B, st, w, e1, e2),
    }));
    return false;
  });
  if (best) return best();

  const deep = whatIf(B, st, CHAIN[6], true, near);
  return deep ? look(deep, true)() : null;
}
