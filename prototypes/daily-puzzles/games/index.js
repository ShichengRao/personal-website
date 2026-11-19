// Registry of games. Safe to import from Node: views load lazily.
export const GAMES = [
  { id: 'seating-chart', name: 'Seating Chart', genre: 'Star Battle' },
  { id: 'two-tone', name: 'Two Tone', genre: 'Takuzu' },
  { id: 'paper-route', name: 'Paper Route', genre: 'Path puzzle' },
  { id: 'zoning', name: 'Zoning', genre: 'Shikaku' },
  { id: 'sudoku6', name: '6×6 Sudoku', genre: 'Sudoku' },
];

export const loadGenerator = (id) => import(`./${id}/generate.js`);
export const loadView = (id) => import(`./${id}/view.js`);
