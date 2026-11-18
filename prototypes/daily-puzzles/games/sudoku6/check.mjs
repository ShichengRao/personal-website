#!/usr/bin/env node
// Independent check of data/sudoku6.json. Shares no code with the generator:
// rules are checked directly, and uniqueness by plain backtracking.
//
//   node games/sudoku6/check.mjs

import { readFileSync } from 'node:fs';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const file = new URL('../../data/sudoku6.json', import.meta.url);
const set = JSON.parse(readFileSync(file, 'utf8'));

const N = 6;
const BOX_ROWS = 2;
const BOX_COLS = 3;

// The 18 groups of cells that must each hold 1–6 once.
const groups = [];
for (let r = 0; r < N; r++) groups.push(Array.from({ length: N }, (_, c) => r * N + c));
for (let c = 0; c < N; c++) groups.push(Array.from({ length: N }, (_, r) => r * N + c));
for (let br = 0; br < N; br += BOX_ROWS) {
  for (let bc = 0; bc < N; bc += BOX_COLS) {
    const g = [];
    for (let r = br; r < br + BOX_ROWS; r++) for (let c = bc; c < bc + BOX_COLS; c++) g.push(r * N + c);
    groups.push(g);
  }
}
const groupsOf = Array.from({ length: N * N }, (_, i) => groups.filter((g) => g.includes(i)));

function parse(str, allowZero) {
  if (typeof str !== 'string' || str.length !== N * N) return null;
  const cells = [...str].map(Number);
  const lo = allowZero ? 0 : 1;
  return cells.every((d) => Number.isInteger(d) && d >= lo && d <= N) ? cells : null;
}

function followsRules(grid) {
  return groups.every((g) => new Set(g.map((i) => grid[i])).size === N && g.every((i) => grid[i] >= 1));
}

function fits(grid, i, d) {
  return groupsOf[i].every((g) => g.every((j) => j === i || grid[j] !== d));
}

/** Count solutions by backtracking, stopping once `limit` are found. */
function countSolutions(givens, limit) {
  const grid = givens.slice();
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] && !fits(grid, i, grid[i])) return { count: 0 };
  }
  let count = 0;
  let first = null;
  const solve = () => {
    const i = grid.indexOf(0);
    if (i < 0) {
      count++;
      if (!first) first = grid.slice();
      return;
    }
    for (let d = 1; d <= N && count < limit; d++) {
      if (!fits(grid, i, d)) continue;
      grid[i] = d;
      solve();
      grid[i] = 0;
    }
  };
  solve();
  return { count, first };
}

let failures = 0;
for (const p of set.puzzles) {
  const label = `w${p.week} ${DAYS[p.day - 1] ?? p.day}`;
  const problems = [];
  const givens = parse(p.givens, true);
  const solution = parse(p.solution, false);
  if (p.size !== N) problems.push(`size is ${p.size}`);
  if (!givens) problems.push('givens unreadable');
  if (!solution) problems.push('solution unreadable');
  if (givens && solution) {
    if (!followsRules(solution)) problems.push('solution breaks the rules');
    if (givens.some((d, i) => d && d !== solution[i])) problems.push('a given disagrees with the solution');
    const { count, first } = countSolutions(givens, 2);
    if (count === 0) problems.push('no solution');
    else if (count > 1) problems.push('more than one solution');
    else if (first.join('') !== solution.join('')) problems.push('the unique solution is not the stored one');
  }
  if (!p.grade || typeof p.grade.score !== 'number' || !p.grade.hardest) problems.push('grade missing');
  const clues = givens ? givens.filter(Boolean).length : '?';
  const info = `${String(clues).padStart(2)} givens  score ${String(p.grade?.score).padStart(3)}  ${p.grade?.hardest}`;
  if (problems.length) {
    failures++;
    console.log(`${label.padEnd(7)} FAIL  ${info}  ${problems.join('; ')}`);
  } else {
    console.log(`${label.padEnd(7)} ok    ${info}  unique`);
  }
}

console.log(`${set.puzzles.length - failures}/${set.puzzles.length} puzzles pass`);
process.exit(failures ? 1 : 0);
