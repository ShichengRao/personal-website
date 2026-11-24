#!/usr/bin/env node
// Makes the same puzzles the page makes for a run of dates, and writes
// data/<game>.json for the checks (games/<id>/check.mjs). The page doesn't read
// these files: it makes each day's puzzle itself, from the game and the date.
//
//   node generate.mjs                          all games, 3 weeks from this Monday
//   node generate.mjs --game zoning            one game (comma-separate for more)
//   node generate.mjs --from 2027-01-04 --weeks 5
//   node generate.mjs --game zoning --days 6,7 --dry    only some weekdays, write nothing

import { writeFileSync, mkdirSync } from 'node:fs';
import { GAMES, loadGenerator } from './games/index.js';
import { DAYS } from './lib/days.js';
import { today, parseDate, addDays, mondayOf, puzzleFor } from './lib/daily.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const only = opt('game', null)?.split(',');
const from = opt('from', today());
const weeks = Number(opt('weeks', 3));
const days = (opt('days', null)?.split(',').map(Number)) ?? DAYS.map((d) => d.day);
const dry = flag('dry');

if (!parseDate(from)) {
  console.error(`--from takes a date like 2027-01-04, not ${from}`);
  process.exit(1);
}
const games = GAMES.filter((g) => !only || only.includes(g.id));
if (!games.length) {
  console.error(`No game matches ${only}. Known: ${GAMES.map((g) => g.id).join(', ')}`);
  process.exit(1);
}

const monday = mondayOf(from);
const dates = [];
for (let i = 0; i < weeks * 7; i++) {
  if (days.includes(i % 7 + 1)) dates.push(addDays(monday, i));
}

mkdirSync(new URL('./data/', import.meta.url), { recursive: true });

for (const g of games) {
  const mod = await loadGenerator(g.id);
  const puzzles = [];
  const t0 = performance.now();
  for (const date of dates) {
    const p = puzzleFor(mod, g.id, date);
    puzzles.push(p);
    const tech = Object.entries(p.grade.techniques ?? {})
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    console.log(
      `${g.id.padEnd(13)} ${date} ${DAYS[p.day - 1].short} size=${String(p.size).padEnd(3)} ` +
        `score=${String(p.grade.score).padEnd(6)} hardest=${String(p.grade.hardest).padEnd(18)} ${String(p.genMs).padStart(6)}ms  ${tech}`,
    );
  }
  const total = ((performance.now() - t0) / 1000).toFixed(1);
  if (dry) {
    console.log(`${g.id}: ${puzzles.length} puzzles in ${total}s (dry run, nothing written)`);
  } else {
    const out = new URL(`./data/${g.id}.json`, import.meta.url);
    writeFileSync(out, JSON.stringify({ game: g.id, from: monday, puzzles }));
    console.log(`${g.id}: wrote ${puzzles.length} puzzles in ${total}s`);
  }
}
