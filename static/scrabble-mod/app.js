/* Scrabble Mod page script: the board and rack UI, the bot's turns, pass-and-
   play on one device, online games against a Supabase project when the page
   has been given one, and a move-by-move review. All rules live in core.js.

   Every game has a three-word id that is also its address. Local games (bot,
   pass-and-play) are kept in this browser under that id; online games live on
   the server and are cached here. */
(function () {
  'use strict';
  const C = window.ScrabbleMod;
  const CFG = window.SM_CONFIG || {};
  const N = C.N;
  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $('sm-app'), wrap: $('sm-boardwrap'), board: $('sm-board'), rack: $('sm-rack'), msg: $('sm-msg'), status: $('sm-status'),
    log: $('sm-log'), overlay: $('sm-overlay'), bag: $('sm-bagn'), bagBtn: $('sm-bag'), players: [$('sm-p0'), $('sm-p1')],
    play: $('sm-play'), swap: $('sm-swap'), pass: $('sm-pass'), recall: $('sm-recall'), shuffle: $('sm-shuffle'),
    newBtn: $('sm-new'), help: $('sm-help'), resign: $('sm-resign'), online: $('sm-online-panel'),
    review: $('sm-review'), nav: $('sm-nav'), navLabel: $('sm-nav-label'), analysis: $('sm-analysis'), movesTitle: $('sm-moves-title'),
    zoomIn: $('sm-zoom-in'), zoomOut: $('sm-zoom-out'), zoomLabel: $('sm-zoom-label')
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const randomSeed = () => (Math.floor(Math.random() * 0x7fffffff) || 1);
  const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // ---- game ids and addresses --------------------------------------------
  const WORDS = ('acorn amber apple arrow badger bagel basil beach birch bison bloom brick brook cabin candle canoe cedar cherry ' +
    'cider cloud clover cobalt comet coral crane daisy delta dune eagle ember falcon fern finch flint forest garden ginger ' +
    'goose grape harbor hawk hazel heron honey ivory jade juniper kettle lagoon lantern lemon lilac lotus maple marble ' +
    'meadow mint moose moss olive orchid otter owl pebble pepper pine plum poppy quartz raven reed river robin saffron sage ' +
    'salmon shadow slate sparrow spruce stone summit thistle tiger timber tulip velvet violet walnut willow wren zebra').split(' ');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const newId = () => pick(WORDS) + '-' + pick(WORDS) + '-' + pick(WORDS);
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const BASE = location.pathname.replace(/(\/scrabble-mod\/).*$/, '$1');
  const pathFor = (id) => (id ? (LOCAL_HOST ? BASE + '?g=' + id : BASE + id) : BASE);
  const linkFor = (id, token) => location.origin + pathFor(id) + (token ? '#k=' + token : '');
  function idFromUrl() {
    const q = new URLSearchParams(location.search).get('g');
    if (q) return q.toLowerCase();
    const m = location.pathname.match(/\/scrabble-mod\/([a-z0-9-]+)\/?$/i);
    return m ? m[1].toLowerCase() : null;
  }
  // The private link's token, read once: whatever happens to the address while the
  // game loads (the menu, a sign-in round trip), the token is still here until a seat is settled.
  let linkToken = (location.hash.match(/[#&]k=([0-9a-f]{32,64})(?![0-9a-f])/) || [])[1] || null;
  let linkGame = linkToken ? idFromUrl() : null;
  try {   // a token stashed before a sign-in round trip (the address fragment is the sign-in's own on the way back)
    const st = JSON.parse(sessionStorage.getItem('sm.linkToken') || 'null');
    if (!linkToken && st && st.id === idFromUrl()) { linkToken = st.token; linkGame = st.id; }
  } catch (e) { /* no session storage */ }
  function tokenFromUrl(id) {
    const m = location.hash.match(/[#&]k=([0-9a-f]{32,64})(?![0-9a-f])/);
    if (m) { linkToken = m[1]; linkGame = idFromUrl(); }
    return id && linkGame && id !== linkGame ? null : linkToken;   // another game's link is not a way into this one
  }
  function dropLinkToken() {
    linkToken = null; linkGame = null;
    try { sessionStorage.removeItem('sm.linkToken'); } catch (e) { /* ignore */ }
    if (/[#&]k=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  const setUrl = (id) => history.replaceState(null, '', pathFor(id));

  // Saved games, by id. { id, kind, level, names, seed, moves, over, updated, online?: {token, player} }
  let saveWarned = false;
  const games = {
    all() { return store.get('sm.games', {}); },
    get(id) { return this.all()[id] || null; },
    put(rec) {
      const a = this.all(); rec.updated = Date.now(); a[rec.id] = rec;
      // finished games are kept for review, but not forever: the oldest go once there are fifty
      const done = Object.values(a).filter((r) => r.over && r.id !== rec.id).sort((x, y) => x.updated - y.updated);
      for (const r of done.slice(0, Math.max(0, done.length - 50))) delete a[r.id];
      if (!store.set('sm.games', a) && !saveWarned) { saveWarned = true; setStatus('This browser is not saving games (storage is full or blocked).', 'bad'); }
    },
    remove(id) { const a = this.all(); delete a[id]; store.set('sm.games', a); },
    list() { return Object.values(this.all()).sort((a, b) => b.updated - a.updated); }
  };
  (function migrate() {
    const old = store.get('sm.local', null);
    if (old && old.moves && old.seed) games.put({ id: newId(), kind: old.kind, level: old.level, names: old.names, seed: old.seed, moves: old.moves, over: !!old.over });
    store.del('sm.local'); store.del('sm.online');
  })();

  // ---- dictionary --------------------------------------------------------
  // dict: every legal word. common: the words most people know, which the
  // easy and medium bots are limited to and which the review rates against.
  let dict = null, common = null;
  let dictFailed = false;
  const dictReady = fetch(BASE + 'words.txt')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((t) => { dict = C.buildDict(t); })
    .catch((e) => { dictFailed = true; setStatus('The word list failed to load (' + e.message + '). Reload to try again.', 'bad'); if (ui.overlay.classList.contains('is-open') && $('sm-m-hotseat')) showMenu(); });
  const commonReady = fetch(BASE + 'common.txt')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((t) => { common = C.buildDict(t); })
    .catch(() => { /* the full list stands in */ });

  // ---- session -----------------------------------------------------------
  // G: { id, kind: 'bot'|'hotseat'|'online', level, names, state, me, online: {token}, hidden, session }
  let G = null;
  let sessions = 0;        // bumps per opened game; async callbacks check it
  let navGen = 0;          // bumps per navigation request; a stale open() gives up
  let pending = [];        // [{r, c, l, b, ri}] tiles placed this turn, ri = rack slot
  let sel = -1;            // selected rack slot
  let cursor = null;       // {r, c, down}
  let swapMode = false;
  let marks = new Set();   // rack slots marked for a swap
  let busy = false;        // a move is in flight (bot thinking, server call, list loading)
  let pollTimer = null, botTimer = null, lastHiddenPoll = 0;
  let statusIsPreview = false, stickyError = null;
  let R = null;            // review mode, see below
  let seenMoves = 0;       // history length already shown, for the bingo animation

  const alive = (s) => !!G && G.session === s;
  const myTurn = () => !!G && !R && !G.state.over && !busy && (G.kind === 'hotseat' ? !G.hidden : G.state.turn === G.me);
  const viewer = () => (G.kind === 'hotseat' ? G.state.turn : G.me);   // null for a spectator
  const nameOf = (p) => G.names[p] || (p === 0 ? 'Player 1' : 'Player 2');
  const isYou = (p) => G.kind !== 'hotseat' && p === G.me;

  function setStatus(text, kind) {
    ui.status.textContent = text || '';
    ui.status.className = 'sm-status' + (kind ? ' ' + kind : '');
    statusIsPreview = false;
    stickyError = kind === 'bad' ? text : null;
  }
  function draftChanged() { stickyError = null; }
  function resetTurnUi() { if (drag && drag.src && drag.src.kind === 'pending') endDrag(drag); pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); stickyError = null; }
  function leaveGame() {
    clearTimeout(botTimer); botTimer = null;
    stopPolling();
    G = null; R = null; busy = false; resetTurnUi();
    ui.board.classList.remove('valid', 'review');
  }

  // ---- board & rack rendering ---------------------------------------------
  const cells = [], cellHtml = [];   // cellHtml: what we last put in each cell, so animations survive renders
  for (let i = 0; i < N * N; i++) {
    const d = document.createElement('div');
    const bonus = C.bonusAt(i);
    d.className = 'sm-cell' + (bonus === '*' ? ' b-c' : bonus ? ' b-' + bonus : '');
    d.dataset.i = i;
    d.textContent = bonus === '*' ? '' : bonus;
    ui.board.appendChild(d);
    cells.push(d);
  }
  function tileHtml(l, b, cls) {
    return '<div class="sm-tile' + (b ? ' blank' : '') + (cls ? ' ' + cls : '') + '"><span>' + esc(l) + '</span><i>' + (b ? 0 : C.VALUE[l]) + '</i></div>';
  }
  // What the board shows: the live state, or a reviewed position.
  function shown() {
    if (!R) return { state: G.state, marked: lastPlayTiles(G.state.history), ghost: null };
    if (R.ghost) return { state: R.states[R.k - 1], marked: [], ghost: R.ghost.tiles };
    const h = R.k > 0 ? G.state.history[R.k - 1] : null;
    return { state: R.states[R.k], marked: h && h.t === 'play' ? h.tiles : [], ghost: null };
  }
  function lastPlayTiles(history) {
    for (let k = history.length - 1; k >= 0; k--) if (history[k].t === 'play') return history[k].tiles;
    return [];
  }
  function renderBoard() {
    const v = shown();
    const pend = new Map(pending.map((t) => [t.r * N + t.c, t]));
    const ghost = new Map((v.ghost || []).map((t) => [t.r * N + t.c, t]));
    const marked = new Set(v.marked.map((t) => t.r * N + t.c));
    for (let i = 0; i < N * N; i++) {
      const d = cells[i], t = v.state.board[i], p = pend.get(i), g = ghost.get(i);
      const bonus = C.bonusAt(i);
      let html;
      if (t) html = tileHtml(t.l, t.b, marked.has(i) ? 'recent' : '');
      else if (g) html = tileHtml(g.l, g.b, 'ghost');
      else if (p) html = tileHtml(p.l, p.b, 'pending');
      else html = bonus === '*' ? '' : esc(bonus);
      if (cellHtml[i] !== html) {
        if (drag && drag.active && drag.hiddenNode && d.contains(drag.hiddenNode)) { boardDirty = true; continue; }   // the node under the finger stays until release
        d.innerHTML = html; cellHtml[i] = html;
      }
      const isCur = !!cursor && cursor.r * N + cursor.c === i && myTurn();
      d.classList.toggle('cursor', isCur);
      d.classList.toggle('down', isCur && cursor.down);
    }
    ui.board.classList.toggle('review', !!R);
  }
  // The rack on show: the viewer's live rack, or in review the mover's rack
  // before the reviewed move when that is theirs to see.
  function rackShown() {
    if (R) {
      if (R.k === 0 || !canAnalyze(R.k)) return [];
      const before = R.states[R.k - 1];
      return before.racks[before.turn];
    }
    const p = viewer();
    return p === null ? [] : G.state.racks[p];
  }
  let rackDirty = false, boardDirty = false;   // a render was skipped mid-drag; redo it at release
  function renderRack() {
    if (drag && drag.active) { rackDirty = true; return; }
    const rack = rackShown();
    const used = new Set(pending.map((t) => t.ri));
    let html = '';
    for (let i = 0; i < C.RACK; i++) {
      const cls = ['sm-slot', sel === i ? 'sel' : '', marks.has(i) ? 'mark' : '', G.hidden ? 'hidden' : ''].join(' ').trim();
      const t = rack[i];
      // while hidden between pass-and-play turns, show anonymous backs: the letters must not reach the page at all
      const inner = G.hidden ? (t ? '<div class="sm-tile back" aria-hidden="true"></div>' : '') : (t && !used.has(i) ? tileHtml(t === '?' ? '?' : t, t === '?', '') : '');
      html += '<div class="' + cls + '" data-i="' + i + '">' + inner + '</div>';
    }
    ui.rack.innerHTML = html;
  }
  function describe(h) {
    const who = isYou(h.p) ? 'You' : esc(nameOf(h.p));
    if (h.t === 'play') return who + ' played <b>' + esc(h.word) + '</b> for <b>' + h.score + '</b> point' + (h.score === 1 ? '' : 's') + (h.bingo ? ' (bingo!)' : '');
    if (h.t === 'swap') return who + ' swapped ' + plural(h.n, 'tile');
    if (h.t === 'resign') return who + ' resigned';
    return who + ' passed';
  }
  function verdict(s) {
    const w = C.winner(s);
    return w === -1 ? 'A tie' : nameOf(w) + ' wins';
  }
  // Score of what is laid out, valid or not.
  function previewDraft(s) {
    const tiles = pending.map((t) => ({ r: t.r, c: t.c, l: t.l, b: t.b }));
    const geo = C.analyze(s.board, tiles);
    if (!geo.ok) return { ok: false, text: geo.reason, kind: '' };
    const extra = geo.words.slice(1).map((w) => w.word);
    let text = geo.main + ' for ' + plural(geo.score, 'point') + (extra.length ? ' (also ' + extra.join(', ') + ')' : '') + (geo.bingo ? ' — a bingo!' : '');
    const missing = dict ? geo.words.map((w) => w.word).filter((w) => !dict.has(w)) : [];
    if (missing.length) return { ok: false, score: geo.score, text: text + ', but ' + missing.join(', ') + (missing.length > 1 ? ' are' : ' is') + ' not in the word list', kind: '' };
    return { ok: true, score: geo.score, text, kind: 'good' };
  }
  function render() {
    if (!G) return;
    const s = G.state;
    for (let p = 0; p < 2; p++) {
      const el = ui.players[p];
      const handle = G.kind === 'online' && G.handles ? G.handles[p] : null;
      el.querySelector('.sm-name').textContent = nameOf(p) + (isYou(p) ? ' (you)' : '');
      el.querySelector('.sm-name').classList.toggle('link', !!handle);
      el.dataset.handle = handle || '';
      el.querySelector('.sm-score').textContent = R ? R.states[R.k].scores[p] : s.scores[p];
      el.classList.toggle('turn', !s.over && !R && s.turn === p);
    }
    ui.bag.textContent = R ? R.states[R.k].bag.length : s.bag.length;
    const h = s.history[s.history.length - 1];
    if (R) {
      const rh = R.k > 0 ? s.history[R.k - 1] : null;
      ui.msg.innerHTML = R.k === 0 ? '<b>Review.</b> The start of the game.' : '<b>Move ' + R.k + '.</b> ' + describe(rh) + (R.ghost ? ' · <i>showing ' + esc(R.ghost.word) + ' instead</i>' : '');
    } else if (s.over) ui.msg.innerHTML = '<b>Game over.</b> ' + esc(verdict(s)) + '.';
    else if (h) ui.msg.innerHTML = (G.kind === 'online' && G.me === null ? '<i>Watching.</i> ' : '') + describe(h) + (s.finalTurns !== null ? ' · <i>bag empty, last turns</i>' : '');
    else ui.msg.innerHTML = (isYou(s.turn) || G.kind === 'hotseat') ? 'Your move. The first word covers the center.' : esc(nameOf(s.turn)) + ' goes first.';
    renderBoard();
    renderRack();
    renderMoves();

    const mine = myTurn();
    const opt = C.options(s);
    let preview = null;
    if (mine && !swapMode && pending.length) preview = previewDraft(s);
    ui.board.classList.toggle('valid', !!(preview && preview.ok));
    if (stickyError) { /* an action failed: keep saying so until the draft changes */ }
    else if (preview) { setStatus(preview.text, preview.kind); statusIsPreview = true; }
    else if (statusIsPreview) setStatus('');
    ui.play.textContent = swapMode ? 'Swap ' + marks.size + ' & pass' : preview && preview.ok ? 'Play for ' + preview.score : 'Play';
    ui.play.disabled = !mine || (swapMode ? marks.size === 0 : opt.mustPass);
    ui.swap.disabled = !mine || !opt.swap;
    ui.swap.textContent = swapMode ? 'Cancel swap' : 'Swap';
    ui.pass.disabled = !mine || swapMode;
    ui.recall.disabled = !mine || !pending.length;
    ui.shuffle.disabled = !!R || viewer() === null || G.hidden;
    ui.resign.disabled = !!R || s.over || (G.kind === 'hotseat' ? false : G.me === null || (G.kind === 'online' && !G.names[1]));
    if (mine && opt.mustPass && !stickyError) setStatus('You have no tiles left. Pass to let ' + nameOf(1 - s.turn) + ' take the last turn.');
    renderOnlinePanel();
  }

  // ---- placing tiles -------------------------------------------------------
  function slotFor(letter) {
    const rack = G.state.racks[viewer()];
    const used = new Set(pending.map((t) => t.ri));
    let blank = -1;
    for (let i = 0; i < rack.length; i++) {
      if (used.has(i)) continue;
      if (rack[i] === letter) return { ri: i, b: false };
      if (rack[i] === '?' && blank < 0) blank = i;
    }
    return blank >= 0 ? { ri: blank, b: true } : null;
  }
  const occupied = (r, c) => !!G.state.board[r * N + c] || pending.some((t) => t.r === r && t.c === c);
  function advance() {
    if (!cursor) return;
    let { r, c } = cursor;
    do { if (cursor.down) r++; else c++; } while (r < N && c < N && occupied(r, c));
    cursor = (r < N && c < N) ? { r, c, down: cursor.down } : null;
  }
  async function place(r, c, ri, b) {
    let l = G.state.racks[viewer()][ri];
    if (b) {
      const s = G.session, before = pending.length;
      l = await pickLetter();
      if (!alive(s) || pending.length !== before || !l || !myTurn() || occupied(r, c)) { if (alive(s)) render(); return; }
    }
    pending.push({ r, c, l, b, ri });
    sel = -1;
    cursor = { r, c, down: cursor ? cursor.down : false };
    advance();
    draftChanged();
    render();
  }
  function takeBack(i) {
    const t = pending[i];
    pending.splice(i, 1);
    cursor = { r: t.r, c: t.c, down: cursor ? cursor.down : false };
    draftChanged();
    render();
  }
  function recall() { pending = []; sel = -1; draftChanged(); render(); }
  // Backspace: the tile under the cursor, else the nearest one behind it along
  // the current direction, else the last one placed.
  function backspace() {
    if (!pending.length) return;
    let idx = -1;
    if (cursor) {
      idx = pending.findIndex((t) => t.r === cursor.r && t.c === cursor.c);
      if (idx < 0) {
        let r = cursor.r, c = cursor.c;
        for (;;) {
          if (cursor.down) r--; else c--;
          if (r < 0 || c < 0) break;
          const j = pending.findIndex((t) => t.r === r && t.c === c);
          if (j >= 0) { idx = j; break; }
          if (!G.state.board[r * N + c]) break;
        }
      }
    }
    takeBack(idx >= 0 ? idx : pending.length - 1);
  }
  // Rack order is cosmetic; pending tiles follow their slot through any
  // rearrangement (by index, so two of the same letter cannot be confused).
  function permuteRack(rack, order) {   // order[newIndex] = oldIndex
    const old = rack.slice();
    const newOf = [];
    order.forEach((o, n) => { rack[n] = old[o]; newOf[o] = n; });
    for (const t of pending) if (newOf[t.ri] !== undefined) t.ri = newOf[t.ri];
  }
  function reorderRack(rack, from, to) {
    const order = rack.map((_, i) => i);
    const [m] = order.splice(from, 1);
    order.splice(to, 0, m);
    permuteRack(rack, order);
  }

  let suppressClick = false;
  ui.board.addEventListener('click', (e) => {
    if (suppressClick) return;
    const cell = e.target.closest('.sm-cell');
    if (!cell || !myTurn() || swapMode) return;
    const i = +cell.dataset.i, r = Math.floor(i / N), c = i % N;
    const pi = pending.findIndex((t) => t.r === r && t.c === c);
    if (pi >= 0) { takeBack(pi); return; }
    if (G.state.board[i]) return;
    if (sel >= 0) { place(r, c, sel, G.state.racks[viewer()][sel] === '?'); return; }
    if (cursor && cursor.r === r && cursor.c === c) cursor.down = !cursor.down;
    else cursor = { r, c, down: cursor ? cursor.down : false };
    ui.board.focus({ preventScroll: true });
    render();
  });
  ui.rack.addEventListener('click', (e) => {
    if (suppressClick) return;
    const slot = e.target.closest('.sm-slot');
    if (!slot || !G || R || G.hidden || viewer() === null) return;
    const i = +slot.dataset.i;
    const rack = G.state.racks[viewer()];
    if (i >= rack.length || pending.some((t) => t.ri === i)) return;
    if (swapMode) { if (marks.has(i)) marks.delete(i); else marks.add(i); render(); return; }
    if (!myTurn()) return;
    sel = sel === i ? -1 : i;
    render();
  });

  // ---- dragging tiles ---------------------------------------------------------
  // A tile lifted from the rack (or a placed tile) follows the finger. While
  // it is over the rack band the other tiles slide out of its way live, so
  // dropping anywhere in the band reorders the rack; over an empty square it
  // is placed. The band is generous above and below the rack, but a real
  // square always wins over it.
  //
  // Nothing under the finger is re-rendered while a drag is in progress:
  // touch browsers drop the pointer stream when its target leaves the DOM,
  // so the rack is rearranged by moving its tile nodes, and the full render
  // waits for the release.
  let drag = null;   // { src: {kind:'rack', i} | {kind:'pending', pi}, x, y, active, ghost, over, pointerId, lifted }
  const BAND = 70;
  function rackBand(x, y) {
    const b = ui.wrap.getBoundingClientRect();
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return false;   // over the board (even its gaps) is not the rack
    const r = ui.rack.getBoundingClientRect();
    return y >= r.top - BAND && y <= r.bottom + BAND && x >= r.left - 20 && x <= r.right + 20;
  }
  function slotIndexAt(x, count) {
    const r = ui.rack.getBoundingClientRect();
    const w = r.width / C.RACK;
    return Math.max(0, Math.min(count - 1, Math.floor((x - r.left) / w)));
  }
  function dropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.closest('.sm-cell');
    if (cell && ui.board.contains(cell)) return { kind: 'cell', el: cell, i: +cell.dataset.i };
    return null;
  }
  function setLifted(slot) {
    if (drag && drag.lifted) drag.lifted.classList.remove('lifted');
    if (slot) slot.classList.add('lifted');
    if (drag) drag.lifted = slot;
  }
  // Rearrange the rack's tile nodes to match a reorder and slide them over.
  function liveReorder(rack, from, to) {
    const slots = [...ui.rack.querySelectorAll('.sm-slot')].slice(0, rack.length);
    const tiles = slots.map((sl) => sl.querySelector('.sm-tile'));
    const rects = tiles.map((t) => t && t.getBoundingClientRect());
    const order = rack.map((_, i) => i);   // over the rack's own length: an endgame rack is shorter than the seven slots
    const [m] = order.splice(from, 1);
    order.splice(to, 0, m);            // order[newIndex] = oldIndex
    permuteRack(rack, order);
    slots.forEach((slot, j) => {
      const node = tiles[order[j]] || null;
      const cur = slot.querySelector('.sm-tile');
      if (cur && cur !== node && !tiles.includes(cur)) cur.remove();
      if (node && node.parentNode !== slot) slot.appendChild(node);
    });
    slots.forEach((slot, j) => {
      const node = tiles[order[j]];
      const before = rects[order[j]];
      if (!node || !before) return;
      const dx = before.left - slot.getBoundingClientRect().left;
      if (!dx) return;
      node.style.transition = 'none';
      node.style.transform = 'translateX(' + dx + 'px)';
      node.getBoundingClientRect();
      node.style.transition = 'transform .16s ease-out';
      node.style.transform = '';
    });
    setLifted(slots[to]);
  }
  function endDrag(d) {
    if (d.ghost) d.ghost.remove();
    if (d.over) d.over.el.classList.remove('drop');
    if (d.lifted) d.lifted.classList.remove('lifted');
    if (d.hiddenNode) d.hiddenNode.style.visibility = '';
    drag = null;
    if (rackDirty || boardDirty) { rackDirty = boardDirty = false; if (G) render(); }
  }
  function onPointerDown(e) {
    if (drag) { endDrag(drag); render(); }   // a drag whose release never arrived
    if (!G || R || G.hidden || viewer() === null || swapMode || e.button !== 0 || pinch.active) return;
    const tile = e.target.closest('.sm-tile');
    if (!tile) return;
    const slot = tile.closest('.sm-slot');
    let src = null;
    if (slot && ui.rack.contains(slot)) src = { kind: 'rack', i: +slot.dataset.i, slot };
    else if (tile.classList.contains('pending')) {
      const cell = tile.closest('.sm-cell');
      const pi = pending.findIndex((t) => t.r * N + t.c === +cell.dataset.i);
      if (pi < 0 || !myTurn()) return;
      src = { kind: 'pending', pi, node: tile };
    }
    if (!src) return;
    if (src.kind === 'rack' && pending.some((t) => t.ri === src.i)) return;
    drag = { src, x: e.clientX, y: e.clientY, active: false, ghost: null, over: null, pointerId: e.pointerId, lifted: null, hiddenNode: null };
  }
  function activateDrag() {
    const rack = G.state.racks[viewer()];
    const t = drag.src.kind === 'rack' ? rack[drag.src.i] : pending[drag.src.pi].l;
    const b = drag.src.kind === 'rack' ? t === '?' : pending[drag.src.pi].b;
    const ghost = document.createElement('div');
    ghost.className = 'sm-drag';
    ghost.innerHTML = tileHtml(t === '?' ? '?' : t, b, '');
    ui.app.appendChild(ghost);
    drag.ghost = ghost;
    drag.active = true;
    if (drag.src.kind === 'rack') setLifted(drag.src.slot);
    else { drag.hiddenNode = drag.src.node; drag.src.node.style.visibility = 'hidden'; }
  }
  // A placed tile carried into the rack becomes a rack tile mid-drag: the
  // model changes now, the board cell only hides its node until the release.
  function pendingToRack() {
    const t = pending[drag.src.pi];
    if (!t) { endDrag(drag); render(); return; }
    pending.splice(drag.src.pi, 1);
    cursor = { r: t.r, c: t.c, down: cursor ? cursor.down : false };
    draftChanged();
    const slot = ui.rack.querySelectorAll('.sm-slot')[t.ri];
    if (slot && !slot.querySelector('.sm-tile')) slot.innerHTML = tileHtml(t.b ? '?' : t.l, t.b, '');
    drag.src = { kind: 'rack', i: t.ri, slot };
    setLifted(slot);
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (pinch.active) { endDrag(drag); render(); return; }
    const rack = G.state.racks[viewer()];
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      activateDrag();
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const target = dropTarget(e.clientX, e.clientY);
    if (!target && rackBand(e.clientX, e.clientY)) {
      if (drag.over) { drag.over.el.classList.remove('drop'); drag.over = null; }
      if (drag.src.kind === 'pending') { pendingToRack(); if (!drag) return; }
      const idx = slotIndexAt(e.clientX, rack.length);
      if (idx !== drag.src.i) { const from = drag.src.i; drag.src.i = idx; liveReorder(rack, from, idx); }
      return;
    }
    if (drag.over && (!target || drag.over.el !== target.el)) drag.over.el.classList.remove('drop');
    if (target && (!drag.over || drag.over.el !== target.el)) {
      const ok = myTurn() && !G.state.board[target.i] && !pending.some((t) => t.r * N + t.c === target.i);
      if (ok) target.el.classList.add('drop');
    }
    drag.over = target;
  }
  async function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { drag = null; return; }   // a plain click; the click handlers take it
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (!d.active) activateDrag();   // a press-and-release jump with no moves between (some pointers do that)
    const rack = G.state.racks[viewer()];
    const target = dropTarget(e.clientX, e.clientY);
    if (!target && rackBand(e.clientX, e.clientY)) {
      if (d.src.kind === 'pending') { pendingToRack(); if (!drag) return; }
      const idx = slotIndexAt(e.clientX, rack.length);
      if (idx !== d.src.i) reorderRack(rack, d.src.i, idx);
      endDrag(d); render(); return;
    }
    endDrag(d);
    if (!target || !myTurn()) { render(); return; }
    const r = Math.floor(target.i / N), c = target.i % N;
    if (G.state.board[target.i] || pending.some((t) => t.r === r && t.c === c)) { render(); return; }
    if (d.src.kind === 'rack') { if (d.src.i < rack.length) place(r, c, d.src.i, rack[d.src.i] === '?'); else render(); return; }
    const t = pending[d.src.pi];
    if (!t) { render(); return; }
    t.r = r; t.c = c;
    cursor = { r, c, down: cursor ? cursor.down : false };
    advance();
    draftChanged();
    render();
    if (t.b) {   // a blank moved to a new square: ask again which letter it is
      const s = G.session;
      const l = await pickLetter();
      if (alive(s) && l && pending.includes(t)) { t.l = l; render(); }
    }
  }
  window.addEventListener('online', () => { if (G && G.kind === 'online' && G.offline) openOnline(G.id); });
  ui.rack.addEventListener('pointerdown', onPointerDown);
  ui.board.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', () => { if (drag) { endDrag(drag); render(); } });

  // ---- pinch to zoom the board ---------------------------------------------------
  // Two fingers on the board frame scale it between 1x and 3x around the
  // pinch midpoint. Touch events rather than pointer events: preventDefault
  // on touchmove is what actually stops the frame and the page scrolling
  // under the gesture, and updates are applied once per frame.
  const pinch = { active: false, dist: 0, zoom: 1, next: null, raf: 0 };
  const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  ui.wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    if (drag) { endDrag(drag); render(); }
    pinch.active = true; pinch.dist = touchDist(e.touches); pinch.zoom = zoom;
    e.preventDefault();
  }, { passive: false });
  ui.wrap.addEventListener('touchmove', (e) => {
    if (!pinch.active || e.touches.length !== 2) return;
    e.preventDefault();
    const wr = ui.wrap.getBoundingClientRect();
    pinch.next = {
      zoom: pinch.zoom * touchDist(e.touches) / pinch.dist,
      fx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - wr.left,
      fy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - wr.top
    };
    if (!pinch.raf) pinch.raf = requestAnimationFrame(() => { pinch.raf = 0; if (pinch.next) setZoom(pinch.next.zoom, pinch.next.fx, pinch.next.fy, false); });
  }, { passive: false });
  const pinchEnd = (e) => { if (pinch.active && e.touches.length < 2) { pinch.active = false; pinch.next = null; store.set('sm.zoom', zoom); } };
  ui.wrap.addEventListener('touchend', pinchEnd);
  ui.wrap.addEventListener('touchcancel', pinchEnd);

  // ---- keyboard ------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat && (e.key === 'Enter' || e.key === 'Escape')) return;
    if (ui.overlay.classList.contains('is-open')) {
      if (e.key === 'Escape' && !cancelPicker) {
        const out = [...ui.overlay.querySelectorAll('button')].find((b) => /^(Cancel|Close|Back|Back to the board|Not now|Look at the board|Got it)$/.test(b.textContent.trim()));
        if (out) { e.preventDefault(); out.click(); }
      }
      return;
    }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (R) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); reviewGo(R.k - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); reviewGo(R.k + 1); }
      else if (e.key === 'Escape') exitReview();
      return;
    }
    if (!myTurn()) return;
    if (e.key === 'Escape') { if (swapMode) { swapMode = false; marks = new Set(); setStatus(''); render(); } else recall(); return; }
    if (swapMode) return;
    if (e.key === 'Enter') { if (e.target && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return; e.preventDefault(); play(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { if (pending.length) { e.preventDefault(); backspace(); } return; }
    const boardFocus = e.target === document.body || ui.wrap.contains(e.target) || ui.board.contains(e.target);
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && cursor && boardFocus) {
      // an arrow sets the direction; a second press in that direction moves the cursor
      e.preventDefault();
      const down = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      if (cursor.down !== down) cursor.down = down;
      else {
        const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const r = cursor.r + dr, c = cursor.c + dc;
        if (r >= 0 && r < N && c >= 0 && c < N) { cursor.r = r; cursor.c = c; }
      }
      render();
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key) && cursor) {
      e.preventDefault();
      const L = e.key.toUpperCase();
      if (occupied(cursor.r, cursor.c)) return;
      const s = slotFor(L);
      if (!s) { setStatus('No ' + L + ' on your rack.', 'bad'); return; }
      pending.push({ r: cursor.r, c: cursor.c, l: L, b: s.b, ri: s.ri });
      advance();
      draftChanged();
      render();
    }
  });
  ui.recall.addEventListener('click', recall);
  ui.shuffle.addEventListener('click', () => {
    if (!G || R || G.hidden || viewer() === null) return;
    const rack = G.state.racks[viewer()];
    const order = rack.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    permuteRack(rack, order);
    sel = -1; marks = new Set();
    render();
  });
  ui.swap.addEventListener('click', () => {
    if (!myTurn()) return;
    swapMode = !swapMode; marks = new Set(); pending = []; sel = -1; draftChanged();
    render();
    setStatus(swapMode ? 'Pick the tiles to swap, then confirm. Swapping uses your turn.' : '');
  });
  ui.pass.addEventListener('click', () => {
    if (!myTurn()) return;
    if (pending.length) { setStatus('Recall your tiles before passing.', 'bad'); return; }
    if (G.state.racks[G.state.turn].length && !window.confirm('Pass this turn without playing?')) return;
    commit({ t: 'pass' });
  });
  ui.resign.addEventListener('click', () => {
    if (!G || R || G.state.over) return;
    if (G.kind === 'hotseat' ? G.hidden : (G.state.turn !== G.me || busy)) { setStatus('You can resign on your own turn.'); return; }
    if (G.kind === 'online' && !G.names[1]) { setStatus('Nobody has joined yet; there is no one to resign to.'); return; }
    if (!window.confirm('Resign this game? ' + nameOf(1 - G.state.turn) + ' will take the win.')) return;
    commit({ t: 'resign' });
  });
  ui.play.addEventListener('click', play);
  function play() {
    if (!myTurn()) return;
    if (swapMode) {
      const rack = G.state.racks[viewer()];
      commit({ t: 'swap', tiles: [...marks].map((i) => rack[i]) });
      return;
    }
    if (!pending.length) { setStatus('Place some tiles first: click a square and type, or drag a tile from the rack.'); return; }
    commit({ t: 'play', tiles: pending.map((t) => ({ r: t.r, c: t.c, l: t.l, b: t.b })) });
  }

  // ---- moves ----------------------------------------------------------------
  async function commit(move) {
    if (!G || busy || R) return;
    // lock before the first await, and give up if the game moved on meanwhile
    const s = G.session, p = G.state.turn, idx = G.state.moves.length;
    if (!dict) {
      busy = true; render(); setStatus('Loading the word list…');
      await dictReady;
      if (!alive(s)) return;
      busy = false;
      if (!dict || G.state.turn !== p || G.state.moves.length !== idx) { render(); return; }
    }
    const res = C.check(G.state, move, dict);
    if (!res.ok) { setStatus(res.reason, 'bad'); return; }
    if (G.kind !== 'online') { applyLocal(move); return; }
    busy = true; render(); setStatus('Sending…');
    let moves;
    try {
      moves = await Net.rpc('play_move', { p_code: G.id, p_token: G.online.token, p_index: idx, p_move: Object.assign({ t: move.t, d: C.pack(G.id, move) }, move.t === 'play' ? { n: move.tiles.length } : {}) });
    } catch (e) {
      if (!alive(s)) return;
      busy = false; setStatus('Could not send that move: ' + e.message, 'bad'); render();
      syncOnline();
      return;
    }
    if (!alive(s)) return;
    busy = false;
    setStatus('');
    integrate(moves, null);
  }
  // A move arrived while a review snapshot exists: extend it rather than
  // leaving navigation pointing at positions it does not have.
  function extendReview() {
    if (!R || R.states.length >= G.state.moves.length + 1) return;
    while (R.states.length < G.state.moves.length + 1) {
      const k = R.states.length - 1;
      R.states.push(C.apply(R.states[k], G.state.moves[k], null));
    }
    R.summary = null; computeSummary();
  }
  function applyLocal(move) {
    G.state = C.apply(G.state, move, dict);
    extendReview();
    resetTurnUi();
    setStatus('');
    if (G.kind === 'hotseat' && !G.state.over) G.hidden = true;
    persist();
    render();
    afterMove();
  }
  async function reportResult() {
    if (!G || G.kind !== 'online' || !G.state.over || G.me === null || G.reported) return;
    G.reported = true;
    const s = G.session;
    await dictReady; await commonReady;
    if (!alive(s) || !dict) return;
    try {
      // spread the per-turn analysis over frames so the game-over screen stays responsive
      const result = await C.computeResult(G.state, dict, common, (go) => setTimeout(go, 0));
      if (!alive(s)) return;
      await Net.rpc('finish_game', { p_code: G.id, p_token: G.online.token, p_result: result });
    } catch (e) { if (alive(s)) G.reported = false; }
  }
  commonReady.then(() => {
    if (!R) return;
    for (const [k, a] of R.cands) if (a.provisional) R.cands.delete(k);
    R.summary = null; computeSummary(); render();
  });
  function afterMove() {
    celebrateNew();
    if (G.state.over) { stopPolling(); reportResult(); showGameOver(); if (G.kind === 'online') startPolling(); return; }
    if (G.kind === 'bot' && G.state.turn !== G.me) scheduleBot();
    else if (G.kind === 'hotseat') showHandoff();
    else if (G.kind === 'online') {
      startPolling();
      if (G.state.turn === G.me && C.options(G.state).mustPass) commit({ t: 'pass' });
    }
  }
  function scheduleBot() {
    clearTimeout(botTimer);
    const s = G.session;
    busy = true; render();
    setStatus(nameOf(1 - G.me) + ' is thinking…');
    botTimer = setTimeout(async () => {
      await dictReady; await commonReady;
      if (!alive(s)) return;
      if (G.kind !== 'bot' || G.state.over || G.state.turn === G.me || !dict) { busy = false; render(); return; }
      const move = C.botMove(G.state, G.level, Math.random, dict, { vocab: common || dict });
      busy = false;
      applyLocal(move);
    }, 650);
  }
  function persist() {
    if (!G || (G.kind === 'online' && G.me === null)) return;
    const was = games.get(G.id);
    games.put({ id: G.id, kind: G.kind, level: G.level, names: G.names, seed: G.state.seed, moves: G.state.moves, over: G.state.over,
                online: G.kind === 'online' ? { token: G.online.token, player: G.me } : undefined, attached: !!(was && was.attached) });
  }
  // A bingo just landed on the board: say so.
  function celebrateNew() {
    const hist = G.state.history;
    const fresh = hist.slice(seenMoves);
    seenMoves = hist.length;
    const bingo = fresh.find((h) => h.t === 'play' && h.bingo);
    if (!bingo || R) return;
    const who = isYou(bingo.p) ? 'You' : nameOf(bingo.p);
    const banner = document.createElement('div');
    banner.className = 'sm-bingo';
    banner.innerHTML = 'Bingo!<small>' + esc(who) + ': ' + esc(bingo.word) + ' for ' + bingo.score + '</small>';
    const confetti = document.createElement('div');
    confetti.className = 'sm-confetti';
    const colors = ['#c99a2e', '#1f6f6a', '#d1495b', '#5b8dd9', '#2e8b57'];
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('i');
      p.style.left = (50 + (Math.random() - 0.5) * 40) + '%';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 300) + 'px');
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      confetti.appendChild(p);
    }
    ui.wrap.appendChild(confetti);
    ui.wrap.appendChild(banner);
    bingo.tiles.forEach((t, k) => {
      const el = cells[t.r * N + t.c].querySelector('.sm-tile');
      if (el) { el.style.animationDelay = (k * 60) + 'ms'; el.classList.add('bounce'); }
    });
    setTimeout(() => { banner.remove(); confetti.remove(); }, 2600);
  }

  // ---- review -----------------------------------------------------------------------
  // R: { k, states, cands: Map<k, analysis>, ghost, summary }. k is the move
  // under review (1..M); the board shows the position after it, the analysis
  // compares it with every play available before it. k = 0 is the start.
  function canAnalyze(k) {
    const p = R.states[k - 1].turn;
    if (G.state.over) return true;
    if (G.kind === 'hotseat') return !G.hidden && p === G.state.turn;
    return p === G.me;
  }
  // Against a person the review waits for the end of the game: past best
  // plays are hints about the board that is still in play. Against a bot it
  // is open at any time.
  const reviewAllowed = () => !!G && (G.kind === 'bot' || G.state.over);
  function enterReview(k) {
    if (!G || !dict || !reviewAllowed()) return;
    R = { k: 0, states: C.positions(G.state.seed, G.state.moves), cands: new Map(), ghost: null, summary: null };
    resetTurnUi();
    ui.board.classList.remove('valid');
    reviewGo(k);
    computeSummary();
  }
  function exitReview() {
    if (!R) return;
    R = null;
    render();
  }
  function reviewGo(k) {
    if (!R) return;
    R.k = Math.max(0, Math.min(G.state.moves.length, k));
    R.ghost = null;
    render();
  }
  // Every play available before move k, ranked by equity, with the played one
  // found. Ratings are measured against the best play made of common words
  // (or an exchange, when that is the best common option); a better play that
  // needs a rare word is reported separately as the expert play.
  function analysis(k) {
    if (R.cands.has(k)) return R.cands.get(k);
    const a = evaluateTurn(R.states[k - 1], G.state.moves[k - 1], G.state.history[k - 1]);
    if (!common) a.provisional = true;   // rated against the full list; redone once common.txt arrives
    R.cands.set(k, a);
    return a;
  }
  const evaluateTurn = (before, move, h) => C.evaluateTurn(before, move, h, dict, common);
  let summaryGen = 0;
  function computeSummary() {
    const session = G.session, states = R.states, gen = ++summaryGen;
    const rows = [];
    let k = 1;
    const step = () => {
      if (!alive(session) || !R || R.states !== states || gen !== summaryGen) return;
      const t0 = Date.now();
      while (k <= G.state.moves.length && Date.now() - t0 < 40) {
        if (canAnalyze(k) && G.state.moves[k - 1].t !== 'resign') { const a = analysis(k); rows.push({ k, p: states[k - 1].turn, grade: a.grade, rating: a.rating, label: a.playedLabel, best: a.ref }); }
        k++;
      }
      R.summary = { rows, done: k > G.state.moves.length };
      renderMoves();
      if (!R.summary.done) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
  function renderMoves() {
    const s = G.state, M = s.moves.length;
    ui.review.textContent = R ? 'Live' : 'Review';
    ui.review.disabled = !R && (M === 0 || !dict || !reviewAllowed());
    ui.review.title = !R && G && !reviewAllowed() ? 'Against a person, the review opens when the game is over' : '';
    ui.movesTitle.textContent = R ? 'Review' : 'Moves';
    ui.nav.hidden = !R;
    let html = '';
    s.history.forEach((e, i) => {
      const what = e.t === 'play' ? esc(e.word) + (e.bingo ? ' <small style="color:var(--good)">bingo</small>' : '') : e.t === 'swap' ? 'swap ×' + e.n : e.t;
      const grade = R && R.summary ? (R.summary.rows.find((r) => r.k === i + 1) || {}).grade : null;
      html += '<li data-k="' + (i + 1) + '"' + (R && R.k === i + 1 ? ' class="cur"' : '') + '><span><span class="n">' + (i + 1) + '.</span><span class="who">' + esc(nameOf(e.p)) + '</span>' + what + '</span>' +
        '<b>' + (e.t === 'play' ? '+' + e.score : '') + (grade === 'miss' ? ' <span style="color:var(--bad)">?</span>' : grade === 'brilliant' ? ' <span style="color:var(--good)">‼</span>' : grade === 'best' ? ' <span style="color:var(--good)">★</span>' : '') + '</b></li>';
    });
    ui.log.innerHTML = html || '<li><span class="who">No moves yet.</span></li>';
    ui.log.querySelectorAll('li[data-k]').forEach((li) => li.addEventListener('click', () => { if (!dict || !reviewAllowed()) return; if (R) reviewGo(+li.dataset.k); else enterReview(+li.dataset.k); }));
    ui.log.classList.toggle('locked', !reviewAllowed());
    if (!R) { ui.analysis.hidden = true; return; }
    ui.navLabel.textContent = R.k === 0 ? 'Start' : 'Move ' + R.k + ' of ' + M;
    $('sm-nav-first').disabled = R.k === 0; $('sm-nav-prev').disabled = R.k === 0;
    $('sm-nav-next').disabled = R.k >= M; $('sm-nav-last').disabled = R.k >= M;
    ui.analysis.hidden = false;
    let a = '';
    if (R.k > 0 && canAnalyze(R.k) && s.moves[R.k - 1].t !== 'resign') {
      const an = analysis(R.k), who = isYou(s.history[R.k - 1].p) ? 'You' : nameOf(s.history[R.k - 1].p);
      const playedRare = an.played !== null && an.played >= 0 && !an.list[an.played].common;
      const rankTxt = an.played === null || an.played < 0 ? '' : playedRare ? ' (a rare word: #' + (an.played + 1) + ' of ' + an.list.length + ' plays in the full list)' : ' (#' + (an.list.slice(0, an.played).filter((m) => m.common).length + 1) + ' of ' + an.commonList.length + ' common plays)';
      const refTxt = an.ref ? (an.ref.t === 'swap' ? 'exchanging ' + esc(an.ref.tiles.join('')) + ' and keeping ' + esc(an.ref.keeps || 'nothing') : an.ref.t === 'pass' ? 'passing' : esc(an.ref.word) + ' for ' + an.ref.score) : '';
      const refIsPlayed = an.played !== null && an.played >= 0 && an.ref === an.list[an.played];
      const refKind = an.ref && an.ref.t !== 'swap' && an.ref.t !== 'pass' && !an.ref.common ? 'The best play in the full list was ' : 'The best common play was ';
      if (!an.ref) a += '<div class="sm-verdict">No play was available; ' + esc(who.toLowerCase() === 'you' ? 'you' : who) + ' ' + esc(an.playedLabel) + '.</div>';
      else if (an.grade === 'brilliant') a += '<div class="sm-verdict best"><b>Brilliant: ' + esc(who) + ' beat every common play, rated ' + an.rating + '.</b> ' + esc(an.playedLabel) + rankTxt + ' ' + refKind + refTxt + '.</div>';
      else if (an.grade === 'best') a += '<div class="sm-verdict best"><b>' + esc(who) + ' found the best play.</b> ' + esc(an.playedLabel) + rankTxt + (playedRare && !refIsPlayed ? ' ' + refKind + refTxt + '.' : '') + '</div>';
      else a += '<div class="sm-verdict ' + (an.grade === 'miss' ? 'miss' : '') + '"><b>' + esc(who) + ': ' + esc(an.playedLabel) + rankTxt + ', rated <b>' + an.rating + '</b>.</b> The best play was ' + refTxt + '.</div>';
      if (an.expert) a += '<div class="sm-note" style="margin:-2px 0 8px">With the full word list an expert had <b>' + esc(an.expert.word) + '</b> for ' + an.expert.score + '. Ratings do not count rare words against you.</div>';
      // the same word in several spots with the same score is one line, unless one of them is the played spot
      const top = [];
      const seenKey = new Set();
      for (const m of an.commonList) {
        const key = m.word + '|' + m.score + '|' + m.keeps;
        const idx = an.list.indexOf(m);
        if (idx === an.played) { top.push(m); seenKey.add(key); continue; }
        if (seenKey.has(key)) continue;
        if (top.length >= 5) break;
        seenKey.add(key); top.push(m);
      }
      if (an.exch && (an.playedSwap || top.length < 5 || an.exch.equity > top[top.length - 1].equity)) { top.push(an.exch); top.sort((x, y) => y.equity - x.equity); }
      if (an.played !== null && an.played >= 0 && !top.includes(an.list[an.played])) top.push(an.list[an.played]);
      if (top.length) {
        a += '<div class="sm-cands"><div class="head"><span>Top plays</span><span>score</span><span></span><span>rating</span></div>';
        top.forEach((m) => {
          const idx = an.list.indexOf(m);
          const isPlayed = m.t === 'swap' ? an.playedSwap && G.state.moves[R.k - 1].tiles.slice().sort().join('') === m.tiles.slice().sort().join('') : idx === an.played;
          const rare = m.t !== 'swap' && !m.common ? ' <small style="color:var(--dw-ink)">rare word</small>' : '';
          a += '<div ' + (m.t === 'swap' ? '' : 'data-c="' + idx + '" ') + 'class="' + (isPlayed ? 'played' : '') + (R.ghost === m ? ' ghost' : '') + '"><span><b>' + esc(m.word) + '</b> <small>' + (m.keeps ? 'keeps ' + esc(m.keeps) : m.t === 'swap' ? 'keeps nothing' : 'plays out') + '</small>' + rare + '</span><span>' + m.score + '</span><span></span><b>' + m.rating + '</b></div>';
        });
        a += '</div><div class="sm-note" style="margin:-4px 0 10px">The best play with common words rates 100; the rest by how they compare, counting the tiles each keeps. A rare word that beats them all rates above 100. Click a play to see it on the board; click again to go back.</div>';
      }
    } else if (R.k > 0) a += '<div class="sm-verdict">' + esc(nameOf(s.history[R.k - 1].p)) + '’s turn. Their rack and options stay hidden until the game is over.</div>';
    if (R.summary) {
      const misses = R.summary.rows.filter((r) => r.grade === 'miss').sort((x, y) => x.rating - y.rating);
      const brilliant = R.summary.rows.filter((r) => r.grade === 'brilliant').sort((x, y) => y.rating - x.rating);
      const bests = R.summary.rows.filter((r) => r.grade === 'best');
      const rated = R.summary.rows.length;
      a += '<div class="sm-k">Summary' + (R.summary.done ? '' : ' (working…)') + '</div><div class="sm-summary">';
      const avg = rated ? Math.round(R.summary.rows.reduce((t, r) => t + r.rating, 0) / rated) : 0;
      a += '<div class="sm-note" style="margin:0 0 4px">' + rated + ' turn' + (rated === 1 ? '' : 's') + ' rated · average <b>' + avg + '</b> · ' + (brilliant.length ? brilliant.length + ' brilliant · ' : '') + bests.length + ' best · ' + misses.length + ' to improve</div>';
      if (brilliant.length) { a += '<div class="sm-k" style="margin-top:6px">Brilliancies</div>'; brilliant.forEach((r) => { a += '<div data-k="' + r.k + '">' + r.k + '. ' + (G.kind === 'hotseat' || G.me === null ? esc(nameOf(r.p)) + ': ' : '') + esc(r.label) + ' <b style="color:var(--good)">' + r.rating + '</b></div>'; }); }
      if (misses.length) { a += '<div class="sm-k" style="margin-top:6px">Could do better</div>'; misses.forEach((r) => { a += '<div data-k="' + r.k + '">' + r.k + '. ' + (G.kind === 'hotseat' || G.me === null ? esc(nameOf(r.p)) + ': ' : '') + esc(r.label) + ' <b style="color:var(--bad)">' + r.rating + '</b> <small>(best ' + esc(r.best.word) + (r.best.t === 'swap' ? '' : ' ' + r.best.score) + ')</small></div>'; }); }
      if (bests.length) { a += '<div class="sm-k" style="margin-top:6px">Best plays</div>'; bests.forEach((r) => { a += '<div data-k="' + r.k + '">' + r.k + '. ' + (G.kind === 'hotseat' || G.me === null ? esc(nameOf(r.p)) + ': ' : '') + esc(r.label) + ' <b style="color:var(--good)">★</b></div>'; }); }
      a += '</div>';
    }
    ui.analysis.innerHTML = a;
    ui.analysis.querySelectorAll('.sm-cands div[data-c]').forEach((d) => d.addEventListener('click', () => {
      const m = analysis(R.k).list[+d.dataset.c];
      R.ghost = R.ghost === m ? null : m;
      render();
    }));
    ui.analysis.querySelectorAll('.sm-summary div[data-k]').forEach((d) => d.addEventListener('click', () => reviewGo(+d.dataset.k)));
  }
  ui.review.addEventListener('click', () => { if (!G) return; if (R) exitReview(); else enterReview(G.state.moves.length); });
  $('sm-nav-first').addEventListener('click', () => reviewGo(0));
  $('sm-nav-prev').addEventListener('click', () => reviewGo(R.k - 1));
  $('sm-nav-next').addEventListener('click', () => reviewGo(R.k + 1));
  $('sm-nav-last').addEventListener('click', () => reviewGo(G.state.moves.length));

  // ---- overlays ---------------------------------------------------------------
  let cancelPicker = null, cancelAsk = null, focusBefore = null;
  const behindOverlay = () => {
    const out = [];
    for (let el = ui.overlay; el && el.parentElement && el !== document.body; el = el.parentElement) {
      for (const sib of el.parentElement.children) if (sib !== el) out.push(sib);
    }
    return out;
  };
  function openOverlay(html) {
    if (cancelPicker) cancelPicker();   // a picker still waiting is over: whatever replaces it wins
    if (cancelAsk) cancelAsk();
    if (!ui.overlay.classList.contains('is-open')) focusBefore = document.activeElement;
    ui.overlay.innerHTML = '<div class="sm-card" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>';
    ui.overlay.classList.add('is-open');
    for (const el of behindOverlay()) el.inert = true;   // nothing behind the card can be reached or activated
    ui.overlay.firstElementChild.focus({ preventScroll: true });   // the card itself, so a key still held down activates nothing
  }
  function closeOverlay() {
    if (cancelPicker) cancelPicker();
    if (cancelAsk) cancelAsk();
    ui.overlay.classList.remove('is-open'); ui.overlay.innerHTML = '';
    for (const el of behindOverlay()) el.inert = false;
    if (focusBefore && focusBefore.isConnected && typeof focusBefore.focus === 'function') focusBefore.focus({ preventScroll: true });
    focusBefore = null;
  }

  function pickLetter() {
    return new Promise((resolve) => {
      let html = '<h2>Blank tile</h2><p>Which letter is it?</p><div class="sm-letters">';
      for (let i = 0; i < 26; i++) html += '<button data-l="' + String.fromCharCode(65 + i) + '">' + String.fromCharCode(65 + i) + '</button>';
      html += '</div><button data-l="">Cancel</button>';
      openOverlay(html);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        cancelPicker = null;
        document.removeEventListener('keydown', onKey, true);
        closeOverlay();
        resolve(v);
      };
      // another overlay taking the picker's place answers it with nothing, and drops its key listener
      cancelPicker = () => { if (done) return; done = true; cancelPicker = null; document.removeEventListener('keydown', onKey, true); resolve(null); };
      const onKey = (e) => {
        if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); finish(e.key.toUpperCase()); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      };
      ui.overlay.querySelectorAll('button[data-l]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.l || null)));
      document.addEventListener('keydown', onKey, true);
    });
  }
  function askText(title, body, placeholder, initial) {
    return new Promise((resolve) => {
      openOverlay('<h2>' + esc(title) + '</h2><p>' + body + '</p><input type="text" id="sm-ask" maxlength="24" placeholder="' + esc(placeholder) + '" value="' + esc(initial || '') + '">' +
        '<div class="sm-row" style="justify-content:center;margin-top:12px"><button id="sm-ask-cancel">Cancel</button><button class="primary" id="sm-ask-ok">Continue</button></div>');
      const inp = $('sm-ask');
      inp.focus(); inp.select();
      let settled = false;
      cancelAsk = () => { if (settled) return; settled = true; cancelAsk = null; resolve(null); };
      const done = (v) => { if (settled) return; settled = true; cancelAsk = null; closeOverlay(); resolve(v); };
      $('sm-ask-ok').addEventListener('click', () => done(inp.value.trim() || null));
      $('sm-ask-cancel').addEventListener('click', () => done(null));
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); });
    });
  }

  function gameLabel(rec) {
    const kind = rec.kind === 'bot' ? 'vs Bot (' + rec.level + ')' : rec.kind === 'hotseat' ? 'Pass and play' : 'Online' + (rec.names && rec.names[1] ? ': ' + rec.names[0] + ' vs ' + rec.names[1] : rec.names && rec.names[0] ? ' with ' + rec.names[0] : '');
    const n = rec.moves ? rec.moves.length : 0;
    let when;
    if (rec.over) when = 'finished';
    else if (rec.kind === 'online' && rec.online && rec.online.player !== null) when = (n % 2 === rec.online.player) ? 'your turn' : 'their turn';
    else when = plural(n, 'move') + ' in';
    return { kind, when };
  }
  let menuNote = null;
  // a navigation that failed: the message goes on the status line and into the menu card that follows
  function failToMenu(msg) { setStatus(msg, 'bad'); menuNote = msg; showMenu(); }
  function showMenu() {
    if (G) setUrl(null);   // with no game open the address is the one still loading, or the home page already
    const list = games.list();
    const noDict = dictFailed ? ' disabled' : '';
    const note = menuNote ? '<p class="sm-card-note">' + esc(menuNote) + '</p>' : '';
    menuNote = null;
    let html = '<h2>Scrabble Mod</h2><p>Two racks, one bag, a 15×15 board.</p>' + note + (dictFailed ? '<p style="color:var(--bad)">The word list did not load, so no new game can start. Reload to try again.</p>' : '') + '<div class="sm-choices">' +
      '<button data-bot="easy"' + noDict + '><b>Play the bot: easy</b><small>common words only, and a middling play</small></button>' +
      '<button data-bot="medium"' + noDict + '><b>Play the bot: medium</b><small>common words only, and a good play</small></button>' +
      '<button data-bot="hard"' + noDict + '><b>Play the bot: hard</b><small>every word in the list, the strongest play it can find</small></button>' +
      '<button id="sm-m-hotseat"' + noDict + '><b>Two players, one device</b><small>pass it back and forth; racks hide between turns</small></button>' +
      '<button id="sm-m-online"' + (Net.enabled && navigator.onLine !== false ? '' : ' disabled') + '><b>Play a friend online</b><small>' + (!Net.enabled ? 'not set up on this site yet' : navigator.onLine === false ? 'you are offline' : 'share a link; take turns whenever') + '</small></button>' +
      '</div>';
    if (list.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:14px">Your games</div><div class="sm-games">';
      for (const rec of list) {
        const l = gameLabel(rec);
        html += '<button data-open="' + esc(rec.id) + '"><b' + (l.when === 'your turn' ? ' class="now"' : '') + '>' + esc(l.kind) + '</b> <small>' + esc(l.when) + ' · ' + esc(rec.id) + '</small></button>';
      }
      html += '</div>';
    }
    if (user) html += '<div class="sm-note" id="sm-m-mine">Looking up your games…</div>';
    if (Net.enabled) html += '<div style="margin-top:12px;display:flex;justify-content:center">' + authRowHtml() + '</div>';
    if (G) html += '<div class="sm-row" style="justify-content:center;margin-top:10px"><button id="sm-m-back">Back to the board</button></div>';
    openOverlay(html);
    if (Net.enabled) bindAuth(ui.overlay);
    if (user) {
      // games on the account that this browser has not seen (other devices, or a cleared browser)
      Net.rpc('my_games').then((mine) => {
        const note = $('sm-m-mine');
        if (!note) return;
        const extra = (mine || []).filter((m) => !games.get(m.id));
        if (!extra.length) { note.remove(); return; }
        let h = '<div class="sm-k" style="text-align:left;margin-top:10px">Your games on other devices</div><div class="sm-games">';
        for (const m of extra) {
          const who = m.p2_name ? m.p1_name + ' vs ' + m.p2_name : 'with ' + m.p1_name;
          const when = (m.finished || m.resigned) ? 'finished' : (m.moves % 2 === m.seat ? 'your turn' : m.p2_name ? 'their turn' : 'waiting for a player');
          h += '<button data-open="' + esc(m.id) + '"><b' + (when === 'your turn' ? ' class="now"' : '') + '>Online: ' + esc(who) + '</b> <small>' + esc(when) + ' · ' + esc(m.id) + '</small></button>';
        }
        const holder = document.createElement('div');
        holder.innerHTML = h + '</div>';
        const added = [...holder.querySelectorAll('button[data-open]')];
        note.replaceWith(...holder.childNodes);
        added.forEach((b) => b.addEventListener('click', () => { closeOverlay(); openGame(b.dataset.open); }));
      }).catch(() => { const note = $('sm-m-mine'); if (note) note.textContent = 'Could not look up your games.'; });
    }
    ui.overlay.querySelectorAll('button[data-bot]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); startLocal('bot', b.dataset.bot); }));
    ui.overlay.querySelectorAll('button[data-open]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); openGame(b.dataset.open); }));
    $('sm-m-hotseat').addEventListener('click', () => { closeOverlay(); startLocal('hotseat'); });
    $('sm-m-online').addEventListener('click', () => { closeOverlay(); createOnline(); });
    const back = $('sm-m-back');
    if (back) back.addEventListener('click', () => { closeOverlay(); setUrl(G.id); });
  }
  function showHandoff() {
    openOverlay('<h2>' + esc(nameOf(G.state.turn)) + '’s turn</h2><p>Pass the device over. The rack stays hidden until you tap.</p><button class="primary" id="sm-reveal">Show my rack</button>');
    $('sm-reveal').addEventListener('click', () => { G.hidden = false; closeOverlay(); render(); });
  }
  function showHelp() {
    openOverlay('<h2>How to play</h2>' +
      '<p class="left">Each player holds 7 tiles from a bag of 100, including three blanks. Make words across or down that connect to what is on the board; the first word covers the center. Every word formed must be in the word list.</p>' +
      '<p class="left">Letter values add up. Bonus squares double or triple a letter or the whole word. Using all 7 tiles in one turn is a <b>bingo</b>, worth 40 extra points.</p>' +
      '<p class="left">Instead of playing you can <b>swap</b> any of your tiles, which uses your turn, or <b>pass</b>. Once the bag is empty each player gets one last turn, then the higher score wins. Leftover tiles do not count against you. Four passes in a row end the game.</p>' +
      '<div class="sm-keys">' +
      '<div><b>Placing tiles:</b> drag a tile onto the board, or click a square and type, or click a tile and then a square. Drag tiles around the rack to reorder them.</div>' +
      '<div><kbd>→</kbd> <kbd>↓</kbd> switch across and down · <kbd>⌫</kbd> take back the tile at the cursor · <kbd>↵</kbd> play · <kbd>Esc</kbd> recall</div>' +
      '<div><b>Review:</b> click any move in the list to step through the game (against a person, once the game is over). <kbd>←</kbd> <kbd>→</kbd> move between turns. Ratings compare your move with the best play made of common words: that play is 100, and a rare word that beats it rates above 100. A better rare-word play you did not find is noted separately.</div>' +
      '<div><b>Word lists:</b> plays are checked against ENABLE, the public-domain list. The easy and medium bots, and the ratings, use only its common words.</div>' +
      '</div>' +
      '<button class="primary" id="sm-help-ok" style="margin-top:12px">Got it</button>');
    $('sm-help-ok').addEventListener('click', closeOverlay);
  }
  // The tiles this player cannot see: the bag plus the other rack.
  function showUnseen() {
    const s = R ? R.states[R.k] : G.state;
    const me = R ? (R.k > 0 && canAnalyze(R.k) ? R.states[R.k - 1].turn : null) : viewer();
    const opp = me === null ? null : 1 - me;
    const counts = {};
    for (const t of s.bag) counts[t] = (counts[t] || 0) + 1;
    if (opp !== null) for (const t of s.racks[opp]) counts[t] = (counts[t] || 0) + 1;
    const total = s.bag.length + (opp === null ? 0 : s.racks[opp].length);
    let html = '<h2>Unseen tiles</h2><p>' + s.bag.length + ' in the bag' + (opp === null ? '' : ' and ' + s.racks[opp].length + ' on ' + esc(nameOf(opp)) + '’s rack') + ': ' + total + ' in all.</p><div class="sm-unseen">';
    for (const k of Object.keys(C.TILES)) {
      const n = counts[k] || 0;
      html += '<div class="' + (n ? '' : 'none') + '">' + k + '<small>' + n + '</small></div>';
    }
    html += '</div><button class="primary" id="sm-unseen-ok">Close</button>';
    openOverlay(html);
    $('sm-unseen-ok').addEventListener('click', closeOverlay);
  }
  function showGameOver() {
    const s = G.state;
    const why = s.endReason === 'resign' ? esc(nameOf(s.resigned)) + ' resigned.' : s.endReason === 'passes' ? 'Four passes in a row.' : 'The bag ran out and both players took a last turn.';
    openOverlay('<h2>' + esc(verdict(s)) + '</h2><p>' + why + '</p><div class="sm-final"><div>' + esc(nameOf(0)) + '<b>' + s.scores[0] + '</b></div><div>' + esc(nameOf(1)) + '<b>' + s.scores[1] + '</b></div></div>' +
      '<div class="sm-row" style="justify-content:center"><button id="sm-over-close">Look at the board</button><button id="sm-over-review">Review the game</button>' +
      (G.kind === 'online' && G.me !== null && G.names[1] ? '<button class="primary" id="sm-over-again">' + (G.nextGame ? 'Open the rematch' : 'Play again, sides swapped') + '</button>' : '<button class="primary" id="sm-over-new">New game</button>') + '</div>');
    $('sm-over-close').addEventListener('click', closeOverlay);
    $('sm-over-review').addEventListener('click', () => { closeOverlay(); enterReview(s.moves.length); });
    const again = $('sm-over-again'), fresh = $('sm-over-new');
    if (again) again.addEventListener('click', () => { closeOverlay(); startRematch(); });
    if (fresh) fresh.addEventListener('click', () => { closeOverlay(); showMenu(); });
  }

  // ---- starting and opening games ------------------------------------------------
  function startLocal(kind, level) {
    ++navGen;
    leaveGame();
    let id = newId();
    while (games.get(id)) id = newId();
    G = { id, kind, level: level || null, names: kind === 'bot' ? ['You', 'Bot (' + level + ')'] : ['Player 1', 'Player 2'], state: C.newGame(randomSeed()), me: 0, hidden: false, session: ++sessions };
    seenMoves = 0;
    persist();
    setUrl(id);
    render();
    setStatus('');
  }
  async function resumeLocal(rec) {
    const my = ++navGen;
    await dictReady;
    if (my !== navGen) return;
    leaveGame();
    let state;
    try { state = C.replay(rec.seed, rec.moves); }
    catch (e) { failToMenu('The saved game ' + rec.id + ' could not be restored.'); return; }
    G = { id: rec.id, kind: rec.kind, level: rec.level, names: rec.names, state, me: 0, hidden: rec.kind === 'hotseat' && !state.over && !!dict, session: ++sessions };
    seenMoves = state.history.length;
    setUrl(rec.id);
    render();
    setStatus(dict ? '' : 'The word list did not load, so plays cannot be checked. Reload to try again.', 'bad');
    if (!dict) return;
    if (G.state.over) showGameOver();
    else if (G.kind === 'bot' && G.state.turn !== G.me) scheduleBot();
    else if (G.kind === 'hotseat') showHandoff();
  }
  async function openGame(id) {
    const rec = games.get(id);
    if (rec && rec.kind !== 'online') { resumeLocal(rec); return; }
    if (Net.enabled) { openOnline(id); return; }
    if (rec && rec.seed) { showCachedOnline(rec); return; }
    failToMenu(rec ? 'That game lives online and this page is offline; open it once you are connected.' : 'There is no game called ' + id + ' in this browser.');
  }
  // Offline (or the Supabase script did not load): the game as it was last
  // seen, read-only, from the browser's copy of the record.
  async function showCachedOnline(rec) {
    const my = ++navGen;
    await dictReady;
    if (my !== navGen) return;
    leaveGame();
    let state;
    try { state = C.replay(rec.seed, rec.moves); } catch (e) { failToMenu('The saved copy of ' + rec.id + ' could not be read.'); return; }
    G = { id: rec.id, kind: 'online', level: null, names: rec.names || ['Player 1', 'Player 2'], handles: {}, nextGame: null, state, me: null, online: { token: null }, hidden: false, session: ++sessions, offline: true };
    seenMoves = state.history.length;
    setUrl(rec.id);
    render();
    setStatus('Offline: this is the game as it was last seen here. Moves need a connection.', 'bad');
  }

  // ---- online --------------------------------------------------------------------
  // The Supabase client (loaded from a CDN in the layout) carries the signed-in
  // user's token on every call, so the server can tie seats to an account.
  const sb = CFG.url && CFG.key && window.supabase ? window.supabase.createClient(CFG.url, CFG.key) : null;
  const Net = {
    enabled: !!sb,
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args || {});
      if (error) throw new Error(error.message || error.hint || 'request failed');
      return data;
    }
  };

  // ---- signing in ------------------------------------------------------------------
  // Optional. With an account, seats and the games list follow the player to
  // any device; without one, play by link works as before.
  let user = null;   // { id, name, email }
  const authPanel = $('sm-auth');
  function setUser(u) {
    if (u && user && user.id === u.id) { if (!user.handle) loadProfile(); return; }   // a refresh or refocus, same account: keep what we have
    user = u ? { id: u.id, email: u.email || '', name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || '').split('@')[0] || 'Player', handle: null } : null;
    if (user && !store.get('sm.name', '')) store.set('sm.name', user.name);
    renderAuth();
    if (user) loadProfile();
  }
  // On sign-in, every seat this browser holds by link gets attached to the
  // account (join_game is idempotent for a held seat), so the games follow
  // the account to other devices without being reopened here first.
  async function attachSeats() {
    const name = store.get('sm.name', '') || (user && user.name) || 'Player';
    const held = games.list().filter((r) => r.kind === 'online' && r.online && r.online.token && !r.attached).slice(0, 30);
    if (!held.length) return;
    // a shared device: the games in this browser may be someone else's, so they are attached only on a yes
    if (store.get('sm.attachDeclined', null) === user.id) return;
    if (!window.confirm('Attach the ' + plural(held.length, 'online game') + ' saved in this browser to this account? They will follow it to your other devices.')) { store.set('sm.attachDeclined', user.id); return; }
    for (const rec of held) {
      let ok = false;
      try { await Net.rpc('join_game', { p_code: rec.id, p_name: name, p_token: rec.online.token }); ok = true; }
      catch (e) { ok = /over|no such game/.test(e.message); }   // finished or gone: nothing to attach, and nothing to ask about again
      const cur = games.get(rec.id);
      if (ok && cur) { cur.attached = true; games.put(cur); }
    }
  }
  function loadProfile() {
    const id = user.id;
    Net.rpc('ensure_profile', { p_name: user.name }).then((p) => { if (user && user.id === id && p) { user.handle = p.handle; user.name = p.name; store.set('sm.name', p.name); renderAuth(); } }).catch(() => {});
  }
  function renderAuth() {
    if (!Net.enabled) { authPanel.style.display = 'none'; return; }
    authPanel.style.display = '';
    authPanel.innerHTML = authRowHtml() + (user ? '<div class="sm-note">Your games, stats and friends follow this account to any device.</div>' : '<div class="sm-note">Optional: keeps your online games together across devices, with stats and friends.</div>');
    bindAuth(authPanel);
  }
  function openMyProfile() { if (user.handle) showProfile(user.handle); else { setStatus('Your profile is still loading; trying again.'); loadProfile(); } }
  function signInGoogle() {
    try { if (linkToken && linkGame) sessionStorage.setItem('sm.linkToken', JSON.stringify({ id: linkGame, token: linkToken })); } catch (e) { /* ignore */ }
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname + location.search } });
  }
  // the same controls appear in the side panel and in the menu card (the card makes the panel unreachable)
  function authRowHtml() {
    return user
      ? '<div class="sm-auth-row">Signed in as <b>' + esc(user.name) + '</b>' + (user.handle ? ' <span class="sm-code">' + esc(user.handle) + '</span>' : '') + '<button class="small" data-auth="profile">Profile</button><button class="small" data-auth="signout">Sign out</button></div>'
      : '<div class="sm-auth-row"><button class="small" data-auth="google">Sign in with Google</button><button class="small" data-auth="email">Email me a link</button></div>';
  }
  function bindAuth(root) {
    const g = root.querySelector('[data-auth="google"]'), e = root.querySelector('[data-auth="email"]'), o = root.querySelector('[data-auth="signout"]'), pr = root.querySelector('[data-auth="profile"]');
    if (pr) pr.addEventListener('click', () => { closeOverlay(); openMyProfile(); });
    if (g) g.addEventListener('click', signInGoogle);
    if (e) e.addEventListener('click', async () => {
      const email = await askText('Email me a sign-in link', 'A one-time link to sign in here. No password.', 'you@example.com', '');
      if (!email) return;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
      setStatus(error ? 'Could not send the link: ' + error.message : 'Check your email for the sign-in link.', error ? 'bad' : 'good');
    });
    if (o) o.addEventListener('click', async () => {
      store.set('sm.signout', Date.now());   // every tab sees the same marker and forgets the seats too
      let err = null;
      try { const r = await sb.auth.signOut(); err = r && r.error; } catch (e) { err = e; }
      if (err) { store.del('sm.signout'); setStatus('Could not sign out: ' + (err.message || err), 'bad'); }
    });
  }
  if (sb) {
    sb.auth.getSession().then(({ data }) => setUser(data.session && data.session.user));
    sb.auth.onAuthStateChange((event, session) => {
      const before = user && user.id;
      setUser(session && session.user);
      if (event === 'SIGNED_OUT') {
        // a shared device: the seats this browser opened while signed in must not stay playable.
        // Only a sign-out this person asked for does that; a session that merely expired keeps them.
        const asked = Date.now() - (store.get('sm.signout', 0) || 0) < 15000;
        if (asked) {
          for (const rec of games.list()) if (rec.kind === 'online') games.remove(rec.id);
          if (G && G.kind === 'online') { leaveGame(); setUrl(null); showMenu(); }
        } else if (G && G.kind === 'online') render();
        return;
      }
      if (user && user.id !== before) attachSeats();
      if (G && G.kind === 'online') syncOnline();
    });
  } else renderAuth();

  async function createOnline() {
    const my = ++navGen;
    const name = user ? (store.get('sm.name', '') || user.name) : await askText('Your name', 'Shown to your opponent.', 'Name', store.get('sm.name', ''));
    if (my !== navGen) return;
    if (!name) { showMenu(); return; }
    store.set('sm.name', name);
    const token = randomToken();
    setStatus('Creating the game…');
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        await Net.rpc('create_game', { p_code: id, p_seed: C.pack(id, randomSeed()), p_name: name, p_token: token });
        if (my !== navGen) return;
        games.put({ id, kind: 'online', names: [name, null], seed: null, moves: [], over: false, online: { token, player: 0 }, attached: !!user });
        await openOnline(id);
        return;
      } catch (e) {
        if (my !== navGen) return;
        if (/taken/.test(e.message)) continue;
        failToMenu('Could not create the game: ' + e.message); return;
      }
    }
    failToMenu('Could not find a free game id; try again.');
  }
  // Claim or recover a seat: from this browser's record, or from a private
  // link's token, or by joining the empty second seat.
  async function seatFor(id, row) {
    const rec = games.get(id);
    let urlToken = tokenFromUrl(id);
    if (urlToken) {
      // a private link must name a seat that exists; a stale or wrong one is not a way in.
      // It is only dropped from the address once the server has answered.
      let seat;
      try { seat = await Net.rpc('my_seat', { p_code: id, p_token: urlToken }); } catch (e) { throw new Error('could not check the private link (' + e.message + ')'); }
      if (seat === null || seat === undefined) { setStatus('That private link did not open a seat.', 'bad'); urlToken = null; dropLinkToken(); }
    }
    // a valid private link wins over whatever this browser remembered
    const token = urlToken || (rec && rec.online && rec.online.token) || randomToken();
    const holds = row.seat !== null && row.seat !== undefined;   // the account already has a seat here
    const known = holds || (rec && rec.online && rec.online.token) || urlToken;
    let name = store.get('sm.name', '') || (user && user.name) || '';
    if (!known && row.full) return { token: null, player: null };
    if (!known && !name) {
      name = await askText('Join ' + (row.p1_name || 'the game'), 'Shown to your opponent.', 'Your name', '');
      if (!name) return null;
      store.set('sm.name', name);
    }
    try {
      // the server answers with the seat and the token that seat really holds
      // (an account-held seat may have been created with a token this browser never saw)
      const r = await Net.rpc('join_game', { p_code: id, p_name: name || 'Player', p_token: token });
      const seat = typeof r === 'number' ? { token, player: r } : { token: r.token || token, player: r.player };
      // kept at once, before anything else can interrupt: the server has already given this token the seat
      if (!(rec && rec.online && rec.online.token === seat.token)) {
        games.put({ id, kind: 'online', level: null, names: [row.p1_name || 'Player 1', seat.player === 1 ? (name || 'Player') : row.p2_name || null], seed: null, moves: [], over: false, online: { token: seat.token, player: seat.player }, attached: !!user });
      } else if (user && !rec.attached) { rec.attached = true; games.put(rec); }   // the server attached it to the account just now
      return seat;
    } catch (e) {
      if (/two players/.test(e.message)) return { token: null, player: null };
      throw e;
    }
  }
  async function openOnline(id) {
    const my = ++navGen;
    await dictReady;
    if (my !== navGen) return;
    if (!dict) { failToMenu('The word list did not load. Reload to try again.'); return; }
    const rec = games.get(id);
    // offline: the copy this browser has, read-only
    if (navigator.onLine === false && rec && rec.seed) { showCachedOnline(rec); return; }
    let row;
    try { row = await Net.rpc('get_game', { p_code: id, p_token: (rec && rec.online && rec.online.token) || tokenFromUrl(id) || null }); }
    catch (e) {
      if (my !== navGen) return;
      if (rec && rec.seed) { showCachedOnline(rec); return; }
      failToMenu('Could not load game ' + id + ': ' + e.message); return;
    }
    if (my !== navGen) return;
    if (!row) { failToMenu('There is no game called ' + id + '.'); return; }
    let seat;
    try { seat = await seatFor(id, row); } catch (e) { if (my !== navGen) return; failToMenu('Could not join: ' + e.message); return; }
    if (my !== navGen) return;
    dropLinkToken();   // the seat is held (or refused) now; the link's token has done its work
    if (!seat) { showMenu(); return; }
    if (seat.player !== null) {
      try { row = await Net.rpc('get_game', { p_code: id, p_token: seat.token }); } catch (e) { /* keep what we have */ }
      if (my !== navGen) return;
    }
    if (!row.seed) { failToMenu(row.private ? 'This game is private: its players have not opened it to watchers.' : 'Could not load game ' + id + '.'); return; }
    let state;
    try { state = C.replay(C.unpack(id, row.seed), (row.moves || []).map((m) => C.unpack(id, m.d))); } catch (e) { failToMenu('This game’s record is corrupt: ' + e.message); return; }
    leaveGame();
    G = { id, kind: 'online', level: null, names: [row.p1_name || 'Player 1', row.p2_name || null], handles: row.handles || {}, nextGame: row.next_game || null, state, me: seat.player, online: { token: seat.token }, hidden: false, session: ++sessions };
    seenMoves = state.history.length;
    if (seat.player !== null) persist();
    setUrl(id);
    render();
    setStatus(seat.player === null ? 'Watching: this game already has two players.' : '');
    if (G.state.over) { reportResult(); showGameOver(); startPolling(); }
    else { startPolling(); if (G.state.turn === G.me && C.options(G.state).mustPass) commit({ t: 'pass' }); }
  }
  // Fold the server's move list into ours. Idempotent: moves we already have
  // are skipped, so a poll and a submission can both deliver the same move.
  // Server moves are trusted like stored ones; only our own are validated.
  function integrate(moves, names, row) {
    if (names) { if (G.labels === undefined) G.labels = JSON.stringify([G.names, G.handles, G.nextGame]); G.names = names; }
    if (row) { G.handles = row.handles || G.handles || {}; if (row.next_game && !G.nextGame) { G.nextGame = row.next_game; if (G.state.over) { stopPolling(); setStatus('A rematch is waiting: open it from the panel.', 'good'); } } }
    moves = moves || [];
    let s = G.state;
    try {
      for (let i = s.moves.length; i < moves.length; i++) {
        const m = C.unpack(G.id, moves[i].d);
        // the label the server reads (kind, tile count) must be what the move really is
        if (m.t !== moves[i].t || (m.t === 'play' && moves[i].n !== undefined && m.tiles.length !== moves[i].n)) throw new Error('a move is not what it says it is');
        s = C.apply(s, m, null);
      }
    }
    catch (e) { setStatus('The game record no longer matches this page: ' + e.message, 'bad'); return; }
    const changed = s !== G.state;
    const labels = JSON.stringify([G.names, G.handles, G.nextGame]);
    if (changed) { G.state = s; extendReview(); resetTurnUi(); setStatus(''); }
    if (changed || labels !== (G.labels || '')) { G.labels = labels; persist(); render(); }
    if (changed) afterMove();
  }
  async function syncOnline() {
    if (!G || G.kind !== 'online') return;
    const s = G.session;
    let row;
    try { row = await Net.rpc('get_game', { p_code: G.id, p_token: G.online.token || null }); } catch (e) { return; }
    if (!alive(s) || busy || !row) return;
    if (!row.moves) { if (row.private && G.me === null) { stopPolling(); setStatus('This game is private now: its players have closed it to watchers.', 'bad'); } return; }
    integrate(row.moves, [row.p1_name || 'Player 1', row.p2_name || null], row);
  }
  // The same two players again, seats swapped. The server copies both seats,
  // so the other side opens it with the token or account it already has.
  async function startRematch() {
    if (!G || G.kind !== 'online' || G.me === null) return;
    const old = G, my = ++navGen;
    let id = old.nextGame;
    if (!id) {
      setStatus('Starting the rematch…');
      for (let attempt = 0; attempt < 5 && !id; attempt++) {
        const fresh = newId();
        try { id = await Net.rpc('rematch', { p_old: old.id, p_token: old.online.token, p_new: fresh, p_seed: C.pack(fresh, randomSeed()) }); }
        catch (e) { if (my !== navGen) return; if (/taken/.test(e.message)) continue; setStatus('Could not start a rematch: ' + e.message, 'bad'); return; }
      }
      if (my !== navGen) return;
      if (!id) { setStatus('Could not find a free game id; try again.', 'bad'); return; }
    }
    games.put({ id, kind: 'online', names: [old.names[1], old.names[0]], seed: null, moves: [], over: false, online: { token: old.online.token, player: 1 - old.me }, attached: !!user });
    openOnline(id);
  }
  // A game against a friend, seated for them: they find it in their games list.
  async function challengeFriend(handle, name) {
    const my = ++navGen;
    const token = randomToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        await Net.rpc('challenge', { p_code: id, p_seed: C.pack(id, randomSeed()), p_name: store.get('sm.name', '') || (user && user.name) || 'Player', p_token: token, p_handle: handle });
        if (my !== navGen) return;
        games.put({ id, kind: 'online', names: [store.get('sm.name', '') || user.name, name], seed: null, moves: [], over: false, online: { token, player: 0 }, attached: true });
        await openOnline(id);
        return;
      } catch (e) {
        if (my !== navGen) return;
        if (/taken/.test(e.message)) continue;
        if (G) setStatus('Could not start the game: ' + e.message, 'bad'); else failToMenu('Could not start the game: ' + e.message);
        return;
      }
    }
    if (G) setStatus('Could not find a free game id; try again.', 'bad'); else failToMenu('Could not find a free game id; try again.');
  }
  function startPolling() {
    stopPolling();
    if (!G || G.kind !== 'online') return;
    // a finished game keeps a slow poll going until a rematch shows up, so
    // the other side's "play again" reaches this page; a background tab keeps
    // polling too (slower), so a game left open is current when you come back
    if (G.state.over && (G.nextGame || G.me === null)) return;
    const tick = () => { if (document.visibilityState === 'visible' || Date.now() - lastHiddenPoll > 30000) { lastHiddenPoll = Date.now(); syncOnline(); } };
    pollTimer = setInterval(tick, G.state.over ? 15000 : G.state.turn === G.me ? 15000 : 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && G.kind === 'online') syncOnline(); });
  function renderOnlinePanel() {
    if (!G || G.kind !== 'online') { ui.online.style.display = 'none'; return; }
    ui.online.style.display = '';
    const invite = linkFor(G.id), mine = G.online.token ? linkFor(G.id, G.online.token) : null;
    ui.online.innerHTML = '<div class="sm-k">Online game</div><div>Game <span class="sm-code">' + esc(G.id) + '</span></div>' +
      (G.names[1] ? '<div class="sm-note">' + esc(G.names[0]) + ' vs ' + esc(G.names[1]) + '. This page checks for new moves every few seconds while it is open; come back any time.</div>'
                  : '<div class="sm-note">' + (G.state.moves.length ? 'Waiting for a second player to take their turn.' : 'Play your first word, then') + ' Send them this link:</div><input type="text" readonly value="' + esc(invite) + '" id="sm-link"><div class="sm-row"><button id="sm-copy" data-link="' + esc(invite) + '">Copy invite link</button></div>') +
      (mine ? '<div class="sm-note" style="margin-top:10px">Your private link opens <i>your</i> seat on another device. Keep it to yourself.</div><div class="sm-row"><button id="sm-copy-mine" data-link="' + esc(mine) + '">Copy private link</button></div>' : '') +
      (G.nextGame && G.state.over ? '<div class="sm-row"><button class="primary" id="sm-rematch">Open the rematch</button></div>' : '') +
      '<div class="sm-row"><button id="sm-refresh">Refresh</button></div>';
    const rm = $('sm-rematch');
    if (rm) rm.addEventListener('click', startRematch);
    ui.online.querySelectorAll('button[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.link); b.textContent = 'Copied'; }
      catch (e) { window.prompt('Copy this link:', b.dataset.link); }
    }));
    $('sm-refresh').addEventListener('click', syncOnline);
  }

  // ---- profiles, stats and friends -------------------------------------------------
  const profileUrl = (handle) => location.origin + (LOCAL_HOST ? BASE + '?u=' + handle : BASE + 'u/' + handle);
  function statsOf(results) {
    const st = { games: 0, wins: 0, losses: 0, ties: 0, best: 0, total: 0, plays: 0, points: 0, bingos: 0, brilliancies: 0, bestWord: null, bestWordScore: 0 };
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);   // whatever the server holds, only a number is ever shown
    for (const r of results) {
      if (r.end_reason === 'disputed') continue;   // the two sides disagreed on the score: played, counted for nothing
      st.games++;
      if (r.won === true) st.wins++; else if (r.won === false) st.losses++; else st.ties++;
      st.total += num(r.my_score); st.best = Math.max(st.best, num(r.my_score));
      const x = r.stats || {};
      st.plays += num(x.plays); st.points += num(x.points); st.bingos += num(x.bingos); st.brilliancies += num(x.brilliancies);
      if (num(x.best_score) > st.bestWordScore) { st.bestWordScore = num(x.best_score); st.bestWord = String(x.best_word || ''); }
    }
    return st;
  }
  let profileGen = 0;
  async function showProfile(handle) {
    if (!Net.enabled) { openOverlay('<h2>Profile</h2><p>Profiles need a connection, and this page is offline.</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', () => { closeOverlay(); if (!G) showMenu(); }); return; }
    let pr;
    const back = () => { closeOverlay(); if (!G) showMenu(); };
    openOverlay('<h2>Profile</h2><p>Loading…</p><button id="sm-pr-close">Cancel</button>');
    const my = ++profileGen;
    $('sm-pr-close').addEventListener('click', () => { profileGen++; back(); });
    try { pr = await Net.rpc('profile', { p_handle: handle }); } catch (e) { if (my !== profileGen) return; openOverlay('<h2>Profile</h2><p>' + esc(e.message) + '</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', back); return; }
    if (my !== profileGen) return;
    if (!pr) { openOverlay('<h2>No such player</h2><p>Nobody has the code ' + esc(handle) + '.</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', back); return; }
    const st = statsOf(pr.results);
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0).toString();
    const records = {};
    for (const r of pr.results) {
      if (r.end_reason === 'disputed') continue;
      const k = r.their_handle || ('~' + r.their_name);
      const rec = records[k] || (records[k] = { name: String(r.their_name || ''), handle: r.their_handle ? String(r.their_handle) : null, w: 0, l: 0, t: 0 });
      if (r.won === true) rec.w++; else if (r.won === false) rec.l++; else rec.t++;
    }
    let html = '<h2>' + esc(pr.name) + '</h2><p>Friend code <span class="sm-code">' + esc(pr.handle) + '</span></p>' +
      '<div class="sm-row" style="justify-content:center">' +
      (pr.mine ? '<button class="small" id="sm-pr-rename">Change name</button><button class="small" id="sm-pr-qr">Show QR code</button>' :
        (user ? (pr.is_friend ? '<button class="small" id="sm-pr-challenge">Challenge to a game</button><button class="small" id="sm-pr-unfriend">Remove friend</button>' : '<button class="small" id="sm-pr-friend">Add friend</button>') : '<span class="sm-note">Sign in to add friends or challenge.</span>')) +
      '</div>';
    html += '<div class="sm-k" style="text-align:left;margin-top:12px">Online games</div><div class="sm-stats">' +
      '<div><b>' + st.wins + '–' + st.losses + (st.ties ? '–' + st.ties : '') + '</b><small>won–lost' + (st.ties ? '–tied' : '') + '</small></div>' +
      '<div><b>' + (st.games ? num(st.total / st.games) : '–') + '</b><small>average game</small></div>' +
      '<div><b>' + (st.best || '–') + '</b><small>best game</small></div>' +
      '<div><b>' + (st.plays ? num(st.points / st.plays) : '–') + '</b><small>points per play</small></div>' +
      '<div><b>' + st.bingos + '</b><small>bingos</small></div>' +
      '<div><b>' + st.brilliancies + '</b><small>brilliancies</small></div>' +
      '<div style="grid-column:span 2"><b>' + (st.bestWord ? esc(st.bestWord) + ' ' + st.bestWordScore : '–') + '</b><small>best word</small></div></div>';
    const recs = Object.values(records).sort((a, b) => (b.w + b.l + b.t) - (a.w + a.l + a.t));
    if (recs.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Against</div><div class="sm-summary">';
      for (const r of recs) html += '<div' + (r.handle ? ' data-u="' + esc(r.handle) + '"' : '') + '><span>' + esc(r.name || 'a guest') + '</span> <b>' + r.w + '–' + r.l + (r.t ? '–' + r.t : '') + '</b></div>';
      html += '</div>';
    }
    if (pr.live) {
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Games in progress</div><div class="sm-summary">';
      if (!pr.live.length) html += '<div class="sm-note">None right now.</div>';
      for (const g of pr.live) html += '<div data-g="' + esc(g.id) + '"><span>' + esc(g.p1_name) + ' vs ' + esc(g.p2_name) + '</span><small>' + plural(num(g.moves), 'move') + (pr.mine ? '' : ' · watch') + '</small></div>';
      html += '</div>';
    }
    if (pr.mine) {
      html += '<div class="sm-row" style="margin-top:8px"><label class="sm-note" style="margin:0"><input type="checkbox" id="sm-pr-public"' + (pr.public_games ? ' checked' : '') + '> Let anyone watch my games in progress from this page</label></div>';
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Friends</div><div class="sm-summary" id="sm-pr-friends">';
      if (!pr.friends.length) html += '<div class="sm-note">No friends yet. Add one by their code, or send them yours.</div>';
      for (const f of pr.friends) html += '<div data-u="' + esc(f.handle) + '"><span>' + esc(f.name) + ' <small>' + esc(f.handle) + '</small></span><b>›</b></div>';
      html += '</div><div class="sm-row"><input type="text" id="sm-pr-code" placeholder="Friend code" maxlength="8" style="width:140px"><button class="small" id="sm-pr-add">Add friend</button></div>';
    }
    if (pr.results.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Past games</div><div class="sm-summary">';
      for (const r of pr.results.slice(0, 30)) html += '<div data-g="' + esc(r.game_id) + '"><span>' + (r.end_reason === 'disputed' ? 'Disputed' : (r.won === true ? 'Won' : r.won === false ? 'Lost' : 'Tied') + ' ' + num(r.my_score) + '–' + num(r.their_score)) + ' vs ' + esc(r.their_name || 'a guest') + '</span><small>' + esc(new Date(r.finished_at).toLocaleDateString()) + '</small></div>';
      html += '</div>';
    }
    html += '<div class="sm-row" style="justify-content:center;margin-top:12px"><button id="sm-pr-close">Close</button></div>';
    openOverlay(html);
    $('sm-pr-close').addEventListener('click', back);
    ui.overlay.querySelectorAll('[data-u]').forEach((d) => d.addEventListener('click', () => showProfile(d.dataset.u)));
    ui.overlay.querySelectorAll('[data-g]').forEach((d) => d.addEventListener('click', () => { closeOverlay(); openGame(d.dataset.g); }));
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('sm-pr-qr', () => showQr(pr));
    on('sm-pr-rename', async () => { const n = await askText('Your name', 'Shown to opponents.', 'Name', pr.name); if (!n) { showProfile(handle); return; } try { const p = await Net.rpc('set_name', { p_name: n }); store.set('sm.name', p.name); if (user) user.name = p.name; renderAuth(); } catch (e) { setStatus(e.message, 'bad'); } showProfile(handle); });
    on('sm-pr-friend', async () => { try { await Net.rpc('add_friend', { p_handle: pr.handle }); } catch (e) { setStatus(e.message, 'bad'); } showProfile(handle); });
    on('sm-pr-unfriend', async () => { try { await Net.rpc('remove_friend', { p_handle: pr.handle }); } catch (e) { setStatus(e.message, 'bad'); } showProfile(handle); });
    on('sm-pr-challenge', () => { closeOverlay(); challengeFriend(pr.handle, pr.name); });
    const pub = $('sm-pr-public');
    if (pub) pub.addEventListener('change', async () => { try { await Net.rpc('set_visibility', { p_public: pub.checked }); } catch (e) { setStatus(e.message, 'bad'); pub.checked = !pub.checked; } });
    on('sm-pr-add', async () => { const code = ($('sm-pr-code').value || '').trim(); if (!code) return; try { const f = await Net.rpc('add_friend', { p_handle: code }); setStatus('Added ' + f.name + '.', 'good'); } catch (e) { setStatus(e.message, 'bad'); } showProfile(handle); });
  }
  // A QR code of the profile link, drawn by a small library fetched on demand.
  function showQr(pr) {
    const link = profileUrl(pr.handle);
    const draw = () => {
      const qr = window.qrcode(0, 'M');
      qr.addData(link); qr.make();
      openOverlay('<h2>' + esc(pr.name) + '</h2><p>Scan to open this profile and add a friend.</p><div class="sm-qr">' + qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) + '</div><p><span class="sm-code">' + esc(pr.handle) + '</span></p><div class="sm-row" style="justify-content:center"><button id="sm-qr-copy" data-link="' + esc(link) + '">Copy link</button><button id="sm-qr-back">Back</button></div>');
      $('sm-qr-back').addEventListener('click', () => showProfile(pr.handle));
      $('sm-qr-copy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch (err) { window.prompt('Copy this link:', link); } });
    };
    if (window.qrcode) { draw(); return; }
    openOverlay('<h2>QR code</h2><p>Loading…</p><button id="sm-qr-cancel">Cancel</button>');
    let cancelled = false;
    $('sm-qr-cancel').addEventListener('click', () => { cancelled = true; showProfile(pr.handle); });
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    sc.onload = () => { if (!cancelled) draw(); };
    sc.onerror = () => { if (cancelled) return; openOverlay('<h2>QR code</h2><p>Could not load the QR library. The link is ' + esc(link) + '</p><button id="sm-qr-back">Back</button>'); $('sm-qr-back').addEventListener('click', () => showProfile(pr.handle)); };
    document.head.appendChild(sc);
  }

  // ---- zoom ------------------------------------------------------------------------
  let zoom = Number(store.get('sm.zoom', 1)) || 1;
  if (!(zoom >= 1 && zoom <= 3)) zoom = 1;
  // Scale the board, keeping the point (fx, fy) in the frame where it was.
  function setZoom(z, fx, fy, save) {
    const old = zoom;
    zoom = Math.round(Math.max(1, Math.min(3, z)) * 100) / 100;
    if (fx === undefined) { fx = ui.wrap.clientWidth / 2; fy = ui.wrap.clientHeight / 2; }
    const sx = ui.wrap.scrollLeft, sy = ui.wrap.scrollTop;
    ui.board.style.setProperty('--zoom', zoom);
    ui.wrap.scrollLeft = (sx + fx) * (zoom / old) - fx;
    ui.wrap.scrollTop = (sy + fy) * (zoom / old) - fy;
    ui.zoomLabel.textContent = (Math.round(zoom * 10) / 10) + '×';
    ui.zoomOut.disabled = zoom <= 1;
    ui.zoomIn.disabled = zoom >= 3;
    if (save !== false) store.set('sm.zoom', zoom);
  }
  ui.zoomIn.addEventListener('click', () => setZoom(zoom + 0.5));
  ui.zoomOut.addEventListener('click', () => setZoom(zoom - 0.5));
  setZoom(zoom);

  // ---- boot ----------------------------------------------------------------------
  if ('serviceWorker' in navigator && !LOCAL_HOST) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => { /* no offline copy, nothing lost */ });
  ui.newBtn.addEventListener('click', showMenu);
  ui.help.addEventListener('click', showHelp);
  ui.players.forEach((el) => el.addEventListener('click', () => { if (el.dataset.handle) showProfile(el.dataset.handle); }));
  ui.bagBtn.addEventListener('click', () => { if (G) showUnseen(); });
  dictReady.then(() => { if (G) render(); });

  const wanted = idFromUrl();
  const wantedProfile = new URLSearchParams(location.search).get('u') || (location.pathname.match(/\/scrabble-mod\/u\/([A-Za-z0-9]+)\/?$/) || [])[1];
  if (wantedProfile) { history.replaceState(null, '', BASE); showProfile(wantedProfile.toUpperCase()); }
  else if (wanted) openGame(wanted);
  else {
    const latest = games.list().find((r) => !r.over);
    if (latest) openGame(latest.id); else showMenu();
  }

  window.__sm = { get game() { return G; }, get review() { return R; }, core: C, get dict() { return dict; }, games, enterReview, reviewGo };
})();
