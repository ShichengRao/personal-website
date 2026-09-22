#!/usr/bin/env node
/* Compare the Scrabble Mod engine's top play against MAGPIE on positions
   sampled from self-play.

   node tools/scrabble-mod-vs-magpie.mjs <magpie dir> [positions=40] [iterations=1000]

   MAGPIE (https://github.com/jvc56/MAGPIE) must be built in <magpie dir> with
   our game's data in place: data/layouts/crossplay15.txt, the letter
   distribution data/letterdistributions/english_mod.csv, and the lexicon
   CSWMOD (data/lexica/CSWMOD.kwg + CSWMOD.klv2, made from words.txt with
   `magpie convert text2kwg CSWMOD english_mod` and `createdata klv CSWMOD
   english_mod`). -leaves CSW24 borrows MAGPIE's standard-English leave values,
   which are the closest thing available to real leaves for this tile set.

   For each position the script asks MAGPIE for its static ranking (by score
   plus leave) and a 2-ply Monte Carlo sim, then reports where our top play
   lands in each. */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C = require(join(root, 'static', 'scrabble-mod', 'core.js'));
const N = C.N;
const [magpieDir, nPos = '40', iters = '1000'] = process.argv.slice(2);
// MAGPIE_LEAVES names the leave file MAGPIE ranks with (CSW24 by default, or
// a CSWMOD_gen_N made by leavegen); OUR_LEAVES points at a fitted table for
// our engine (from the lab's leaves or fitklv commands).
const MAGPIE_LEAVES = process.env.MAGPIE_LEAVES || 'CSW24';
const OUR_LEAVES = process.env.OUR_LEAVES || null;
if (!magpieDir || !existsSync(join(magpieDir, 'bin', 'magpie'))) {
  console.error('usage: node tools/scrabble-mod-vs-magpie.mjs <magpie dir> [positions] [iterations]');
  process.exit(1);
}
const dict = C.buildDict(readFileSync(join(root, 'static', 'scrabble-mod', 'words.txt'), 'utf8'));
if (OUR_LEAVES) {
  const l = JSON.parse(readFileSync(OUR_LEAVES, 'utf8'));
  Object.assign(C.LEAVE, l.table); Object.assign(C.LEAVE_TUNE, l.tune);
  for (const k in C.LEAVE2) delete C.LEAVE2[k];
  Object.assign(C.LEAVE2, l.pairs || {});
}

// ---- positions from self-play ------------------------------------------------
function samplePositions(count, seed) {
  const rnd = C.seededRandom(seed);
  const out = [];
  let game = 0;
  while (out.length < count) {
    let s = C.newGame(Math.floor(rnd() * 0x7fffffff) || 1);
    const states = [];
    let n = 0;
    while (!s.over && n++ < 300) {
      if (s.moves.length >= 2 && s.bag.length >= 7 && s.racks[s.turn].length === 7) states.push(s);
      s = C.apply(s, C.botMove(s, 'hard', rnd, dict), dict);
    }
    if (states.length) out.push(states[Math.floor(rnd() * states.length)]);
    game++;
  }
  return out;
}

// ---- notation --------------------------------------------------------------------
const col = (c) => String.fromCharCode(65 + c);
function cgp(state) {
  const rows = [];
  for (let r = 0; r < N; r++) {
    let row = '', run = 0;
    for (let c = 0; c < N; c++) {
      const t = state.board[r * N + c];
      if (!t) { run++; continue; }
      if (run) { row += run; run = 0; }
      row += t.b ? t.l.toLowerCase() : t.l;
    }
    if (run) row += run;
    rows.push(row);
  }
  const p = state.turn;
  return rows.join('/') + ' ' + state.racks[p].join('') + '/ ' + state.scores[p] + '/' + state.scores[1 - p] + ' 0';
}
// The placed cells with their letters and which of them are blanks: the same
// play however it is written. OXO with the blank first and OXO with the blank
// last are different plays with different scores.
const keyOf = (tiles) => tiles.map((t) => t.r + ',' + t.c + t.l.toUpperCase() + (t.b ? '*' : '')).sort().join('|');
// MAGPIE writes "K7 F(L)OWAGE": column letter first for a vertical play,
// "7K" for a horizontal one; letters in parentheses were already on the
// board, and a blank is written as a lowercase letter.
function parseMove(pos, word) {
  const vertical = /^[A-O]\d+$/.test(pos);
  let r, c;
  if (vertical) { c = pos.charCodeAt(0) - 65; r = parseInt(pos.slice(1), 10) - 1; }
  else { r = parseInt(pos, 10) - 1; c = pos.charCodeAt(pos.length - 1) - 65; }
  const tiles = [];
  let inParen = false;
  for (const ch of word) {
    if (ch === '(') { inParen = true; continue; }
    if (ch === ')') { inParen = false; continue; }
    if (!inParen) tiles.push({ r, c, l: ch.toUpperCase(), b: ch !== ch.toUpperCase() });
    if (vertical) r++; else c++;
  }
  return tiles;
}

// ---- MAGPIE ------------------------------------------------------------------------
const MOVE_RE = /(\d+):\s+([A-O]\d+|\d+[A-O])\s+(\S+)\s+(.*)$/;
function askMagpie(state) {
  const script = [
    // -savesettings false: MAGPIE otherwise writes every setting to settings.txt in its directory; that file is the caller's
    // -r1/-r2 all: record every generated move, in case a settings.txt from a leavegen run (which records only the best) is being loaded
    `set -savesettings false -r1 all -r2 all -lex CSWMOD -ld english_mod -bdn crossplay15 -bb 40 -wmp false -threads 4 -numplays 40 -hr false -leaves ${MAGPIE_LEAVES} -plies 2 -iterations ${iters}`,
    'cgp ' + cgp(state), 'generate', 'shmoves 40', 'set -numplays 15', 'simulate', 'quit', ''
  ].join('\n');
  const r = spawnSync(join(magpieDir, 'bin', 'magpie'), ['set', '-mode', 'sync'], { cwd: magpieDir, input: script, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('magpie failed: ' + (r.stderr || r.stdout).slice(-2000));
  const stat = [], sim = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.match(MOVE_RE);
    if (!m) continue;
    const rest = m[4].trim().split(/\s+/);
    const tiles = parseMove(m[2], m[3]);
    if (rest.includes('-')) {
      // sim: [leave?] score - win% ... equity ... ; leave is letters, score is a number
      const i = rest.indexOf('-');
      sim.push({ key: keyOf(tiles), word: m[3], score: +rest[i - 1], win: +rest[i + 1], equity: +rest[i + 3] });
    } else {
      const eq = +rest[rest.length - 1], score = +rest[rest.length - 2];
      if (!Number.isFinite(eq) || !Number.isFinite(score)) continue;
      stat.push({ key: keyOf(tiles), word: m[3], score, equity: eq });
    }
  }
  return { stat, sim };
}

// ---- compare ------------------------------------------------------------------------
const positions = samplePositions(+nPos, 4242);
const tally = { n: 0, statTop1: 0, statTop3: 0, statListed: 0, simTop1: 0, simTop3: 0, simListed: 0, winGap: 0, winGapN: 0,
  maxScoreAgree: 0, scoreAgree: 0, scoreChecked: 0, ourScoreTopIsMagpieScoreTop: 0, simBestIsStatBest: 0 };
const rows = [];
for (const s of positions) {
  const p = s.turn, rack = s.racks[p];
  const ours = C.rank(C.generate(s.board, rack, dict), rack, false);
  if (!ours.length) continue;
  const top = ours[0];
  const key = keyOf(top.tiles);
  let m;
  try { m = askMagpie(s); } catch (e) { console.error(e.message); continue; }
  if (!m.stat.length) { console.error('no static plays parsed for', cgp(s)); continue; }
  tally.n++;
  const si = m.stat.findIndex((x) => x.key === key);
  if (si === 0) tally.statTop1++;
  if (si >= 0 && si < 3) tally.statTop3++;
  if (si >= 0) { tally.statListed++; tally.scoreChecked++; if (m.stat[si].score === top.score) tally.scoreAgree++; }
  const ourMax = Math.max(...ours.map((x) => x.score)), theirMax = Math.max(...m.stat.map((x) => x.score));
  if (ourMax === theirMax) tally.maxScoreAgree++;
  const bi = m.sim.findIndex((x) => x.key === key);
  if (bi === 0) tally.simTop1++;
  if (bi >= 0 && bi < 3) tally.simTop3++;
  if (bi >= 0) { tally.simListed++; tally.winGap += m.sim[0].win - m.sim[bi].win; tally.winGapN++; }
  if (m.sim.length && m.stat.length && m.sim[0].key === m.stat[0].key) tally.simBestIsStatBest++;
  rows.push({ rack: rack.join(''), ours: top.word + ' ' + top.score + ' (eq ' + top.equity + ')', statRank: si + 1 || '>40', statBest: m.stat[0].word + ' ' + m.stat[0].score, simRank: bi + 1 || '>15', simBest: m.sim.length ? m.sim[0].word + ' ' + m.sim[0].score + ' ' + m.sim[0].win + '%' : '-', ourMax, theirMax });
}
console.table(rows);
const pct = (a) => (100 * a / tally.n).toFixed(0) + '%';
console.log(`${tally.n} positions, sim ${iters} iterations, 2 plies, MAGPIE leaves ${MAGPIE_LEAVES}, our leaves ${OUR_LEAVES || 'built in'}`);
console.log(`generator/scoring: our best score is matched within MAGPIE's top 40 by equity in ${pct(tally.maxScoreAgree)} (its true top scorer may rank lower); matched plays score the same in ${tally.scoreAgree}/${tally.scoreChecked}`);
console.log(`static (MAGPIE equity): our top play is MAGPIE's #1 in ${pct(tally.statTop1)}, in its top 3 in ${pct(tally.statTop3)}, in its top 40 in ${pct(tally.statListed)}`);
console.log(`sim (win%):             our top play is MAGPIE's #1 in ${pct(tally.simTop1)}, in its top 3 in ${pct(tally.simTop3)}, among the 15 simmed in ${pct(tally.simListed)}`);
console.log(`                        when simmed, our play trails MAGPIE's best by ${(tally.winGap / Math.max(1, tally.winGapN)).toFixed(2)} win% on average`);
console.log(`MAGPIE's own static #1 is also its sim #1 in ${pct(tally.simBestIsStatBest)} (how much the sim changes MAGPIE's mind)`);
