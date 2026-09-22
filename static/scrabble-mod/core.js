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
    if (!Number.isInteger(seed)) throw new Error('bad seed');
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
    if (!Array.isArray(tiles)) return bad('Not a play.');
    for (const t of tiles) {
      if (!t || typeof t !== 'object') return bad('Not a play.');
      if (!(Number.isInteger(t.r) && Number.isInteger(t.c) && t.r >= 0 && t.r < N && t.c >= 0 && t.c < N)) return bad('That square is off the board.');
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
      if (!Array.isArray(move.tiles) || !move.tiles.length || move.tiles.some((t) => typeof t !== 'string')) return bad('Pick the tiles to swap.');
      if (move.tiles.length > state.bag.length) return bad('The bag only has ' + state.bag.length + ' tiles left.');
      if (!hasTiles(rack, move.tiles)) return bad('Those tiles are not on your rack.');
      return { ok: true };
    }
    if (move.t === 'play') {
      if (!Array.isArray(move.tiles) || move.tiles.some((t) => !t || typeof t !== 'object')) return bad('Not a move.');
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
    const take = (tile) => { const i = rack.indexOf(tile); if (i < 0) throw new Error('Tile not on the rack.'); rack.splice(i, 1); };
    let kept;   // the record's own copy of the move: the caller's object is not shared with the state
    if (move.t === 'play') {
      kept = { t: 'play', tiles: move.tiles.map((t) => ({ r: t.r, c: t.c, l: t.l, b: !!t.b })) };
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
    s.moves.push(kept || (move.t === 'swap' ? { t: 'swap', tiles: move.tiles.slice() } : { t: move.t }));
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
  // mustPass is kept for safety only: a rack empties during the final turns, and the game ends before that player moves again.
  function options(state) {
    const rack = state.racks[state.turn];
    return { play: !state.over && rack.length > 0, swap: !state.over && rack.length > 0 && state.bag.length > 0, pass: !state.over, mustPass: !state.over && rack.length === 0 };
  }

  // ---- packing for the server ------------------------------------------------
  // What the online store holds is a seed and a move list, from which both
  // racks follow. They are scrambled with a key derived from the game id and
  // base64'd before they leave the page: not secret, just not readable at a
  // glance in the database. Works in Node and the browser.
  function packKey(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const rnd = seededRandom(h || 1), k = new Uint8Array(32);
    for (let i = 0; i < k.length; i++) k[i] = Math.floor(rnd() * 256);
    return k;
  }
  function pack(id, value) {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('nothing to pack');
    const bytes = new TextEncoder().encode(json), k = packKey(String(id));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ k[i % k.length]);
    return btoa(bin);
  }
  function unpack(id, str) {
    const bin = atob(str), k = packKey(String(id)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ k[i % k.length];
    return JSON.parse(new TextDecoder().decode(bytes));
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
  // Fitted to leave values that MAGPIE's leavegen produced for this exact
  // board, tile set and word list (three generations, 2 million self-play
  // games, regenerated after the NWL short words such as QI and ZA joined
  // the list, which took the Q from -10 to -7 kept), by least squares over
  // singles, pairs and skew: tools/scrabble-mod-lab.mjs fitklv, output in
  // tools/leaves-gen3.json. Against the hand-written table the first such
  // fit won a 600-game arena 55.3%; this one beats the previous fit 51.6%
  // over 1,000 games and agrees with MAGPIE's own ranking on the top play
  // about 85% of the time. Duplicates are handled by the pair terms.
  const LEAVE = { '?': 21, A: -0.7, B: -0.5, C: -0.8, D: -1, E: 0.5, F: -3, G: 0.2, H: -2.6, I: -2.1, J: 3, K: 2.4, L: 0.5, M: -0.9, N: -1.2, O: -2.5, P: -1.6, Q: -7.4, R: -0.4, S: 5.2, T: -1.8, U: -2.5, V: -2.2, W: -0.5, X: 2.3, Y: -0.4, Z: 5.4 };
  const LEAVE_TUNE = { dup: 0, blankDup: 0, skew: -0.1 };
  // Pair synergies, keyed by the two tiles in order ('?' first, then A-Z):
  // what holding both is worth beyond the two singles (QU is the classic;
  // doubled letters are the big negatives).
  const LEAVE2 = {
    '??': -4.2, '?A': 0.9, '?B': -0.7, '?D': -0.5, '?E': 1.2, '?F': -1.2, '?G': -0.4, '?H': -0.7, '?I': 1.1,
    '?J': -1.6, '?K': -0.9, '?L': 0.4, '?M': -0.7, '?O': 0.7, '?P': -0.8, '?Q': -1.9, '?V': -1.9, '?W': -1.6,
    '?X': -2.1, '?Y': -0.8, '?Z': -0.9, 'AA': -5.2, 'AB': 1.5, 'AC': 1.3, 'AD': 1.1, 'AE': -0.8, 'AF': 0.7,
    'AG': 1.4, 'AH': 1.1, 'AI': -1, 'AJ': 2.2, 'AK': 1.4, 'AL': 1.7, 'AM': 1.8, 'AN': 1.3, 'AO': -1.8, 'AP': 1.1,
    'AQ': 2, 'AR': 1.5, 'AS': 1.1, 'AT': 1.3, 'AU': -1, 'AV': 1.9, 'AW': 1.4, 'AX': 1.7, 'AZ': 2.2, 'BB': -2.9,
    'BC': -1.4, 'BD': -1.1, 'BE': 1, 'BF': -1.4, 'BG': -1.4, 'BH': -1.1, 'BI': 0.9, 'BK': -0.6, 'BM': -0.7,
    'BN': -1.2, 'BO': 1.9, 'BP': -2.5, 'BQ': -1.1, 'BS': -0.8, 'BT': -1.1, 'BU': 1.7, 'BV': -2, 'BW': -1.1,
    'BX': -1.1, 'BY': 0.6, 'BZ': -0.9, 'CC': -5.8, 'CD': -1.3, 'CE': 0.6, 'CF': -1.2, 'CG': -2.6, 'CH': 1.8,
    'CI': 1.3, 'CJ': -2, 'CK': 2.3, 'CL': -0.6, 'CM': -1, 'CN': -0.8, 'CO': 1.4, 'CP': -1, 'CQ': -1.8,
    'CR': -0.5, 'CS': -0.9, 'CT': -0.7, 'CU': 0.9, 'CV': -1.4, 'CW': -1.6, 'CX': -1.3, 'CZ': -1.7, 'DD': -4.2,
    'DE': 2.6, 'DF': -0.9, 'DG': -1.1, 'DH': -0.9, 'DI': 1.3, 'DJ': -1, 'DK': -1.3, 'DL': -1.1, 'DM': -1.3,
    'DN': -0.8, 'DO': 1.3, 'DP': -1.3, 'DQ': -0.8, 'DR': -0.9, 'DS': -1.4, 'DT': -1.6, 'DU': 0.9, 'DV': -1.1,
    'DW': -0.3, 'DX': -1.2, 'DZ': -1.2, 'EE': -4.6, 'EF': 0.6, 'EG': 0.5, 'EH': 0.4, 'EI': -0.6, 'EJ': 1.3,
    'EK': 1.1, 'EL': 1.4, 'EM': 0.7, 'EN': 0.9, 'EO': -1, 'EP': 0.9, 'EQ': -0.7, 'ER': 2.3, 'ES': 1.5, 'ET': 1.3,
    'EU': -0.8, 'EV': 2.1, 'EW': 0.9, 'EX': 1.8, 'EY': -0.5, 'EZ': 1.7, 'FF': 1.5, 'FG': -1, 'FH': -0.8,
    'FI': 1.4, 'FJ': -1, 'FK': -1, 'FL': 0.3, 'FM': -1.4, 'FN': -1.2, 'FO': 1, 'FP': -1.8, 'FQ': -0.5,
    'FS': -0.9, 'FT': -0.4, 'FU': 1.6, 'FV': -1.7, 'FW': -0.6, 'FY': 0.3, 'FZ': -0.3, 'GG': -3.2, 'GH': -0.4,
    'GI': 1.8, 'GJ': -0.6, 'GK': -2.2, 'GL': -0.6, 'GM': -1.1, 'GN': 1.3, 'GO': 1.2, 'GP': -1.5, 'GQ': -1.6,
    'GR': -0.6, 'GS': -1, 'GT': -1.5, 'GU': 1.5, 'GV': -1.1, 'GW': -0.9, 'GX': -2.1, 'GY': 0.8, 'GZ': -1.3,
    'HH': -4.5, 'HI': 0.3, 'HJ': -0.8, 'HK': -0.4, 'HL': -1.1, 'HN': -0.9, 'HO': 0.9, 'HP': 0.4, 'HQ': -0.4,
    'HR': -0.9, 'HT': 0.5, 'HU': 0.4, 'HV': -1.3, 'HW': 1.2, 'HX': -1, 'HY': 0.4, 'HZ': -0.9, 'II': -6,
    'IJ': 0.6, 'IK': 1, 'IL': 1.3, 'IM': 1.5, 'IN': 2.6, 'IO': -1.4, 'IP': 1.1, 'IQ': 2.6, 'IR': 0.7, 'IS': 1.4,
    'IT': 1.3, 'IU': -1.9, 'IV': 2.2, 'IX': 1.8, 'IY': -0.9, 'IZ': 2, 'JL': -1.5, 'JM': -0.8, 'JN': -0.5,
    'JO': 2.1, 'JP': -1.2, 'JQ': -0.9, 'JR': -1.6, 'JS': -1, 'JT': -0.8, 'JU': 2.5, 'JV': -1.3, 'JW': -0.4,
    'JX': -1, 'JZ': -2, 'KL': -0.8, 'KM': -1.5, 'KO': 1.2, 'KP': -0.8, 'KQ': -0.6, 'KR': -0.6, 'KT': -1.6,
    'KU': 0.9, 'KV': -2, 'KX': -1.9, 'KY': 0.6, 'KZ': -1.6, 'LL': -4.6, 'LM': -1.1, 'LN': -1.7, 'LO': 1.1,
    'LP': -0.5, 'LQ': -1.8, 'LR': -2, 'LS': -0.7, 'LT': -1.1, 'LU': 1.2, 'LV': -0.7, 'LW': -0.4, 'LX': -0.9,
    'LY': 1.5, 'LZ': -1.6, 'MM': -3.8, 'MN': -1.1, 'MO': 1.5, 'MP': -0.4, 'MQ': -1.6, 'MR': -0.7, 'MS': -0.5,
    'MT': -1.2, 'MU': 1.5, 'MV': -1.8, 'MW': -1.1, 'MX': -0.6, 'MY': 0.8, 'MZ': -1.2, 'NN': -4.9, 'NO': 1.2,
    'NP': -1.2, 'NQ': -1.5, 'NR': -1.5, 'NS': -0.9, 'NT': -0.7, 'NU': 0.8, 'NV': -1.2, 'NW': -0.3, 'NX': -1,
    'NY': 0.3, 'NZ': -1, 'OO': -4, 'OP': 1.3, 'OR': 1.1, 'OS': 1, 'OT': 1, 'OU': -1.1, 'OV': 1, 'OW': 1.9,
    'OX': 2, 'OY': 0.6, 'OZ': 2.2, 'PP': -3.6, 'PQ': -0.6, 'PT': -0.7, 'PU': 1.1, 'PV': -1.9, 'PW': -1,
    'PX': -0.3, 'PY': 1.3, 'PZ': -1, 'QR': -1.5, 'QS': -1.1, 'QU': 9.5, 'QV': -0.8, 'QW': -0.3, 'QX': -0.4,
    'QZ': -0.4, 'RR': -5.4, 'RS': -0.6, 'RT': -0.3, 'RU': 0.7, 'RV': -0.4, 'RW': -0.3, 'RX': -1.8, 'RY': 0.3,
    'RZ': -1.1, 'SS': -5.8, 'SU': 1.2, 'SV': -1.2, 'SW': -0.5, 'SX': -1.8, 'SY': -0.6, 'SZ': -1.8, 'TT': -4.2,
    'TU': 1.1, 'TV': -1.4, 'TW': -0.8, 'TX': -0.7, 'TZ': -1, 'UU': -7.1, 'UW': -1.5, 'UX': 0.7, 'UY': -0.6,
    'VV': -3.7, 'VW': -0.8, 'VX': -0.5, 'VY': 0.4, 'VZ': -2.3, 'WW': -5.1, 'WX': -1.2, 'WY': 0.7, 'WZ': -1.4,
    'XY': 0.6, 'XZ': -1.7, 'YY': -6.6
  };
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
    // the fit never saw three blanks in one leave (the pair terms cover two): a third is priced as
    // two points on top of the two-blank leave, less than an S, so a bingo in hand is played now
    let nb = 0;
    for (const t of tiles) if (t === '?') nb++;
    if (nb > 2) { let drop = nb - 2; return leaveValue(tiles.filter((t) => t !== '?' || drop-- <= 0)) + 2 * (nb - 2); }
    const f = leaveFeatures(tiles);
    let v = 0;
    for (const t in f.counts) v += LEAVE[t] * f.counts[t];
    for (const k of f.pairs) v += LEAVE2[k] || 0;
    v += LEAVE_TUNE.dup * f.dup + LEAVE_TUNE.blankDup * f.blankDup + LEAVE_TUNE.skew * f.skew;
    return Math.round(v * 10) / 10;
  }
  function leaveAfter(rack, tiles) {
    const left = rack.slice();
    for (const t of tiles) { const i = left.indexOf(t.b ? '?' : t.l); if (i >= 0) left.splice(i, 1); }
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

  // ---- exchanging ------------------------------------------------------------
  // The best exchange on offer: the tiles to give back whose kept tiles are
  // worth the most next turn. Shaped like a generated play so it can sit in
  // the same ranked list (score 0, equity = the leave). Null with an empty bag.
  function bestExchange(rack, bagLen) {
    if (!bagLen || !rack.length) return null;
    let best = null;
    for (let m = 1; m < (1 << rack.length); m++) {
      const swap = [], kept = [];
      for (let i = 0; i < rack.length; i++) (m & (1 << i) ? swap : kept).push(rack[i]);
      if (swap.length > bagLen) continue;
      const v = leaveValue(kept);
      if (!best || v > best.equity) best = { t: 'swap', tiles: swap, keeps: kept.join(''), word: 'Exchange ' + swap.join(''), score: 0, leave: v, equity: v, words: [] };
    }
    return best;
  }

  // ---- rating a turn ------------------------------------------------------------
  // Everything a review says about one turn: the plays that were available
  // before it (ranked by equity), which of them use only common words, the
  // best exchange, the yardstick (best common play or the exchange), the
  // expert play a rare word would have given, and the played move's rating:
  // the yardstick is 100, everything else its share, a rare word that beats
  // it rates above 100. `common` may be null, in which case every word counts
  // as common.
  function evaluateTurn(before, move, h, dict, common) {
    const p = before.turn, rack = before.racks[p];
    const bagEmpty = before.bag.length === 0;
    // in the last turns the opponent's rack is known, so a play is worth its
    // score minus their best reply (what the bot's endgame search uses too)
    const endgame = bagEmpty && before.finalTurns === 2 && before.racks[1 - p].length > 0;
    let list = rank(generate(before.board, rack, dict), rack, bagEmpty);
    const isCommon = (m) => !common || m.words.every((w) => common.has(w.word));
    for (const m of list) m.common = isCommon(m);
    const key = (tiles) => tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
    const pk = move.t === 'play' ? key(move.tiles) : null;
    if (endgame) {
      // search the top plays by score, the top common ones, and whatever was played; the rest are left out
      const opp = before.racks[1 - p];
      const margin = (m) => { const after = apply(before, { t: 'play', tiles: m.tiles }, null); const reply = generate(after.board, opp, dict)[0]; return m.score - (reply ? reply.score : 0); };
      const examined = new Set(list.slice(0, 40));
      for (const m of list.filter((m) => m.common).slice(0, 40)) examined.add(m);
      const playedMove = pk && list.find((m) => key(m.tiles) === pk);
      if (playedMove) examined.add(playedMove);
      for (const m of examined) { m.equity = margin(m); m.reply = m.score - m.equity; }
      list = [...examined].sort((a, b) => b.equity - a.equity || b.score - a.score);
    }
    const exch = bestExchange(rack, before.bag.length);
    const commonList = list.filter((m) => m.common);
    const replyNow = endgame ? (generate(before.board, before.racks[1 - p], dict)[0] || { score: 0 }).score : 0;
    let played = null, playedEquity = 0, playedLabel = h.t, playedSwap = false;
    if (move.t === 'play') {
      played = list.findIndex((m) => key(m.tiles) === pk);
      if (played >= 0) playedEquity = list[played].equity;
      else {   // not in the generated list (a word since dropped from the list): rate it like any other play
        const kept = rack.slice();
        for (const t of move.tiles) { const i = kept.indexOf(t.b ? '?' : t.l); if (i >= 0) kept.splice(i, 1); }
        if (endgame) { const after = apply(before, move, null); const reply = generate(after.board, before.racks[1 - p], dict)[0]; playedEquity = h.score - (reply ? reply.score : 0); }
        else playedEquity = h.score + (bagEmpty ? 0 : leaveValue(kept));
      }
      playedLabel = h.word + ' for ' + h.score;
    } else if (move.t === 'swap') {
      const kept = rack.slice();
      for (const t of move.tiles) { const i = kept.indexOf(t); if (i >= 0) kept.splice(i, 1); }
      playedEquity = bagEmpty ? 0 : leaveValue(kept);
      playedLabel = 'exchanged ' + move.tiles.join('') + ', kept ' + (kept.join('') || 'nothing');
      playedSwap = true;
    } else if (move.t === 'pass') {
      playedEquity = endgame ? -replyNow : bagEmpty ? 0 : leaveValue(rack);
      playedLabel = 'passed';
    }
    let ref = commonList[0] || null;
    // the exchange is the yardstick only when it clearly beats playing, the bot's own rule
    if (exch && (!ref || exch.equity > ref.equity + 1)) ref = exch;
    // nothing common and nothing to exchange: the best play there is stands in, so a pass cannot rate as best
    if (!ref && list[0]) ref = list[0];
    if (endgame && (!ref || -replyNow > ref.equity)) ref = { t: 'pass', word: 'Pass', score: 0, equity: -replyNow, reply: replyNow, common: true, words: [], tiles: [] };
    // the expert play: a rare-word play better than the yardstick, unless the player found it themselves
    const expert = list[0] && !list[0].common && played !== 0 && (!ref || list[0].equity > ref.equity + 0.5) ? list[0] : null;
    // ratings: the yardstick is 100 and every point of equity above or below it is worth three,
    // so ten points behind rates 70 and a third of the board's value behind rates 0
    const rate = (eq) => !ref ? 100 : Math.max(0, Math.round(100 + 3 * (eq - ref.equity)));
    for (const m of list) m.rating = rate(m.equity);
    if (exch) exch.rating = rate(exch.equity);
    const rating = rate(playedEquity);
    // a brilliancy is a rare word that beats every common play by five points or more
    const brilliant = ref && played !== null && played >= 0 && !list[played].common && rating >= 115;
    return { list, commonList, exch, played, playedEquity, playedLabel, playedSwap, ref, expert, endgame, rating, grade: !ref ? 'best' : brilliant ? 'brilliant' : rating >= 99 ? 'best' : rating < 75 ? 'miss' : 'ok' };
  }
  // The outcome of a finished game for the results table: scores, winner and
  // each seat's plays, points, bingos, best word and brilliancies. `step` is
  // called between turns when given, so a page can spread the work out.
  function computeResult(state, dict, common, step) {
    const positions_ = positions(state.seed, state.moves);
    const stats = { p0: { plays: 0, points: 0, bingos: 0, brilliancies: 0, best_word: null, best_score: 0 }, p1: { plays: 0, points: 0, bingos: 0, brilliancies: 0, best_word: null, best_score: 0 } };
    const turn = (i) => {
      const m = state.moves[i], before = positions_[i], h = state.history[i], st = stats['p' + before.turn];
      if (m.t !== 'play') return;
      st.plays++; st.points += h.score;
      if (h.bingo) st.bingos++;
      if (h.score > st.best_score) { st.best_score = h.score; st.best_word = h.word; }
      if (dict && evaluateTurn(before, m, h, dict, common).grade === 'brilliant') st.brilliancies++;
    };
    const result = () => ({ moves: state.moves.length, p0_score: state.scores[0], p1_score: state.scores[1], winner: winner(state), end_reason: state.endReason, stats });
    if (!step) { for (let i = 0; i < state.moves.length; i++) turn(i); return result(); }
    return new Promise((resolve, reject) => {
      let i = 0;
      const go = () => {
        try {
          const t0 = Date.now();
          while (i < state.moves.length && Date.now() - t0 < 30) turn(i++);
          if (i < state.moves.length) step(go); else resolve(result());
        } catch (e) { reject(e); }
      };
      go();
    });
  }

  // ---- the bot ------------------------------------------------------------
  // hard takes the play with the best equity from the whole word list;
  // medium one of the next few by equity, easy one of the eleventh to
  // thirtieth by score, both from opts.vocab when given (a smaller list of
  // common words). Against hard in self-play that is roughly 430, 260 and
  // 190 points a game. Any level exchanges instead when the kept rack is
  // worth more than the best play.
  const EASY_POOL = [10, 30];   // easy picks among these ranks by score (0-based, end exclusive)
  function botMove(state, level, rnd, dict, opts) {
    const p = state.turn, rack = state.racks[p];
    if (!rack.length) return { t: 'pass' };
    if (level === 'hard' && state.bag.length === 0 && !(opts && opts.noEndgame)) {
      const e = endgameMove(state, dict);
      if (e) return e.move;
    }
    const vocab = (opts && opts.vocab && level !== 'hard') ? opts.vocab : dict;
    const byScore = generate(state.board, rack, vocab);
    const moves = rank(byScore.slice(), rack, state.bag.length === 0);
    const exch = bestExchange(rack, state.bag.length);
    // an exchange has to be clearly better than playing; ties go to the board
    if (exch && (!moves.length || exch.equity > moves[0].equity + 1)) return { t: 'swap', tiles: exch.tiles };
    if (!moves.length) return { t: 'pass' };
    let pool;
    if (level === 'hard' && opts && opts.sim && moves.length > 1 && state.bag.length > 0) {
      const top = moves.slice(0, opts.sim.cands || 5);
      const m = lookahead(state, top, dict, rnd, opts.sim.samples || 5, opts.sim.weight || 1);
      return { t: 'play', tiles: m.tiles };
    }
    if (level === 'hard') pool = moves.slice(0, 1);
    else if (level === 'medium') pool = moves.slice(Math.min(2, moves.length - 1), Math.min(10, moves.length));
    else { const [lo, hi] = (opts && opts.easyPool) || EASY_POOL; pool = byScore.slice(Math.min(lo, byScore.length - 1), Math.min(hi, byScore.length)); }   // a casual play, by score alone
    const pick = pool[Math.floor(rnd() * pool.length)] || moves[moves.length - 1];
    return { t: 'play', tiles: pick.tiles };
  }

  return { N, CENTER, RACK, BINGO, VERSION, PASS_LIMIT, LAYOUT, LM, WM, TILES, VALUE, bonusAt, tileValue, seededRandom,
           newGame, analyze, check, apply, replay, positions, options, winner, buildDict, generate, rank, leaveValue, leaveFeatures, LEAVE, LEAVE2, LEAVE_TUNE, pairKey, bestExchange, evaluateTurn, computeResult, endgameMove, lookahead, botMove, transpose, pack, unpack };
});
