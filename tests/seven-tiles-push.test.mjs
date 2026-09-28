import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C = require(join(root, 'static', 'seven-tiles', 'core.js'));
const { loadDict } = await import(join(root, 'tools', 'lexicon.mjs'));
const { turnMessage } = await import(join(root, 'netlify', 'functions', 'lib', 'turn-message.mjs'));
const handler = (await import(join(root, 'netlify', 'functions', 'push.mjs'))).default;
const webpush = require('web-push');
const ece = require('http_ece');

const ID = 'otter-slate-plum';
// a game record exactly as the server stores it: packed seed and moves, kinds and counts in the clear
function record(n, extra) {
  const d = loadDict('words');
  let s = C.newGame(4242);
  const moves = [];
  for (let i = 0; i < n; i++) {
    const m = C.botMove(s, 'hard', C.seededRandom(i), d);
    s = C.apply(s, m, d);
    moves.push({ t: m.t, d: C.pack(ID, m), ...(m.t === 'play' ? { n: m.tiles.length } : {}) });
  }
  for (const m of extra || []) { s = C.apply(s, m, d); moves.push({ t: m.t, d: C.pack(ID, m) }); }
  return { state: s, body: { game: ID, seed: C.pack(ID, 4242), moves, names: ['Allison', 'Delilah'], seat: moves.length % 2, over: s.over } };
}

test('a turn notification names the move in words and links to the game', () => {
  const { state, body } = record(1);
  const h = state.history[0];
  const m = turnMessage(body);
  assert.equal(m.title, 'Seven Tiles: your turn');
  assert.equal(m.body, 'Allison played ' + h.word + ' for ' + h.score + (h.bingo ? ', a bingo' : '') + '. Your move.');
  assert.equal(m.url, 'https://shichengrao.com/seven-tiles/' + ID);
  assert.equal(m.tag, 'seven-tiles-' + ID);
  const two = turnMessage(record(2).body);
  assert.match(two.body, /^Delilah played [A-Z]+ for \d+/, 'the second move is the other player\'s');
});

test('game over, resignations, passes and unreadable records are worded sensibly', () => {
  const r = record(1, [{ t: 'resign' }]);
  const m = turnMessage(r.body);
  assert.equal(m.title, 'Seven Tiles: game over');
  assert.equal(m.body, 'Delilah resigned. You win.');
  assert.match(turnMessage(record(1, [{ t: 'pass' }]).body).body, /^Delilah passed\. Your move\.$/);
  const broken = { ...record(1).body, moves: [{ t: 'play', d: '!!!', n: 3 }] };
  assert.equal(turnMessage(broken).body, 'Allison moved. Your move.');
  assert.equal(turnMessage({ ...broken, names: [null, null] }).body, 'Your opponent moved. Your move.');
});

test('a notification encrypts so that only the subscribed device can read it', () => {
  const dev = createECDH('prime256v1'); dev.generateKeys();
  const auth = randomBytes(16);
  const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: dev.getPublicKey('base64url'), auth: auth.toString('base64url') } };
  const vapid = webpush.generateVAPIDKeys();
  const payload = JSON.stringify(turnMessage(record(1).body));
  const req = webpush.generateRequestDetails(sub, payload, { vapidDetails: { subject: 'https://shichengrao.com/seven-tiles/', publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 });
  assert.equal(req.endpoint, sub.endpoint);
  assert.match(req.headers.Authorization, /^vapid t=.+, k=/);
  const plain = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: dev, authSecret: auth.toString('base64url') });
  assert.deepEqual(JSON.parse(plain.toString()), JSON.parse(payload));
});

test('the push function refuses callers without the shared secret', async () => {
  const post = (secret, body) => new Request('https://x.test/.netlify/functions/push', { method: 'POST', headers: { 'x-push-secret': secret || '' }, body: JSON.stringify(body || {}) });
  const saved = { ...process.env };
  try {
    delete process.env.PUSH_SECRET;
    assert.equal((await handler(post('s'))).status, 503, 'not configured');
    const v = webpush.generateVAPIDKeys();
    Object.assign(process.env, { PUSH_SECRET: 'right-secret-value', VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey });
    assert.equal((await handler(new Request('https://x.test/', { method: 'GET' }))).status, 405);
    assert.equal((await handler(post('wrong-secret-value'))).status, 403);
    assert.equal((await handler(post(''))).status, 403);
    const ok = await handler(post('right-secret-value', { ...record(1).body, subs: [] }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { sent: 0, gone: 0 });
  } finally { process.env = saved; }
});

test('the worker shows every push and the schema wires the trigger', () => {
  const sw = readFileSync(join(root, 'static', 'seven-tiles', 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  const sql = readFileSync(join(root, 'plans', 'seven-tiles-supabase.sql'), 'utf8');
  assert.match(sql, /create trigger games_notify_turn after update of moves on games/);
  assert.match(sql, /exception when others then\s+return new;/, 'a failed notification never blocks a move');
});
