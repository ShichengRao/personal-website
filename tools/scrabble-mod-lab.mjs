#!/usr/bin/env node
/* Scrabble Mod lab: self-play across all cores, for measuring the bot.

   node tools/scrabble-mod-lab.mjs arena <A> <B> [games]   A vs B, alternating first move
   node tools/scrabble-mod-lab.mjs leaves [games] [out.json] fit leave values from self-play
   node tools/scrabble-mod-lab.mjs bench [games]             moves per second

   A profile is a level (easy, medium, hard) with options after colons:
     hard:noendgame          skip the exact endgame search
     hard:score              no leave values at all (pure score)
     hard:leaves=file.json   use a fitted leave table (from the leaves command)
     hard:sim=5x5x1          sampled lookahead: 5 candidates, 5 opponent racks, weight 1
     hard:scale=2            multiply the leave table in use by 2 (after leaves=)
   The tables are swapped into core.js's LEAVE before each move, so two
   profiles with different tables can play each other. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C = require(join(root, 'static', 'scrabble-mod', 'core.js'));
const BASE = { table: Object.assign({}, C.LEAVE), tune: Object.assign({}, C.LEAVE_TUNE) };
const ZERO = { table: Object.fromEntries(Object.keys(C.LEAVE).map((k) => [k, 0])), tune: { dup: 0, blankDup: 0, skew: 0 } };

function parseProfile(spec) {
  const [level, ...opts] = spec.split(':');
  const p = { level, noEndgame: false, leaves: BASE, sim: null, spec };
  for (const o of opts) {
    if (o === 'noendgame') p.noEndgame = true;
    else if (o === 'score') p.leaves = ZERO;
    else if (o.startsWith('leaves=')) p.leaves = JSON.parse(readFileSync(o.slice(7), 'utf8'));
    else if (o.startsWith('scale=')) { const k = Number(o.slice(6)); p.leaves = { table: Object.fromEntries(Object.entries(p.leaves.table).map(([a, v]) => [a, v * k])), tune: Object.fromEntries(Object.entries(p.leaves.tune).map(([a, v]) => [a, v * k])) }; }
    else if (o.startsWith('sim=')) { const [c, n, w] = o.slice(4).split('x').map(Number); p.sim = { cands: c, samples: n, weight: w || 1 }; }
    else throw new Error('unknown option ' + o);
  }
  return p;
}
function useLeaves(l) { Object.assign(C.LEAVE, l.table); Object.assign(C.LEAVE_TUNE, l.tune); }

// ---- worker side -----------------------------------------------------------
if (!isMainThread) {
  const dict = C.buildDict(readFileSync(join(root, 'static', 'scrabble-mod', 'words.txt'), 'utf8'));
  const { job, seed, games, a, b } = workerData;
  const rnd = C.seededRandom(seed);
  const bots = [a, b].map((spec) => spec && parseProfile(spec));
  const out = [];
  const samples = [];
  let moves = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const first = job === 'arena' ? g % 2 : 0;       // who plays as bot A
    let s = C.newGame(Math.floor(rnd() * 0x7fffffff) || 1);
    const pendingSample = [null, null];               // per player: feature vector waiting for its next score
    let n = 0;
    while (!s.over && n++ < 300) {
      const p = s.turn;
      const bot = bots[job === 'arena' ? (p === first ? 0 : 1) : 0];
      useLeaves(bot.leaves);
      const move = C.botMove(s, bot.level, rnd, dict, { noEndgame: bot.noEndgame, sim: bot.sim });
      const before = s;
      s = C.apply(s, move, null);
      moves++;
      if (job === 'leaves') {
        const h = s.history[s.history.length - 1];
        const score = h.t === 'play' ? h.score : 0;
        if (pendingSample[p]) { samples.push([pendingSample[p], score]); pendingSample[p] = null; }
        // what p kept, when the next rack is a genuinely random draw
        if (before.bag.length >= 7 && (move.t === 'play' || move.t === 'swap')) {
          const kept = before.racks[p].slice();
          const used = move.t === 'play' ? move.tiles.map((t) => (t.b ? '?' : t.l)) : move.tiles;
          for (const t of used) kept.splice(kept.indexOf(t), 1);
          pendingSample[p] = kept;
        }
      }
    }
    if (job === 'arena') {
      const w = C.winner(s);
      const aIdx = first, bIdx = 1 - first;
      out.push({ winner: w === -1 ? 'tie' : w === aIdx ? 'A' : 'B', margin: s.scores[aIdx] - s.scores[bIdx], firstWon: w === -1 ? null : w === 0 });
    }
  }
  parentPort.postMessage({ out, samples, moves, ms: Date.now() - t0 });
}

// ---- main side -------------------------------------------------------------
function run(job, games, a, b) {
  const workers = Math.max(1, Math.min(cpus().length - 2, games));   // leave two cores for the rest of the machine
  const per = Math.ceil(games / workers);
  return Promise.all(Array.from({ length: workers }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { job, seed: 1000 + i * 7919, games: Math.min(per, games - i * per), a, b } });
    w.on('message', resolve); w.on('error', reject);
  })));
}

async function arena(a, b, games) {
  const t0 = Date.now();
  const res = await run('arena', games, a, b);
  const all = res.flatMap((r) => r.out);
  const wins = { A: 0, B: 0, tie: 0 };
  let margin = 0, firstWins = 0, decided = 0;
  for (const g of all) { wins[g.winner]++; margin += g.margin; if (g.firstWon !== null) { decided++; if (g.firstWon) firstWins++; } }
  const n = all.length, pa = wins.A / n, se = Math.sqrt(pa * (1 - pa) / n);
  console.log(`${a}  vs  ${b}: ${n} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  A wins ${wins.A} (${(pa * 100).toFixed(1)}% ± ${(se * 196).toFixed(1)}), B wins ${wins.B}, ties ${wins.tie}`);
  console.log(`  A's average margin ${(margin / n).toFixed(1)} points; first mover won ${(firstWins / decided * 100).toFixed(1)}% of decided games`);
}

// Least squares: next-turn score ~ intercept + letter counts + duplicates + skew.
function fit(samples) {
  const letters = Object.keys(C.LEAVE);
  const idx = Object.fromEntries(letters.map((k, i) => [k, i + 1]));
  const D = letters.length + 4;   // intercept, letters, dup, blankDup, skew
  const XtX = Array.from({ length: D }, () => new Float64Array(D)), Xty = new Float64Array(D);
  let sum = 0;
  for (const [kept, y] of samples) {
    const f = C.leaveFeatures(kept);
    const x = new Float64Array(D);
    x[0] = 1;
    for (const t in f.counts) x[idx[t]] = f.counts[t];
    x[D - 3] = f.dup; x[D - 2] = f.blankDup; x[D - 1] = f.skew;
    for (let i = 0; i < D; i++) { if (!x[i]) continue; Xty[i] += x[i] * y; for (let j = 0; j < D; j++) if (x[j]) XtX[i][j] += x[i] * x[j]; }
    sum += y;
  }
  for (let i = 1; i < D; i++) XtX[i][i] += 1;   // a little ridge, for letters seen rarely in leaves
  // Gaussian elimination
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < D; c++) {
    let piv = c;
    for (let r = c + 1; r < D; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-9) continue;
    for (let r = 0; r < D; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= D; j++) M[r][j] -= k * M[c][j];
    }
  }
  const coef = M.map((row, i) => row[D] / (row[i] || 1));
  const r1 = (v) => Math.round(v * 10) / 10;
  const table = Object.fromEntries(letters.map((k) => [k, r1(coef[idx[k]])]));
  const tune = { dup: r1(coef[D - 3]), blankDup: r1(coef[D - 2]), skew: r1(coef[D - 1]) };
  return { table, tune, intercept: r1(coef[0]), mean: r1(sum / samples.length), n: samples.length };
}

async function leaves(games, outFile, rounds) {
  let current = BASE;
  for (let round = 1; round <= rounds; round++) {
    const tmp = join(root, 'tools', '.leaves-round.json');
    writeFileSync(tmp, JSON.stringify(current));
    const t0 = Date.now();
    const res = await run('leaves', games, 'hard:leaves=' + tmp, null);
    const samples = res.flatMap((r) => r.samples);
    const f = fit(samples);
    console.log(`round ${round}: ${games} games, ${f.n} samples in ${((Date.now() - t0) / 1000).toFixed(0)}s; mean next score ${f.mean}, intercept ${f.intercept}`);
    console.log('  letters:', Object.entries(f.table).map(([k, v]) => k + ' ' + v).join('  '));
    console.log('  tune:', JSON.stringify(f.tune));
    current = { table: f.table, tune: f.tune };
  }
  writeFileSync(outFile, JSON.stringify(current, null, 1));
  console.log('wrote', outFile);
}

async function bench(games) {
  const res = await run('arena', games, 'hard', 'hard');
  const moves = res.reduce((a, r) => a + r.moves, 0), ms = Math.max(...res.map((r) => r.ms));
  console.log(`${moves} moves in ${(ms / 1000).toFixed(1)}s wall across ${res.length} workers: ${(moves / (ms / 1000) / res.length).toFixed(0)} moves/s per core`);
}

if (isMainThread) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'arena') await arena(args[0] || 'hard', args[1] || 'hard:score', +(args[2] || 200));
  else if (cmd === 'leaves') await leaves(+(args[0] || 400), args[1] || join(root, 'tools', 'leaves.json'), +(args[2] || 2));
  else if (cmd === 'bench') await bench(+(args[0] || 28));
  else console.log('usage: arena <A> <B> [games] | leaves [games] [out.json] [rounds] | bench [games]');
}
