// Paper Route generator: a numbered Hamiltonian path puzzle.
//
// 1. Make a random route through every cell with "backbite" moves.
// 2. Put a stop on every cell of it and a few walls on edges it doesn't use.
// 3. Remove stops in random order, keeping each removal only if the logical
//    grader (solver.js) still solves the puzzle with the day's techniques and
//    the score stays under the day's ceiling. Easy days stop as soon as the
//    puzzle lands in the day's band; weekend days keep removing to make the
//    hardest puzzle that path allows, then check the band.
// 4. A puzzle the grader solves without guessing has exactly one solution;
//    count.js double-checks that by brute force before it is accepted.

import { makeBoard, solve, TECHNIQUES } from './solver.js';
import { countRoutes } from './count.js';

// Per day:
//   size   board is size x size
//   walls  walls placed on edges the route doesn't use
//   cap    highest technique tier the grader may use
//   need   [tier, n]: at least n steps must use a technique of that tier or above
//   band   [lo, hi] score range
//   stops  [fewest, most] stops (including 1 and the last)
//   full   keep removing stops while possible instead of stopping at the band
//   tries  candidate routes to try before settling for the closest
export const DAY_PLAN = {
  1: { size: 5, walls: 5, cap: 2, need: [1, 0], band: [0, 45], stops: [9, 10], tries: 30 },
  2: { size: 6, walls: 7, cap: 2, need: [2, 6], band: [40, 80], stops: [8, 11], tries: 30 },
  3: { size: 6, walls: 8, cap: 3, need: [3, 2], band: [55, 110], stops: [6, 11], tries: 40 },
  4: { size: 7, walls: 10, cap: 4, need: [4, 1], band: [95, 170], stops: [6, 14], tries: 40 },
  5: { size: 7, walls: 11, cap: 5, need: [5, 1], band: [140, 250], stops: [5, 14], tries: 30 },
  6: { size: 8, walls: 14, cap: 5, need: [5, 3], band: [220, 380], stops: [6, 18], tries: 30, full: true },
  7: { size: 9, walls: 18, cap: 6, need: [6, 1], band: [340, 560], stops: [8, 24], tries: 12, full: true },
};

function neighbours(N, v) {
  const r = Math.floor(v / N);
  const c = v % N;
  const out = [];
  if (r > 0) out.push(v - N);
  if (r < N - 1) out.push(v + N);
  if (c > 0) out.push(v - 1);
  if (c < N - 1) out.push(v + 1);
  return out;
}

// Random Hamiltonian path by backbite moves from a serpentine start.
export function randomPath(N, rng, moves = 40 * N * N) {
  const V = N * N;
  const path = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) path.push(r * N + (r % 2 ? N - 1 - c : c));
  }
  const nb = Array.from({ length: V }, (_, v) => neighbours(N, v));
  for (let m = 0; m < moves; m++) {
    if (rng.chance(0.5)) path.reverse();
    const tail = path[V - 1];
    const w = rng.pick(nb[tail]);
    if (w === path[V - 2]) continue;
    const j = path.indexOf(w);
    // Link the tail to w, drop w's link to path[j+1], reverse the loose end.
    for (let i = j + 1, k = V - 1; i < k; i++, k--) {
      const tmp = path[i];
      path[i] = path[k];
      path[k] = tmp;
    }
  }
  return path;
}

function unusedEdges(N, path) {
  const pos = new Int32Array(N * N);
  path.forEach((v, i) => { pos[v] = i; });
  const out = [];
  for (let v = 0; v < N * N; v++) {
    for (const u of neighbours(N, v)) {
      if (u > v && Math.abs(pos[u] - pos[v]) !== 1) out.push(u, v);
    }
  }
  return out;
}

function hardSteps(g, tier) {
  let n = 0;
  for (const [name, count] of Object.entries(g.counts)) {
    if (TECHNIQUES[name].tier >= tier) n += count;
  }
  return n;
}

function fits(g, plan, nStops) {
  return g.solved
    && nStops <= plan.stops[1]
    && g.score >= plan.band[0] && g.score <= plan.band[1]
    && hardSteps(g, plan.need[0]) >= plan.need[1];
}

// How far a candidate is from the day's target (0 = on target).
function miss(c, plan) {
  const { g } = c;
  if (!g.solved) return Infinity;
  const [lo, hi] = plan.band;
  let d = g.score < lo ? lo - g.score : g.score > hi ? g.score - hi : 0;
  d += 50 * Math.max(0, plan.need[1] - hardSteps(g, plan.need[0]));
  d += 10 * Math.max(0, c.stops.length - plan.stops[1]);
  return d;
}

function attempt(plan, rng) {
  const N = plan.size;
  const V = N * N;
  const path = randomPath(N, rng);
  const edges = unusedEdges(N, path);
  const walls = [];
  for (const i of rng.shuffle([...Array(edges.length / 2).keys()]).slice(0, plan.walls)) {
    walls.push(edges[2 * i], edges[2 * i + 1]);
  }
  const stopOn = new Uint8Array(V).fill(1);
  let nStops = V;
  const order = rng.shuffle([...Array(V - 2).keys()].map((i) => i + 1));

  const stopsNow = () => path.filter((_, i) => stopOn[i]);
  const grade = (cap) => solve(makeBoard(N, stopsNow(), walls), cap);
  const result = (g) => ({ N, path, stops: stopsNow(), walls, g });

  let g = grade(plan.cap);
  // Cheap pass first: a solve that succeeds with tiers 1-3 takes exactly the
  // same steps at any higher cap (the grader always tries the easiest
  // technique first), so only the leftovers need the slower lookahead.
  const passes = plan.cap > 3 ? [3, plan.cap] : [plan.cap];
  for (const cap of passes) {
    for (const i of order) {
      if (!stopOn[i] || nStops <= plan.stops[0]) continue;
      stopOn[i] = 0;
      const next = grade(cap);
      if (!next.solved || next.score > plan.band[1]) {
        stopOn[i] = 1;
        continue;
      }
      nStops--;
      g = next;
      if (!plan.full && fits(g, plan, nStops)) return result(g);
    }
  }
  return result(g);
}

export function generate(day, rng) {
  const plan = DAY_PLAN[day];
  let best = null;
  let tries = 0;
  while (tries < plan.tries || !best) {
    tries++;
    const cand = attempt(plan, rng);
    if (!cand.g.solved || (best && miss(cand, plan) >= miss(best, plan))) continue;
    if (countRoutes(cand.N, cand.stops, cand.walls, 2, 5e6).count !== 1) continue;
    best = cand;
    if (fits(cand.g, plan, cand.stops.length)) break;
  }
  return toPuzzle(best, fits(best.g, plan, best.stops.length));
}

function toPuzzle(c, onTarget) {
  const { g } = c;
  const techniques = {};
  for (const name of Object.keys(TECHNIQUES)) if (g.counts[name]) techniques[name] = g.counts[name];
  const forced = Math.round((100 * (g.counts['Forced cell'] ?? 0)) / g.steps);
  const looks = g.chains.length;
  const parts = [
    `${c.stops.length} stops, ${c.walls.length / 2} walls`,
    `${g.steps} steps, ${forced}% forced cells`,
    looks ? `${looks} lookahead${looks > 1 ? 's' : ''}, longest chain ${Math.max(...g.chains)}` : 'no lookahead',
  ];
  if (!onTarget) parts.push('off target');
  return {
    size: c.N,
    stops: c.stops,
    walls: c.walls,
    solution: c.path,
    grade: { score: g.score, hardest: g.hardest, techniques, summary: parts.join(' · ') },
  };
}
