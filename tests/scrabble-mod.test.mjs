import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, 'static', 'scrabble-mod');
const require = createRequire(import.meta.url);
const C = require(join(dir, 'core.js'));
const N = C.N;

let fullDict = null;
const dict = () => (fullDict ||= C.buildDict(readFileSync(join(dir, 'words.txt'), 'utf8')));
const small = C.buildDict(['quilt', 'et', 'tailors', 'jump', 'aa', 'ab', 'ba', 'qi', 'ox', 'oxo', 'xu', 'to', 'flow', 'wolf', 'fowl', 'lo', 'of', 'ow', 'wo'].join('\n'));

const play = (word, r, c, down, blanks = []) => ({
  t: 'play',
  tiles: word.split('').map((l, i) => ({ r: down ? r + i : r, c: down ? c : c + i, l, b: blanks.includes(i) }))
});
const withRack = (state, rack) => { state.racks[state.turn] = rack.split(''); return state; };

test('the board is the layout from the screenshot: symmetric, with a plain centre', () => {
  assert.equal(C.LAYOUT.length, 15);
  for (const row of C.LAYOUT) assert.equal(row.length, 15);
  const counts = {};
  for (let i = 0; i < N * N; i++) { const b = C.bonusAt(i); counts[b] = (counts[b] || 0) + 1; }
  assert.deepEqual(counts, { '': 168, '2L': 20, '3L': 20, '2W': 8, '3W': 8, '*': 1 });
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const here = C.bonusAt(r * N + c);
    assert.equal(here, C.bonusAt(c * N + r), `transpose symmetry at ${r},${c}`);
    assert.equal(here, C.bonusAt((N - 1 - r) * N + c), `vertical symmetry at ${r},${c}`);
    assert.equal(here, C.bonusAt(r * N + (N - 1 - c)), `horizontal symmetry at ${r},${c}`);
  }
  assert.equal(C.LM[C.CENTER * N + C.CENTER], 1);
  assert.equal(C.WM[C.CENTER * N + C.CENTER], 1);
});

test('the bag holds 100 tiles with the rebalanced values', () => {
  let n = 0;
  for (const k in C.TILES) n += C.TILES[k][0];
  assert.equal(n, 100);
  assert.equal(C.VALUE.Q, 10); assert.equal(C.VALUE.U, 2); assert.equal(C.VALUE.W, 5); assert.equal(C.VALUE.K, 6);
  assert.equal(C.VALUE.X, 8); assert.equal(C.VALUE['?'], 0); assert.equal(C.VALUE.N, 1);
  const s = C.newGame(7);
  assert.equal(s.bag.length + s.racks[0].length + s.racks[1].length, 100);
  assert.equal(s.racks[0].length, 7);
  assert.deepEqual(C.newGame(7).bag, s.bag, 'the deal is seeded');
});

test('scoring matches the games in the screenshots', () => {
  // QUILT from the centre: T lands on the 2W at (7,11), I on the 2L at (7,9)
  let s = withRack(C.newGame(1), 'QUILTAB');
  let r = C.check(s, play('QUILT', 7, 7, false), small);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.score, 34);
  assert.deepEqual(r.words.map((w) => w.word), ['QUILT']);
  // JUMP off the multipliers is 18: J10 U2 M3 P3
  assert.equal('JUMP'.split('').reduce((a, l) => a + C.VALUE[l], 0), 18);
  const board = new Array(N * N).fill(null);
  board[6 * N + 7] = { l: 'S', b: false };
  const jumps = C.analyze(board, play('JUMP', 6, 3, false).tiles);
  assert.equal(jumps.ok, true, jumps.reason);
  assert.deepEqual(jumps.words.map((w) => [w.word, w.score]), [['JUMPS', 19]]);
  // a 7-tile play earns 40 on top
  s = withRack(C.newGame(1), 'TAILORS');
  r = C.check(s, play('TAILORS', 7, 4, false), dict());
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.bingo, true);
  assert.equal(r.score, r.words[0].score + 40);
});

test('cross words are scored and blanks are worth nothing', () => {
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  s = withRack(s, 'E??ABCD');
  // E above the T of QUILT makes ET
  let r = C.check(s, play('E', 6, 11, true), small);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.words.map((w) => w.word), ['ET']);
  assert.equal(r.score, 2);
  // the same E as a blank scores only the T
  r = C.check(s, play('E', 6, 11, true, [0]), small);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.score, 1);
  // AB across under I,L would also form IA and LB, which are not words
  r = C.check(s, play('AB', 8, 9, false), small);
  assert.equal(r.ok, false);
  assert.match(r.reason, /IA, LB are not in the word list/);
});

test('placements fail for the right reasons', () => {
  let s = withRack(C.newGame(1), 'QUILTAB');
  assert.match(C.check(s, play('QUILT', 0, 0, false), small).reason, /center/);
  assert.match(C.check(s, play('QUILT', 7, 7, false), C.buildDict('aa')).reason, /QUILT is not in the word list/);
  assert.match(C.check(s, play('QUILTZ', 7, 7, false), small).reason, /not on your rack/);
  assert.match(C.check(s, play('T', 7, 7, false), small).reason, /two letters/);
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  s = withRack(s, 'ABOXEEE');
  assert.match(C.check(s, play('AB', 0, 0, false), small).reason, /touch a tile/);
  assert.match(C.check(s, { t: 'play', tiles: [{ r: 6, c: 7, l: 'A' }, { r: 8, c: 8, l: 'B' }] }, small).reason, /one row or one column/);
  assert.match(C.check(s, { t: 'play', tiles: [{ r: 6, c: 7, l: 'A' }, { r: 6, c: 9, l: 'B' }] }, small).reason, /gaps/);
  assert.match(C.check(s, { t: 'play', tiles: [{ r: 7, c: 7, l: 'A' }] }, small).reason, /already taken/);
  assert.match(C.check(s, { t: 'swap', tiles: ['Z'] }, small).reason, /not on your rack/);
  assert.equal(C.check(s, { t: 'swap', tiles: ['A', 'B'] }, small).ok, true);
  assert.equal(C.check(s, { t: 'pass' }, small).ok, true);
});

test('the game ends the Crossplay way: one last turn each once the bag is empty, no penalty', () => {
  let s = C.newGame(3);
  s.bag = s.bag.slice(0, 3);
  s = withRack(s, 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  assert.equal(s.bag.length, 0, 'the draw empties the bag');
  assert.equal(s.finalTurns, 2);
  assert.equal(s.over, false);
  const before = s.scores.slice();
  s = C.apply(s, { t: 'pass' }, small);
  assert.equal(s.over, false);
  assert.equal(s.finalTurns, 1);
  s = C.apply(s, { t: 'pass' }, small);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'bag');
  assert.deepEqual(s.scores, before, 'leftover tiles cost nothing');
  // the last two turns went to the opponent of whoever emptied the bag, then to them
  assert.deepEqual(s.history.map((h) => h.p), [0, 1, 0]);
  assert.match(C.check(s, { t: 'pass' }, small).reason, /over/);
  // and no swapping from an empty bag
  let t = withRack(C.newGame(3), 'QUILTAB');
  t.bag = [];
  assert.match(C.check(t, { t: 'swap', tiles: ['A'] }, small).reason, /bag/);
});

test('four passes in a row end the game early, and a swap breaks the run', () => {
  let s = C.newGame(9);
  for (let i = 0; i < C.PASS_LIMIT - 1; i++) { s = C.apply(s, { t: 'pass' }, small); assert.equal(s.over, false); }
  const t = C.apply(s, { t: 'swap', tiles: s.racks[s.turn].slice(0, 1) }, small);
  assert.equal(t.passes, 0);
  assert.equal(C.apply(t, { t: 'pass' }, small).over, false, 'pass, pass, pass, swap, pass is not four passes');
  s = C.apply(s, { t: 'pass' }, small);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'passes');
  assert.equal(C.winner(s), s.scores[0] === s.scores[1] ? -1 : (s.scores[0] > s.scores[1] ? 0 : 1));
});

test('resigning ends the game and hands the win over regardless of score', () => {
  let s = withRack(C.newGame(4), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  assert.equal(s.scores[0], 34);
  assert.equal(C.winner(s), null);
  s = C.apply(s, { t: 'pass' }, small);
  s = C.apply(s, { t: 'resign' }, small);
  assert.equal(s.over, true);
  assert.equal(s.endReason, 'resign');
  assert.equal(s.resigned, 0);
  assert.equal(C.winner(s), 1, 'the leader resigned, so the other player wins');
  assert.equal(s.history[s.history.length - 1].t, 'resign');
  assert.match(C.check(s, { t: 'pass' }, small).reason, /over/);
});

test('a swap is deterministic given the seed and the move list', () => {
  const s = C.newGame(11);
  const rack = s.racks[0];
  const a = C.apply(s, { t: 'swap', tiles: rack.slice(0, 3) }, small);
  const b = C.apply(s, { t: 'swap', tiles: rack.slice(0, 3) }, small);
  assert.deepEqual(a.bag, b.bag);
  assert.deepEqual(a.racks, b.racks);
  assert.equal(a.racks[0].length, 7);
  assert.equal(a.bag.length, s.bag.length);
  assert.equal(a.turn, 1);
});

test('replaying the move list reproduces a bot game exactly', () => {
  const d = dict();
  const rnd = C.seededRandom(99);
  let s = C.newGame(2024);
  let n = 0;
  while (!s.over && n++ < 300) s = C.apply(s, C.botMove(s, n % 2 ? 'hard' : 'easy', rnd, d), d);
  assert.equal(s.over, true, 'the bots finish the game');
  const again = C.replay(s.seed, s.moves, d);
  assert.deepEqual(again.board, s.board);
  assert.deepEqual(again.scores, s.scores);
  assert.deepEqual(again.racks, s.racks);
  assert.equal(again.over, true);
});

// Every placement of up to three rack tiles, the slow way, to check the
// generator against on a small dictionary.
function bruteForce(board, rack, d) {
  const found = new Map();
  const perms = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
  const subsets = [];
  for (let m = 1; m < 1 << rack.length; m++) subsets.push(rack.filter((_, i) => m & (1 << i)));
  const seqs = subsets.flatMap(perms);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const down of [false, true]) for (const seq of seqs) {
    const tiles = [];
    let rr = r, cc = c, ok = true;
    for (const t of seq) {
      while (rr < N && cc < N && board[rr * N + cc]) { if (down) rr++; else cc++; }
      if (rr >= N || cc >= N) { ok = false; break; }
      if (t === '?') { for (let L = 0; L < 26; L++) { /* blanks: try every letter */ } }
      tiles.push({ r: rr, c: cc, l: t, b: false });
      if (down) rr++; else cc++;
    }
    if (!ok) continue;
    const res = C.analyze(board, tiles);
    if (!res.ok || res.words.some((w) => !d.has(w.word))) continue;
    const key = tiles.map((t) => t.r + ',' + t.c + t.l).sort().join('|');
    found.set(key, res.score);
  }
  return found;
}

test('the move generator finds exactly the legal plays', () => {
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  const rack = ['O', 'X', 'A', 'B'];
  const gen = C.generate(s.board, rack, small);
  const brute = bruteForce(s.board, rack, small);
  const genKeys = new Map(gen.map((m) => [m.tiles.map((t) => t.r + ',' + t.c + t.l).sort().join('|'), m.score]));
  for (const [k, v] of brute) assert.equal(genKeys.get(k), v, `generator missed or mis-scored ${k}`);
  for (const [k, v] of genKeys) assert.equal(brute.get(k), v, `generator invented ${k}`);
  assert.ok(gen.length > 0);
  assert.equal(gen[0].score, Math.max(...brute.values()));
  // the empty board too
  const first = C.generate(C.newGame(1).board, ['Q', 'U', 'I', 'L', 'T', 'X', 'O'], small);
  assert.ok(first.some((m) => m.word === 'QUILT' && m.score === 34));
  assert.ok(first.every((m) => m.tiles.some((t) => t.r === 7 && t.c === 7)));
});

test('the generator will spend a blank early to save a real letter for a better square', () => {
  // OXO along row 8 from column 11: the T of QUILT sits above the first O (TO),
  // and the last O lands on a 3L. Blank first, real O on the 3L scores 12;
  // the other way round scores 11.
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  const moves = C.generate(s.board, ['O', 'X', '?'], small);
  assert.equal(moves[0].score, 12, moves.slice(0, 3).map((m) => m.word + '=' + m.score).join(' '));
  const oxo = moves.find((m) => m.word === 'OXO' && m.score === 12);
  assert.ok(oxo);
  assert.deepEqual(oxo.tiles.map((t) => [t.c, t.l, t.b]), [[11, 'O', true], [12, 'X', false], [13, 'O', false]]);
});

test('the generator uses blanks and every move it proposes is legal on the real list', () => {
  const d = dict();
  let s = withRack(C.newGame(5), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), d);
  s = withRack(s, 'OE?FRGW');
  const moves = C.generate(s.board, s.racks[1], d);
  assert.ok(moves.length > 100);
  assert.ok(moves.some((m) => m.tiles.some((t) => t.b)), 'some moves spend the blank');
  for (const m of moves.slice(0, 200)) {
    const r = C.check(s, { t: 'play', tiles: m.tiles }, d);
    assert.equal(r.ok, true, `${m.word}: ${r.reason}`);
    assert.equal(r.score, m.score);
  }
  for (let i = 1; i < moves.length; i++) assert.ok(moves[i - 1].score >= moves[i].score, 'sorted best first');
});

test('the word list is installed and the trie agrees with it', () => {
  assert.ok(existsSync(join(dir, 'words.txt')));
  const d = dict();
  assert.ok(d.size > 150000);
  for (const w of ['QUILT', 'TAILORS', 'JUMP', 'AA', 'XU']) assert.equal(d.has(w), true, w);
  for (const w of ['QUILTZ', 'A', 'ZZZZ', '']) assert.equal(d.has(w), false, w);
  assert.equal(d.has('AB'), true);
  assert.equal(d.has('ABANDONE'), false, 'a prefix is not a word');
});

test('the Scrabble Mod page has its layout and scripts', () => {
  assert.ok(existsSync(join(root, 'content', 'scrabble-mod', '_index.md')));
  assert.ok(existsSync(join(root, 'layouts', 'scrabble-mod', 'list.html')));
  assert.ok(existsSync(join(dir, 'app.js')));
  const layout = readFileSync(join(root, 'layouts', 'scrabble-mod', 'list.html'), 'utf8');
  assert.match(layout, /scrabble-mod\/core\.js/);
  assert.match(layout, /scrabble-mod\/app\.js/);
});

test('a stored game replays without the word list, so a list change cannot strand it', () => {
  const d = dict();
  let s = C.newGame(21);
  const first = C.generate(s.board, s.racks[0], d)[0];
  s = C.apply(s, { t: 'play', tiles: first.tiles }, d);
  const stricter = C.buildDict('aa\nab');
  assert.throws(() => C.replay(s.seed, s.moves, stricter), /not in the word list/);
  const back = C.replay(s.seed, s.moves);
  assert.deepEqual(back.board, s.board);
  assert.deepEqual(back.scores, s.scores);
  assert.deepEqual(back.racks, s.racks);
  const pos = C.positions(s.seed, s.moves);
  assert.equal(pos.length, s.moves.length + 1);
  assert.deepEqual(pos[pos.length - 1].board, s.board);
  assert.equal(pos[0].history.length, 0);
});

test('equity counts the rack you keep, not just the score', () => {
  assert.ok(C.leaveValue(['S', '?']) > 30);
  assert.ok(C.leaveValue(['Q', 'U', 'U', 'V']) < -20);
  assert.ok(C.leaveValue(['A', 'E', 'I', 'O', 'U']) < C.leaveValue(['A', 'E', 'R', 'S', 'T']), 'all vowels is a bad leave');
  assert.equal(C.leaveValue([]), 0);
  // With QUILT on the board and a rack of S ? Q A: dumping the Q for a small
  // score should rank above a slightly bigger score that keeps it.
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  const rack = ['Q', 'I', 'S', '?', 'A', 'B', 'X'];
  const byScore = C.generate(s.board, rack, small);
  const byEquity = C.rank(byScore.map((m) => Object.assign({}, m)), rack, false);
  for (const m of byEquity) {
    assert.equal(typeof m.leave, 'number');
    assert.equal(m.equity, Math.round((m.score + m.leave) * 10) / 10);
  }
  for (let i = 1; i < byEquity.length; i++) assert.ok(byEquity[i - 1].equity >= byEquity[i].equity);
  const keepsS = byEquity.filter((m) => m.keeps.includes('S') && m.keeps.includes('?'));
  assert.ok(keepsS.length, 'some plays keep S and the blank');
  // once the bag is empty the leave is worth nothing
  const endgame = C.rank(byScore.map((m) => Object.assign({}, m)), rack, true);
  for (const m of endgame) { assert.equal(m.leave, 0); assert.equal(m.equity, m.score); }
});

test('with the bag empty the hard bot searches the last turns exactly', () => {
  const d = dict();
  // reach a real endgame by self-play, then check the search's accounting
  const rnd = C.seededRandom(7);
  let s = C.newGame(77);
  let n = 0;
  while (!s.over && s.bag.length > 0 && n++ < 300) s = C.apply(s, C.botMove(s, 'hard', rnd, d, { noEndgame: true }), d);
  assert.equal(s.bag.length, 0);
  assert.equal(s.finalTurns, 2, 'the mover has one turn, then the opponent has the last');
  const e = C.endgameMove(s, d);
  assert.ok(e && e.move);
  if (e.move.t === 'play') {
    // margin is this move's score minus the opponent's best reply, and no other candidate does better
    const after = C.apply(s, e.move, d);
    const reply = C.generate(after.board, after.racks[after.turn], d)[0];
    assert.equal(e.margin, e.score - (reply ? reply.score : 0));
    const top = C.generate(s.board, s.racks[s.turn], d)[0];
    const afterTop = C.apply(s, { t: 'play', tiles: top.tiles }, d);
    const replyTop = C.generate(afterTop.board, afterTop.racks[afterTop.turn], d)[0];
    assert.ok(e.margin >= top.score - (replyTop ? replyTop.score : 0), 'at least as good as the greedy play');
  }
  // the bot uses it
  const move = C.botMove(s, 'hard', rnd, d);
  assert.deepEqual(move, e.move);
  // and on the very last move it just takes the points
  const last = C.apply(s, e.move, d);
  if (!last.over && last.racks[last.turn].length) {
    const e2 = C.endgameMove(last, d);
    const best = C.generate(last.board, last.racks[last.turn], d)[0];
    if (best) assert.equal(e2.score, best.score);
  }
});

test('the lookahead charges each candidate its sampled best reply', () => {
  const d = dict();
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), d);
  const rack = s.racks[1];
  const cands = C.rank(C.generate(s.board, rack, d), rack, false).slice(0, 4);
  const pick = C.lookahead(s, cands, d, C.seededRandom(3), 3, 1);
  assert.ok(cands.includes(pick));
  for (const m of cands) {
    assert.equal(typeof m.reply, 'number');
    assert.ok(m.reply >= 0);
    assert.equal(m.value, Math.round((m.equity - m.reply) * 10) / 10);
    assert.ok(pick.value >= m.value);
  }
  const f = C.leaveFeatures(['A', 'A', 'E', '?', '?', 'X']);
  assert.deepEqual(f, { counts: { A: 2, E: 1, '?': 2, X: 1 }, dup: 1, blankDup: 1, skew: 1 });
});
