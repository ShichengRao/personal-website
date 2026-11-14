import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C = require(join(root, 'static', 'seven-tiles', 'core.js'));
const { loadDict } = await import(join(root, 'tools', 'lexicon.mjs'));
const N = C.N;

const dict = () => loadDict('words');
const tilesOn = (s) => s.board.filter(Boolean).length + s.rack.length + s.bag.length;
const playOf = (m) => ({ t: 'play', tiles: m.tiles });
const keyOf = (tiles) => tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
const junk = { t: 'play', tiles: [{ r: 0, c: 0, l: 'Q', b: false }] };

// Plays a game to the end, asking script(state, round) for each round's submissions.
function playOut(seed, opts, d, script) {
  let s = C.newGroup(seed, opts, d);
  const record = [];
  while (!s.over) {
    const subs = script(s, record.length + 1);
    record.push(subs);
    s = C.resolveRound(s, subs, d);
    assert.equal(tilesOn(s), 100, 'tiles are conserved in round ' + record.length);
  }
  return { s, record };
}
// Three players: one picks among the top five, one plays the best every other round, one sends junk.
const mixed = (d) => (s, round) => {
  const gen = C.generate(s.board, s.rack, d);
  const subs = [{ p: 0, at: 1000 * round + 5, move: playOf(gen[round % Math.min(5, gen.length)]) }];
  if (round % 2 === 0) subs.push({ p: 1, at: 1000 * round + 9, move: playOf(gen[0]) });
  subs.push({ p: 2, at: 1000 * round, move: junk });
  return subs;
};

test('a group game is the same on every phone: the seed and the submissions decide it', () => {
  const d = dict();
  assert.deepEqual(C.newGroup(11, {}, d), C.newGroup(11, {}, d), 'the first rack is seeded');
  const { s, record } = playOut(11, { limit: 0 }, d, mixed(d));
  assert.deepEqual(C.replayGroup(11, { limit: 0 }, record, d), s);
  // rounds the server still holds after the end change nothing
  assert.deepEqual(C.replayGroup(11, { limit: 0 }, record.concat([[{ p: 0, at: 1, move: junk }]]), d), s);
  // the board history has the 1v1 shape the page draws from
  assert.equal(s.history.length, s.rounds.length);
  s.rounds.forEach((r, k) => {
    assert.deepEqual(s.history[k].tiles, r.board.tiles);
    assert.equal(s.history[k].t, 'play');
    assert.equal(s.history[k].p, r.board.p);
  });
  // settling a round leaves the state it was given alone
  const fresh = C.newGroup(12, {}, d), before = JSON.stringify(fresh);
  C.resolveRound(fresh, mixed(d)(fresh, 1), d);
  assert.equal(JSON.stringify(fresh), before);
});

test('the best submitted play goes on the board, ties to the earliest, else the engine\'s', () => {
  const d = dict();
  const s = C.newGroup(21, {}, d);
  const gen = C.generate(s.board, s.rack, d);
  // on the empty board a play and its mirror through the centre score the same
  const a = gen[0], b = gen.find((m) => m !== a && m.score === a.score && keyOf(m.tiles) !== keyOf(a.tiles));
  assert.ok(b, 'a second play with the top score');
  const low = gen.find((m) => m.score < a.score);
  const round = (subs, opts) => C.resolveRound(opts ? Object.assign({}, s, { opts: C.groupOptions(opts) }) : s, subs, d).rounds[0];

  let r = round([{ p: 0, at: 50, move: playOf(low) }, { p: 1, at: 100, move: playOf(b) }, { p: 2, at: 200, move: playOf(a) }]);
  assert.equal(r.board.p, 1, 'equal scores go to the earlier submission');
  assert.equal(keyOf(r.board.tiles), keyOf(b.tiles));
  assert.deepEqual(r.plays.map((x) => [x.p, x.score]), [[1, a.score], [2, a.score], [0, low.score]], 'each player scores their own play, best first');

  r = round([{ p: 1, at: 300, move: playOf(b) }, { p: 2, at: 200, move: playOf(a) }]);
  assert.equal(r.board.p, 2);
  r = round([{ p: 3, at: 200, move: playOf(b) }, { p: 2, at: 200, move: playOf(a) }]);
  assert.equal(r.board.p, 2, 'the same moment goes to the lower seat');
  r = round([{ p: 3, at: null, move: playOf(a) }, { p: 4, at: 900, move: playOf(b) }]);
  assert.equal(r.board.p, 4, 'a submission with no time counts as the latest');

  // nobody found a legal play: the engine's best goes on, credited to nobody
  r = round([{ p: 0, at: 1, move: junk }]);
  assert.equal(r.board.p, null);
  assert.equal(r.board.score, r.best.score);
  assert.equal(r.best.score, a.score);
  assert.equal(round([]).board.p, null);

  // set to the engine's play, a player's play never goes on, even the best one
  r = round([{ p: 0, at: 1, move: playOf(low) }, { p: 1, at: 2, move: playOf(a) }], { board: 'engine' });
  assert.equal(r.board.p, null);
  assert.equal(keyOf(r.board.tiles), keyOf(r.best.tiles));
  assert.deepEqual(r.plays.map((x) => [x.p, x.score]), [[1, a.score], [0, low.score]], 'players still score their own plays');
});

test('a play that is not legal scores 0 and never reaches the board', () => {
  const d = dict();
  const s = C.newGroup(31, {}, d);
  const gen = C.generate(s.board, s.rack, d);
  const low = gen[gen.length - 1];
  const letters = s.rack.filter((t) => t !== '?');
  let nonWord = null;
  letters.forEach((x, i) => letters.forEach((y, j) => { if (!nonWord && i !== j && !d.has(x + y)) nonWord = x + y; }));
  assert.ok(nonWord, 'two rack letters that are not a word');
  const missing = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !s.rack.includes(l));
  const at = (w, r, c) => ({ t: 'play', tiles: w.split('').map((l, i) => ({ r, c: c + i, l, b: false })) });
  const subs = [
    { p: 0, at: 1, move: at(nonWord, 7, 7) },
    { p: 1, at: 2, move: at(missing + missing, 7, 7) },
    { p: 2, at: 3, move: Object.assign(playOf(low), { tiles: low.tiles.map((t) => ({ r: t.r - 3, c: t.c, l: t.l, b: t.b })) }) },
    { p: 3, at: 4, move: null },
    { p: 4, at: 5, move: { t: 'swap', tiles: ['A'] } },
    { p: 5, at: 6, move: { t: 'play', tiles: 'QI' } },
    { p: 6, at: 7, move: { t: 'play', tiles: [null] } },
    { p: 7, at: 8, move: playOf(low) },
    { p: 'x', at: 9, move: playOf(gen[0]) }
  ];
  const r = C.resolveRound(s, subs, d).rounds[0];
  assert.equal(r.board.p, 7, 'the only legal play goes on');
  assert.deepEqual(r.plays.map((x) => x.p), [7, 0, 1, 2, 3, 4, 5, 6], 'a seat that is not a number is dropped');
  for (const x of r.plays.slice(1)) {
    assert.equal(x.ok, false, 'seat ' + x.p);
    assert.equal(x.score, 0);
    assert.ok(x.reason, 'seat ' + x.p + ' is told why');
  }
  assert.match(r.plays[1].reason, /not in the word list/);
  assert.match(r.plays[2].reason, /not on your rack/);
  assert.match(r.plays[3].reason, /center/);
  // the 1v1 check gives the same answer as the shared play check
  const g = C.newGame(5), m = { t: 'play', tiles: C.generate(g.board, g.racks[0], d)[0].tiles };
  assert.deepEqual(C.check(g, m, d), C.checkPlay(g.board, g.racks[0], m, d));
});

test('a player\'s later submission replaces the earlier one, whatever order the rows arrive in', () => {
  const d = dict();
  const s = C.newGroup(41, {}, d);
  const gen = C.generate(s.board, s.rack, d);
  const best = gen[0], worse = gen.find((m) => m.score < best.score);
  const subs = [{ p: 0, at: 10, move: playOf(best) }, { p: 0, at: 20, move: playOf(worse) }];
  for (const order of [subs, subs.slice().reverse()]) {
    const r = C.resolveRound(s, order, d).rounds[0];
    assert.equal(r.plays.length, 1);
    assert.equal(r.plays[0].score, worse.score);
    assert.equal(keyOf(r.board.tiles), keyOf(worse.tiles));
  }
});

test('racks follow the vowel and consonant rule, and a rack that breaks it is redrawn', () => {
  const meets = (t, n) => C.rackMeets(t.split(''), n);
  assert.equal(meets('AEBCDFG', 2), true);
  assert.equal(meets('AEIOUBS', 2), true);
  assert.equal(meets('AEIOUYB', 2), true, 'Y is a consonant');
  assert.equal(meets('AEIOUUB', 2), false);
  assert.equal(meets('?EIOUUB', 2), true, 'a blank stands in for a consonant');
  assert.equal(meets('BCDFGHA', 2), false);
  assert.equal(meets('BCDFGHA', 1), true);
  assert.equal(meets('??', 2), false);
  assert.equal(meets('??', 1), true);
  assert.equal(C.rackNeed(15), 2);
  assert.equal(C.rackNeed(16), 1);

  const d = dict();
  let redrawn = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = C.newGroup(seed, {}, d);
    assert.equal(s.rack.length, 7);
    assert.ok(C.rackMeets(s.rack, 2), 'seed ' + seed + ' deals a rack that meets the rule');
    if (s.redraws) redrawn++;
  }
  assert.ok(redrawn > 0, 'some first draws break the rule and are redrawn');
  // through whole games, every rack meets the rule for its round
  for (const seed of [51, 52, 53]) {
    const { s } = playOut(seed, { limit: 0 }, d, mixed(d));
    s.rounds.forEach((r, k) => assert.ok(C.rackMeets(r.rack, C.rackNeed(k + 1)), 'seed ' + seed + ' round ' + (k + 1)));
  }
});

test('the game ends after the set rounds, or when the bag cannot make a rack', () => {
  const d = dict();
  assert.deepEqual(C.groupOptions(), { limit: 10, board: 'player', racks: 'keep' });
  assert.deepEqual(C.groupOptions({ limit: -1, board: 'x', racks: 'x' }), { limit: 10, board: 'player', racks: 'keep' });
  assert.deepEqual(C.groupOptions({ limit: 0, board: 'engine', racks: 'fresh' }), { limit: 0, board: 'engine', racks: 'fresh' });

  const { s } = playOut(61, { limit: 3 }, d, mixed(d));
  assert.equal(s.rounds.length, 3);
  assert.equal(s.endReason, 'rounds');
  assert.equal(s.best, null, 'no best play is left lying around once the game is over');
  assert.throws(() => C.resolveRound(s, [], d), /over/);

  for (const seed of [62, 63]) {
    const full = playOut(seed, { limit: 0 }, d, () => []).s;
    assert.equal(full.endReason, 'bag');
    assert.ok(full.rounds.length >= 15 && full.rounds.length <= 40, 'a full bag lasts ' + full.rounds.length + ' rounds');
    assert.ok(full.bag.length < 7 || !C.rackMeets(full.rack.concat(full.bag), C.rackNeed(full.rounds.length + 1)), 'it ends only when the tiles run short');
  }
});

test('with nobody playing, the engine takes the top score, and ties never depend on the locale', () => {
  const d = dict();
  let s = C.newGroup(71, { limit: 0 }, d), tied = 0;
  while (!s.over) {
    const top = C.generate(s.board, s.rack, d).filter((m, i, all) => m.score === all[0].score);
    if (new Set(top.map((m) => m.word)).size > 1) tied++;
    const next = C.resolveRound(s, [], d), board = next.rounds[next.rounds.length - 1].board;
    assert.equal(board.score, top[0].score);
    assert.equal(keyOf(board.tiles), top.map((m) => keyOf(m.tiles)).sort()[0], 'the tie goes to the first play in plain string order');
    s = next;
  }
  assert.ok(tied > 0, 'the game had a top score shared by different words');
  // generate() orders equal scores by localeCompare; turn that around and nothing changes
  const orig = String.prototype.localeCompare;
  let flipped;
  try {
    String.prototype.localeCompare = function (o) { return -orig.call(this, o); };
    flipped = playOut(71, { limit: 0 }, d, () => []).s;
  } finally { String.prototype.localeCompare = orig; }
  assert.deepEqual(flipped, s);
});

test('standings: totals, share of the best, best-play rounds, shared ranks and a late joiner', () => {
  const d = dict();
  const { s } = playOut(81, { limit: 3 }, d, (st, round) => {
    const gen = C.generate(st.board, st.rack, d);
    const subs = [{ p: 0, at: 10, move: playOf(st.best) }, { p: 1, at: 20, move: playOf(st.best) }];
    if (round >= 2) subs.push({ p: 2, at: 5, move: playOf(gen[gen.length - 1]) });
    return subs;
  });
  const rows = C.groupStandings(s, [{ p: 0 }, { p: 1, from: 1 }, { p: 2, from: 2 }, { p: 3, from: 3 }]);
  const by = Object.fromEntries(rows.map((r) => [r.p, r]));
  const bestSum = s.rounds.reduce((a, r) => a + r.best.score, 0);
  assert.equal(by[0].total, bestSum);
  assert.equal(by[0].share, 100);
  assert.equal(by[0].tops, 3);
  assert.equal(by[0].boards, 3, 'the earlier of two equal plays goes on the board');
  assert.equal(by[1].total, bestSum);
  assert.equal(by[1].boards, 0);
  assert.equal(by[0].rank, 1);
  assert.equal(by[1].rank, 1, 'equal totals share a rank');
  assert.equal(by[2].rank, 3);
  assert.equal(by[2].possible, s.rounds[1].best.score + s.rounds[2].best.score, 'a late joiner is measured from the round they joined');
  assert.equal(by[2].plays, 2);
  assert.ok(by[2].total < bestSum);
  assert.deepEqual([by[3].total, by[3].possible, by[3].rank], [0, s.rounds[2].best.score, 4], 'a player who never played');
  assert.deepEqual(rows.map((r) => r.p), [0, 1, 2, 3]);
  const best = s.rounds.map((r) => r.best).reduce((a, b) => (b.score > a.score ? b : a));
  assert.deepEqual([by[0].best_word, by[0].best_score], [best.word, best.score]);
  // without a player list, everyone who submitted counts from round 1
  assert.deepEqual(C.groupStandings(s).map((r) => [r.p, r.possible]), [[0, bestSum], [1, bestSum], [2, bestSum]]);
});

test('a game named by words deals the same racks on every phone', () => {
  const d = dict();
  const a = C.seedOf('same-rack:otter-slate-plum'), b = C.seedOf('same-rack:otter-slate-plum'), c = C.seedOf('same-rack:otter-slate-pine');
  assert.equal(a, b);
  assert.notEqual(a, c);
  for (const s of [a, c, C.seedOf(''), C.seedOf('x'.repeat(500))]) assert.ok(Number.isInteger(s) && s > 0 && s <= 0x7fffffff, 'a positive 31-bit seed: ' + s);
  // with the engine's play going on every round, a player's own plays never change the game
  const opts = { limit: 10, board: 'engine' };
  const alone = playOut(a, opts, d, () => []).s;
  const busy = playOut(a, opts, d, mixed(d)).s;
  assert.deepEqual(busy.history, alone.history);
  assert.deepEqual(busy.rounds.map((r) => r.rack), alone.rounds.map((r) => r.rack));
  // the page reorders the rack in place when a player drags or shuffles: that must not change any draw
  let tested = 0;
  for (let i = 0; i < 20 && tested < 2; i++) {
    const seed = C.seedOf('same-rack:test-' + i);
    let s = C.newGroup(seed, { limit: 0, board: 'engine' }, d), redrawn = 0;
    while (!s.over) { s.rack.reverse(); s = C.resolveRound(s, [], d); redrawn += s.redraws; }
    if (!redrawn) continue;
    tested++;
    assert.deepEqual(s.history, playOut(seed, { limit: 0, board: 'engine' }, d, () => []).s.history, 'seed ' + seed);
  }
  assert.equal(tested, 2, 'games with a redraw after the first round, to test');
});

test('given the everyday words, the round\'s best play is the best one made of them, and the top play is noted too', () => {
  const d = dict(), common = loadDict('common');
  const opts = { limit: 0, board: 'engine' };
  let s = C.newGroup(91, opts, d, common), differ = 0;
  while (!s.over) {
    const gen = C.generate(s.board, s.rack, d);
    const everyday = gen.filter((m) => m.words.every((w) => common.has(w.word)));
    assert.equal(s.top.score, gen[0].score, 'the top play is the best of all');
    assert.equal(s.best.score, everyday.length ? everyday[0].score : gen[0].score, 'the best play is the best of everyday words');
    if (everyday.length) assert.ok(s.best.words.every((w) => common.has(w.word)));
    if (s.best.score < s.top.score) differ++;
    const next = C.resolveRound(s, [], d, common), r = next.rounds[next.rounds.length - 1];
    assert.equal(keyOf(r.board.tiles), keyOf(s.best.tiles), 'the best everyday play goes on the board');
    assert.deepEqual([r.best, r.top], [s.best, s.top]);
    s = next;
  }
  assert.ok(differ > 0, 'some rounds have a top play beyond the everyday words');
  assert.deepEqual(C.replayGroup(91, opts, [], d, common).rounds.length, 0);
  assert.deepEqual(playOutWith(91, opts, d, common), s, 'the same list gives the same game');
  // without the list, the best play and the top play are one and the same
  const plain = C.newGroup(91, opts, d);
  assert.deepEqual(plain.best, plain.top);
});
function playOutWith(seed, opts, d, common) {
  let s = C.newGroup(seed, opts, d, common);
  while (!s.over) s = C.resolveRound(s, [], d, common);
  return s;
}

test('with fresh racks, the leftover tiles go back in the bag and every round starts from seven new ones', () => {
  const d = dict(), opts = { limit: 0, board: 'engine', racks: 'fresh' };
  const { s } = playOut(81, opts, d, () => []);
  assert.equal(s.endReason, 'bag');
  let fresh = 0;
  s.rounds.forEach((r, k) => {
    assert.ok(C.rackMeets(r.rack, C.rackNeed(k + 1)), 'round ' + (k + 1) + ' meets the rack rule');
    if (k === 0) return;
    const before = s.rounds[k - 1], left = before.rack.slice();
    for (const t of before.board.tiles) left.splice(left.indexOf(t.b ? '?' : t.l), 1);
    if (left.some((t, i) => r.rack[i] !== t)) fresh++;
  });
  assert.ok(fresh > s.rounds.length / 2, 'racks do not start from what was left: ' + fresh + ' of ' + (s.rounds.length - 1));
  assert.deepEqual(playOut(81, opts, d, () => []).s, s, 'the seed decides it');
  // the same seed keeping its leftovers is a different game from round 2
  const keep = playOut(81, { limit: 0, board: 'engine' }, d, () => []).s;
  assert.deepEqual(keep.rounds[0].rack, s.rounds[0].rack);
  assert.notDeepEqual(keep.rounds[1].rack, s.rounds[1].rack);
});
