// Brute-force route counter for Paper Route, kept apart from the logical
// grader in solver.js. It walks the route cell by cell from stop 1 and backs
// up on failure, pruning only with plainly safe tests:
//   - a stop may be entered only when it is the next one due
//   - the last stop may be entered only as the final cell
//   - every unvisited cell needs two usable neighbours (the last stop needs one),
//     counting the route's head as usable
//   - an unvisited cell whose only spare neighbour besides the head is one
//     cell must be the next move; two such cells is a dead end
//   - the unvisited cells must all be reachable from the head
//
// countRoutes(N, stops, walls, limit) returns { count, first, nodes }, where
// count stops at `limit` and first is the first route found (cell indices).

export function countRoutes(N, stops, walls = [], limit = 2, maxNodes = Infinity) {
  const V = N * N;
  const blocked = new Set();
  for (let i = 0; i + 1 < walls.length; i += 2) {
    const a = Math.min(walls[i], walls[i + 1]);
    const b = Math.max(walls[i], walls[i + 1]);
    blocked.add(a * V + b);
  }
  const nbr = Array.from({ length: V }, () => []);
  for (let v = 0; v < V; v++) {
    const r = Math.floor(v / N);
    const c = v % N;
    const cand = [];
    if (r > 0) cand.push(v - N);
    if (r < N - 1) cand.push(v + N);
    if (c > 0) cand.push(v - 1);
    if (c < N - 1) cand.push(v + 1);
    for (const u of cand) {
      const key = Math.min(u, v) * V + Math.max(u, v);
      if (!blocked.has(key)) nbr[v].push(u);
    }
  }
  const K = stops.length;
  const stopAt = new Int32Array(V);
  stops.forEach((v, i) => { stopAt[v] = i + 1; });
  const start = stops[0];
  const end = stops[K - 1];

  const seen = new Uint8Array(V);
  const route = new Int32Array(V);
  const mark = new Int32Array(V);
  const queue = new Int32Array(V);
  let stamp = 0;
  let count = 0;
  let nodes = 0;
  let first = null;

  // -2: dead position; -1: no forced move; otherwise the forced next cell.
  function inspect(head, filled) {
    let forced = -1;
    for (let w = 0; w < V; w++) {
      if (seen[w]) continue;
      let free = 0;
      let touchesHead = false;
      for (const u of nbr[w]) {
        if (!seen[u]) free++;
        else if (u === head) { free++; touchesHead = true; }
      }
      const want = w === end ? 1 : 2;
      if (free < want) return -2;
      if (touchesHead && free === want) {
        if (forced >= 0) return -2;
        forced = w;
      }
    }
    stamp++;
    let qh = 0;
    let qt = 0;
    let reached = 0;
    queue[qt++] = head;
    mark[head] = stamp;
    while (qh < qt) {
      const x = queue[qh++];
      for (const u of nbr[x]) {
        if (seen[u] || mark[u] === stamp) continue;
        mark[u] = stamp;
        reached++;
        queue[qt++] = u;
      }
    }
    if (reached < V - filled) return -2;
    return forced;
  }

  function walk(head, filled, due) {
    if (++nodes > maxNodes) throw new Error('node limit');
    if (filled === V) {
      if (head === end && due === K + 1) {
        count++;
        if (!first) first = Array.from(route);
      }
      return;
    }
    const forced = inspect(head, filled);
    if (forced === -2) return;
    for (const u of nbr[head]) {
      if (seen[u]) continue;
      if (forced >= 0 && u !== forced) continue;
      const k = stopAt[u];
      if (k && k !== due) continue;
      if (u === end && filled + 1 !== V) continue;
      seen[u] = 1;
      route[filled] = u;
      walk(u, filled + 1, k ? due + 1 : due);
      seen[u] = 0;
      if (count >= limit) return;
    }
  }

  seen[start] = 1;
  route[0] = start;
  if (V === 1) count = 1;
  else walk(start, 1, 2);
  return { count, first, nodes };
}
