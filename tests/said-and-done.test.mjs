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
  assert.equal(results.schema_version, 2);
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

test('every task says whether the checks were built on it, when the results are split', () => {
  if (!results.by_split) return;
  const splits = new Set(['development', 'held_out', 'blind']);
  const all = [...results.tasks, ...(results.tasks_outside_score || [])];
  for (const t of all) assert.ok(splits.has(t.split), `${t.id}: split ${t.split}`);
  for (const k of Object.keys(results.by_split)) assert.ok(splits.has(k), `by_split has unknown split ${k}`);
  for (const [k, g] of Object.entries(results.scaffold_gain_by_split || {})) {
    assert.ok(k === 'all' || splits.has(k), `scaffold_gain_by_split has unknown split ${k}`);
    for (const f of ['diff', 'low', 'high']) assert.equal(typeof g[f], 'number', `scaffold_gain_by_split.${k}.${f}`);
    assert.ok(g.low <= g.diff && g.diff <= g.high, `scaffold_gain_by_split.${k}: interval doesn't hold its estimate`);
  }
  const ids = new Set(all.map((t) => t.id));
  for (const t of all) if (t.same_as) assert.ok(ids.has(t.same_as), `${t.id}: same_as ${t.same_as} isn't a task`);
  for (const r of results.runs_outside_score || []) assert.ok(ids.has(r.task), `outside-score run on unknown task ${r.task}`);
});

test('published rates and costs recompute from the scored rows', () => {
  // Arithmetic checks complement the separate audit against original run evidence.
  const near = (actual, expected, label) => {
    if (expected === null) return assert.equal(actual, null, label);
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);
  };
  const rate = (rows, predicate) => rows.length ? rows.filter(predicate).length / rows.length : null;
  const median = (xs) => {
    const ys = xs.filter((v) => v !== null).sort((a, b) => a - b), m = Math.floor(ys.length / 2);
    return ys.length ? ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2 : null;
  };
  const keys = results.runs.map((r) => `${r.task}/${r.config_id}/${r.seed}`);
  assert.equal(new Set(keys).size, keys.length, 'duplicate run in published results');
  for (const c of results.configs) {
    const rows = results.runs.filter((r) => r.scored && r.config_id === c.id), s = results.summary[c.id];
    assert.equal(s.runs, rows.length, `${c.id}: denominator`);
    for (const r of rows) assert.equal(r.said_and_done, r.done && r.truthful === true && !r.violated);
    for (const key of ['said_and_done', 'done']) near(s[key], rate(rows, (r) => r[key]), `${c.id}: ${key}`);
    near(s.truthful, rate(rows.filter((r) => r.outcome === 'complete' || r.outcome === 'blocked'), (r) => r.truthful), `${c.id}: truthful`);
    near(s.false_completion_of_completes, rate(rows.filter((r) => r.outcome === 'complete'), (r) => r.code === 'F'), `${c.id}: false complete`);
    near(s.false_completion_of_runs, rate(rows, (r) => r.code === 'F'), `${c.id}: false per run`);
    near(s.violation_rate, rate(rows, (r) => r.violated), `${c.id}: violations`);
    near(s.median_minutes, median(rows.map((r) => r.minutes)), `${c.id}: median minutes`);
    near(s.median_cost_usd, median(rows.map((r) => r.cost_usd)), `${c.id}: median cost`);
    near(s.total_cost_usd, rows.reduce((n, r) => n + (r.cost_usd ?? 0), 0), `${c.id}: total cost`);
    assert.equal(s.cost_estimated, rows.some((r) => r.cost_estimated), `${c.id}: cost basis`);
    for (const family of results.families) {
      const subset = rows.filter((r) => r.family === family.id);
      if (subset.length) near(results.by_family[family.id][c.id], rate(subset, (r) => r.said_and_done), `${c.id}/${family.id}`);
    }
  }
});

test('the headline setups named in the front matter are in the results', () => {
  const line = read('content/said-and-done/_index.md').match(/^highlights:\s*(\[.*\])\s*$/m);
  assert.ok(line, 'content/said-and-done/_index.md has no highlights');
  const ids = new Set(results.configs.map((c) => c.id));
  for (const id of JSON.parse(line[1])) assert.ok(ids.has(id), `highlights names ${id}, which results.json doesn't have`);
});

test('the no-valid-option section has what it reads', () => {
  const setups = new Set(noValid.setups.map((s) => s.id));
  // The section's headline numbers compare Beam alone with Beam + scaffold, by these ids.
  for (const g of ['beam', 'beam-mitigation']) assert.ok(noValid.setups.some((x) => x.group === g), `no-valid-option.json has no ${g} setup`);
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

test('Checked /goal never names the pen name, and its GitHub or Hugging Face links are the real-name account or Mirror', () => {
  for (const f of ['static/checked-goal/content.json', 'static/checked-goal/README.md']) {
    const text = read(f);
    assert.ok(!/abnew123|shadowghosts/i.test(text), `${f} names the pen name`);
    for (const url of text.match(/https?:\/\/(?:www\.)?(?:github\.com|huggingface\.co)\/[^\s)"'`\]]*/gi) || []) {
      assert.ok(/^https:\/\/(?:github\.com|huggingface\.co)\/(?:(?:spaces|datasets)\/)?(?:ShichengRao|reflection-oss\/mirror)(?:\/|$)/.test(url), `${f} links an account other than ShichengRao or Mirror: ${url}`);
    }
  }
});

test('Checked /goal ships the files its install section links, with no real home folder in them, or none while held', () => {
  const page = JSON.parse(read('static/checked-goal/content.json'));
  // While the download is held (extension_held in its front matter), the page links none of them and the site ships none.
  if (/^extension_held:\s*true\s*$/m.test(read('content/checked-goal/_index.md'))) {
    for (const f of page.install.files) assert.ok(!existsSync(join(root, 'static/checked-goal', f)), `static/checked-goal/${f} ships while the extension is held`);
    return;
  }
  for (const f of page.install.files) assert.ok(existsSync(join(root, 'static/checked-goal', f)), `static/checked-goal/${f} is missing`);
  for (const f of page.install.files) {
    // The README's generic example (/Users/you/.aws) and the guard's pattern (/Users/[^/\s]+) are the only ones allowed.
    const homes = read(join('static/checked-goal', f)).match(/\/Users\/(?!you\/|\[\^)[^\s/`'")]*/g);
    assert.equal(homes, null, `a home folder in static/checked-goal/${f}`);
  }
});
