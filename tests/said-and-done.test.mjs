import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Said & Done page draws everything from the benchmark's report package,
// copied in unchanged. These checks catch a package the page can't draw, and
// the made-up numbers it was built with reaching main.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');
const results = JSON.parse(read('static/said-and-done/results.json'));
const excerpts = JSON.parse(read('static/said-and-done/excerpts.json'));
const prose = ['assets/said-and-done/intro.md', 'assets/said-and-done/method.md'].map(read);
// Reported separately from the score, each from its own package.
const noValid = JSON.parse(read('static/said-and-done/no-valid-option.json'));
const addendum = JSON.parse(read('static/said-and-done/addendum.json'));

test('results are real, not the synthetic layout data', () => {
  assert.notEqual(results.synthetic, true, 'static/said-and-done/results.json is synthetic');
  assert.notEqual(results.preview, true, 'static/said-and-done/results.json is a preview of partial results');
  assert.notEqual(excerpts.synthetic, true, 'static/said-and-done/excerpts.json is synthetic');
  assert.ok(!/placeholder/i.test(prose[0]), 'assets/said-and-done/intro.md is still the placeholder');
});

test('results match the schema the page reads', () => {
  assert.equal(results.schema_version, 1);
  const ids = (xs) => new Set(xs.map((x) => x.id));
  const configs = ids(results.configs), tasks = ids(results.tasks), families = ids(results.families);
  const groups = new Set(['beam', 'beam-mitigation', 'brain-worker', 'reference', 'anchor']);
  for (const c of results.configs) {
    assert.ok(groups.has(c.group), `${c.id}: unknown group ${c.group}`);
    if (c.group === 'reference') assert.equal(typeof c.open_weights, 'boolean', `${c.id}: open_weights decides its color`);
    const s = results.summary[c.id];
    assert.ok(s, `${c.id}: no summary`);
    for (const k of ['said_and_done', 'done']) assert.equal(typeof s[k], 'number', `${c.id}: ${k}`);
    assert.equal(s.said_and_done_ci.length, 2, `${c.id}: said_and_done_ci`);
  }
  for (const t of results.tasks) assert.ok(families.has(t.family), `${t.id}: unknown family ${t.family}`);
  for (const r of results.runs) {
    assert.ok(configs.has(r.config_id) && tasks.has(r.task), `run ${r.task}/${r.config_id}`);
    assert.ok(r.code in results.codes, `run ${r.task}/${r.config_id}: unknown code ${r.code}`);
  }
  for (const q of excerpts.excerpts) assert.ok(configs.has(q.config) && tasks.has(q.task), `excerpt ${q.task}/${q.config}`);
});

test('the headline setups named in the front matter are in the results', () => {
  const line = read('content/said-and-done/_index.md').match(/^highlights:\s*(\[.*\])\s*$/m);
  assert.ok(line, 'content/said-and-done/_index.md has no highlights');
  const ids = new Set(results.configs.map((c) => c.id));
  for (const id of JSON.parse(line[1])) assert.ok(ids.has(id), `highlights names ${id}, which results.json doesn't have`);
});

test('the no-valid-option section has what it reads', () => {
  const setups = new Set(noValid.setups.map((s) => s.id));
  for (const id of ['beam', 'beam-checks']) assert.ok(setups.has(id), `no-valid-option.json has no ${id} setup`);
  for (const id of setups) assert.ok(noValid.summary[id], `no-valid-option.json: no summary for ${id}`);
  const scenarios = new Set(noValid.scenarios.map((s) => s.id));
  for (const r of noValid.results) {
    assert.ok(scenarios.has(r.scenario), `no-valid-option.json: unknown scenario ${r.scenario}`);
    for (const id of Object.keys(r.setups)) assert.ok(setups.has(id), `no-valid-option.json: ${r.scenario} has unknown setup ${id}`);
  }
  assert.ok(noValid.caveats.length, 'no-valid-option.json has no caveats');
});

test('the addendum has what it reads, and its download is here', () => {
  for (const k of ['lede', 'headline_numbers', 'quotes', 'by_model', 'tripwire', 'method', 'limits']) assert.ok(addendum[k], `addendum.json has no ${k}`);
  assert.ok(existsSync(join(root, 'static/said-and-done', addendum.download.file)), `static/said-and-done/${addendum.download.file} is missing`);
});

test('the page links nowhere outside the site', () => {
  for (const text of [...prose, JSON.stringify(results), JSON.stringify(excerpts), JSON.stringify(noValid), JSON.stringify(addendum)]) {
    assert.ok(!text.includes('://'), 'a URL in the Said & Done package');
  }
});

test('Checked /goal ships the files its install section links, with no real home folder in them', () => {
  const page = JSON.parse(read('static/checked-goal/content.json'));
  for (const f of page.install.files) assert.ok(existsSync(join(root, 'static/checked-goal', f)), `static/checked-goal/${f} is missing`);
  for (const f of page.install.files) {
    // The README's generic example (/Users/you/.aws) and the guard's pattern (/Users/[^/\s]+) are the only ones allowed.
    const homes = read(join('static/checked-goal', f)).match(/\/Users\/(?!you\/|\[\^)[^\s/`'")]*/g);
    assert.equal(homes, null, `a home folder in static/checked-goal/${f}`);
  }
});
