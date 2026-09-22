/* Scrabble Mod core: the board, the bag, the rules, the scorer, the dictionary
   trie and the move generator, with no DOM in any of it. The page, the tests
   and the bot all run this same code; it loads in Node as well as the browser.

   A game is fully determined by its seed and its list of moves, so two clients
   that share those reconstruct the same board, racks and bag. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScrabbleMod = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 15, CENTER = 7, RACK = 7, BINGO = 40, VERSION = 1;
  const PASS_LIMIT = 4;   // consecutive passes (two each) that end a game early

  // d/t: double/triple letter, D/T: double/triple word, *: the plain center.
  const LAYOUT = [
    't..T...d...T..t',
    '.D....t.t....D.',
    '....d.....d....',
    'T..d...D...d..T',
    '..d..t...t..d..',
    '....t..d..t....',
    '.t...........t.',
    'd..D.d.*.d.D..d',
    '.t...........t.',
    '....t..d..t....',
    '..d..t...t..d..',
    'T..d...D...d..T',
    '....d.....d....',
    '.D....t.t....D.',
    't..T...d...T..t'
  ];
  const LM = new Uint8Array(N * N), WM = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const ch = LAYOUT[r][c];
    LM[r * N + c] = ch === 'd' ? 2 : ch === 't' ? 3 : 1;
    WM[r * N + c] = ch === 'D' ? 2 : ch === 'T' ? 3 : 1;
  }
  function bonusAt(i) {
    const ch = LAYOUT[Math.floor(i / N)][i % N];
    return { d: '2L', t: '3L', D: '2W', T: '3W', '*': '*' }[ch] || '';
  }

  // [count, value]. 100 tiles; '?' is the blank.
  const TILES = {
    A: [9, 1], B: [2, 4], C: [2, 3], D: [4, 2], E: [12, 1], F: [2, 4], G: [3, 4], H: [3, 3], I: [8, 1],
    J: [1, 10], K: [1, 6], L: [4, 2], M: [2, 3], N: [5, 1], O: [8, 1], P: [2, 3], Q: [1, 10], R: [6, 1],
    S: [5, 1], T: [6, 1], U: [3, 2], V: [2, 6], W: [2, 5], X: [1, 8], Y: [2, 4], Z: [1, 10], '?': [3, 0]
  };
  const VALUE = {};
  for (const k in TILES) VALUE[k] = TILES[k][1];
  const tileValue = (t) => (t.b ? 0 : VALUE[t.l]);

  function seededRandom(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const mix = (seed, k) => ((seed ^ Math.imul(k + 1, 0x9E3779B9)) >>> 0) || 1;
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function fullBag() {
    const bag = [];
    for (const k in TILES) for (let i = 0; i < TILES[k][0]; i++) bag.push(k);
    return bag;
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---- game state -------------------------------------------------------

  function draw(state, p) {
    const rack = state.racks[p];
    while (rack.length < RACK && state.bag.length) rack.push(state.bag.pop());
  }

  function newGame(seed) {
    const bag = shuffle(fullBag(), seededRandom(mix(seed, 0)));
    const state = {
      version: VERSION, seed, board: new Array(N * N).fill(null), racks: [[], []], bag,
      scores: [0, 0], turn: 0, moves: [], history: [], passes: 0, finalTurns: null, over: false, endReason: null, resigned: null
    };
    draw(state, 0); draw(state, 1);
    return state;
  }

  // Geometry and scoring of a placement, without the dictionary.
  // tiles: [{r, c, l, b}] where l is the letter shown and b marks a blank.
  function analyze(board, tiles) {
    const bad = (reason) => ({ ok: false, reason });
    if (!tiles || !tiles.length) return bad('Place at least one tile.');
    const placed = new Map();
    for (const t of tiles) {
      if (!(t.r >= 0 && t.r < N && t.c >= 0 && t.c < N)) return bad('That square is off the board.');
      const i = t.r * N + t.c;
      if (board[i]) return bad('That square is already taken.');
      if (placed.has(i)) return bad('Two tiles landed on one square.');
      if (typeof t.l !== 'string' || !/^[A-Z]$/.test(t.l)) return bad('That is not a letter.');
      placed.set(i, t);
    }
    const at = (r, c) => (r < 0 || c < 0 || r >= N || c >= N) ? null : (placed.get(r * N + c) || board[r * N + c]);
    let r0 = N, r1 = -1, c0 = N, c1 = -1;
    for (const t of tiles) { r0 = Math.min(r0, t.r); r1 = Math.max(r1, t.r); c0 = Math.min(c0, t.c); c1 = Math.max(c1, t.c); }
    let dir;
    if (tiles.length === 1) dir = (at(r0, c0 - 1) || at(r0, c0 + 1)) ? 'h' : 'v';
    else if (r0 === r1) dir = 'h';
    else if (c0 === c1) dir = 'v';
    else return bad('Tiles must sit in one row or one column.');
    if (dir === 'h') { for (let c = c0; c <= c1; c++) if (!at(r0, c)) return bad('Leave no gaps in the word.'); }
    else { for (let r = r0; r <= r1; r++) if (!at(r, c0)) return bad('Leave no gaps in the word.'); }

    let empty = true;
    for (let i = 0; i < N * N; i++) if (board[i]) { empty = false; break; }
    if (empty) {
      if (!placed.has(CENTER * N + CENTER)) return bad('The first word must cover the center square.');
    } else {
      let touch = false;
      for (const t of tiles) {
        if (board[(t.r - 1) * N + t.c] && t.r > 0 || board[(t.r + 1) * N + t.c] && t.r < N - 1 ||
            t.c > 0 && board[t.r * N + t.c - 1] || t.c < N - 1 && board[t.r * N + t.c + 1]) { touch = true; break; }
      }
      if (!touch) return bad('Every play must touch a tile already on the board.');
    }

    function line(r, c, dr, dc) {
      while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
      const cells = [];
      while (at(r, c)) { cells.push(r * N + c); r += dr; c += dc; }
      return cells;
    }
    const lines = [];
    const main = dir === 'h' ? line(r0, c0, 0, 1) : line(r0, c0, 1, 0);
    if (main.length >= 2) lines.push(main);
    for (const t of tiles) {
      const cross = dir === 'h' ? line(t.r, t.c, 1, 0) : line(t.r, t.c, 0, 1);
      if (cross.length >= 2) lines.push(cross);
    }
    if (!lines.length) return bad('A word needs at least two letters.');
    const words = lines.map((cells) => {
      let sum = 0, mult = 1, word = '';
      for (const i of cells) {
        const p = placed.get(i);
        if (p) { sum += tileValue(p) * LM[i]; mult *= WM[i]; word += p.l; }
        else { sum += tileValue(board[i]); word += board[i].l; }
      }
      return { word, score: sum * mult, cells };
    });
    const bingo = tiles.length === RACK;
    let score = bingo ? BINGO : 0;
    for (const w of words) score += w.score;
    return { ok: true, words, score, bingo, dir, main: words[0].word };
  }

  function hasTiles(rack, wanted) {
    const left = rack.slice();
    for (const w of wanted) {
      const i = left.indexOf(w);
      if (i < 0) return false;
      left.splice(i, 1);
    }
    return true;
  }

  // Is this move legal right now? Returns analyze()'s result for plays.
  function check(state, move, dict) {
    const bad = (reason) => ({ ok: false, reason });
    if (state.over) return bad('The game is over.');
    if (!move || typeof move !== 'object') return bad('Not a move.');
    const rack = state.racks[state.turn];
    if (move.t === 'pass' || move.t === 'resign') return { ok: true };
    if (move.t === 'swap') {
      if (!Array.isArray(move.tiles) || !move.tiles.length) return bad('Pick the tiles to swap.');
      if (move.tiles.length > state.bag.length) return bad('The bag only has ' + state.bag.length + ' tiles left.');
      if (!hasTiles(rack, move.tiles)) return bad('Those tiles are not on your rack.');
      return { ok: true };
    }
    if (move.t === 'play') {
      if (!Array.isArray(move.tiles)) return bad('Not a move.');
      if (!hasTiles(rack, move.tiles.map((t) => (t.b ? '?' : t.l)))) return bad('Those tiles are not on your rack.');
      const res = analyze(state.board, move.tiles);
      if (!res.ok) return res;
      if (dict) {
        const missing = res.words.map((w) => w.word).filter((w) => !dict.has(w));
        if (missing.length) return bad(missing.join(', ') + (missing.length > 1 ? ' are not in the word list.' : ' is not in the word list.'));
      }
      return res;
    }
    return bad('Unknown move.');
  }

  // Apply a legal move and return the new state; throws on an illegal one.
  function apply(state, move, dict) {
    const res = check(state, move, dict);
    if (!res.ok) throw new Error(res.reason);
    const s = clone(state);
    const p = s.turn, rack = s.racks[p];
    const wasFinal = s.finalTurns !== null;
    const take = (tile) => rack.splice(rack.indexOf(tile), 1);
    if (move.t === 'play') {
      for (const t of move.tiles) { take(t.b ? '?' : t.l); s.board[t.r * N + t.c] = { l: t.l, b: !!t.b }; }
      s.scores[p] += res.score;
      s.history.push({ p, t: 'play', word: res.main, words: res.words.map((w) => ({ word: w.word, score: w.score })),
                       score: res.score, bingo: res.bingo, tiles: move.tiles.map((t) => ({ r: t.r, c: t.c, l: t.l, b: !!t.b })) });
      s.passes = 0;
      draw(s, p);
    } else if (move.t === 'swap') {
      for (const t of move.tiles) take(t);
      draw(s, p);
      for (const t of move.tiles) s.bag.push(t);
      shuffle(s.bag, seededRandom(mix(s.seed, s.moves.length + 1)));
      s.history.push({ p, t: 'swap', n: move.tiles.length });
      s.passes = 0;
    } else if (move.t === 'resign') {
      s.history.push({ p, t: 'resign' });
      s.over = true; s.endReason = 'resign'; s.resigned = p;
    } else {
      s.passes++;
      s.history.push({ p, t: 'pass' });
      if (s.passes >= PASS_LIMIT) { s.over = true; s.endReason = 'passes'; }
    }
    s.moves.push(move);
    if (wasFinal && !s.over) {
      s.finalTurns--;
      if (s.finalTurns === 0) { s.over = true; s.endReason = 'bag'; }
    }
    if (s.finalTurns === null && s.bag.length === 0) s.finalTurns = 2;
    s.turn = 1 - p;
    return s;
  }

  // Rebuild a game from its record. Stored moves were checked against the
  // word list when they were made, so they are replayed without it: a later
  // change of list must not make an old game unreadable. Geometry and racks
  // are still checked. Pass a dict to validate anyway.
  function replay(seed, moves, dict) {
    let s = newGame(seed);
    for (const m of moves) s = apply(s, m, dict || null);
    return s;
  }
  // Every position of a game: states[k] is the board after k moves.
  function positions(seed, moves) {
    const out = [newGame(seed)];
    for (const m of moves) out.push(apply(out[out.length - 1], m, null));
    return out;
  }

  // 0 or 1 for the winner of a finished game, -1 for a tie, null while it runs.
  function winner(state) {
    if (!state.over) return null;
    if (state.endReason === 'resign') return 1 - state.resigned;
    if (state.scores[0] === state.scores[1]) return -1;
    return state.scores[0] > state.scores[1] ? 0 : 1;
  }

  // What the side to move may do. A player with no tiles once the bag is
  // empty can only pass, which is how the other side gets their last turn.
  function options(state) {
    const rack = state.racks[state.turn];
    return { play: !state.over && rack.length > 0, swap: !state.over && rack.length > 0 && state.bag.length > 0, pass: !state.over, mustPass: !state.over && rack.length === 0 };
  }

  // ---- dictionary ---------------------------------------------------------
  // A trie in flat typed arrays: node 0 is the root, children are a linked list.

  function buildDict(text) {
    const words = [];
    for (const line of text.split('\n')) {
      const w = line.trim().toUpperCase();
      if (w.length >= 2 && w.length <= N && /^[A-Z]+$/.test(w)) words.push(w);
    }
    words.sort();
    let cap = 1 << 19;
    let first = new Int32Array(cap), next = new Int32Array(cap), last = new Int32Array(cap);
    let ch = new Uint8Array(cap), term = new Uint8Array(cap);
    first[0] = -1; last[0] = -1; next[0] = -1;
    let n = 1;
    function grow() {
      cap *= 2;
      const g = (old, T) => { const a = new T(cap); a.set(old); return a; };
      first = g(first, Int32Array); next = g(next, Int32Array); last = g(last, Int32Array);
      ch = g(ch, Uint8Array); term = g(term, Uint8Array);
    }
    const path = [0];
    let prev = '', count = 0;
    for (const w of words) {
      if (w === prev) continue;
      let k = 0;
      while (k < prev.length && k < w.length && prev[k] === w[k]) k++;
      path.length = k + 1;
      let node = path[k];
      for (let i = k; i < w.length; i++) {
        if (n >= cap) grow();
        const nn = n++;
        ch[nn] = w.charCodeAt(i) - 65; first[nn] = -1; next[nn] = -1; last[nn] = -1; term[nn] = 0;
        if (first[node] < 0) first[node] = nn; else next[last[node]] = nn;
        last[node] = nn;
        node = nn; path.push(nn);
      }
      term[node] = 1; prev = w; count++;
    }
    function child(node, code) {
      for (let c = first[node]; c >= 0; c = next[c]) if (ch[c] === code) return c;
      return -1;
    }
    function has(word) {
      let node = 0;
      for (let i = 0; i < word.length; i++) {
        node = child(node, word.charCodeAt(i) - 65);
        if (node < 0) return false;
      }
      return node > 0 && term[node] === 1;
    }
    return { size: count, nodes: n, child, has, first: (node) => first[node], next: (node) => next[node], letter: (node) => ch[node], isTerm: (node) => term[node] === 1 };
  }

  // ---- move generation (Appel & Jacobson) ---------------------------------

  const ALL = (1 << 26) - 1;

  function transpose(board) {
    const t = new Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) t[c * N + r] = board[r * N + c];
    return t;
  }

  // Every legal play for this rack, scored, best first.
  function generate(board, rack, dict) {
    const out = new Map();
    genOriented(board, board, rack, dict, false, out);
    genOriented(transpose(board), board, rack, dict, true, out);
    return [...out.values()].sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  }

  function genOriented(b, real, rack, dict, trans, out) {
    const cnt = new Int32Array(27);
    for (const t of rack) cnt[t === '?' ? 26 : t.charCodeAt(0) - 65]++;
    let empty = true;
    for (let i = 0; i < N * N; i++) if (b[i]) { empty = false; break; }
    const anchor = new Uint8Array(N * N);
    if (empty) anchor[CENTER * N + CENTER] = 1;
    else for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (b[i]) continue;
      if ((r > 0 && b[i - N]) || (r < N - 1 && b[i + N]) || (c > 0 && b[i - 1]) || (c < N - 1 && b[i + 1])) anchor[i] = 1;
    }
    const cross = new Int32Array(N * N).fill(-1);
    function allowed(r, c) {
      const i = r * N + c;
      if (cross[i] >= 0) return cross[i];
      let up = r - 1; while (up >= 0 && b[up * N + c]) up--;
      let dn = r + 1; while (dn < N && b[dn * N + c]) dn++;
      if (up === r - 1 && dn === r + 1) return (cross[i] = ALL);
      let pre = '', suf = '';
      for (let k = up + 1; k < r; k++) pre += b[k * N + c].l;
      for (let k = r + 1; k < dn; k++) suf += b[k * N + c].l;
      let m = 0;
      for (let L = 0; L < 26; L++) if (dict.has(pre + String.fromCharCode(65 + L) + suf)) m |= 1 << L;
      return (cross[i] = m);
    }
    const left = [], right = [];
    function record(r, anchorCol) {
      const tiles = [];
      for (let j = 0; j < left.length; j++) tiles.push({ c: anchorCol - left.length + j, l: left[j].l, b: left[j].b });
      for (const t of right) tiles.push(t);
      const real_ = tiles.map((t) => (trans ? { r: t.c, c: r, l: t.l, b: t.b } : { r, c: t.c, l: t.l, b: t.b }));
      const key = real_.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
      if (out.has(key)) return;
      const res = analyze(real, real_);
      if (res.ok) out.set(key, { tiles: real_, score: res.score, words: res.words.map((w) => ({ word: w.word, score: w.score })), word: res.main, bingo: res.bingo });
    }
    function extendRight(r, c, node, anchorCol) {
      if (c >= N || !b[r * N + c]) {
        if (c > anchorCol && dict.isTerm(node)) record(r, anchorCol);
        if (c >= N) return;
        const mask = allowed(r, c);
        for (let k = dict.first(node); k >= 0; k = dict.next(k)) {
          const L = dict.letter(k);
          if (!(mask & (1 << L))) continue;
          const letter = String.fromCharCode(65 + L);
          // both branches: a blank spent here can free the real letter for a
          // better square later in the word
          if (cnt[L] > 0) {
            cnt[L]--; right.push({ c, l: letter, b: false });
            extendRight(r, c + 1, k, anchorCol);
            right.pop(); cnt[L]++;
          }
          if (cnt[26] > 0) {
            cnt[26]--; right.push({ c, l: letter, b: true });
            extendRight(r, c + 1, k, anchorCol);
            right.pop(); cnt[26]++;
          }
        }
      } else {
        const k = dict.child(node, b[r * N + c].l.charCodeAt(0) - 65);
        if (k >= 0) extendRight(r, c + 1, k, anchorCol);
      }
    }
    function leftPart(r, anchorCol, node, limit) {
      extendRight(r, anchorCol, node, anchorCol);
      if (limit <= 0) return;
      for (let k = dict.first(node); k >= 0; k = dict.next(k)) {
        const L = dict.letter(k);
        const letter = String.fromCharCode(65 + L);
        if (cnt[L] > 0) {
          cnt[L]--; left.push({ l: letter, b: false });
          leftPart(r, anchorCol, k, limit - 1);
          left.pop(); cnt[L]++;
        }
        if (cnt[26] > 0) {
          cnt[26]--; left.push({ l: letter, b: true });
          leftPart(r, anchorCol, k, limit - 1);
          left.pop(); cnt[26]++;
        }
      }
    }
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!anchor[r * N + c]) continue;
      if (c > 0 && b[r * N + c - 1]) {
        let s = c - 1;
        while (s > 0 && b[r * N + s - 1]) s--;
        let node = 0;
        for (let k = s; k < c && node >= 0; k++) node = dict.child(node, b[r * N + k].l.charCodeAt(0) - 65);
        if (node >= 0) extendRight(r, c, node, c);
      } else {
        let limit = 0, k = c - 1;
        while (k >= 0 && !b[r * N + k] && !anchor[r * N + k]) { limit++; k--; }
        leftPart(r, c, 0, limit);
      }
    }
  }

  // ---- rack leave and equity ------------------------------------------------
  // What the tiles you keep are worth next turn: a static per-letter value,
  // a penalty for duplicates and for a lopsided vowel/consonant mix. A rough
  // heuristic, but it is what separates "the highest score" from "the best
  // play": dumping a Q for 11 beats a 14 that keeps the Q.
  // A next-score regression from 9,000 self-play games (tools/scrabble-mod-lab.mjs
  // leaves) produced a table that played this one to a coin flip (49.8%),
  // and scaling this table by 0.5 or the fitted one by 2 both lost, so these
  // values stay.
  const LEAVE = { A: 1, B: -3.5, C: -0.5, D: 0, E: 4, F: -2, G: -2, H: 0.5, I: -0.5, J: -3, K: -2.5, L: -1, M: -0.5,
                  N: 0.5, O: -1.5, P: -1.5, Q: -11.5, R: 1.5, S: 8, T: 0, U: -4.5, V: -5.5, W: -4, X: 3.5, Y: -2, Z: 2, '?': 25 };
  // per extra copy of a letter, per extra blank, per point of vowel/consonant skew beyond one
  const LEAVE_TUNE = { dup: -3, blankDup: -12, skew: -1.5 };
  // Pair synergies, keyed by the two tiles in order ('?' first, then A-Z):
  // what holding both is worth beyond the two singles. Empty until fitted
  // from a proper leave file (tools/scrabble-mod-lab.mjs fitklv).
  const LEAVE2 = {};
  const pairKey = (a, b) => (a <= b ? a + b : b + a);
  // The features leaveValue scores: letter counts, pairs, duplicates, skew.
  // Shared with the tuning script so a fitted table means the same thing here.
  function leaveFeatures(tiles) {
    const counts = {};
    const pairs = [];
    let vowels = 0, cons = 0, dup = 0, blankDup = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      counts[t] = (counts[t] || 0) + 1;
      if (counts[t] > 1) { if (t === '?') blankDup++; else dup++; }
      for (let j = i + 1; j < tiles.length; j++) pairs.push(pairKey(t, tiles[j]));
      if (t === '?') continue;
      if ('AEIOU'.includes(t)) vowels++; else cons++;
    }
    const skew = tiles.length >= 3 ? Math.max(0, Math.abs(vowels - cons) - 1) : 0;
    return { counts, pairs, dup, blankDup, skew };
  }
  function leaveValue(tiles) {
    if (!tiles.length) return 0;
    const f = leaveFeatures(tiles);
    let v = 0;
    for (const t in f.counts) v += LEAVE[t] * f.counts[t];
    for (const k of f.pairs) v += LEAVE2[k] || 0;
    v += LEAVE_TUNE.dup * f.dup + LEAVE_TUNE.blankDup * f.blankDup + LEAVE_TUNE.skew * f.skew;
    return Math.round(v * 10) / 10;
  }
  function leaveAfter(rack, tiles) {
    const left = rack.slice();
    for (const t of tiles) left.splice(left.indexOf(t.b ? '?' : t.l), 1);
    return left;
  }
  // Adds leave and equity to generated moves and sorts by equity. Once the
  // bag is empty the leave is worth nothing (leftovers cost nothing either).
  function rank(moves, rack, bagEmpty) {
    for (const m of moves) {
      const left = leaveAfter(rack, m.tiles);
      m.leave = bagEmpty ? 0 : leaveValue(left);
      m.keeps = left.join('');
      m.equity = Math.round((m.score + m.leave) * 10) / 10;
    }
    return moves.sort((a, b) => b.equity - a.equity || b.score - a.score || a.word.localeCompare(b.word));
  }

  // ---- endgame ------------------------------------------------------------
  // With the bag empty the opponent's rack is known exactly, so the last
  // turns can be searched instead of guessed. finalTurns 2: this move, then
  // the opponent's last; pick what leaves them the least. finalTurns 1: this
  // is the last move of the game, take the score. Passing is a candidate too.
  function endgameMove(state, dict, width) {
    const p = state.turn, rack = state.racks[p], opp = state.racks[1 - p];
    const moves = generate(state.board, rack, dict);
    if (state.finalTurns !== 2 || !opp.length) return moves.length ? { score: moves[0].score, move: { t: 'play', tiles: moves[0].tiles } } : null;
    const replyNow = generate(state.board, opp, dict)[0];
    let best = { t: 'pass' }, bestVal = -(replyNow ? replyNow.score : 0), bestScore = 0;
    for (const m of moves.slice(0, width || 40)) {
      const after = apply(state, { t: 'play', tiles: m.tiles }, null);
      const reply = generate(after.board, opp, dict)[0];
      const val = m.score - (reply ? reply.score : 0);
      if (val > bestVal) { bestVal = val; best = { t: 'play', tiles: m.tiles }; bestScore = m.score; }
    }
    return { score: bestScore, margin: bestVal, move: best };
  }

  // ---- lookahead ------------------------------------------------------------
  // A sampled one-ply reply: for the top candidates by equity, draw a few
  // opponent racks from the unseen tiles (bag plus their rack, which the bot
  // is not allowed to peek at), find their best reply on the resulting board
  // and charge the candidate the average. Off by default: in self-play
  // (tools/scrabble-mod-lab.mjs) it scored 48-49% against plain equity at
  // 5x5 and 6x12 samples, i.e. no gain for a lot of work. Kept for
  // experiments with deeper simulation.
  function lookahead(state, cands, dict, rnd, samples, weight) {
    const p = state.turn;
    const unseen = state.bag.concat(state.racks[1 - p]);
    const n = Math.min(RACK, unseen.length);
    const racks = [];
    for (let k = 0; k < samples; k++) racks.push(shuffle(unseen.slice(), rnd).slice(0, n));
    let best = null, bestVal = -Infinity;
    for (const m of cands) {
      const after = apply(state, { t: 'play', tiles: m.tiles }, null);
      let reply = 0;
      for (const r of racks) { const top = generate(after.board, r, dict)[0]; if (top) reply += top.score; }
      m.reply = Math.round(reply / racks.length * 10) / 10;
      m.value = Math.round((m.equity - weight * m.reply) * 10) / 10;
      if (m.value > bestVal) { bestVal = m.value; best = m; }
    }
    return best;
  }

  // ---- the bot ------------------------------------------------------------
  // hard takes the play with the best equity; medium takes one of the next
  // few; easy plays a middling one by score. With nothing to play it swaps the
  // rack while the bag allows.
  function botMove(state, level, rnd, dict, opts) {
    const p = state.turn, rack = state.racks[p];
    if (!rack.length) return { t: 'pass' };
    if (level === 'hard' && state.bag.length === 0 && !(opts && opts.noEndgame)) {
      const e = endgameMove(state, dict);
      if (e) return e.move;
    }
    const moves = level === 'easy' ? generate(state.board, rack, dict) : rank(generate(state.board, rack, dict), rack, state.bag.length === 0);
    if (!moves.length) {
      if (state.bag.length >= rack.length) return { t: 'swap', tiles: rack.slice() };
      if (state.bag.length > 0) return { t: 'swap', tiles: rack.slice(0, state.bag.length) };
      return { t: 'pass' };
    }
    let pool;
    if (level === 'hard' && opts && opts.sim && moves.length > 1 && state.bag.length > 0) {
      const top = moves.slice(0, opts.sim.cands || 5);
      const m = lookahead(state, top, dict, rnd, opts.sim.samples || 5, opts.sim.weight || 1);
      return { t: 'play', tiles: m.tiles };
    }
    if (level === 'hard') pool = moves.slice(0, 1);
    else if (level === 'medium') pool = moves.slice(Math.min(2, moves.length - 1), Math.min(10, moves.length));
    else pool = moves.slice(Math.floor(moves.length * 0.35), Math.max(Math.floor(moves.length * 0.35) + 1, Math.floor(moves.length * 0.75)));
    const pick = pool[Math.floor(rnd() * pool.length)] || moves[moves.length - 1];
    return { t: 'play', tiles: pick.tiles };
  }

  return { N, CENTER, RACK, BINGO, VERSION, PASS_LIMIT, LAYOUT, LM, WM, TILES, VALUE, bonusAt, tileValue, seededRandom,
           newGame, analyze, check, apply, replay, positions, options, winner, buildDict, generate, rank, leaveValue, leaveFeatures, LEAVE, LEAVE2, LEAVE_TUNE, pairKey, endgameMove, lookahead, botMove, transpose };
});
