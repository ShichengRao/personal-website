// Red waits until a rule break has stood untouched for two seconds, so
// tapping through one piece on the way to another never flashes red.
//
// A view calls see(values) at the top of each render with one value per
// cell. The helper notes which cells changed since the last call and when.
// Then, for each rule break it finds, the view asks ripe(cells) with the
// cells behind that break. ripe is true once all of them have been still for
// the grace period. Otherwise it books a re-render for that moment.

export const GRACE_MS = 2000;

export function makeGrace(rerender, ms = GRACE_MS) {
  const changed = new Map(); // cell -> time of its last change
  let seen = null;
  let timer = 0;
  let due = Infinity;

  const fire = () => {
    timer = 0;
    due = Infinity;
    rerender();
  };

  return {
    see(values) {
      const t = performance.now();
      if (seen) {
        for (let i = 0; i < values.length; i++) if (values[i] !== seen[i]) changed.set(i, t);
      }
      seen = Array.from(values);
    },

    ripe(cells) {
      let latest = -Infinity;
      for (const i of cells) latest = Math.max(latest, changed.get(i) ?? -Infinity);
      const at = latest + ms;
      const now = performance.now();
      if (at <= now) return true;
      if (at < due) {
        clearTimeout(timer);
        due = at;
        timer = setTimeout(fire, at - now + 5);
      }
      return false;
    },

    stop() {
      clearTimeout(timer);
      timer = 0;
      due = Infinity;
    },
  };
}
