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
      tiles.push({ r: rr, c: cc, l: t, b: t === '?' });
      if (down) rr++; else cc++;
    }
    if (!ok) continue;
    // a blank can be any letter: try them all
    const blanks = tiles.filter((t) => t.b);
    const combos = blanks.length ? Array.from({ length: 26 ** blanks.length }, (_, k) => k) : [0];
    for (const k of combos) {
      let n = k;
      for (const b of blanks) { b.l = String.fromCharCode(65 + (n % 26)); n = Math.floor(n / 26); }
      const res = C.analyze(board, tiles);
      if (!res.ok || res.words.some((w) => !d.has(w.word))) continue;
      const key = tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
      found.set(key, res.score);
    }
  }
  return found;
}

test('the move generator finds exactly the legal plays', () => {
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  const rack = ['O', 'X', 'A', 'B'];
  const gen = C.generate(s.board, rack, small);
  const brute = bruteForce(s.board, rack, small);
  const genKeys = new Map(gen.map((m) => [m.tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|'), m.score]));
  for (const [k, v] of brute) assert.equal(genKeys.get(k), v, `generator missed or mis-scored ${k}`);
  for (const [k, v] of genKeys) assert.equal(brute.get(k), v, `generator invented ${k}`);
  assert.ok(gen.length > 0);
  assert.equal(gen[0].score, Math.max(...brute.values()));
  // and with a blank in the rack, against every letter the blank could be
  const rackB = ['O', 'X', '?'];
  const genB = C.generate(s.board, rackB, small);
  const bruteB = bruteForce(s.board, rackB, small);
  const genKeysB = new Map(genB.map((m) => [m.tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|'), m.score]));
  for (const [k, v] of bruteB) assert.equal(genKeysB.get(k), v, `generator missed or mis-scored ${k} (blank)`);
  for (const [k, v] of genKeysB) assert.equal(bruteB.get(k), v, `generator invented ${k} (blank)`);
  assert.ok(genB.some((m) => m.tiles.some((t) => t.b)), 'the blank is used');
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
  assert.ok(C.leaveValue(['S', '?']) > 15, 'S and a blank are the best keep');
  assert.ok(C.leaveValue(['Q', 'U', 'U', 'V']) < 0, 'Q with doubled U and a V is a liability');
  assert.ok(C.leaveValue(['Q', 'V', 'W']) < -5, 'Q without a U, plus V and W, is worse still');
  assert.ok(C.leaveValue(['Q', 'U']) > C.leaveValue(['Q']) + C.leaveValue(['U']), 'QU is worth more together');
  assert.ok(C.leaveValue(['S', 'S']) < 2 * C.leaveValue(['S']), 'a second S is worth less than the first');
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
  assert.equal(e.move.t, 'play', 'fixture assumption: the endgame opens with a play');
  {
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
  assert.ok(!last.over && last.racks[last.turn].length, 'fixture assumption: the opponent has the last turn');
  {
    const e2 = C.endgameMove(last, d);
    const best = C.generate(last.board, last.racks[last.turn], d)[0];
    assert.ok(best, 'fixture assumption: the last player has a play');
    assert.equal(e2.score, best.score);
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
  assert.deepEqual(f.counts, { A: 2, E: 1, '?': 2, X: 1 });
  assert.deepEqual([f.dup, f.blankDup, f.skew], [1, 1, 1]);
  assert.equal(f.pairs.length, 15, 'every unordered pair of the six tiles');
  assert.ok(f.pairs.includes('AA') && f.pairs.includes('??') && f.pairs.includes('?X') && f.pairs.includes('AE'));
  // pair synergies add on top of the singles
  const before = C.leaveValue(['E', 'R']), had = C.LEAVE2.ER || 0;
  C.LEAVE2.ER = had + 2.5;
  assert.equal(C.leaveValue(['E', 'R']), Math.round((before + 2.5) * 10) / 10);
  C.LEAVE2.ER = had;
});

test('the common-word list is a subset of the word list and draws the line sensibly', () => {
  const text = readFileSync(join(dir, 'common.txt'), 'utf8');
  const words = text.split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'));
  const all = new Set(readFileSync(join(dir, 'words.txt'), 'utf8').split('\n'));
  assert.ok(words.length > 20000 && words.length < 60000, 'a few tens of thousands of words');
  for (const w of words) assert.ok(all.has(w), w + ' is not in the word list');
  const c = C.buildDict(text);
  for (const w of ['LOVE', 'QUILT', 'VARNISH', 'JUMP', 'ZEBRA']) assert.equal(c.has(w), true, w);
  for (const w of ['FOVEAL', 'LOVAT', 'HUED', 'CLEW', 'OXO', 'ZAX']) assert.equal(c.has(w), false, w);
});

test('an exchange is a candidate: the bot swaps a stuck rack and keeps what is worth keeping', () => {
  const rack = ['Q', 'V', 'W', 'U', 'I', 'I', 'S'];
  const e = C.bestExchange(rack, 40);
  assert.equal(e.t, 'swap');
  assert.ok(e.tiles.length >= 1 && e.tiles.length <= 7);
  assert.equal(e.equity, C.leaveValue(e.keeps.split('')));
  assert.ok(e.keeps.includes('S'), 'the S stays');
  assert.ok(!e.tiles.includes('S'));
  for (let m = 1; m < 128; m++) {   // nothing kept is worth more
    const kept = rack.filter((_, i) => !(m & (1 << i)));
    assert.ok(C.leaveValue(kept) <= e.equity + 1e-9);
  }
  assert.equal(C.bestExchange(rack, 0), null, 'no exchange from an empty bag');
  assert.ok(C.bestExchange(rack, 2).tiles.length <= 2, 'never more tiles than the bag holds');
  // with only QUILT playable, a rack of vowels has no play: the bot exchanges rather than passes
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), small);
  s = withRack(s, 'UUIIOOA');
  const move = C.botMove(s, 'hard', C.seededRandom(1), small);
  assert.equal(move.t, 'swap');
  assert.ok(move.tiles.length >= 1);
});

test('easy and medium bots stay inside their vocabulary; hard uses everything', () => {
  const d = dict();
  const tiny = C.buildDict(['quilt', 'lit', 'tilt', 'it', 'ti', 'quit', 'quilts', 'tin', 'nit', 'lint', 'tint', 'unit', 'until'].join('\n'));
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), d);
  s = withRack(s, 'NTIUSEA');
  const rnd = C.seededRandom(9);
  for (const level of ['easy', 'medium']) {
    for (let i = 0; i < 5; i++) {
      const m = C.botMove(s, level, rnd, d, { vocab: tiny });
      assert.equal(m.t, 'play', 'fixture assumption: ' + level + ' plays from NTIUSEA on the opening');
      const r = C.check(s, m, d);
      assert.equal(r.ok, true);
      for (const w of r.words) assert.equal(tiny.has(w.word), true, level + ' played ' + w.word + ', outside its vocabulary');
    }
  }
  const hardMove = C.botMove(s, 'hard', rnd, d, { vocab: tiny });
  const hardBest = C.rank(C.generate(s.board, s.racks[1], d), s.racks[1], false)[0];
  assert.deepEqual(hardMove.tiles, hardBest.tiles, 'hard ignores the vocabulary limit');
});

test('the NWL additions are in both lists until the licensed list arrives', () => {
  const adds = readFileSync(join(root, 'tools', 'word-additions.txt'), 'utf8').split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'));
  const d = dict();
  const c = C.buildDict(readFileSync(join(dir, 'common.txt'), 'utf8'));
  for (const w of adds) assert.equal(d.has(w.toUpperCase()), true, w);
  for (const w of ['QI', 'ZA', 'KI', 'OI', 'QIS', 'ZEN']) assert.equal(c.has(w), true, w + ' should count as common');
  assert.equal(c.has('MBAQANGA'), false);
});

test('online records are packed per game and unpack to the same thing', () => {
  const move = { t: 'play', tiles: [{ r: 7, c: 7, l: 'Q', b: false }, { r: 7, c: 8, l: 'I', b: true }] };
  const packed = C.pack('otter-slate-plum', move);
  assert.match(packed, /^[A-Za-z0-9+/=]+$/, 'base64');
  assert.ok(!packed.includes('tiles'), 'not readable as is');
  assert.deepEqual(C.unpack('otter-slate-plum', packed), move);
  assert.notEqual(C.pack('otter-slate-bob', move), packed, 'keyed by the game id');
  let other = null;
  try { other = C.unpack('otter-slate-bob', packed); } catch (e) { other = 'garbage'; }
  assert.notDeepEqual(other, move, 'the wrong key does not decode to the move');
  assert.equal(C.unpack('otter-slate-plum', C.pack('otter-slate-plum', 123456789)), 123456789);
});

test('a turn is rated against the best common play, and rare words can beat it', () => {
  const d = dict();
  const tiny = C.buildDict(['quilt', 'lit', 'tilt', 'it', 'ti', 'quit', 'tin', 'nit', 'lint', 'tint', 'unit', 'until'].join('\n'));
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), d);
  const before = withRack(s, 'NTIUSEA');
  const best = C.rank(C.generate(before.board, before.racks[1], d), before.racks[1], false)[0];
  const after = C.apply(before, { t: 'play', tiles: best.tiles }, d);
  const a = C.evaluateTurn(before, { t: 'play', tiles: best.tiles }, after.history[after.history.length - 1], d, tiny);
  assert.equal(a.playedLabel, best.word + ' for ' + best.score);
  assert.ok(a.ref, 'a common yardstick exists');
  assert.ok(a.commonList.every((m) => m.common));
  assert.ok(!best.words.every((w) => tiny.has(w.word)), 'fixture assumption: the best play uses a word outside the tiny list');
  assert.ok(a.rating >= 100, 'the best full-list play rates at least the best common play');
  assert.equal(a.expert, null, 'no expert note when the player found the rare word');
  // without a common list every play is common and the best play is exactly 100
  const b = C.evaluateTurn(before, { t: 'play', tiles: best.tiles }, after.history[after.history.length - 1], d, null);
  assert.equal(b.rating, 100);
  assert.equal(b.grade, 'best');
  // a pass is rated by the rack it keeps against that yardstick
  const c = C.evaluateTurn(before, { t: 'pass' }, { t: 'pass', p: 1 }, d, tiny);
  assert.equal(c.playedLabel, 'passed');
  assert.ok(c.rating < 100);
});

test('the result report attributes plays, bingos and best words to the right seat', async () => {
  const d = dict();
  const rnd = C.seededRandom(31);
  let s = C.newGame(3131);
  let n = 0;
  while (!s.over && n++ < 300) s = C.apply(s, C.botMove(s, 'hard', rnd, d), d);
  const r = C.computeResult(s, d, null);
  assert.equal(r.moves, s.moves.length);
  assert.deepEqual([r.p0_score, r.p1_score], s.scores);
  assert.equal(r.winner, C.winner(s));
  for (const p of [0, 1]) {
    const mine = s.history.filter((h) => h.p === p && h.t === 'play');
    const st = r.stats['p' + p];
    assert.equal(st.plays, mine.length);
    assert.equal(st.points, mine.reduce((t, h) => t + h.score, 0));
    assert.equal(st.bingos, mine.filter((h) => h.bingo).length);
    assert.equal(st.best_score, Math.max(0, ...mine.map((h) => h.score)));
  }
  // the sliced form gives the same answer
  const sliced = await C.computeResult(s, d, null, (go) => setTimeout(go, 0));
  assert.deepEqual(sliced, r);
});


test('in the last turns a play is rated by its margin over the known reply, not its score', () => {
  const d = dict();
  const rnd = C.seededRandom(703);
  let s = C.newGame(703);
  let n = 0;
  while (!s.over && !(s.bag.length === 0 && s.finalTurns === 2) && n++ < 300) s = C.apply(s, C.botMove(s, 'hard', rnd, d, { noEndgame: true }), d);
  assert.equal(s.finalTurns, 2);
  const e = C.endgameMove(s, d);
  assert.equal(e.move.t, 'play', 'seed 703 has a playable endgame');
  const after = C.apply(s, e.move, d);
  const a = C.evaluateTurn(s, e.move, after.history[after.history.length - 1], d, null);
  assert.equal(a.endgame, true);
  assert.equal(a.rating, 100, 'the margin-optimal play is the best play');
  const greedy = C.generate(s.board, s.racks[s.turn], d)[0];
  const afterG = C.apply(s, { t: 'play', tiles: greedy.tiles }, d);
  const g = C.evaluateTurn(s, { t: 'play', tiles: greedy.tiles }, afterG.history[afterG.history.length - 1], d, null);
  assert.ok(g.rating < 100, 'the greedy play gives more back and rates below the best');
  assert.equal(a.list[0].equity, e.margin, 'the yardstick is the searched margin');
  // a modest play far down the list by score is rated by its own margin, not written off
  const all = C.generate(s.board, s.racks[s.turn], d);
  const low = all[all.length - 1];
  const afterL = C.apply(s, { t: 'play', tiles: low.tiles }, d);
  const l = C.evaluateTurn(s, { t: 'play', tiles: low.tiles }, afterL.history[afterL.history.length - 1], d, null);
  assert.ok(l.played >= 0, 'the played move is in the examined list');
  const replyL = C.generate(afterL.board, afterL.racks[afterL.turn], d)[0];
  assert.equal(l.playedEquity, low.score - (replyL ? replyL.score : 0), 'rated by its real margin');
});

test('a brilliancy needs a rare word with a clear edge, and a malformed move is refused, not a crash', () => {
  const d = dict();
  let s = withRack(C.newGame(1), 'QUILTAB');
  s = C.apply(s, play('QUILT', 7, 7, false), d);
  assert.equal(C.check(s, { t: 'play', tiles: [null] }, d).ok, false);
  assert.equal(C.check(s, { t: 'play', tiles: [{ r: 8, c: 7 }] }, d).ok, false);
  assert.equal(C.check(s, { t: 'swap', tiles: [null] }, d).ok, false);
  assert.throws(() => C.apply(s, { t: 'play', tiles: 'nope' }, d), /Not a move/);
  // a common word cannot be a brilliancy even when it tops the list
  const tiny = C.buildDict(['quilt', 'lit', 'tilt', 'it', 'ti', 'quit', 'tin', 'nit', 'lint', 'tint', 'unit', 'until'].join('\n'));
  const before = withRack(s, 'NTIUSEA');
  const best = C.rank(C.generate(before.board, before.racks[1], tiny), before.racks[1], false)[0];
  const after = C.apply(before, { t: 'play', tiles: best.tiles }, d);
  const a = C.evaluateTurn(before, { t: 'play', tiles: best.tiles }, after.history[after.history.length - 1], d, tiny);
  assert.equal(a.grade, 'best');
  assert.equal(a.rating, 100);
  // and the rating scale is one straight line: three points per point of equity, best at 100
  const r2 = a.list[1];
  assert.ok(r2, 'fixture assumption: more than one play');
  assert.equal(r2.rating, Math.max(0, Math.round(100 + 3 * (r2.equity - a.ref.equity))));
});

test('a move object handed to apply is copied, not shared, and a seed must be an integer', () => {
  const d = dict();
  let s = C.newGame(11);
  s = withRack(s, 'QUILTAX');
  const m = { t: 'play', tiles: [{ r: 7, c: 7, l: 'Q' }, { r: 7, c: 8, l: 'U' }, { r: 7, c: 9, l: 'I' }, { r: 7, c: 10, l: 'L' }, { r: 7, c: 11, l: 'T' }], extra: 1 };
  const after = C.apply(s, m, d);
  m.tiles[0].l = 'Z'; m.tiles.push({ r: 0, c: 0, l: 'A' });
  assert.equal(after.moves[0].tiles.length, 5);
  assert.equal(after.moves[0].tiles[0].l, 'Q');
  assert.equal('extra' in after.moves[0], false);
  assert.deepEqual(C.apply(s, after.moves[0], d).scores, after.scores, 'the stored copy replays to the same position');
  assert.throws(() => C.newGame('abc'), /bad seed/);
  assert.throws(() => C.newGame(0.5), /bad seed/);
  assert.throws(() => C.pack('id', undefined), /nothing to pack/);
  assert.notEqual(C.pack(123, 'x'), C.pack(124, 'x'));
});

test('three blanks are not worth three times one, and a rare-only position still has a yardstick', () => {
  const d = dict();
  assert.ok(C.leaveValue(['?', '?', '?']) < C.leaveValue(['?', '?']) + 10, 'a third blank is worth little');
  assert.ok(C.leaveValue(['?', '?', '?']) >= C.leaveValue(['?', '?']), 'but never less than nothing');
  assert.ok(C.leaveValue(['?', '?', '?', 'E']) >= C.leaveValue(['?', '?', 'E']), 'and holding it beats not holding it');
  let s = C.newGame(12);
  s = withRack(s, '???EAIS');
  const m = C.botMove(s, 'hard', C.seededRandom(1), d);
  assert.equal(m.t, 'play');
  assert.equal(m.tiles.length, 7, 'with three blanks the bot plays a bingo, not a two-tile word');
  // a position where no common play exists and the bag is empty: the best play is the yardstick
  const empty = C.newGame(13);
  const tiny = new Set(['ZZZZ']);
  let e = withRack(empty, 'QUILTAX'); e = { ...e, bag: [], racks: [e.racks[0], ['A', 'B']] };
  const after = C.apply(e, { t: 'pass' }, d);
  const a = C.evaluateTurn(e, { t: 'pass' }, after.history[after.history.length - 1], d, tiny);
  assert.ok(a.ref, 'a yardstick exists');
  assert.ok(a.rating < 100, 'a pass does not rate best when a play was available');
});
