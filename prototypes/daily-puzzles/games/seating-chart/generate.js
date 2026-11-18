// Seating Chart: a one-star Star Battle.
// An N×N grid is split into N connected tables (regions). Seat exactly one
// guest in every row, column and table, with no two guests touching, not
// even diagonally.
//
// Puzzle JSON:
//   size      N
//   regions   string of N*N letters, row by row; 'a' is table 0, 'b' table 1…
//   solution  array of N column indexes, the guest's column in each row
//   grade     { score, hardest, techniques, summary, tier }
//
// The grader is a step-by-step solver that only makes human-style deductions
// and always takes the easiest one available. Tiers, easiest first:
//   1  last open cell          a row, column or table with one open cell
//                               (a seated guest rules out its row, column,
//                               table and neighbours as part of every step)
//   2  confined to a line      a table's open cells lie in one row or column,
//                               or a line's open cells lie in one table
//      blocking cell           a guest here would rule out every open cell
//                               of some other row, column or table
//   3  k tables in k lines     k tables fit inside k rows (or columns), or
//                               k lines fit inside k tables, for k = 2 or 3
//   4  what-if chain           seat a guest here, follow last-cell and
//                               confined steps, and some line or table runs
//                               out of room
// Each step adds its weight to the score: last cell 1, confined 3, blocking 4,
// k tables in k lines 5+3k, what-if chain 20+5×(chain length).
// A puzzle is accepted for a day only when the grader finishes it using the
// tiers that day allows, and its score lands in the day's band.
//
// hint(puzzle, marks) reuses the same steps for the view's Hint button.

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

// ---------------------------------------------------------------------------
// Day targets, calibrated over many seeds.
//   n         board size
//   maxTier   hardest tier the grader may use (blocking: false drops that
//             technique from tier 2)
//   band      [lo, hi] score
//   need      minimum steps per tier ({ 3: 1 } = at least one tier-3 step)
//   cap       maximum steps per tier
//   minChain  shortest allowed longest what-if chain
//   chain     longest what-if chain the grader will follow
//   grow      region-growing style
//   climb     border moves allowed per candidate while steering into the band
//   work      grader runs allowed for the day (default WORK_BUDGET)
// ---------------------------------------------------------------------------
const DAYS = {
  1: { n: 7, maxTier: 2, blocking: false, band: [9, 16], need: { 2: 1 }, cap: { 2: 3 }, grow: 'easy', climb: 50 },
  2: { n: 7, maxTier: 2, band: [18, 32], need: { 2: 4 }, cap: {}, grow: 'easy', climb: 100 },
  3: { n: 8, maxTier: 3, band: [50, 75], need: { 3: 2 }, cap: { 3: 2 }, grow: 'mixed', climb: 400 },
  4: { n: 8, maxTier: 3, band: [76, 105], need: { 3: 3 }, cap: {}, grow: 'mixed', climb: 600 },
  5: { n: 9, maxTier: 3, band: [106, 150], need: { 3: 3, '3 tables in 3 lines': 1 }, cap: {}, grow: 'even', climb: 800 },
  6: { n: 9, maxTier: 4, band: [151, 200], need: { 3: 2, 4: 2 }, cap: { 4: 3 }, grow: 'even', chain: 2, climb: 2000, work: 9000 },
  7: { n: 9, maxTier: 4, band: [201, 290], need: { 3: 2, 4: 4 }, cap: { 4: 6 }, grow: 'even', chain: 2, climb: 3000, work: 9000 },
};

// Work is counted in grader runs rather than milliseconds, so the same seed
// always gives the same puzzle on any machine.
const WORK_BUDGET = 6000;
let work = 0;

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

function neighbours8(n, i) {
  const r = (i / n) | 0;
  const c = i % n;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
  }
  return out;
}

function neighbours4(n, i) {
  const r = (i / n) | 0;
  const c = i % n;
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

// Units 0..n-1 are rows, n..2n-1 columns, 2n..3n-1 tables.
function buildCtx(n, reg) {
  const size = n * n;
  const units = Array.from({ length: 3 * n }, () => []);
  const unitOf = [];
  for (let i = 0; i < size; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    units[r].push(i);
    units[n + c].push(i);
    units[2 * n + reg[i]].push(i);
    unitOf.push([r, n + c, 2 * n + reg[i]]);
  }
  const attack = [];
  const mark = new Int32Array(size).fill(-1);
  for (let i = 0; i < size; i++) {
    const list = [];
    mark[i] = i;
    for (const u of unitOf[i]) {
      for (const j of units[u]) {
        if (mark[j] !== i) { mark[j] = i; list.push(j); }
      }
    }
    for (const j of neighbours8(n, i)) {
      if (mark[j] !== i) { mark[j] = i; list.push(j); }
    }
    attack.push(list);
  }
  return { n, size, reg, units, unitOf, attack };
}

// ---------------------------------------------------------------------------
// Solver state: st[i] is 0 open, 1 ruled out, 2 guest. done[u] marks a unit
// that already has its guest.
// ---------------------------------------------------------------------------

function newState(ctx) {
  return { st: new Uint8Array(ctx.size), done: new Uint8Array(3 * ctx.n), seated: 0 };
}

function cloneState(s) {
  return { st: s.st.slice(), done: s.done.slice(), seated: s.seated };
}

function seat(ctx, s, i) {
  s.st[i] = 2;
  s.seated++;
  for (const j of ctx.attack[i]) if (s.st[j] === 0) s.st[j] = 1;
  for (const u of ctx.unitOf[i]) s.done[u] = 1;
}

function openCells(ctx, s, u) {
  const out = [];
  for (const i of ctx.units[u]) if (s.st[i] === 0) out.push(i);
  return out;
}

// The unsolved unit with no open cell left, or -1.
function brokenUnit(ctx, s) {
  for (let u = 0; u < 3 * ctx.n; u++) {
    if (s.done[u]) continue;
    let any = false;
    for (const i of ctx.units[u]) if (s.st[i] === 0) { any = true; break; }
    if (!any) return u;
  }
  return -1;
}

const broken = (ctx, s) => brokenUnit(ctx, s) >= 0;

// ---------------------------------------------------------------------------
// Techniques. Each applies one deduction to s and returns a step describing
// it (kind, the cells it changed in `hits`, the cells that justify it in
// `area`), or null.
// ---------------------------------------------------------------------------

// Tier 1: a row, column or table with exactly one open cell gets the guest.
// Tables first: they are the easiest thing to spot.
function lastCell(ctx, s) {
  const { n } = ctx;
  for (let k = 0; k < 3 * n; k++) {
    const u = (k + 2 * n) % (3 * n);
    if (s.done[u]) continue;
    let only = -1;
    let count = 0;
    for (const i of ctx.units[u]) {
      if (s.st[i] === 0) { only = i; if (++count > 1) break; }
    }
    if (count === 1) {
      seat(ctx, s, only);
      return { name: 'last open cell', tier: 1, weight: 1, kind: 'last', unit: u, cell: only, hits: [only], area: ctx.units[u] };
    }
  }
  return null;
}

// Tier 2a: a table whose open cells sit in one row (or column) claims that
// line; a line whose open cells sit in one table claims that table.
function confined(ctx, s) {
  const { n, reg } = ctx;
  for (let g = 0; g < n; g++) {
    const u = 2 * n + g;
    if (s.done[u]) continue;
    const cells = openCells(ctx, s, u);
    if (!cells.length) continue;
    for (const axis of [0, 1]) {
      const line = axis === 0 ? (cells[0] / n) | 0 : cells[0] % n;
      if (!cells.every((i) => (axis === 0 ? (i / n) | 0 : i % n) === line)) continue;
      const hits = [];
      for (const j of ctx.units[axis * n + line]) {
        if (s.st[j] === 0 && reg[j] !== g) { s.st[j] = 1; hits.push(j); }
      }
      if (hits.length) {
        return { name: 'confined to a line', tier: 2, weight: 3, kind: 'tableInLine', unit: axis * n + line, table: g, hits, area: cells };
      }
    }
  }
  for (let u = 0; u < 2 * n; u++) {
    if (s.done[u]) continue;
    const cells = openCells(ctx, s, u);
    if (!cells.length) continue;
    const g = reg[cells[0]];
    if (!cells.every((i) => reg[i] === g)) continue;
    const hits = [];
    for (const j of ctx.units[2 * n + g]) {
      if (s.st[j] === 0 && !ctx.unitOf[j].includes(u)) { s.st[j] = 1; hits.push(j); }
    }
    if (hits.length) {
      return { name: 'confined to a line', tier: 2, weight: 3, kind: 'lineInTable', unit: u, table: g, hits, area: cells };
    }
  }
  return null;
}

// Tier 2b: a cell whose guest would rule out every open cell of some other
// row, column or table can't hold a guest.
function blocking(ctx, s) {
  const { n, size } = ctx;
  const hitMark = new Int32Array(size).fill(-1);
  for (let x = 0; x < size; x++) {
    if (s.st[x] !== 0) continue;
    for (const j of ctx.attack[x]) hitMark[j] = x;
    hitMark[x] = x;
    const own = ctx.unitOf[x];
    for (let u = 0; u < 3 * n; u++) {
      if (s.done[u] || own.includes(u)) continue;
      let allHit = true;
      let any = false;
      for (const i of ctx.units[u]) {
        if (s.st[i] !== 0) continue;
        any = true;
        if (hitMark[i] !== x) { allHit = false; break; }
      }
      if (any && allHit) {
        const area = openCells(ctx, s, u);
        s.st[x] = 1;
        return { name: 'blocking cell', tier: 2, weight: 4, kind: 'blocking', unit: u, cell: x, hits: [x], area };
      }
    }
  }
  return null;
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const bitsOf = (mask, n) => Array.from({ length: n }, (_, i) => i).filter((i) => (mask >> i) & 1);

// Tier 3: k tables whose open cells fit inside k rows (or columns) claim
// those lines, and k lines whose open cells fit inside k tables claim those
// tables.
function counting(ctx, s, k) {
  const { n, reg } = ctx;
  for (const axis of [0, 1]) {
    const lineOf = (i) => (axis === 0 ? (i / n) | 0 : i % n);
    // masks: tables → lines they touch, lines → tables they touch
    const tableLines = new Int32Array(n);
    const lineTables = new Int32Array(n);
    for (let i = 0; i < ctx.size; i++) {
      if (s.st[i] !== 0) continue;
      tableLines[reg[i]] |= 1 << lineOf(i);
      lineTables[lineOf(i)] |= 1 << reg[i];
    }
    const openTables = [];
    const openLines = [];
    for (let g = 0; g < n; g++) if (!s.done[2 * n + g]) openTables.push(g);
    for (let l = 0; l < n; l++) if (!s.done[axis * n + l]) openLines.push(l);
    if (k >= openTables.length) continue;

    for (const dir of [0, 1]) {
      const items = dir === 0 ? openTables : openLines;
      const masks = dir === 0 ? tableLines : lineTables;
      // depth-first over k-subsets whose union stays within k bits
      const pick = [];
      let found = null;
      const rec = (start, union) => {
        if (pick.length === k) {
          if (popcount(union) !== k) return;
          let setMask = 0;
          for (const x of pick) setMask |= 1 << x;
          const hits = [];
          const area = [];
          for (let i = 0; i < ctx.size; i++) {
            if (s.st[i] !== 0) continue;
            const inUnion = dir === 0 ? (union >> lineOf(i)) & 1 : (union >> reg[i]) & 1;
            const inSet = dir === 0 ? (setMask >> reg[i]) & 1 : (setMask >> lineOf(i)) & 1;
            if (inUnion && !inSet) hits.push(i);
            else if (inSet) area.push(i);
          }
          if (!hits.length) return;
          for (const i of hits) s.st[i] = 1;
          const tables = dir === 0 ? pick.slice() : bitsOf(union, n);
          const lines = dir === 0 ? bitsOf(union, n) : pick.slice();
          found = { name: `${k} tables in ${k} lines`, tier: 3, weight: 5 + 3 * k, kind: 'counting', k, axis, dir, tables, lines, hits, area };
          return;
        }
        for (let a = start; a < items.length && !found; a++) {
          const nu = union | masks[items[a]];
          if (popcount(nu) > k) continue;
          pick.push(items[a]);
          rec(a + 1, nu);
          pick.pop();
        }
      };
      rec(0, 0);
      if (found) return found;
    }
  }
  return null;
}

// Follow a what-if: seat a guest at x, then take last-cell and confined steps.
// Returns { len, seats, unit } when some unit runs out of room within
// maxSteps (seats are the guests the chain forced), or null.
function followChain(ctx, s, x, maxSteps) {
  const t = cloneState(s);
  seat(ctx, t, x);
  const seats = [];
  let u = brokenUnit(ctx, t);
  if (u >= 0) return { len: 0, seats, unit: u };
  for (let step = 1; step <= maxSteps; step++) {
    const st = lastCell(ctx, t) || confined(ctx, t);
    if (!st) return null;
    if (st.kind === 'last') seats.push(st.cell);
    u = brokenUnit(ctx, t);
    if (u >= 0) return { len: step, seats, unit: u };
    if (t.seated === ctx.n) return null;
  }
  return null;
}

// Tier 4: seat a guest at x, follow easy steps; if some unit runs out of
// room, x can't hold a guest. Picks the shortest chain on the board.
function whatIf(ctx, s, maxChain) {
  let best = null;
  let bestX = -1;
  for (let x = 0; x < ctx.size; x++) {
    if (s.st[x] !== 0) continue;
    const limit = best ? Math.min(maxChain, best.len - 1) : maxChain;
    if (limit < 0) break;
    const chain = followChain(ctx, s, x, limit);
    if (chain && (!best || chain.len < best.len)) { best = chain; bestX = x; }
    if (best && best.len <= 1) break; // length 0 is a blocking cell, so 1 is the shortest
  }
  if (!best) return null;
  s.st[bestX] = 1;
  return {
    name: 'what-if chain', tier: 4, weight: 20 + 5 * best.len, kind: 'whatIf',
    len: best.len, cell: bestX, unit: best.unit, seats: best.seats, hits: [bestX], area: ctx.units[best.unit],
  };
}

// The easiest deduction available from state s, applied to s, or null.
function nextStep(ctx, s, { maxTier = 4, chain = 6, blocking: useBlocking = true, maxK = 3 } = {}) {
  let step = lastCell(ctx, s);
  if (!step && maxTier >= 2) step = confined(ctx, s) || (useBlocking ? blocking(ctx, s) : null);
  if (!step && maxTier >= 3) {
    const unsolved = ctx.n - s.seated;
    for (let k = 2; k <= maxK && k < unsolved && !step; k++) step = counting(ctx, s, k);
  }
  if (!step && maxTier >= 4) step = whatIf(ctx, s, chain);
  return step;
}

// ---------------------------------------------------------------------------
// The grader
// ---------------------------------------------------------------------------

export function grade(n, reg, opts = {}) {
  work++;
  const ctx = buildCtx(n, reg);
  const s = newState(ctx);
  const techniques = {};
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let score = 0;
  let hardest = null;
  let hardestRank = -1;
  let longest = 0;
  let steps = 0;
  const rankOf = (step) => step.tier * 100 + step.weight;

  while (s.seated < n) {
    const step = nextStep(ctx, s, opts);
    if (!step || broken(ctx, s)) {
      let decided = 0;
      for (let i = 0; i < ctx.size; i++) if (s.st[i]) decided++;
      return { solved: false, score, tiers, techniques, st: s.st, done: s.done, decided, contradiction: !!step };
    }
    steps++;
    score += step.weight;
    tiers[step.tier]++;
    techniques[step.name] = (techniques[step.name] ?? 0) + 1;
    if (step.len > longest) longest = step.len;
    if (rankOf(step) > hardestRank) { hardestRank = rankOf(step); hardest = step.name; }
  }
  const solution = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (s.st[r * n + c] === 2) solution.push(c);
  }
  return { solved: true, score, tiers, techniques, hardest, longest, steps, solution };
}

// ---------------------------------------------------------------------------
// Hints, used by the view in the browser.
// hint(puzzle, marks) takes the player's marks (0 empty, 1 ×, 2 guest per
// cell) and returns { text, target, area, ghost } or null when solved:
//   text    one plain sentence
//   target  cells to act on
//   area    cells that explain why
//   ghost   guests a what-if would force, to draw faintly
// A wrong guest or a × on a guest's seat comes first. Otherwise it finds the
// easiest next deduction from the player's guests and ×s, counting
// everything a seated guest rules out as already known.
// ---------------------------------------------------------------------------

const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function placeOf(u, n, table) {
  if (u < n) return `in row ${u + 1}`;
  if (u < 2 * n) return `in column ${u - n + 1}`;
  return table;
}

function describe(step, n) {
  const lines = (axis, ls) => `${axis === 0 ? 'rows' : 'columns'} ${listOf(ls.map((l) => l + 1))}`;
  switch (step.kind) {
    case 'last':
      return `Only one seat ${placeOf(step.unit, n, 'at this table')} is still possible, so the guest goes there.`;
    case 'tableInLine': {
      const line = placeOf(step.unit, n).slice(3);
      return `Every possible seat at this table is in ${line}, so the rest of ${line} can't hold a guest.`;
    }
    case 'lineInTable':
      return `Every possible seat ${placeOf(step.unit, n)} is at one table, so that table's other seats can't hold a guest.`;
    case 'blocking':
      return `A guest here would rule out every possible seat ${placeOf(step.unit, n, 'at the outlined table')}, so this seat can't hold a guest.`;
    case 'counting':
      return step.dir === 0
        ? `These ${step.k} tables can only seat guests in ${lines(step.axis, step.lines)}, so no other guest can sit in those ${step.axis === 0 ? 'rows' : 'columns'}.`
        : `${lines(step.axis, step.lines).replace(/^./, (c) => c.toUpperCase())} can only seat guests at ${step.k} tables, so those tables can't seat a guest anywhere else.`;
    case 'whatIf': {
      const where = placeOf(step.unit, n, 'at the outlined table').replace(/^(in|at) /, '');
      const start = step.seats.length ? 'A guest here would force the faint guests and leave' : 'A guest here would soon leave';
      return `${start} ${where} with no possible seat, so this seat can't hold a guest.`;
    }
    default:
      return 'Look for a row, column or table with only one possible seat.';
  }
}

export function hint(puzzle, marks) {
  const n = puzzle.size;
  const size = n * n;
  const reg = Array.from(puzzle.regions, (ch) => ch.charCodeAt(0) - 97);
  const answer = new Uint8Array(size);
  puzzle.solution.forEach((c, r) => { answer[r * n + c] = 1; });

  let right = 0;
  for (let i = 0; i < size; i++) {
    if (marks[i] === 2 && !answer[i]) {
      return { text: "This guest can't be part of the answer.", target: [i], area: [], ghost: [] };
    }
    if (marks[i] === 2) right++;
  }
  for (let i = 0; i < size; i++) {
    if (marks[i] === 1 && answer[i]) {
      return { text: "This seat needs a guest, so it can't be crossed out.", target: [i], area: [], ghost: [] };
    }
  }
  if (right === n) return null;

  const ctx = buildCtx(n, reg);
  const s = newState(ctx);
  for (let i = 0; i < size; i++) if (marks[i] === 2) seat(ctx, s, i);
  for (let i = 0; i < size; i++) if (marks[i] === 1 && s.st[i] === 0) s.st[i] = 1;

  const step = nextStep(ctx, s, { maxTier: 4, chain: 8 });
  if (!step) {
    // Not expected: every puzzle solves with these steps. Show one guest.
    const r = puzzle.solution.findIndex((c, row) => marks[row * n + c] !== 2);
    const i = r * n + puzzle.solution[r];
    return { text: 'A guest sits here in the answer.', target: [i], area: [], ghost: [] };
  }
  return { text: describe(step, n), target: step.hits, area: step.area, ghost: step.seats ?? [], kind: step.kind };
}

// ---------------------------------------------------------------------------
// Solution counter used while generating (check.mjs has its own).
// Row by row, with a prune for tables that can no longer be reached.
// ---------------------------------------------------------------------------

function findSolutions(n, reg, limit, order = null) {
  const colOrder = order ?? Array.from({ length: n }, (_, i) => i);
  const lastRow = new Int32Array(n).fill(-1);
  for (let i = 0; i < n * n; i++) lastRow[reg[i]] = Math.max(lastRow[reg[i]], (i / n) | 0);
  const deadBy = new Int32Array(n + 1); // tables whose last row is before r
  for (let r = 0; r <= n; r++) {
    for (let g = 0; g < n; g++) if (lastRow[g] < r) deadBy[r] |= 1 << g;
  }
  const out = [];
  const cur = new Int32Array(n);
  const rec = (r, cols, tables, prev) => {
    if (r === n) {
      out.push(Array.from(cur));
      return out.length >= limit;
    }
    if (deadBy[r] & ~tables) return false;
    for (const c of colOrder) {
      if ((cols >> c) & 1) continue;
      if (prev >= 0 && c >= prev - 1 && c <= prev + 1) continue;
      const g = reg[r * n + c];
      if ((tables >> g) & 1) continue;
      cur[r] = c;
      if (rec(r + 1, cols | (1 << c), tables | (1 << g), c)) return true;
    }
    return false;
  };
  rec(0, 0, 0, -1);
  return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

// One guest per row and column, none touching.
function randomPlacement(n, rng) {
  const cols = new Array(n);
  const used = new Uint8Array(n);
  const rec = (r) => {
    if (r === n) return true;
    const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    for (const c of order) {
      if (used[c]) continue;
      if (r > 0 && Math.abs(c - cols[r - 1]) < 2) continue;
      used[c] = 1;
      cols[r] = c;
      if (rec(r + 1)) return true;
      used[c] = 0;
    }
    return false;
  };
  rec(0);
  return cols;
}

// Grow one table from each guest with a randomized flood fill.
//   easy   uneven sizes, some tiny tables and some straight runs
//   mixed  somewhere between
//   even   tables grow in turn, so sizes stay close and shapes are blobby
function growRegions(n, cols, rng, style) {
  const size = n * n;
  const reg = new Int8Array(size).fill(-1);
  const ids = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const cells = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r++) {
    const i = r * n + cols[r];
    reg[i] = ids[r];
    cells[ids[r]].push(i);
  }
  const balance = style === 'even' ? 0.85 : style === 'mixed' ? 0.5 : 0.15;
  const straight = style === 'easy' ? 0.6 : style === 'mixed' ? 0.3 : 0.1;
  const caps = new Int32Array(n).fill(size);
  if (style === 'easy') {
    for (let g = 0; g < n; g++) if (rng.chance(0.4)) caps[g] = rng.range(1, 3);
  } else if (style === 'mixed') {
    for (let g = 0; g < n; g++) if (rng.chance(0.2)) caps[g] = rng.range(2, 4);
  }
  let left = size - n;
  while (left > 0) {
    const frontier = (g) => {
      const f = [];
      for (const i of cells[g]) {
        for (const j of neighbours4(n, i)) if (reg[j] === -1) f.push([i, j]);
      }
      return f;
    };
    let candidates = [];
    for (let g = 0; g < n; g++) {
      if (cells[g].length >= caps[g]) continue;
      const f = frontier(g);
      if (f.length) candidates.push([g, f]);
    }
    if (!candidates.length) {
      for (let g = 0; g < n; g++) {
        const f = frontier(g);
        if (f.length) candidates.push([g, f]);
      }
    }
    let pick;
    if (rng.chance(balance)) {
      let min = Infinity;
      for (const c of candidates) min = Math.min(min, cells[c[0]].length);
      pick = rng.pick(candidates.filter((c) => cells[c[0]].length === min));
    } else {
      pick = rng.pick(candidates);
    }
    const [g, f] = pick;
    let edge = rng.pick(f);
    if (cells[g].length > 1 && rng.chance(straight)) {
      // prefer a cell that continues a straight run
      const runs = f.filter(([a, b]) => {
        const d = b - a;
        const back = a - d;
        return back >= 0 && back < size && reg[back] === g &&
          (Math.abs(d) === n || ((back / n) | 0) === ((a / n) | 0));
      });
      if (runs.length) edge = rng.pick(runs);
    }
    reg[edge[1]] = g;
    cells[g].push(edge[1]);
    left--;
  }
  return reg;
}

function connectedWithout(n, reg, g, skip) {
  let start = -1;
  let total = 0;
  for (let i = 0; i < n * n; i++) {
    if (reg[i] === g && i !== skip) { total++; if (start < 0) start = i; }
  }
  if (start < 0) return false;
  const seen = new Uint8Array(n * n);
  const stack = [start];
  seen[start] = 1;
  let count = 0;
  while (stack.length) {
    const i = stack.pop();
    count++;
    for (const j of neighbours4(n, i)) {
      if (!seen[j] && j !== skip && reg[j] === g) { seen[j] = 1; stack.push(j); }
    }
  }
  return count === total;
}

// Make the puzzle uniquely solvable with the day's techniques. Run the
// grader; where it gets stuck, move one open cell that isn't a guest into a
// neighbouring table and keep the move that lets the grader get furthest.
// The intended guests never move, so the intended solution stays valid, and
// a full logical solve proves it is the only one.
function movesFrom(n, reg, isGuest, cells, rng, limit) {
  const out = [];
  for (const i of rng.shuffle(cells.slice())) {
    if (isGuest[i]) continue;
    const from = reg[i];
    const options = [...new Set(neighbours4(n, i).map((j) => reg[j]))].filter((g) => g !== from);
    if (!options.length || !connectedWithout(n, reg, from, i)) continue;
    out.push([i, rng.pick(options)]);
    if (out.length >= limit) break;
  }
  return out;
}

function solverFix(n, reg, cols, rng, opts, maxFixes = 200, width = 5) {
  const isGuest = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) isGuest[r * n + cols[r]] = 1;
  const recent = [];
  let g = grade(n, reg, opts);
  for (let fix = 0; fix < maxFixes && !g.solved; fix++) {
    // open cells first, then cells touching them, then anything
    const open = [];
    const near = new Set();
    for (let i = 0; i < n * n; i++) {
      if (g.st[i] !== 0 || recent.includes(i)) continue;
      open.push(i);
      for (const j of neighbours8(n, i)) if (g.st[j] !== 0 && !recent.includes(j)) near.add(j);
    }
    let moves = movesFrom(n, reg, isGuest, open, rng, width);
    if (moves.length < width) moves = moves.concat(movesFrom(n, reg, isGuest, [...near], rng, width - moves.length));
    if (!moves.length) {
      const rest = Array.from({ length: n * n }, (_, i) => i).filter((i) => !recent.includes(i));
      moves = movesFrom(n, reg, isGuest, rest, rng, width);
    }
    if (!moves.length) return null;
    let best = null;
    for (const [i, to] of moves) {
      const from = reg[i];
      reg[i] = to;
      const t = grade(n, reg, opts);
      const progress = t.solved ? Infinity : t.decided;
      if (!best || progress > best.progress) best = { i, to, t, progress };
      reg[i] = from;
    }
    reg[best.i] = best.to;
    recent.push(best.i);
    if (recent.length > 4) recent.shift();
    g = best.t;
  }
  return g.solved ? g : null;
}

// Move one non-guest boundary cell into a neighbouring table, keeping every
// table connected. Returns an undo function, or null if nothing moved.
function mutate(n, reg, isGuest, rng) {
  const all = Array.from({ length: n * n }, (_, i) => i);
  const [move] = movesFrom(n, reg, isGuest, all, rng, 1);
  if (!move) return null;
  const [i, to] = move;
  const from = reg[i];
  reg[i] = to;
  return () => { reg[i] = from; };
}

const optsOf = (cfg) => ({ maxTier: cfg.maxTier, chain: cfg.chain, blocking: cfg.blocking ?? true });

// How far a graded puzzle is from the day's target, for the fallback.
function distance(cfg, g) {
  if (!g.solved) return Infinity;
  let d = 0;
  // need/cap keys are tier numbers or technique names
  const count = (key) => (/^\d$/.test(key) ? g.tiers[key] : g.techniques[key]) ?? 0;
  for (const [key, min] of Object.entries(cfg.need)) d += Math.max(0, min - count(key)) * 50;
  for (const [key, max] of Object.entries(cfg.cap)) d += Math.max(0, count(key) - max) * 50;
  if (cfg.minChain && g.longest < cfg.minChain) d += 50;
  if (g.score < cfg.band[0]) d += cfg.band[0] - g.score;
  if (g.score > cfg.band[1]) d += g.score - cfg.band[1];
  return d;
}


function summarize(n, g) {
  const parts = [`${n}×${n}`, `${g.steps} steps`];
  if (g.tiers[2]) parts.push(`${g.tiers[2]} line/blocking`);
  if (g.tiers[3]) parts.push(`${g.tiers[3]} counting`);
  if (g.tiers[4]) parts.push(`${g.tiers[4]} what-if (longest chain ${g.longest})`);
  if (!g.tiers[2] && !g.tiers[3] && !g.tiers[4]) parts.push('last-cell steps only');
  return parts.join(', ');
}

export function candidate(n, rng, style, opts) {
  const cols = randomPlacement(n, rng);
  const reg = growRegions(n, cols, rng, style);
  const g = solverFix(n, reg, cols, rng, opts);
  return g ? { reg, cols, g } : null;
}

// Nudge table borders one cell at a time, keeping the puzzle unique and
// solvable within the day's tiers, toward the day's band.
// Sideways moves are kept so the climb can cross plateaus; it gives up after
// `stall` moves without a strict improvement.
function climb(cfg, cand, g, rng, steps, budget, stall = 500) {
  const { n } = cfg;
  const { reg, cols } = cand;
  const isGuest = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) isGuest[r * n + cols[r]] = 1;
  let cur = g;
  let curDist = distance(cfg, g);
  let lastGain = 0;
  for (let k = 0; k < steps && curDist > 0 && k - lastGain < stall && work < budget; k++) {
    const undo = mutate(n, reg, isGuest, rng);
    if (!undo) break;
    const ng = grade(n, reg, optsOf(cfg));
    const d = distance(cfg, ng);
    if (d < curDist) lastGain = k;
    if (d <= curDist) { cur = ng; curDist = d; } else undo();
  }
  return cur;
}

export function generate(day, rng, { budget = DAYS[day].work ?? WORK_BUDGET } = {}) {
  const cfg = DAYS[day];
  const { n } = cfg;
  work = 0;
  let best = null;
  let bestDist = Infinity;
  let tries = 0;
  while (true) {
    tries++;
    // Weekend boards are made unique with tiers 1-3 (cheaper and more
    // reliable), then the climb works what-if steps in.
    const cand = candidate(n, rng, cfg.grow, { ...optsOf(cfg), maxTier: Math.min(cfg.maxTier, 3) });
    if (cand) {
      let g = cfg.maxTier > 3 ? grade(n, cand.reg, optsOf(cfg)) : cand.g;
      if (distance(cfg, g) > 0) g = climb(cfg, cand, g, rng, cfg.climb ?? 0, budget);
      const d = distance(cfg, g);
      if (d < bestDist) { best = { reg: cand.reg.slice(), cols: cand.cols, g }; bestDist = d; }
      if (d === 0) break;
    }
    if (work >= budget && best) break;
  }
  const { reg, cols, g } = best;
  // Sanity: the grader's solution is the intended one, and it is the only one.
  if (g.solution.join() !== cols.join() || findSolutions(n, reg, 2).length !== 1) {
    throw new Error(`seating-chart: day ${day} produced a puzzle that is not uniquely solvable`);
  }
  const puzzle = {
    size: n,
    regions: Array.from(reg, (x) => LETTERS[x]).join(''),
    solution: cols,
    grade: {
      score: g.score,
      hardest: g.hardest,
      techniques: g.techniques,
      summary: summarize(n, g),
      tier: Object.keys(g.tiers).filter((t) => g.tiers[t]).map(Number).pop(),
    },
  };
  if (bestDist > 0) puzzle.grade.offTarget = true; // budget ran out: closest candidate
  // diagnostics for calibration scripts, left out of the JSON
  Object.defineProperty(puzzle, 'stats', { value: { inBand: bestDist === 0, tries, work } });
  return puzzle;
}

export { DAYS, findSolutions, growRegions, randomPlacement, solverFix, distance, climb, optsOf };
