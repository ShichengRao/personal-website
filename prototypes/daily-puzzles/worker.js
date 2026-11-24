// Makes puzzles off the page's thread, so the page stays responsive while a
// hard one takes a few seconds. The page sends { game, date } and gets back
// { puzzle } or { error }.

import { loadGenerator } from './games/index.js';
import { puzzleFor } from './lib/daily.js';

onmessage = async ({ data: { game, date } }) => {
  try {
    const mod = await loadGenerator(game);
    postMessage({ puzzle: puzzleFor(mod, game, date) });
  } catch (err) {
    postMessage({ error: String(err?.message ?? err) });
  }
};
