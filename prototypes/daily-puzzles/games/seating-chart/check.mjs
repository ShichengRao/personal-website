#!/usr/bin/env node
// Independently verifies data/seating-chart.json:
//   - the board is N×N with N connected tables
//   - the stored solution follows every rule
//   - the puzzle has exactly one solution (brute-force backtracking that
//     shares no code with the generator's grader or counter)
// Prints one line per puzzle and exits non-zero on any failure.
//
//   node games/seating-chart/check.mjs [path/to/seating-chart.json]

import { readFileSync } from 'node:fs';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const file = process.argv[2] ?? new URL('../../data/seating-chart.json', import.meta.url);
const set = JSON.parse(readFileSync(file, 'utf8'));

function checkShape(p) {
  const n = p.size;
  if (!Number.isInteger(n) || n < 4) return `bad size ${n}`;
  if (typeof p.regions !== 'string' || p.regions.length !== n * n) return 'regions string has the wrong length';
  const reg = Array.from(p.regions, (ch) => ch.charCodeAt(0) - 97);
  if (reg.some((g) => g < 0 || g >= n)) return 'region letter out of range';
  for (let g = 0; g < n; g++) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (reg[i] === g) cells.push(i);
    if (!cells.length) return `table ${g} is empty`;
    const seen = new Set([cells[0]]);
    const queue = [cells[0]];
    while (queue.length) {
      const i = queue.shift();
      const r = Math.floor(i / n);
      const c = i % n;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        const j = rr * n + cc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[j] === g && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    if (seen.size !== cells.length) return `table ${g} is not connected`;
  }
  return null;
}

// The rules, checked on a list of [row, col] guests.
function ruleBreak(n, reg, guests) {
  if (guests.length !== n) return `${guests.length} guests, expected ${n}`;
  const rows = new Set(guests.map(([r]) => r));
  const cols = new Set(guests.map(([, c]) => c));
  const tables = new Set(guests.map(([r, c]) => reg[r * n + c]));
  if (rows.size !== n) return 'a row has no guest or two guests';
  if (cols.size !== n) return 'a column has no guest or two guests';
  if (tables.size !== n) return 'a table has no guest or two guests';
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const [r1, c1] = guests[a];
      const [r2, c2] = guests[b];
      if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) return `guests at ${r1},${c1} and ${r2},${c2} touch`;
    }
  }
  return null;
}

// Count solutions up to `limit`, choosing a cell for one table at a time,
// smallest table first, with a check that every unfilled table still has a
// usable cell.
function countSolutions(n, reg, limit = 2) {
  const tables = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) tables[reg[i]].push([Math.floor(i / n), i % n]);
  const order = tables.map((_, g) => g).sort((a, b) => tables[a].length - tables[b].length);
  const rowUsed = new Array(n).fill(false);
  const colUsed = new Array(n).fill(false);
  const placed = [];
  let found = 0;

  const usable = ([r, c]) =>
    !rowUsed[r] && !colUsed[c] && placed.every(([pr, pc]) => Math.abs(pr - r) > 1 || Math.abs(pc - c) > 1);

  const search = (k) => {
    if (found >= limit) return;
    if (k === n) { found++; return; }
    for (let j = k + 1; j < n; j++) if (!tables[order[j]].some(usable)) return;
    for (const cell of tables[order[k]]) {
      if (!usable(cell)) continue;
      rowUsed[cell[0]] = true;
      colUsed[cell[1]] = true;
      placed.push(cell);
      search(k + 1);
      placed.pop();
      rowUsed[cell[0]] = false;
      colUsed[cell[1]] = false;
      if (found >= limit) return;
    }
  };
  search(0);
  return found;
}

let failures = 0;
for (const p of set.puzzles) {
  const label = `${p.date} ${DAY[p.day] ?? p.day} ${p.size}×${p.size}`;
  const t0 = performance.now();
  let problem = checkShape(p);
  let count = null;
  if (!problem) {
    const n = p.size;
    const reg = Array.from(p.regions, (ch) => ch.charCodeAt(0) - 97);
    if (!Array.isArray(p.solution) || p.solution.length !== n) problem = 'solution is not one column per row';
    else problem = ruleBreak(n, reg, p.solution.map((c, r) => [r, c]));
    if (!problem) {
      count = countSolutions(n, reg);
      if (count !== 1) problem = count === 0 ? 'no solution found' : 'more than one solution';
    }
  }
  if (!problem && !(p.grade && typeof p.grade.score === 'number' && p.grade.hardest)) problem = 'grade is missing';
  const ms = (performance.now() - t0).toFixed(0);
  if (problem) {
    failures++;
    console.log(`FAIL ${label}  ${problem}`);
  } else {
    console.log(`ok   ${label}  rules hold, exactly 1 solution  score=${p.grade.score} hardest=${p.grade.hardest}  (${ms}ms)`);
  }
}
console.log(failures ? `${failures} of ${set.puzzles.length} puzzles failed` : `all ${set.puzzles.length} puzzles pass`);
process.exit(failures ? 1 : 0);
