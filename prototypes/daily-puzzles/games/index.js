// Registry of games. Safe to import from Node: views load lazily.
export const GAMES = [
  { id: 'seating-chart', name: 'Seating Chart', genre: 'Star Battle' },
  { id: 'even-keel', name: 'Even Keel', genre: 'Takuzu' },
  { id: 'paper-route', name: 'Paper Route', genre: 'Path puzzle' },
  { id: 'zoning', name: 'Zoning', genre: 'Shikaku' },
  { id: 'sudoku6', name: 'Sudoku 6×6', genre: 'Sudoku' },
];

export const loadGenerator = (id) => import(`./${id}/generate.js`);
export const loadView = (id) => import(`./${id}/view.js`);
