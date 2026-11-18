#!/usr/bin/env node
// Generates puzzles for every game, week and day and writes data/<game>.json.
//
//   node generate.mjs                     all games, 3 weeks
//   node generate.mjs --game zoning       one game (comma-separate for more)
//   node generate.mjs --weeks 5
//   node generate.mjs --game zoning --days 6,7 --dry    try some days, write nothing
//   node generate.mjs --salt x            different puzzles from the same code

import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { GAMES, loadGenerator } from './games/index.js';
import { DAYS } from './lib/days.js';
import { makeRng, hashString } from './lib/rng.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const only = opt('game', null)?.split(',');
const weeks = Number(opt('weeks', 3));
const days = (opt('days', null)?.split(',').map(Number)) ?? DAYS.map((d) => d.day);
const salt = opt('salt', '');
const dry = flag('dry');

const games = GAMES.filter((g) => !only || only.includes(g.id));
if (!games.length) {
  console.error(`No game matches ${only}. Known: ${GAMES.map((g) => g.id).join(', ')}`);
  process.exit(1);
}

mkdirSync(new URL('./data/', import.meta.url), { recursive: true });

for (const g of games) {
  const mod = await loadGenerator(g.id);
  const puzzles = [];
  const t0 = performance.now();
  for (let week = 1; week <= weeks; week++) {
    for (const day of days) {
      const seed = hashString(`${g.id}|${week}|${day}|${salt}`);
      const started = performance.now();
      const p = mod.generate(day, makeRng(seed));
      const ms = Math.round(performance.now() - started);
      Object.assign(p, { game: g.id, week, day, seed, genMs: ms });
      puzzles.push(p);
      const tech = Object.entries(p.grade.techniques ?? {})
        .map(([k, v]) => `${k}×${v}`)
        .join(' ');
      console.log(
        `${g.id.padEnd(13)} w${week} ${DAYS[day - 1].short} size=${String(p.size).padEnd(3)} ` +
          `score=${String(p.grade.score).padEnd(6)} hardest=${String(p.grade.hardest).padEnd(18)} ${String(ms).padStart(6)}ms  ${tech}`,
      );
    }
  }
  const total = ((performance.now() - t0) / 1000).toFixed(1);
  if (dry) {
    console.log(`${g.id}: ${puzzles.length} puzzles in ${total}s (dry run, nothing written)`);
  } else {
    const out = new URL(`./data/${g.id}.json`, import.meta.url);
    writeFileSync(out, JSON.stringify({ game: g.id, weeks, puzzles }));
    console.log(`${g.id}: wrote ${puzzles.length} puzzles in ${total}s`);
  }
}
