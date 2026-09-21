import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gamesDir = join(root, 'static', 'games');
const scripts = readdirSync(gamesDir).filter((f) => f.endsWith('.js'));

test('every game script parses', () => {
  assert.ok(scripts.includes('common.js'), 'common.js should exist');
  for (const f of scripts) {
    const r = spawnSync(process.execPath, ['--check', join(gamesDir, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} failed to parse:\n${r.stderr}`);
  }
});

test('each Long Game page has the layout its front matter names', () => {
  const contentDir = join(root, 'content', 'long-game');
  const pages = readdirSync(contentDir).filter((f) => f.endsWith('.md') && f !== '_index.md');
  assert.ok(pages.length >= 3, 'expected the three game pages');
  for (const f of pages) {
    const fm = readFileSync(join(contentDir, f), 'utf8');
    const m = fm.match(/^layout:\s*"?([a-z-]+)"?\s*$/m);
    assert.ok(m, `${f} should name a layout`);
    assert.ok(existsSync(join(root, 'layouts', 'long-game', `${m[1]}.html`)), `${f} names layout ${m[1]}, which is missing`);
    assert.ok(existsSync(join(gamesDir, `${m[1]}.js`)), `${f} has no script static/games/${m[1]}.js`);
  }
});

test('every set Crux wall is solvable and the solver agrees with the evaluator', async () => {
  const core = (await import(join(gamesDir, 'crux-core.js'))).default;
  const src = readFileSync(join(gamesDir, 'crux.js'), 'utf8');
  const walls = [...src.matchAll(/tier: (\d+), seed: (\d+)/g)].map((m) => ({ tier: Number(m[1]), seed: Number(m[2]) }));
  assert.ok(walls.length >= 5, 'the set walls should be declared in crux.js');
  for (const w of walls) {
    const level = core.generate(w.seed, w.tier);
    assert.deepEqual(level.cells, core.generate(w.seed, w.tier).cells, `wall ${w.tier}-${w.seed} should generate deterministically`);
    const sol = core.solve(level);
    assert.ok(sol, `wall ${w.tier}-${w.seed} should be solvable`);
    const ev = core.evaluate(level, sol.plan);
    assert.equal(ev.ok, true, `the solver's plan for ${w.tier}-${w.seed} should evaluate as a summit`);
    assert.equal(ev.beats, sol.par, `par for ${w.tier}-${w.seed} should match the plan's beats`);
    assert.equal(ev.stamina, sol.stamina);
    // the anchors are the only way up and the ground is the only way in
    assert.ok(level.cells.slice(0, core.COLS).includes('F'));
    assert.ok(level.cells.slice(-core.COLS).every((c) => c === 'G'));
  }
});

test('Crux plans fail for the right reasons', async () => {
  const core = (await import(join(gamesDir, 'crux-core.js'))).default;
  const cells = new Array(core.COLS * core.ROWS).fill('.');
  for (let c = 0; c < core.COLS; c++) cells[(core.ROWS - 1) * core.COLS + c] = 'G';
  const put = (c, r, v) => { cells[r * core.COLS + c] = v; };
  put(3, 14, 'j'); put(3, 13, 'c'); put(3, 12, 'p'); put(3, 11, 'x'); put(3, 9, 'j'); put(3, 0, 'F'); put(6, 14, 'c');
  const level = { cols: core.COLS, rows: core.ROWS, cells, chutes: [{ c: 3, period: 4, offset: 1 }], winds: [{ r0: 9, r1: 11, period: 3, offset: 0, dur: 1 }] };
  const s = { t: 's', c: 3, r: 15 };
  // beat 1 in the chute column is a rock beat
  assert.equal(core.evaluate(level, [s, { t: 'm', c: 3, r: 14 }]).fatal.reason, 'rock');
  // waiting on the ground first makes beat 2 safe; the pocket is safe on beat 5
  const safe = core.evaluate(level, [s, { t: 'w', c: 3, r: 15 }, { t: 'm', c: 3, r: 14 }, { t: 'm', c: 3, r: 13 }, { t: 'm', c: 3, r: 12 }, { t: 'w', c: 3, r: 12 }]);
  assert.equal(safe.fatal, null);
  // a dyno out of the wind band on a gust beat is fatal; a beat later it is fine
  const gust = safe.steps.length; // next beat is 6: (6 - 0) % 3 === 0 -> gust
  assert.equal(core.evaluate(level, [...safe.steps.map(stepOf), { t: 'd', c: 3, r: 10 }]).fatal.reason, 'nohold');
  assert.equal(gust, 6);
  // sit in the pocket through rock beat 5, step onto the crumble at 8, dyno on gust beat 9
  const w = { t: 'w', c: 3, r: 12 };
  const dyno = core.evaluate(level, [s, { t: 'w', c: 3, r: 15 }, { t: 'm', c: 3, r: 14 }, { t: 'm', c: 3, r: 13 }, { t: 'm', c: 3, r: 12 }, w, w, w, { t: 'm', c: 3, r: 11 }, { t: 'd', c: 3, r: 9 }]);
  assert.equal(dyno.fatal.reason, 'gust');
  // two beats later (rock at 9 rules out beat 9 on the crumble) the same dyno is clean
  const clean = core.evaluate(level, [s, { t: 'w', c: 3, r: 15 }, { t: 'm', c: 3, r: 14 }, { t: 'm', c: 3, r: 13 }, { t: 'm', c: 3, r: 12 }, w, w, w, w, w, { t: 'm', c: 3, r: 11 }, { t: 'd', c: 3, r: 9 }, { t: 'm', c: 3, r: 10 }]);
  assert.equal(clean.fatal.reason, 'nohold');
  assert.equal(clean.steps[11].fatal, undefined);
  // waiting on a crumble hold is a fall
  const crumble = core.evaluate(level, [s, { t: 'w', c: 3, r: 15 }, { t: 'm', c: 3, r: 14 }, { t: 'm', c: 3, r: 13 }, { t: 'm', c: 3, r: 12 }, w, w, w, w, w, { t: 'm', c: 3, r: 11 }, { t: 'w', c: 3, r: 11 }]);
  assert.equal(crumble.fatal.reason, 'crumble');
  // stamina runs out hanging on a crimp, away from the chute
  const pump = core.evaluate(level, [{ t: 's', c: 6, r: 15 }, { t: 'm', c: 6, r: 14 }, ...Array(30).fill({ t: 'w', c: 6, r: 14 })]);
  assert.equal(pump.fatal.reason, 'pumped');
  assert.equal(pump.fatal.index, 19);
  function stepOf(st) { return { t: st.t, c: st.c, r: st.r }; }
});
