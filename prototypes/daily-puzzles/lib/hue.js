// OKLCH hues for pieces and regions. Red means a mistake, so these skip the
// reds (roughly 335° through 360° to 55°). OKLCH spaces hues evenly to the eye,
// so equal steps look equally different. Golden-ratio steps through the
// allowed range keep neighbouring indexes far apart in colour.

const FROM = 60;
const SPAN = 275; // 60° (orange) to 335° (pink)

export const safeHue = (k) => Math.round(FROM + ((k * 0.6180339887 + 0.1) % 1) * SPAN);

// Hues for a map of regions, so regions that touch get hues far apart.
// adj[g] is the set of regions next to region g. Greedy, busiest region first:
// each takes the unused hue farthest from its neighbours' hues so far.
export function spreadHues(adj) {
  const pool = adj.map((_, k) => safeHue(k));
  const hue = adj.map(() => null);
  const order = adj.map((_, g) => g).sort((a, b) => adj[b].size - adj[a].size);
  for (const g of order) {
    let best = -1;
    let bestGap = -1;
    pool.forEach((h, k) => {
      if (h === null) return;
      let gap = 360;
      for (const o of adj[g]) if (hue[o] !== null) gap = Math.min(gap, Math.abs(h - hue[o]));
      if (gap > bestGap) { bestGap = gap; best = k; }
    });
    hue[g] = pool[best];
    pool[best] = null;
  }
  return hue;
}
