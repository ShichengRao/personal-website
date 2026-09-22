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
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
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
  function tokenFromUrl() {
    const m = location.hash.match(/[#&]k=([0-9a-f]{32})/);
    return m ? m[1] : null;
  }
  const setUrl = (id) => history.replaceState(null, '', pathFor(id));

  // Saved games, by id. { id, kind, level, names, seed, moves, over, updated, online?: {token, player} }
  const games = {
    all() { return store.get('sm.games', {}); },
    get(id) { return this.all()[id] || null; },
    put(rec) { const a = this.all(); rec.updated = Date.now(); a[rec.id] = rec; store.set('sm.games', a); },
    list() { return Object.values(this.all()).sort((a, b) => b.updated - a.updated); }
  };
  (function migrate() {
    const old = store.get('sm.local', null);
    if (old && old.moves && old.seed) games.put({ id: newId(), kind: old.kind, level: old.level, names: old.names, seed: old.seed, moves: old.moves, over: !!old.over });
    store.del('sm.local'); store.del('sm.online');
  })();

  // ---- dictionary --------------------------------------------------------
  let dict = null;
  const dictReady = fetch(BASE + 'words.txt')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((t) => { dict = C.buildDict(t); })
    .catch((e) => { setStatus('The word list failed to load (' + e.message + '). Reload to try again.', 'bad'); });

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
  let pollTimer = null, botTimer = null;
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
  function resetTurnUi() { pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); stickyError = null; }
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
      if (cellHtml[i] !== html) { d.innerHTML = html; cellHtml[i] = html; }
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
  function renderRack() {
    const rack = rackShown();
    const used = new Set(pending.map((t) => t.ri));
    let html = '';
    for (let i = 0; i < C.RACK; i++) {
      const cls = ['sm-slot', sel === i ? 'sel' : '', marks.has(i) ? 'mark' : '', G.hidden ? 'hidden' : ''].join(' ').trim();
      const t = rack[i];
      html += '<div class="' + cls + '" data-i="' + i + '">' + (t && !used.has(i) ? tileHtml(t === '?' ? '?' : t, t === '?', '') : '') + '</div>';
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
      el.querySelector('.sm-name').textContent = nameOf(p) + (isYou(p) ? ' (you)' : '');
      el.querySelector('.sm-score').textContent = R ? R.states[R.k].scores[p] : s.scores[p];
      el.classList.toggle('turn', !s.over && !R && s.turn === p);
    }
    ui.bag.textContent = R ? R.states[R.k].bag.length : s.bag.length;
    const h = s.history[s.history.length - 1];
    if (R) {
      const rh = R.k > 0 ? s.history[R.k - 1] : null;
      ui.msg.innerHTML = R.k === 0 ? '<b>Review.</b> The start of the game.' : '<b>Move ' + R.k + '.</b> ' + describe(rh) + (R.ghost ? ' · <i>showing ' + esc(R.ghost.word) + ' instead</i>' : '');
    } else if (s.over) ui.msg.innerHTML = '<b>Game over.</b> ' + esc(verdict(s)) + '.';
    else if (h) ui.msg.innerHTML = describe(h) + (s.finalTurns !== null ? ' · <i>bag empty, last turns</i>' : '');
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
    ui.resign.disabled = !!R || s.over || (G.kind === 'hotseat' ? false : G.me === null);
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
    if (b) { l = await pickLetter(); if (!l || !myTurn() || occupied(r, c)) { render(); return; } }
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
  // Rack order is cosmetic; pending tiles follow their letters around.
  function reorderRack(rack, from, to) {
    const keep = pending.map((t) => rack[t.ri]);
    const [t] = rack.splice(from, 1);
    rack.splice(to, 0, t);
    const taken = new Set();
    pending.forEach((p, k) => { for (let i = 0; i < rack.length; i++) if (!taken.has(i) && rack[i] === keep[k]) { taken.add(i); p.ri = i; break; } });
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
  let drag = null;   // { src: {kind:'rack', i} | {kind:'pending', pi}, x, y, active, ghost, over }
  function dropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const slot = el.closest('.sm-slot');
    if (slot && ui.rack.contains(slot)) return { kind: 'slot', el: slot, i: +slot.dataset.i };
    const cell = el.closest('.sm-cell');
    if (cell && ui.board.contains(cell)) return { kind: 'cell', el: cell, i: +cell.dataset.i };
    return null;
  }
  function onPointerDown(e) {
    if (!G || R || G.hidden || viewer() === null || swapMode || e.button !== 0) return;
    const tile = e.target.closest('.sm-tile');
    if (!tile) return;
    const slot = tile.closest('.sm-slot');
    let src = null;
    if (slot && ui.rack.contains(slot)) src = { kind: 'rack', i: +slot.dataset.i, el: slot };
    else if (tile.classList.contains('pending')) {
      const cell = tile.closest('.sm-cell');
      const pi = pending.findIndex((t) => t.r * N + t.c === +cell.dataset.i);
      if (pi < 0 || !myTurn()) return;
      src = { kind: 'pending', pi, el: cell };
    }
    if (!src) return;
    if (src.kind === 'rack' && pending.some((t) => t.ri === src.i)) return;
    drag = { src, x: e.clientX, y: e.clientY, active: false, ghost: null, over: null, pointerId: e.pointerId };
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.active = true;
      const rack = G.state.racks[viewer()];
      const t = drag.src.kind === 'rack' ? rack[drag.src.i] : pending[drag.src.pi].l;
      const b = drag.src.kind === 'rack' ? t === '?' : pending[drag.src.pi].b;
      const ghost = document.createElement('div');
      ghost.className = 'sm-drag';
      ghost.innerHTML = tileHtml(t === '?' ? '?' : t, b, '');
      ui.app.appendChild(ghost);
      drag.ghost = ghost;
      drag.src.el.classList.add('lifted');
      try { e.target.setPointerCapture(drag.pointerId); } catch (err) { /* fine */ }
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const target = dropTarget(e.clientX, e.clientY);
    if (drag.over && (!target || drag.over.el !== target.el)) drag.over.el.classList.remove('drop');
    if (target && (!drag.over || drag.over.el !== target.el)) {
      const ok = target.kind === 'slot' || (myTurn() && !G.state.board[target.i] && !pending.some((t) => t.r * N + t.c === target.i));
      if (ok) target.el.classList.add('drop');
    }
    drag.over = target;
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    if (!d.active) return;   // a plain click; the click handlers take it
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    d.ghost.remove();
    d.src.el.classList.remove('lifted');
    if (d.over) d.over.el.classList.remove('drop');
    const target = dropTarget(e.clientX, e.clientY);
    const rack = G.state.racks[viewer()];
    if (!target) { render(); return; }
    if (target.kind === 'slot') {
      const to = Math.min(target.i, rack.length - 1);
      if (d.src.kind === 'rack') reorderRack(rack, d.src.i, to);
      else { const t = pending[d.src.pi]; pending.splice(d.src.pi, 1); reorderRack(rack, t.ri, to); cursor = { r: t.r, c: t.c, down: cursor ? cursor.down : false }; draftChanged(); }
      render();
      return;
    }
    if (!myTurn()) { render(); return; }
    const r = Math.floor(target.i / N), c = target.i % N;
    if (G.state.board[target.i] || pending.some((t) => t.r === r && t.c === c)) { render(); return; }
    if (d.src.kind === 'rack') { place(r, c, d.src.i, rack[d.src.i] === '?'); return; }
    const t = pending[d.src.pi];
    t.r = r; t.c = c;
    cursor = { r, c, down: cursor ? cursor.down : false };
    advance();
    draftChanged();
    render();
  }
  ui.rack.addEventListener('pointerdown', onPointerDown);
  ui.board.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', (e) => { if (drag && drag.active) { drag.ghost.remove(); drag.src.el.classList.remove('lifted'); if (drag.over) drag.over.el.classList.remove('drop'); } drag = null; });

  // ---- keyboard ------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (ui.overlay.classList.contains('is-open')) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (R) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); reviewGo(R.k - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); reviewGo(R.k + 1); }
      else if (e.key === 'Escape') exitReview();
      return;
    }
    if (!myTurn() || swapMode) return;
    if (e.key === 'Enter') { e.preventDefault(); play(); return; }
    if (e.key === 'Escape') { recall(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { if (pending.length) { e.preventDefault(); backspace(); } return; }
    if (/^Arrow(Up|Down|Left|Right)$/.test(e.key) && cursor) {
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
    const keep = pending.map((t) => rack[t.ri]);
    for (let i = rack.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = rack[i]; rack[i] = rack[j]; rack[j] = t; }
    const taken = new Set();
    pending.forEach((t, k) => { for (let i = 0; i < rack.length; i++) if (!taken.has(i) && rack[i] === keep[k]) { taken.add(i); t.ri = i; break; } });
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
      moves = await Net.rpc('play_move', { p_code: G.id, p_token: G.online.token, p_index: idx, p_move: move });
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
  function applyLocal(move) {
    G.state = C.apply(G.state, move, dict);
    resetTurnUi();
    setStatus('');
    if (G.kind === 'hotseat' && !G.state.over) G.hidden = true;
    persist();
    render();
    afterMove();
  }
  function afterMove() {
    celebrateNew();
    if (G.state.over) { stopPolling(); showGameOver(); return; }
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
      await dictReady;
      if (!alive(s)) return;
      if (G.kind !== 'bot' || G.state.over || G.state.turn === G.me || !dict) { busy = false; render(); return; }
      const move = C.botMove(G.state, G.level, Math.random, dict);
      busy = false;
      applyLocal(move);
    }, 650);
  }
  function persist() {
    if (!G) return;
    games.put({ id: G.id, kind: G.kind, level: G.level, names: G.names, seed: G.state.seed, moves: G.state.moves, over: G.state.over,
                online: G.kind === 'online' ? { token: G.online.token, player: G.me } : undefined });
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
  function enterReview(k) {
    if (!G || !dict) return;
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
  // Every play available before move k, ranked by equity, with the played one found.
  function analysis(k) {
    if (R.cands.has(k)) return R.cands.get(k);
    const before = R.states[k - 1], p = before.turn;
    const rack = before.racks[p];
    const list = C.rank(C.generate(before.board, rack, dict), rack, before.bag.length === 0);
    const move = G.state.moves[k - 1], h = G.state.history[k - 1];
    const key = (tiles) => tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
    let played = null, playedEquity = 0, playedLabel = h.t;
    if (move.t === 'play') {
      const pk = key(move.tiles);
      played = list.findIndex((m) => key(m.tiles) === pk);
      playedEquity = played >= 0 ? list[played].equity : h.score;
      playedLabel = h.word + ' for ' + h.score;
    } else if (move.t === 'swap') {
      const kept = rack.slice();
      for (const t of move.tiles) kept.splice(kept.indexOf(t), 1);
      playedEquity = before.bag.length ? C.leaveValue(kept) : 0;
      playedLabel = 'swapped ' + plural(move.tiles.length, 'tile');
    } else if (move.t === 'pass') {
      playedEquity = before.bag.length ? C.leaveValue(rack) : 0;
      playedLabel = 'passed';
    }
    const best = list[0] || null;
    const gap = best ? Math.round((best.equity - playedEquity) * 10) / 10 : 0;
    const a = { list, played, playedEquity, playedLabel, best, gap, grade: !best || gap <= 0.5 ? 'best' : gap >= 8 ? 'miss' : 'ok' };
    R.cands.set(k, a);
    return a;
  }
  function computeSummary() {
    const session = G.session, states = R.states;
    const rows = [];
    let k = 1;
    const step = () => {
      if (!alive(session) || !R || R.states !== states) return;
      const t0 = Date.now();
      while (k <= G.state.moves.length && Date.now() - t0 < 40) {
        if (canAnalyze(k) && G.state.moves[k - 1].t !== 'resign') { const a = analysis(k); rows.push({ k, p: states[k - 1].turn, grade: a.grade, gap: a.gap, label: a.playedLabel, best: a.best }); }
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
    ui.review.disabled = !R && (M === 0 || !dict);
    ui.movesTitle.textContent = R ? 'Review' : 'Moves';
    ui.nav.hidden = !R;
    let html = '';
    s.history.forEach((e, i) => {
      const what = e.t === 'play' ? esc(e.word) + (e.bingo ? ' <small style="color:var(--good)">bingo</small>' : '') : e.t === 'swap' ? 'swap ×' + e.n : e.t;
      const grade = R && R.summary ? (R.summary.rows.find((r) => r.k === i + 1) || {}).grade : null;
      html += '<li data-k="' + (i + 1) + '"' + (R && R.k === i + 1 ? ' class="cur"' : '') + '><span><span class="n">' + (i + 1) + '.</span><span class="who">' + esc(nameOf(e.p)) + '</span>' + what + '</span>' +
        '<b>' + (e.t === 'play' ? '+' + e.score : '') + (grade === 'miss' ? ' <span style="color:var(--bad)">?</span>' : grade === 'best' ? ' <span style="color:var(--good)">★</span>' : '') + '</b></li>';
    });
    ui.log.innerHTML = html || '<li><span class="who">No moves yet.</span></li>';
    ui.log.querySelectorAll('li[data-k]').forEach((li) => li.addEventListener('click', () => { if (!dict) return; if (R) reviewGo(+li.dataset.k); else enterReview(+li.dataset.k); }));
    if (!R) { ui.analysis.hidden = true; return; }
    ui.navLabel.textContent = R.k === 0 ? 'Start' : 'Move ' + R.k + ' of ' + M;
    $('sm-nav-first').disabled = R.k === 0; $('sm-nav-prev').disabled = R.k === 0;
    $('sm-nav-next').disabled = R.k >= M; $('sm-nav-last').disabled = R.k >= M;
    ui.analysis.hidden = false;
    let a = '';
    if (R.k > 0 && canAnalyze(R.k) && s.moves[R.k - 1].t !== 'resign') {
      const an = analysis(R.k), who = isYou(s.history[R.k - 1].p) ? 'You' : nameOf(s.history[R.k - 1].p);
      const rankTxt = an.played === null ? '' : an.played < 0 ? '' : ' (#' + (an.played + 1) + ' of ' + an.list.length + ')';
      if (!an.best) a += '<div class="sm-verdict">No play was available; ' + esc(who.toLowerCase() === 'you' ? 'you' : who) + ' ' + esc(an.playedLabel) + '.</div>';
      else if (an.grade === 'best') a += '<div class="sm-verdict best"><b>' + esc(who) + ' found the best play.</b> ' + esc(an.playedLabel) + rankTxt + '.</div>';
      else a += '<div class="sm-verdict ' + (an.grade === 'miss' ? 'miss' : '') + '"><b>' + esc(who) + ': ' + esc(an.playedLabel) + rankTxt + '.</b> ' + esc(an.best.word) + ' for ' + an.best.score + ' was worth <b>' + an.gap + '</b> more once the rack it keeps is counted.</div>';
      const top = an.list.slice(0, 5);
      if (an.played >= 5) top.push(an.list[an.played]);
      if (top.length) {
        a += '<div class="sm-cands"><div class="head"><span>Top plays</span><span>score</span><span>keep</span><span>total</span></div>';
        top.forEach((m) => {
          const idx = an.list.indexOf(m);
          a += '<div data-c="' + idx + '" class="' + (idx === an.played ? 'played' : '') + (R.ghost === m ? ' ghost' : '') + '"><span><b>' + esc(m.word) + '</b> <small>' + (m.keeps ? 'keeps ' + esc(m.keeps) : 'plays out') + '</small></span><span>' + m.score + '</span><span>' + (m.leave >= 0 ? '+' : '') + m.leave + '</span><b>' + m.equity + '</b></div>';
        });
        a += '</div><div class="sm-note" style="margin:-4px 0 10px">Click a play to see it on the board; click again to go back.</div>';
      }
    } else if (R.k > 0) a += '<div class="sm-verdict">' + esc(nameOf(s.history[R.k - 1].p)) + '’s turn. Their rack and options stay hidden until the game is over.</div>';
    if (R.summary) {
      const misses = R.summary.rows.filter((r) => r.grade === 'miss').sort((x, y) => y.gap - x.gap);
      const bests = R.summary.rows.filter((r) => r.grade === 'best');
      const rated = R.summary.rows.length;
      a += '<div class="sm-k">Summary' + (R.summary.done ? '' : ' (working…)') + '</div><div class="sm-summary">';
      a += '<div class="sm-note" style="margin:0 0 4px">' + rated + ' turn' + (rated === 1 ? '' : 's') + ' rated · ' + bests.length + ' best · ' + misses.length + ' miss' + (misses.length === 1 ? '' : 'es') + '</div>';
      if (misses.length) { a += '<div class="sm-k" style="margin-top:6px">Mistakes</div>'; misses.forEach((r) => { a += '<div data-k="' + r.k + '">' + r.k + '. ' + (G.kind === 'hotseat' || G.me === null ? esc(nameOf(r.p)) + ': ' : '') + esc(r.label) + ' <b style="color:var(--bad)">−' + r.gap + '</b> <small>(' + esc(r.best.word) + ' ' + r.best.score + ')</small></div>'; }); }
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
  ui.review.addEventListener('click', () => { if (R) exitReview(); else enterReview(G.state.moves.length); });
  $('sm-nav-first').addEventListener('click', () => reviewGo(0));
  $('sm-nav-prev').addEventListener('click', () => reviewGo(R.k - 1));
  $('sm-nav-next').addEventListener('click', () => reviewGo(R.k + 1));
  $('sm-nav-last').addEventListener('click', () => reviewGo(G.state.moves.length));

  // ---- overlays ---------------------------------------------------------------
  function openOverlay(html) { ui.overlay.innerHTML = '<div class="sm-card">' + html + '</div>'; ui.overlay.classList.add('is-open'); }
  function closeOverlay() { ui.overlay.classList.remove('is-open'); ui.overlay.innerHTML = ''; }

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
        document.removeEventListener('keydown', onKey, true);
        closeOverlay();
        resolve(v);
      };
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
      const done = (v) => { closeOverlay(); resolve(v); };
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
  function showMenu() {
    setUrl(null);
    const list = games.list();
    let html = '<h2>Scrabble Mod</h2><p>Two racks, one bag, a 15×15 board.</p><div class="sm-choices">' +
      '<button data-bot="easy"><b>Play the bot: easy</b><small>plays middling words</small></button>' +
      '<button data-bot="medium"><b>Play the bot: medium</b><small>plays a good move, rarely the best</small></button>' +
      '<button data-bot="hard"><b>Play the bot: hard</b><small>plays the strongest move it can find</small></button>' +
      '<button id="sm-m-hotseat"><b>Two players, one device</b><small>pass it back and forth; racks hide between turns</small></button>' +
      '<button id="sm-m-online"' + (Net.enabled ? '' : ' disabled') + '><b>Play a friend online</b><small>' + (Net.enabled ? 'share a link; take turns whenever' : 'not set up on this site yet') + '</small></button>' +
      '</div>';
    if (list.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:14px">Your games</div><div class="sm-games">';
      for (const rec of list) {
        const l = gameLabel(rec);
        html += '<button data-open="' + esc(rec.id) + '"><b' + (l.when === 'your turn' ? ' class="now"' : '') + '>' + esc(l.kind) + '</b> <small>' + esc(l.when) + ' · ' + esc(rec.id) + '</small></button>';
      }
      html += '</div>';
    }
    if (G) html += '<div class="sm-row" style="justify-content:center;margin-top:10px"><button id="sm-m-back">Back to the board</button></div>';
    openOverlay(html);
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
      '<div><b>Review:</b> click any move in the list to step through the game. <kbd>←</kbd> <kbd>→</kbd> move between turns.</div>' +
      '<div><b>Word list:</b> ENABLE, the public-domain list.</div>' +
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
      html += '<div class="' + (n ? '' : 'none') + '">' + k + '<small>' + n + ' of ' + C.TILES[k][0] + '</small></div>';
    }
    html += '</div><button class="primary" id="sm-unseen-ok">Close</button>';
    openOverlay(html);
    $('sm-unseen-ok').addEventListener('click', closeOverlay);
  }
  function showGameOver() {
    const s = G.state;
    const why = s.endReason === 'resign' ? esc(nameOf(s.resigned)) + ' resigned.' : s.endReason === 'passes' ? 'Four passes in a row.' : 'The bag ran out and both players took a last turn.';
    openOverlay('<h2>' + esc(verdict(s)) + '</h2><p>' + why + '</p><div class="sm-final"><div>' + esc(nameOf(0)) + '<b>' + s.scores[0] + '</b></div><div>' + esc(nameOf(1)) + '<b>' + s.scores[1] + '</b></div></div>' +
      '<div class="sm-row" style="justify-content:center"><button id="sm-over-close">Look at the board</button><button id="sm-over-review">Review the game</button><button class="primary" id="sm-over-new">New game</button></div>');
    $('sm-over-close').addEventListener('click', closeOverlay);
    $('sm-over-review').addEventListener('click', () => { closeOverlay(); enterReview(s.moves.length); });
    $('sm-over-new').addEventListener('click', () => { closeOverlay(); showMenu(); });
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
    catch (e) { setStatus('The saved game ' + rec.id + ' could not be restored.', 'bad'); showMenu(); return; }
    G = { id: rec.id, kind: rec.kind, level: rec.level, names: rec.names, state, me: 0, hidden: rec.kind === 'hotseat' && !state.over, session: ++sessions };
    seenMoves = state.history.length;
    setUrl(rec.id);
    render();
    setStatus('');
    if (!dict) return;
    if (G.state.over) showGameOver();
    else if (G.kind === 'bot' && G.state.turn !== G.me) scheduleBot();
    else if (G.kind === 'hotseat') showHandoff();
  }
  async function openGame(id) {
    const rec = games.get(id);
    if (rec && rec.kind !== 'online') { resumeLocal(rec); return; }
    if (Net.enabled) { openOnline(id); return; }
    setStatus('There is no game called ' + id + ' in this browser.', 'bad');
    showMenu();
  }

  // ---- online --------------------------------------------------------------------
  const Net = {
    enabled: !!(CFG.url && CFG.key),
    headers() { return { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' }; },
    async rpc(fn, args) {
      const r = await fetch(CFG.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: this.headers(), body: JSON.stringify(args) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error((body && (body.message || body.hint || body.error)) || ('HTTP ' + r.status));
      return body;
    }
  };

  async function createOnline() {
    const my = ++navGen;
    const name = await askText('Your name', 'Shown to your opponent.', 'Name', store.get('sm.name', ''));
    if (my !== navGen) return;
    if (!name) { showMenu(); return; }
    store.set('sm.name', name);
    const token = randomToken();
    setStatus('Creating the game…');
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        await Net.rpc('create_game', { p_code: id, p_seed: randomSeed(), p_name: name, p_token: token });
        if (my !== navGen) return;
        games.put({ id, kind: 'online', names: [name, null], seed: null, moves: [], over: false, online: { token, player: 0 } });
        await openOnline(id);
        return;
      } catch (e) {
        if (my !== navGen) return;
        if (/taken/.test(e.message)) continue;
        setStatus('Could not create the game: ' + e.message, 'bad'); showMenu(); return;
      }
    }
    setStatus('Could not find a free game id; try again.', 'bad'); showMenu();
  }
  // Claim or recover a seat: from this browser's record, or from a private
  // link's token, or by joining the empty second seat.
  async function seatFor(id, row) {
    const rec = games.get(id);
    if (rec && rec.online && rec.online.player !== null && rec.online.token) return { token: rec.online.token, player: rec.online.player };
    const urlToken = tokenFromUrl();
    if (urlToken) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const player = await Net.rpc('join_game', { p_code: id, p_name: store.get('sm.name', '') || 'Player', p_token: urlToken });
        return { token: urlToken, player };
      } catch (e) { setStatus('That private link did not open a seat: ' + e.message, 'bad'); }
    }
    if (row.full) return { token: null, player: null };
    const name = await askText('Join ' + esc(row.p1_name || 'the game'), 'Shown to your opponent.', 'Your name', store.get('sm.name', ''));
    if (!name) return null;
    store.set('sm.name', name);
    const token = randomToken();
    const player = await Net.rpc('join_game', { p_code: id, p_name: name, p_token: token });
    return { token, player };
  }
  async function openOnline(id) {
    const my = ++navGen;
    await dictReady;
    if (my !== navGen) return;
    if (!dict) return;
    let row;
    try { row = await Net.rpc('get_game', { p_code: id }); } catch (e) { if (my !== navGen) return; setStatus('Could not load game ' + id + ': ' + e.message, 'bad'); showMenu(); return; }
    if (my !== navGen) return;
    if (!row) { setStatus('There is no game called ' + id + '.', 'bad'); showMenu(); return; }
    let seat;
    try { seat = await seatFor(id, row); } catch (e) { if (my !== navGen) return; setStatus('Could not join: ' + e.message, 'bad'); showMenu(); return; }
    if (my !== navGen) return;
    if (!seat) { showMenu(); return; }
    if (seat.player !== null) {
      try { row = await Net.rpc('get_game', { p_code: id }); } catch (e) { /* keep what we have */ }
      if (my !== navGen) return;
    }
    let state;
    try { state = C.replay(row.seed, row.moves || []); } catch (e) { setStatus('This game’s record is corrupt: ' + e.message, 'bad'); return; }
    leaveGame();
    G = { id, kind: 'online', level: null, names: [row.p1_name || 'Player 1', row.p2_name || null], state, me: seat.player, online: { token: seat.token }, hidden: false, session: ++sessions };
    seenMoves = state.history.length;
    if (seat.player !== null) persist();
    setUrl(id);
    render();
    setStatus(seat.player === null ? 'Watching: this game already has two players.' : '');
    if (G.state.over) showGameOver();
    else { startPolling(); if (G.state.turn === G.me && C.options(G.state).mustPass) commit({ t: 'pass' }); }
  }
  // Fold the server's move list into ours. Idempotent: moves we already have
  // are skipped, so a poll and a submission can both deliver the same move.
  // Server moves are trusted like stored ones; only our own are validated.
  function integrate(moves, names) {
    if (names) G.names = names;
    moves = moves || [];
    let s = G.state;
    try { for (let i = s.moves.length; i < moves.length; i++) s = C.apply(s, moves[i], null); }
    catch (e) { setStatus('The game record no longer matches this page: ' + e.message, 'bad'); return; }
    const changed = s !== G.state;
    if (changed) { G.state = s; resetTurnUi(); R = null; }
    persist();
    render();
    if (changed) afterMove();
  }
  async function syncOnline() {
    if (!G || G.kind !== 'online') return;
    const s = G.session;
    let row;
    try { row = await Net.rpc('get_game', { p_code: G.id }); } catch (e) { return; }
    if (!alive(s) || busy || !row) return;
    integrate(row.moves, [row.p1_name || 'Player 1', row.p2_name || null]);
  }
  function startPolling() {
    stopPolling();
    if (!G || G.kind !== 'online' || G.state.over) return;
    const tick = () => { if (document.visibilityState === 'visible') syncOnline(); };
    pollTimer = setInterval(tick, G.state.turn === G.me ? 15000 : 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && G.kind === 'online') syncOnline(); });
  function renderOnlinePanel() {
    if (!G || G.kind !== 'online') { ui.online.style.display = 'none'; return; }
    ui.online.style.display = '';
    const invite = linkFor(G.id), mine = G.online.token ? linkFor(G.id, G.online.token) : null;
    ui.online.innerHTML = '<div class="sm-k">Online game</div><div>Game <span class="sm-code">' + esc(G.id) + '</span></div>' +
      (G.names[1] ? '<div class="sm-note">' + esc(G.names[0]) + ' vs ' + esc(G.names[1]) + '. This page checks for new moves every few seconds while it is open; come back any time.</div>'
                  : '<div class="sm-note">Waiting for a second player. Send them this link:</div><input type="text" readonly value="' + esc(invite) + '" id="sm-link"><div class="sm-row"><button id="sm-copy" data-link="' + esc(invite) + '">Copy invite link</button></div>') +
      (mine ? '<div class="sm-note" style="margin-top:10px">Your private link opens <i>your</i> seat on another device. Keep it to yourself.</div><div class="sm-row"><button id="sm-copy-mine" data-link="' + esc(mine) + '">Copy private link</button></div>' : '') +
      '<div class="sm-row"><button id="sm-refresh">Refresh</button></div>';
    ui.online.querySelectorAll('button[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.link); b.textContent = 'Copied'; }
      catch (e) { window.prompt('Copy this link:', b.dataset.link); }
    }));
    $('sm-refresh').addEventListener('click', syncOnline);
  }

  // ---- zoom ------------------------------------------------------------------------
  const ZOOMS = [1, 1.5, 2, 2.5];
  let zoom = store.get('sm.zoom', 1);
  if (!ZOOMS.includes(zoom)) zoom = 1;
  function applyZoom() {
    ui.board.style.setProperty('--zoom', zoom);
    ui.zoomLabel.textContent = zoom + '×';
    ui.zoomOut.disabled = zoom === ZOOMS[0];
    ui.zoomIn.disabled = zoom === ZOOMS[ZOOMS.length - 1];
    store.set('sm.zoom', zoom);
  }
  ui.zoomIn.addEventListener('click', () => { zoom = ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]; applyZoom(); });
  ui.zoomOut.addEventListener('click', () => { zoom = ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]; applyZoom(); });
  applyZoom();

  // ---- boot ----------------------------------------------------------------------
  ui.newBtn.addEventListener('click', showMenu);
  ui.help.addEventListener('click', showHelp);
  ui.bagBtn.addEventListener('click', () => { if (G) showUnseen(); });
  dictReady.then(() => { if (G) render(); });

  const wanted = idFromUrl();
  if (wanted) openGame(wanted);
  else {
    const latest = games.list().find((r) => !r.over);
    if (latest) openGame(latest.id); else showMenu();
  }

  window.__sm = { get game() { return G; }, get review() { return R; }, core: C, get dict() { return dict; }, games, enterReview, reviewGo };
})();
