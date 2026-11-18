#!/usr/bin/env node
// Verifies data/paper-route.json independently of the grader:
//   - the stored solution follows every rule
//   - a brute-force search (count.js) finds exactly one route, and it is that one
// Prints one line per puzzle and exits non-zero if any puzzle fails.
//
//   node games/paper-route/check.mjs [path/to/paper-route.json]

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { countRoutes } from './count.js';
import { DAYS } from '../../lib/days.js';

const file = process.argv[2] ?? new URL('../../data/paper-route.json', import.meta.url);
const set = JSON.parse(readFileSync(file, 'utf8'));

function ruleProblems(p) {
  const out = [];
  const N = p.size;
  const V = N * N;
  const { stops, walls, solution } = p;
  const cellOk = (v) => Number.isInteger(v) && v >= 0 && v < V;
  const adjacent = (a, b) => {
    const dr = Math.abs(Math.floor(a / N) - Math.floor(b / N));
    const dc = Math.abs((a % N) - (b % N));
    return dr + dc === 1;
  };

  if (!Number.isInteger(N) || N < 2) return ['bad size'];
  if (!Array.isArray(stops) || stops.length < 2) out.push('needs at least two stops');
  if (!stops.every(cellOk) || new Set(stops).size !== stops.length) out.push('bad stop cells');
  if (!Array.isArray(walls) || walls.length % 2) out.push('walls must be cell pairs');

  const wallSet = new Set();
  for (let i = 0; i + 1 < walls.length; i += 2) {
    const [a, b] = [walls[i], walls[i + 1]];
    if (!cellOk(a) || !cellOk(b) || !adjacent(a, b)) out.push(`wall ${a}-${b} is not between neighbours`);
    wallSet.add(Math.min(a, b) * V + Math.max(a, b));
  }

  if (!Array.isArray(solution) || solution.length !== V) return [...out, 'solution must visit every cell'];
  if (!solution.every(cellOk) || new Set(solution).size !== V) out.push('solution repeats or skips a cell');
  for (let i = 1; i < V; i++) {
    const a = solution[i - 1];
    const b = solution[i];
    if (!adjacent(a, b)) out.push(`step ${i} jumps from ${a} to ${b}`);
    else if (wallSet.has(Math.min(a, b) * V + Math.max(a, b))) out.push(`step ${i} crosses a wall`);
  }
  if (solution[0] !== stops[0]) out.push('route does not start at 1');
  if (solution[V - 1] !== stops[stops.length - 1]) out.push('route does not end at the last stop');
  const pos = new Map(solution.map((v, i) => [v, i]));
  for (let k = 1; k < stops.length; k++) {
    if (!(pos.get(stops[k - 1]) < pos.get(stops[k]))) out.push(`stop ${k + 1} comes before stop ${k}`);
  }

  const g = p.grade ?? {};
  if (typeof g.score !== 'number' || typeof g.hardest !== 'string'
    || typeof g.techniques !== 'object' || typeof g.summary !== 'string') out.push('incomplete grade');
  return out;
}

let failures = 0;
for (const p of set.puzzles) {
  const label = `w${p.week} ${DAYS[p.day - 1]?.short ?? p.day} ${p.size}x${p.size}`;
  const problems = ruleProblems(p);
  let count = '?';
  let ms = 0;
  if (!problems.length) {
    const t0 = performance.now();
    const r = countRoutes(p.size, p.stops, p.walls, 2);
    ms = Math.round(performance.now() - t0);
    count = r.count;
    if (r.count !== 1) problems.push(`${r.count === 0 ? 'no' : 'more than one'} solution`);
    else if (r.first.some((v, i) => v !== p.solution[i])) problems.push('the only solution differs from the stored one');
  }
  const status = problems.length ? `FAIL ${problems.join('; ')}` : 'ok';
  console.log(
    `${label.padEnd(12)} stops=${String(p.stops.length).padEnd(3)} walls=${String(p.walls.length / 2).padEnd(2)} ` +
      `solutions=${count} (${ms} ms)  ${status}`,
  );
  if (problems.length) failures++;
}

console.log(failures ? `${failures} of ${set.puzzles.length} puzzles failed` : `all ${set.puzzles.length} puzzles ok`);
process.exit(failures ? 1 : 0);
