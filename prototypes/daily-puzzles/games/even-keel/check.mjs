#!/usr/bin/env node
// Independent check of data/even-keel.json:
//   1. the stored solution follows every rule and matches every clue
//   2. the clues allow exactly one solution
// The solution counter is plain backtracking over whole rows. It shares no
// code with the grader in generate.js.
//
//   node games/even-keel/check.mjs [path/to/even-keel.json]

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

function parse(p) {
  const n = p.size;
  if (!Number.isInteger(n) || n < 2 || n % 2) throw new Error(`bad size ${n}`);
  const want = (s, len, ok, what) => {
    if (typeof s !== 'string' || s.length !== len) throw new Error(`${what} should have ${len} chars`);
    for (const ch of s) if (!ok.includes(ch)) throw new Error(`${what} has unexpected "${ch}"`);
  };
  want(p.solution, n * n, 'AB', 'solution');
  want(p.givens, n * n, 'AB.', 'givens');
  want(p.hsigns, n * (n - 1), '=x.', 'hsigns');
  want(p.vsigns, (n - 1) * n, '=x.', 'vsigns');
  return {
    n,
    sol: (r, c) => p.solution[r * n + c],
    given: (r, c) => p.givens[r * n + c],
    h: (r, c) => p.hsigns[r * (n - 1) + c], // between (r,c) and (r,c+1)
    v: (r, c) => p.vsigns[r * n + c], // between (r,c) and (r+1,c)
  };
}

/** Lists every way the stored solution breaks a rule or a clue. */
export function ruleErrors(p) {
  const P = parse(p);
  const { n } = P;
  const errs = [];
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push([`row ${i + 1}`, Array.from({ length: n }, (_, j) => P.sol(i, j))]);
    lines.push([`column ${i + 1}`, Array.from({ length: n }, (_, j) => P.sol(j, i))]);
  }
  for (const [name, cells] of lines) {
    const a = cells.filter((x) => x === 'A').length;
    if (a !== n / 2) errs.push(`${name} has ${a} A`);
    for (let j = 0; j + 2 < n; j++) {
      if (cells[j] === cells[j + 1] && cells[j] === cells[j + 2]) errs.push(`${name} has three ${cells[j]} from ${j + 1}`);
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const g = P.given(r, c);
      if (g !== '.' && g !== P.sol(r, c)) errs.push(`given at ${r + 1},${c + 1} disagrees`);
      if (c + 1 < n) {
        const s = P.h(r, c);
        const same = P.sol(r, c) === P.sol(r, c + 1);
        if ((s === '=' && !same) || (s === 'x' && same)) errs.push(`sign right of ${r + 1},${c + 1} broken`);
      }
      if (r + 1 < n) {
        const s = P.v(r, c);
        const same = P.sol(r, c) === P.sol(r + 1, c);
        if ((s === '=' && !same) || (s === 'x' && same)) errs.push(`sign below ${r + 1},${c + 1} broken`);
      }
    }
  }
  return errs;
}

/** Counts solutions of the clues, stopping at `cap`. */
export function countSolutions(p, cap = 2) {
  const P = parse(p);
  const { n } = P;
  const half = n / 2;
  // Every row pattern that obeys the row rules on its own (bit c set = A).
  const patterns = [];
  for (let x = 0; x < 1 << n; x++) {
    const row = Array.from({ length: n }, (_, c) => ((x >> c) & 1 ? 'A' : 'B'));
    if (row.filter((ch) => ch === 'A').length !== half) continue;
    let ok = true;
    for (let c = 0; c + 2 < n; c++) if (row[c] === row[c + 1] && row[c] === row[c + 2]) ok = false;
    if (ok) patterns.push({ x, row });
  }
  // Per row, the patterns that fit that row's givens and horizontal signs.
  const fits = [];
  for (let r = 0; r < n; r++) {
    fits.push(patterns.filter(({ row }) => {
      for (let c = 0; c < n; c++) {
        const g = P.given(r, c);
        if (g !== '.' && g !== row[c]) return false;
        if (c + 1 < n) {
          const s = P.h(r, c);
          if (s === '=' && row[c] !== row[c + 1]) return false;
          if (s === 'x' && row[c] === row[c + 1]) return false;
        }
      }
      return true;
    }).map(({ x }) => x));
  }
  const full = (1 << n) - 1;
  const eqBelow = [];
  const neBelow = [];
  for (let r = 0; r + 1 < n; r++) {
    let eq = 0;
    let ne = 0;
    for (let c = 0; c < n; c++) {
      if (P.v(r, c) === '=') eq |= 1 << c;
      if (P.v(r, c) === 'x') ne |= 1 << c;
    }
    eqBelow.push(eq);
    neBelow.push(ne);
  }
  const rows = new Array(n);
  const colA = new Array(n).fill(0);
  let found = 0;
  const walk = (r) => {
    if (r === n) {
      found++;
      return;
    }
    for (const x of fits[r]) {
      if (r > 0) {
        const diff = rows[r - 1] ^ x;
        if (diff & eqBelow[r - 1]) continue;
        if (~diff & full & neBelow[r - 1]) continue;
      }
      if (r > 1 && (~(rows[r - 2] ^ rows[r - 1]) & ~(rows[r - 1] ^ x) & full)) continue;
      let ok = true;
      for (let c = 0; c < n; c++) {
        const a = colA[c] + ((x >> c) & 1);
        if (a > half || r + 1 - a > half) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      rows[r] = x;
      for (let c = 0; c < n; c++) colA[c] += (x >> c) & 1;
      walk(r + 1);
      for (let c = 0; c < n; c++) colA[c] -= (x >> c) & 1;
      if (found >= cap) return;
    }
  };
  walk(0);
  return found;
}

function main() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const path = process.argv[2] ?? `${here}../../data/even-keel.json`;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let failures = 0;
  for (const p of data.puzzles) {
    const label = `w${p.week} ${names[p.day] ?? p.day}`;
    let line;
    try {
      const errs = ruleErrors(p);
      const t0 = performance.now();
      const count = errs.length ? -1 : countSolutions(p, 2);
      const ms = Math.round(performance.now() - t0);
      const ok = !errs.length && count === 1;
      if (!ok) failures++;
      line = `${ok ? 'ok  ' : 'FAIL'} ${label} ${p.size}x${p.size} ` +
        (errs.length ? `rule errors: ${errs.slice(0, 3).join('; ')}` : `${count === 1 ? 'unique' : count === 0 ? 'no solution' : '2+ solutions'} (${ms}ms)`);
    } catch (err) {
      failures++;
      line = `FAIL ${label} ${err.message}`;
    }
    console.log(line);
  }
  console.log(failures ? `${failures} of ${data.puzzles.length} puzzles failed` : `all ${data.puzzles.length} puzzles ok`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
