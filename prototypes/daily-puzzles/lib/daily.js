// A day's puzzle comes from the game and the date alone, so every device makes
// the same puzzle on the same day without a list to look it up in. The weekday
// sets the difficulty: Monday (1) is the easiest and Sunday (7) the hardest.
//
// Dates are local 'YYYY-MM-DD' strings. They are turned into Date objects at
// noon, so stepping a day at a time never trips over a daylight-saving change.

import { hashString, makeRng } from './rng.js';

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const today = () => isoDate(new Date());

/** 'YYYY-MM-DD' -> Date at local noon, or null if it isn't a real date */
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return isoDate(d) === s ? d : null;
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Monday 1 to Sunday 7 */
export const weekday = (s) => ((parseDate(s).getDay() + 6) % 7) + 1;

export const mondayOf = (s) => addDays(s, 1 - weekday(s));

export const seedFor = (game, date) => hashString(`${game}|${date}`);

/** Runs a game's generator (its generate.js module) for a date. */
export function puzzleFor(mod, game, date) {
  const day = weekday(date);
  const seed = seedFor(game, date);
  const t0 = performance.now();
  const p = mod.generate(day, makeRng(seed));
  return Object.assign(p, { game, date, day, seed, genMs: Math.round(performance.now() - t0) });
}
