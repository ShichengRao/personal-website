/* What a Seven Tiles turn notification says. The database hands over the
   game's record exactly as stored (seed and moves packed with the game id),
   and replaying it here gives the last move in words: "Allison played QIS for
   22". A record that cannot be read still gets a plain "Allison moved". */
import C from '../../../static/seven-tiles/core.js';

const SITE = 'https://shichengrao.com/seven-tiles/';
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function turnMessage({ game, seed, moves, names, seat, over }) {
  const mover = 1 - seat;
  const who = String((names && names[mover]) || 'Your opponent').slice(0, 24);
  let what = who + ' moved', result = '';
  try {
    const state = C.replay(C.unpack(game, seed), (moves || []).map((m) => C.unpack(game, m.d)));
    const h = state.history[state.history.length - 1];
    if (h.t === 'play') what = who + ' played ' + h.word + ' for ' + h.score + (h.bingo ? ', a bingo' : '');
    else if (h.t === 'swap') what = who + ' swapped ' + plural(h.n, 'tile');
    else if (h.t === 'pass') what = who + ' passed';
    else if (h.t === 'resign') what = who + ' resigned';
    if (over) {
      const me = state.scores[seat], them = state.scores[mover];
      result = h.t === 'resign' ? 'You win.' : me > them ? 'You won ' + me + '–' + them + '.' : me < them ? 'You lost ' + me + '–' + them + '.' : 'A tie at ' + me + '.';
    }
  } catch (e) { /* unreadable record: the plain wording stands */ }
  return {
    title: over ? 'Seven Tiles: game over' : 'Seven Tiles: your turn',
    body: over ? what + '. ' + (result || 'The game is over.') : what + '. Your move.',
    url: SITE + game,
    tag: 'seven-tiles-' + game   // a newer notification for the same game replaces the older one
  };
}
