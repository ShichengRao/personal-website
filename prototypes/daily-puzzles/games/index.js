// Registry of games. Safe to import from Node and from the worker: views load lazily.
//
// v is the generator's version. Bump it after changing a game's generator, so
// browsers that kept an older puzzle for a date make that date's puzzle again.
export const GAMES = [
  { id: 'seating-chart', name: 'Seating Chart', genre: 'Star Battle', v: 1 },
  { id: 'two-tone', name: 'Two Tone', genre: 'Takuzu', v: 1 },
  { id: 'paper-route', name: 'Paper Route', genre: 'Path puzzle', v: 1 },
  { id: 'zoning', name: 'Zoning', genre: 'Shikaku', v: 1 },
  { id: 'sudoku6', name: '6×6 Sudoku', genre: 'Sudoku', v: 1 },
];

export const loadGenerator = (id) => import(`./${id}/generate.js`);
export const loadView = (id) => import(`./${id}/view.js`);
