/* Crux core: the wall generator, the plan evaluator and the solver, with no
   DOM in them, so the page, the tests and the seed search all run the same
   code. A wall is a grid of holds; a plan is a list of beats; everything a
   plan does is decided before the climber moves. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CruxCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 12, ROWS = 16;           // row 0 holds the anchors, row 15 is the ground
  const STAMINA = 100;

  // Hold types. base: cost to move onto it. hang: cost per beat of waiting on
  // it (negative recovers). Crumble can't be waited on and is gone once left.
  const HOLDS = {
    j: { name: 'jug',     base: 3,  hang: 2 },
    c: { name: 'crimp',   base: 8,  hang: 5 },
    l: { name: 'ledge',   base: 2,  hang: -12 },
    p: { name: 'pocket',  base: 5,  hang: 2, shelter: true },
    x: { name: 'crumble', base: 4,  hang: null },
    F: { name: 'anchor',  base: 3,  hang: 0 },
    G: { name: 'ground',  base: 0,  hang: -20 }
  };
  const UP_COST = 3;        // any static move that gains a row
  const DYNO_COST = 20;     // on top of the destination's base cost

  function seededRandom(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const mod = (a, n) => ((a % n) + n) % n;

  function cellAt(level, c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '.';
    return level.cells[r * COLS + c];
  }
  function rockAt(chute, beat) { return beat > 0 && mod(beat - chute.offset, chute.period) === 0; }
  function gustAt(band, beat) { return beat > 0 && mod(beat - band.offset, band.period) < band.dur; }
  function inBand(band, r) { return r >= band.r0 && r <= band.r1; }

  // Every cell one beat can reach from (c, r): static moves to the eight
  // neighbours, dynos to the ring two cells out (never downward).
  function movesFrom(level, c, r) {
    const out = [];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dc && !dr) continue;
      const cc = c + dc, rr = r + dr;
      const cell = cellAt(level, cc, rr);
      if (cell === '.') continue;
      const dist = Math.max(Math.abs(dc), Math.abs(dr));
      if (dist === 1) out.push({ t: 'm', c: cc, r: rr });
      else if (dr <= 0 && cell !== 'G') out.push({ t: 'd', c: cc, r: rr });
    }
    return out;
  }

  // Walks a plan beat by beat. Never throws on a bad plan: the first illegal
  // or fatal step is reported and the walk stops there.
  // plan: [{t:'s',c,r}, {t:'m'|'d'|'w', c, r}, ...]
  function evaluate(level, plan) {
    const steps = [];
    const gone = new Set();     // crumble holds already used
    let c = -1, r = -1, stamina = STAMINA, fatal = null, done = false;
    for (let i = 0; i < plan.length && !fatal && !done; i++) {
      const st = plan[i], beat = i;
      const rec = { beat, t: st.t, c: st.c, r: st.r, cost: 0, stamina, note: '' };
      if (i === 0) {
        if (st.t !== 's' || cellAt(level, st.c, st.r) !== 'G') fatal = { index: i, reason: 'start', text: 'a route starts on the ground' };
        else { c = st.c; r = st.r; }
      } else if (st.t === 'w') {
        const cell = cellAt(level, c, r);
        if (cell === 'x') fatal = { index: i, reason: 'crumble', text: 'the hold crumbled under you' };
        else rec.cost = HOLDS[cell].hang;
      } else if (st.t === 'm' || st.t === 'd') {
        const cell = cellAt(level, st.c, st.r);
        const dc = st.c - c, dr = st.r - r, dist = Math.max(Math.abs(dc), Math.abs(dr));
        const key = st.c + ',' + st.r;
        if (cell === '.' || gone.has(key)) fatal = { index: i, reason: 'nohold', text: 'there is no hold there' };
        else if (st.t === 'm' && dist !== 1) fatal = { index: i, reason: 'reach', text: 'out of reach for a static move' };
        else if (st.t === 'd' && (dist !== 2 || dr > 0 || cell === 'G')) fatal = { index: i, reason: 'reach', text: 'not a dyno target' };
        else {
          rec.cost = HOLDS[cell].base + (st.t === 'd' ? DYNO_COST : (dr < 0 ? UP_COST : 0));
          if (st.t === 'd') {
            for (const band of level.winds) if (gustAt(band, beat) && (inBand(band, r) || inBand(band, st.r))) {
              fatal = { index: i, reason: 'gust', text: 'blown off mid-dyno by a gust' }; break;
            }
          }
          if (!fatal) {
            if (cellAt(level, c, r) === 'x') gone.add(c + ',' + r);
            c = st.c; r = st.r;
          }
        }
      } else fatal = { index: i, reason: 'bad', text: 'not a move' };
      if (!fatal) {
        stamina = Math.min(STAMINA, stamina - rec.cost);
        if (stamina < 0) { stamina = 0; fatal = { index: i, reason: 'pumped', text: 'out of stamina' }; }
      }
      if (!fatal && i > 0) {
        const cell = cellAt(level, c, r);
        if (cell !== 'G' && cell !== 'p') for (const ch of level.chutes) if (ch.c === c && rockAt(ch, beat)) {
          fatal = { index: i, reason: 'rock', text: 'hit by rockfall in column ' + (c + 1) }; break;
        }
      }
      rec.c = c; rec.r = r; rec.stamina = stamina;
      if (fatal) { rec.fatal = fatal.reason; rec.note = fatal.text; }
      steps.push(rec);
      if (!fatal && cellAt(level, c, r) === 'F') done = true;
    }
    return { steps, ok: done, fatal, beats: done ? steps.length - 1 : null, stamina, c, r };
  }

  // Earliest-beat search. A state is (cell, beat); keeping only the most
  // stamina seen per cell per beat is safe because more stamina never closes
  // a door. Crumble holds are treated as ordinary holds you can't rest on, so
  // par can be optimistic by a beat on the rare wall where a route would
  // want one twice.
  function solve(level, maxBeats, opts) {
    maxBeats = maxBeats || 48; opts = opts || {};
    let front = new Map(); // key c,r -> { stamina, prev, step }
    for (let c = 0; c < COLS; c++) if (cellAt(level, c, ROWS - 1) === 'G') front.set(c + ',' + (ROWS - 1), { stamina: STAMINA, prev: null, step: { t: 's', c, r: ROWS - 1 } });
    const layers = [front];
    for (let beat = 1; beat <= maxBeats; beat++) {
      const next = new Map();
      const consider = (key, stamina, prev, step) => {
        const cur = next.get(key);
        if (!cur || cur.stamina < stamina) next.set(key, { stamina, prev, step });
      };
      for (const [key, node] of front) {
        const [c, r] = key.split(',').map(Number);
        const cell = cellAt(level, c, r);
        // wait
        if (HOLDS[cell].hang !== null) {
          const s = Math.min(STAMINA, node.stamina - HOLDS[cell].hang);
          if (s >= 0 && safeAfter(level, c, r, beat)) consider(key, s, node, { t: 'w', c, r });
        }
        for (const mv of movesFrom(level, c, r)) {
          if (opts.noDyno && mv.t === 'd') continue;
          const dest = cellAt(level, mv.c, mv.r);
          let cost = HOLDS[dest].base + (mv.t === 'd' ? DYNO_COST : (mv.r < r ? UP_COST : 0));
          if (mv.t === 'd') {
            let blown = false;
            for (const band of level.winds) if (gustAt(band, beat) && (inBand(band, r) || inBand(band, mv.r))) blown = true;
            if (blown) continue;
          }
          const s = Math.min(STAMINA, node.stamina - cost);
          if (s < 0) continue;
          if (!safeAfter(level, mv.c, mv.r, beat)) continue;
          consider(mv.c + ',' + mv.r, s, node, mv);
        }
      }
      layers.push(next);
      // any anchor reached this beat is a shortest route
      let best = null;
      for (const [key, node] of next) {
        const [c, r] = key.split(',').map(Number);
        if (cellAt(level, c, r) === 'F' && (!best || node.stamina > best.stamina)) best = node;
      }
      if (best) {
        const plan = [];
        for (let n = best; n; n = n.prev) plan.unshift(n.step);
        return { par: beat, plan, stamina: best.stamina };
      }
      if (!next.size) return null;
      front = next;
    }
    return null;
  }
  function safeAfter(level, c, r, beat) {
    const cell = cellAt(level, c, r);
    if (cell === 'G' || cell === 'p') return true;
    for (const ch of level.chutes) if (ch.c === c && rockAt(ch, beat)) return false;
    return true;
  }

  // ---- generator ----------------------------------------------------------
  // Tiers add one idea at a time: 1 slab (stamina only), 2 a rock chute,
  // 3 a wind band across a gap that needs dynos, 4 crumbling shortcuts and
  // long runs between rests, 5 all of it on a sparser wall.
  const TIERS = {
    1: { crimp: 0.15, extra: 0.22, ledges: 2, chutes: 0, wind: false, crumble: 0, dynoGaps: 0 },
    2: { crimp: 0.25, extra: 0.18, ledges: 2, chutes: 1, wind: false, crumble: 0, dynoGaps: 0 },
    3: { crimp: 0.30, extra: 0.16, ledges: 2, chutes: 1, wind: true, crumble: 0, dynoGaps: 1 },
    4: { crimp: 0.40, extra: 0.14, ledges: 1, chutes: 1, wind: true, crumble: 2, dynoGaps: 1 },
    5: { crimp: 0.45, extra: 0.10, ledges: 1, chutes: 2, wind: true, crumble: 2, dynoGaps: 2 }
  };

  function generate(seed, tier) {
    const P = TIERS[tier] || TIERS[3];
    const rnd = seededRandom(seed);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const cells = new Array(COLS * ROWS).fill('.');
    const set = (c, r, v) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) cells[r * COLS + c] = v; };
    const get = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? '.' : cells[r * COLS + c];
    for (let c = 0; c < COLS; c++) set(c, ROWS - 1, 'G');
    const anchors = [];
    const a1 = 1 + Math.floor(rnd() * (COLS - 2)); anchors.push(a1);
    let a2 = 1 + Math.floor(rnd() * (COLS - 2)); if (Math.abs(a2 - a1) < 3) a2 = (a1 + 5) % (COLS - 2) + 1; anchors.push(a2);
    for (const a of anchors) set(a, 0, 'F');

    // the spine: a walk from the ground to an anchor with a few forced dynos
    const holdType = () => (rnd() < P.crimp ? 'c' : 'j');
    const spine = [];
    let c = Math.max(1, Math.min(COLS - 2, anchors[0] + Math.round((rnd() - 0.5) * 8)));
    let r = ROWS - 1;
    const gapRows = new Set();
    for (let g = 0; g < P.dynoGaps; g++) gapRows.add(5 + Math.floor(rnd() * 6));
    while (r > 1) {
      let dr = -1, dc = rnd() < 0.3 ? 0 : (rnd() < 0.5 ? -1 : 1);
      if (gapRows.has(r) && r > 3) dr = -2;                   // a gap only a dyno crosses
      else if (rnd() < 0.18) dr = 0;                          // a traverse
      if (dr === 0 && dc === 0) dc = rnd() < 0.5 ? -1 : 1;
      c = Math.max(0, Math.min(COLS - 1, c + dc)); r += dr;
      if (r <= 1) break;
      if (get(c, r) === '.') set(c, r, holdType());
      spine.push([c, r]);
    }
    // join to the nearest anchor
    const target = anchors.reduce((a, b) => Math.abs(a - c) < Math.abs(b - c) ? a : b);
    while (Math.abs(c - target) > 1) { c += Math.sign(target - c); set(c, 1, holdType()); spine.push([c, 1]); }
    if (get(c, 1) === '.') { set(c, 1, holdType()); spine.push([c, 1]); }

    // a branch off the spine toward the other anchor
    const other = anchors.find((a) => a !== target);
    let bc = spine[Math.floor(spine.length * (0.3 + rnd() * 0.3))][0], br = spine[Math.floor(spine.length * (0.3 + rnd() * 0.3))][1];
    while (br > 1) { bc = Math.max(0, Math.min(COLS - 1, bc + Math.sign(other - bc) * (rnd() < 0.7 ? 1 : 0) + Math.round((rnd() - 0.5)))); br--; if (get(bc, br) === '.') set(bc, br, holdType()); }
    while (Math.abs(bc - other) > 1) { bc += Math.sign(other - bc); if (get(bc, 1) === '.') set(bc, 1, holdType()); }

    // ledges on the spine at spaced heights
    const ledgeRows = P.ledges === 2 ? [10, 5] : [8];
    for (const lr of ledgeRows) { const s = spine.find((p) => p[1] === lr) || spine.find((p) => p[1] === lr + 1); if (s) set(s[0], s[1], 'l'); }

    // sprinkle
    for (let rr = 1; rr < ROWS - 1; rr++) for (let cc = 0; cc < COLS; cc++) if (get(cc, rr) === '.' && rnd() < P.extra) set(cc, rr, holdType());

    // rock chutes cross the spine; a pocket on the spine inside each one
    const chutes = [], winds = [];
    const usedCols = new Set();
    for (let i = 0; i < P.chutes; i++) {
      const cands = spine.filter((p) => p[1] > 3 && p[1] < 12 && !usedCols.has(p[0]));
      if (!cands.length) break;
      const s = pick(cands); usedCols.add(s[0]);
      chutes.push({ c: s[0], period: 3 + Math.floor(rnd() * 3), offset: Math.floor(rnd() * 4) });
      set(s[0], s[1], 'p');
      const above = spine.find((p) => p[0] === s[0] && p[1] < s[1] - 2);
      if (above && rnd() < 0.5) set(above[0], above[1], 'p');
    }
    if (P.wind) {
      const gr = gapRows.size ? [...gapRows][0] : 6 + Math.floor(rnd() * 4);
      winds.push({ r0: Math.max(1, gr - 2), r1: Math.min(ROWS - 2, gr), period: 5 + Math.floor(rnd() * 3), offset: Math.floor(rnd() * 5), dur: 2 });
    }
    // crumbling holds: some of the sprinkled ones, never the spine
    if (P.crumble) {
      const spineKeys = new Set(spine.map((p) => p.join(',')));
      const cands = [];
      for (let rr = 2; rr < ROWS - 2; rr++) for (let cc = 0; cc < COLS; cc++) if ((get(cc, rr) === 'j' || get(cc, rr) === 'c') && !spineKeys.has(cc + ',' + rr)) cands.push([cc, rr]);
      for (let i = 0; i < P.crumble && cands.length; i++) { const k = Math.floor(rnd() * cands.length); const p = cands.splice(k, 1)[0]; set(p[0], p[1], 'x'); }
    }
    return { seed, tier, cols: COLS, rows: ROWS, cells, chutes, winds, anchors };
  }

  // How much a wall asks of the planner, for choosing seeds. A wall where
  // the best plan needs no wait and ignores every hazard is a ladder.
  function measure(level) {
    const sol = solve(level);
    if (!sol) return null;
    const noHaz = solve(Object.assign({}, level, { chutes: [], winds: [] }));
    const noChute = solve(Object.assign({}, level, { chutes: [] }));
    const noWind = solve(Object.assign({}, level, { winds: [] }));
    const stat = solve(level, 48, { noDyno: true });
    const waits = sol.plan.filter((s) => s.t === 'w').length;
    const dynos = sol.plan.filter((s) => s.t === 'd').length;
    let holds = 0; for (const ch of level.cells) if (ch !== '.' && ch !== 'G') holds++;
    return { par: sol.par, parNoHazard: noHaz ? noHaz.par : null, parStatic: stat ? stat.par : null, waits, dynos, stamina: sol.stamina, holds,
             hazardCost: noHaz ? sol.par - noHaz.par : null, chuteCost: noChute ? sol.par - noChute.par : null, windCost: noWind ? sol.par - noWind.par : null };
  }

  return { COLS, ROWS, STAMINA, HOLDS, UP_COST, DYNO_COST, TIERS, cellAt, rockAt, gustAt, inBand, movesFrom, evaluate, solve, generate, measure, seededRandom };
});
