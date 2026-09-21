import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// common.js is a browser script; give it just enough of a window to load.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'static', 'games', 'common.js'), 'utf8');
const sandbox = { window: {}, performance, requestAnimationFrame() {}, cancelAnimationFrame() {}, console,
  CompressionStream, DecompressionStream, Blob, Response, btoa, atob, setTimeout };
vm.runInNewContext(src, sandbox);
const LG = sandbox.window.LongGame;

function fakeInput() {
  return { keys: new Set(), pressed: new Set(), mx: 0, my: 0, mouseMoved: false,
    mouseDown: { left: false, right: false }, mousePressed: { left: false, right: false } };
}
function snapshot(i) {
  return [ [...i.keys].sort().join(','), [...i.pressed].sort().join(','), i.mx, i.my,
    i.mouseDown.left, i.mouseDown.right, i.mousePressed.left, i.mousePressed.right, i.mouseMoved ].join('|');
}

test('a tape replays the exact input sequence it recorded', async () => {
  const tape = new LG.Tape('test', 1);
  tape.begin(12345, { mode: 'x' });
  const input = fakeInput();
  const seen = [];
  // 600 steps of varied input: held keys, edge presses, mouse motion, clicks
  for (let s = 0; s < 600; s++) {
    input.keys = new Set(s % 50 < 30 ? ['KeyW', 'ShiftLeft'] : ['KeyA']);
    input.pressed = new Set(s % 97 === 0 ? ['Space'] : []);
    input.mx = 100 + Math.round(Math.sin(Math.floor(s / 10) / 2) * 50); input.my = 300 + Math.floor(s / 40);
    input.mouseDown.left = s % 120 < 40; input.mouseDown.right = false;
    input.mousePressed.left = s % 120 === 0; input.mousePressed.right = s % 200 === 5;
    // a mouse event that lands on the same pixel still counts as movement
    input.mouseMoved = s % 10 === 0 || s % 77 === 3;
    seen.push(snapshot(input));
    tape.capture(input);
  }
  tape.finish({ ok: true });
  assert.equal(tape.rec.steps, 600);
  assert.ok(tape.rec.runs.length < 600, 'runs should be length-encoded');

  // round trip through the compact (gzip + base64) form
  const compact = await tape.toCompact();
  assert.ok(compact.startsWith('LGR1:'));
  const rec = await LG.Tape.parse(compact);
  assert.equal(rec.seed, 12345);
  assert.equal(rec.result.ok, true);   // (deepEqual would trip on the sandbox's own Object.prototype)

  const back = new LG.Tape('test', 1);
  back.load(rec);
  const replayed = [];
  const out = fakeInput();
  while (back.apply(out)) replayed.push(snapshot(out));
  assert.equal(replayed.length, 600);
  assert.deepEqual(replayed, seen);
});

test('plain JSON tapes parse too', async () => {
  const tape = new LG.Tape('test', 1);
  tape.begin(7, {});
  const input = fakeInput(); input.keys.add('KeyD');
  tape.capture(input); tape.capture(input);
  const rec = await LG.Tape.parse(tape.toJSON());
  assert.equal(rec.runs.length, 1);
  assert.equal(rec.runs[0][0], 2);
});

test('the loop rounds the mouse to whole pixels before the game sees it', () => {
  const input = fakeInput();
  input.mx = 12.6; input.my = 300.2; input.mouseMoved = true;
  input.flush = () => { input.mouseMoved = false; input.pressed.clear(); };
  const tape = new LG.Tape('test', 1);
  tape.begin(1, {});
  const seenByGame = [];
  const loop = LG.loop(() => seenByGame.push([input.mx, input.my, input.mouseMoved]), () => {}, input, tape);
  loop.step();
  assert.deepEqual(seenByGame, [[13, 300, true]]);
  assert.deepEqual([...tape.rec.runs[0]], [1, 0, 0, 13, 300, 16]);
});
