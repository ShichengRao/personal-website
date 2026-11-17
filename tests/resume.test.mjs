import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fn = await import(join(root, 'netlify', 'functions', 'resume.mjs'));

// the shape of a published Google Doc: Google's scripts around one stylesheet and one doc-content div
const PAGE = '<html><head><script>var tracker=1</script><style type="text/css">.c3{max-width:540pt;padding:36pt}p{margin:0}</style></head>'
  + '<body><div class="c3 doc-content"><p class="c1"><span>Shicheng Rao</span></p></div><script>DOCS_timing={}</script></body></html>';

test('the function fetches the doc the Resume page names', () => {
  const md = readFileSync(join(root, 'content', 'resume', '_index.md'), 'utf8');
  const doc = md.match(/^doc:\s*"([^"]*)"/m)[1];
  assert.equal(doc, fn.DOC);
  assert.match(fn.DOC, /^https:\/\/docs\.google\.com\/document\/d\/e\/[A-Za-z0-9_-]+\/pub$/);
});

test('extract keeps the stylesheet and the doc, and no script', () => {
  const doc = fn.extract(PAGE);
  assert.equal(doc.css, '.c3{max-width:540pt;padding:36pt}p{margin:0}');
  assert.match(doc.html, /^<div class="c3 doc-content">/);
  assert.match(doc.html, /Shicheng Rao/);
  assert.doesNotMatch(doc.html, /<script/i);
  assert.equal(fn.extract('<html><body>Not found</body></html>'), null);
});

test('the function asks Google for that one doc and caches what it got', async (t) => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url) => { asked.push(String(url)); return new Response(PAGE); });
  const res = await fn.default(new Request('https://shichengrao.com/api/resume?doc=https://example.com'));
  assert.deepEqual(asked, [`${fn.DOC}?embedded=true`]);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.match(res.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
  assert.match((await res.json()).html, /doc-content/);
});

test('a failed fetch or an unrecognized page is a 502 that is not cached', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  let res = await fn.default();
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('netlify-cdn-cache-control'), 'no-store');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>changed</html>'));
  res = await fn.default();
  assert.equal(res.status, 502);
});
