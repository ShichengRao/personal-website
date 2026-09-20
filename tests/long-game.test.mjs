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

test('the Crux wall is well-formed', () => {
  const src = readFileSync(join(gamesDir, 'crux.js'), 'utf8');
  const block = src.match(/const LEVEL = \[\n([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'LEVEL array should be present');
  const rows = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(rows.length > 40, 'the wall should be tall');
  const width = rows[0].length;
  for (const [i, r] of rows.entries()) {
    assert.equal(r.length, width, `row ${i} has width ${r.length}, expected ${width}`);
    assert.ok(/^[#.~cjR^|<>=SF]+$/.test(r), `row ${i} has an unknown tile: ${r}`);
    assert.equal(r[0], '#', `row ${i} should start with the outer wall`);
    assert.ok(r[width - 1] === '#' || r[width - 1] === '~', `row ${i} should end with an outer wall`);
  }
  assert.ok(/^#+$/.test(rows[0]) && /^#+$/.test(rows[rows.length - 1]), 'top and bottom rows should be solid');
  const all = rows.join('');
  assert.equal((all.match(/S/g) || []).length, 1, 'exactly one start');
  assert.equal((all.match(/F/g) || []).length, 1, 'exactly one summit flag');
  // every rest ledge needs headroom, or the checkpoint would be unreachable
  for (let r = 1; r < rows.length; r++) for (let c = 0; c < width; c++) {
    if (rows[r][c] === 'R') assert.ok('.SF'.includes(rows[r - 1][c]), `rest ledge at ${c},${r} has no headroom`);
  }
  // rock chutes must sit in open air
  const chutes = [...src.matchAll(/\{ c: (\d+), r: (\d+) - (\d+)/g)].map((m) => [Number(m[1]), Number(m[2]) - Number(m[3])]);
  assert.ok(chutes.length >= 1, 'chutes should be declared');
  for (const [c, r] of chutes) assert.equal(rows[r][c], '.', `chute at ${c},${r} is not in open air`);
});
