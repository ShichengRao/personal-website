#!/usr/bin/env node
// Independent check of data/zoning.json. Shares no code with the generator
// or grader: it re-reads the rules from the puzzle data, checks the stored
// solution against them, and counts solutions by brute force (up to 2).
//
//   node games/zoning/check.mjs

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const file = new URL('../../data/zoning.json', import.meta.url);
const set = JSON.parse(readFileSync(file, 'utf8'));

function shapeFits(s, h, w) {
  if (!s || s === '.') return true;
  if (s === 'S') return h === w;
  if (s === 'W') return w > h;
  if (s === 'T') return h > w;
  throw new Error(`unknown shape mark ${s}`);
}

function readPuzzle(p) {
  const N = p.size;
  if (!Number.isInteger(N) || N < 2) throw new Error('bad size');
  if (p.clues.length % 2) throw new Error('clues must be cell, area pairs');
  const clues = [];
  for (let i = 0; i < p.clues.length; i += 2) {
    const cell = p.clues[i];
    clues.push({ r: Math.floor(cell / N), c: cell % N, area: p.clues[i + 1], shape: p.shapes?.[i / 2] ?? '.' });
  }
  if (p.shapes && p.shapes.length !== clues.length) throw new Error('shapes length mismatch');
  if (p.solution.length !== clues.length * 4) throw new Error('solution must be 4 numbers per clue');
  return { N, clues };
}

// Rule check of the stored solution: lots tile the grid, each holds exactly
// one clue (its own), and each lot's area and shape match that clue.
function checkSolution(p, N, clues) {
  const owner = new Array(N * N).fill(-1);
  const clueAt = new Map(clues.map((cl, k) => [cl.r * N + cl.c, k]));
  if (clueAt.size !== clues.length) return 'two clues share a cell';
  for (let k = 0; k < clues.length; k++) {
    const [top, left, h, w] = p.solution.slice(k * 4, k * 4 + 4);
    if (h < 1 || w < 1 || top < 0 || left < 0 || top + h > N || left + w > N) return `lot ${k} is off the board`;
    if (h * w !== clues[k].area) return `lot ${k} has area ${h * w}, clue says ${clues[k].area}`;
    if (!shapeFits(clues[k].shape, h, w)) return `lot ${k} breaks its shape mark`;
    let held = 0;
    for (let r = top; r < top + h; r++) {
      for (let c = left; c < left + w; c++) {
        const i = r * N + c;
        if (owner[i] >= 0) return `lots ${owner[i]} and ${k} overlap`;
        owner[i] = k;
        if (clueAt.has(i)) {
          held++;
          if (clueAt.get(i) !== k) return `lot ${k} holds another lot's clue`;
        }
      }
    }
    if (held !== 1) return `lot ${k} holds ${held} clues`;
  }
  if (owner.some((o) => o < 0)) return 'some cells are not in any lot';
  return null;
}

// Brute force: the first empty cell in reading order must be the top-left
// corner of its lot. Try every clue and every rectangle that could start there.
function countSolutions(N, clues, limit = 2) {
  const grid = new Int16Array(N * N).fill(-1);
  const clueAt = new Int16Array(N * N).fill(-1);
  clues.forEach((cl, k) => { clueAt[cl.r * N + cl.c] = k; });
  const used = new Uint8Array(clues.length);
  let count = 0;

  const fits = (k, top, left, h, w) => {
    for (let r = top; r < top + h; r++) {
      for (let c = left; c < left + w; c++) {
        const i = r * N + c;
        if (grid[i] >= 0) return false;
        if (clueAt[i] >= 0 && clueAt[i] !== k) return false;
      }
    }
    return true;
  };
  const fill = (k, top, left, h, w, v) => {
    for (let r = top; r < top + h; r++) for (let c = left; c < left + w; c++) grid[r * N + c] = v;
  };

  const dfs = (from) => {
    let idx = from;
    while (idx < N * N && grid[idx] >= 0) idx++;
    if (idx === N * N) { count++; return; }
    const top = Math.floor(idx / N);
    const left = idx % N;
    // A cell holding a clue can only start that clue's own lot.
    const own = clueAt[idx];
    for (let k = 0; k < clues.length; k++) {
      if (used[k] || (own >= 0 && own !== k)) continue;
      const { r, c, area, shape } = clues[k];
      if (r < top || c < left) continue;
      for (let h = 1; h <= area; h++) {
        if (area % h) continue;
        const w = area / h;
        if (top + h > N || left + w > N) continue;
        if (r >= top + h || c >= left + w) continue;
        if (!shapeFits(shape, h, w) || !fits(k, top, left, h, w)) continue;
        fill(k, top, left, h, w, k);
        used[k] = 1;
        dfs(idx + 1);
        used[k] = 0;
        fill(k, top, left, h, w, -1);
        if (count >= limit) return;
      }
    }
  };
  dfs(0);
  return count;
}

let failures = 0;
for (const p of set.puzzles) {
  const tag = `w${p.week} ${DAY[p.day]} ${p.size}x${p.size}`;
  const t0 = performance.now();
  let problem = null;
  let lots = 0;
  try {
    const { N, clues } = readPuzzle(p);
    lots = clues.length;
    const g = p.grade;
    if (!g || typeof g.score !== 'number' || typeof g.hardest !== 'string' || typeof g.summary !== 'string' || typeof g.techniques !== 'object') {
      problem = 'grade is incomplete';
    }
    problem ??= checkSolution(p, N, clues);
    if (!problem) {
      const n = countSolutions(N, clues);
      if (n !== 1) problem = n === 0 ? 'no solution found' : 'more than one solution';
    }
  } catch (err) {
    problem = err.message;
  }
  const ms = Math.round(performance.now() - t0);
  if (problem) failures++;
  console.log(`${tag.padEnd(14)} ${String(lots).padStart(2)} lots  ${problem ? `FAIL: ${problem}` : 'ok: solution follows the rules, exactly 1 solution'}  (${ms} ms)`);
}
console.log(failures ? `${failures} of ${set.puzzles.length} puzzles failed` : `all ${set.puzzles.length} puzzles ok`);
process.exit(failures ? 1 : 0);
