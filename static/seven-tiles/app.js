/* Seven Tiles page script: the board and rack UI, the bot's turns, pass-and-
   play on one device, online games against a Supabase project when the page
   has been given one, and a move-by-move review. All rules live in core.js.

   Every game has a three-word id that is also its address. Local games (bot,
   pass-and-play) are kept in this browser under that id; online games live on
   the server and are cached here. */
(function () {
  'use strict';
  const C = window.SevenTiles;
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
  const sentence = (t) => (/[.!?]$/.test(t) ? t : t + '.');

  // ---- game ids and addresses --------------------------------------------
  const WORDS = ('acorn amber apple arrow badger bagel basil beach birch bison bloom brick brook cabin candle canoe cedar cherry ' +
    'cider cloud clover cobalt comet coral crane daisy delta dune eagle ember falcon fern finch flint forest garden ginger ' +
    'goose grape harbor hawk hazel heron honey ivory jade juniper kettle lagoon lantern lemon lilac lotus maple marble ' +
    'meadow mint moose moss olive orchid otter owl pebble pepper pine plum poppy quartz raven reed river robin saffron sage ' +
    'salmon shadow slate sparrow spruce stone summit thistle tiger timber tulip velvet violet walnut willow wren zebra').split(' ');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const newId = () => pick(WORDS) + '-' + pick(WORDS) + '-' + pick(WORDS);
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const BASE = location.pathname.replace(/(\/seven-tiles\/).*$/, '$1');
  // A live room is room:<words>, at /seven-tiles/room/<words>.
  const roomWords = (id) => (/^room:([a-z]+(?:-[a-z]+){2})$/.exec(id || '') || [])[1] || null;
  const pathFor = (id) => {
    const room = roomWords(id);
    if (room) return BASE + (LOCAL_HOST ? '?room=' : 'room/') + room;
    return id ? (LOCAL_HOST ? BASE + '?g=' + id : BASE + id) : BASE;
  };
  const linkFor = (id, token) => location.origin + pathFor(id) + (token ? '#k=' + token : '');
  function idFromUrl() {
    const q = new URLSearchParams(location.search).get('g');
    if (q) return q.toLowerCase();
    const m = location.pathname.match(/\/seven-tiles\/([a-z0-9-]+)\/?$/i);
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
    for (const rec of games.list()) if (rec.kind === 'same') games.remove(rec.id);   // an offline Same Rack that never shipped
  })();

  // ---- dictionary --------------------------------------------------------
  // dict: every legal word. common: the words most people know, which the
  // low bot levels keep mostly to and which the review rates against.
  let dict = null, common = null;
  let dictFailed = false;
  let lexicon = null;   // which list is loaded, and the credit it needs (shown in How to play)
  // the lists ship packed (see core.js): gunzipped here, unscrambled and read by the engine
  const gunzip = (bytes) => {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser is too old to open it');
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  };
  const loadList = (file) => fetch(BASE + file)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then((b) => C.unpackLexicon(b, gunzip));
  const dictReady = loadList('words.bin')
    .then((l) => { lexicon = l.meta; dict = C.buildDict(l.words); })
    .catch((e) => { dictFailed = true; setStatus('The word list failed to load (' + e.message + '). Reload to try again.', 'bad'); if (ui.overlay.classList.contains('is-open') && $('sm-m-hotseat')) showMenu(); });
  const commonReady = loadList('common.bin')
    .then((l) => { common = C.buildDict(l.words); })
    .catch(() => { /* the full list stands in */ });

  // ---- session -----------------------------------------------------------
  // G: { id, kind: 'bot'|'hotseat'|'online'|'room', level, names, state, me, online: {token}, hidden, session }
  // (a Same Rack room has more: see "Same Rack" below)
  let G = null;
  let sessions = 0;        // bumps per opened game; async callbacks check it
  let navGen = 0;          // bumps per navigation request; a stale open() gives up
  let pending = [];        // [{r, c, l, b, ri}] tiles placed this turn, ri = rack slot
  let sel = -1;            // selected rack slot
  let cursor = null;       // {r, c, down}
  let swapMode = false;
  let marks = new Set();   // rack slots marked for a swap
  let busy = false;        // a move is in flight (bot thinking, server call, list loading)
  let pollTimer = null, botTimer = null, lastHiddenPoll = 0, roomClock = null, roomTimer = null;
  let statusIsPreview = false, stickyError = null;
  let R = null;            // review mode, see below
  let seenMoves = 0;       // history length already shown, for the bingo animation

  const alive = (s) => !!G && G.session === s;
  const myTurn = () => !!G && !R && !G.state.over && !busy && (G.kind === 'room' ? G.phase === 'play' && G.me !== null : G.kind === 'hotseat' ? !G.hidden : G.state.turn === G.me);
  // Laying tiles out is allowed on the opponent's turn too: the board shows the
  // score and whether it is legal, and only playing it waits for the turn.
  const canDraft = () => !!G && !R && !G.state.over && !G.hidden && viewer() !== null && (G.kind === 'room' ? G.phase === 'play' : !(busy && G.state.turn === viewer()));
  const viewer = () => (G.kind === 'hotseat' ? G.state.turn : G.me);   // null for a spectator
  const myRack = () => (G.kind === 'room' ? G.state.rack : G.state.racks[viewer()]);   // Same Rack has one rack, everyone's
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
  // After a move lands. A draft laid out while waiting for the opponent carries
  // over where its squares are still free, since their move leaves this rack as
  // it was; after any other move the turn starts afresh.
  function turnUiAfterMove() {
    const last = G.state.history[G.state.history.length - 1];
    const carry = G.kind !== 'hotseat' && G.me !== null && !G.state.over && last && last.p !== G.me && pending.length > 0;
    if (!carry) { resetTurnUi(); return; }
    if (drag && drag.src && drag.src.kind === 'pending') endDrag(drag);
    const rack = G.state.racks[G.me], taken = new Set();
    pending = pending.filter((t) => {
      const ok = !G.state.board[t.r * N + t.c] && t.ri < rack.length && rack[t.ri] === (t.b ? '?' : t.l) && !taken.has(t.ri);
      if (ok) taken.add(t.ri);
      return ok;
    });
    if (cursor && G.state.board[cursor.r * N + cursor.c]) cursor = null;
    sel = -1; swapMode = false; marks = new Set(); stickyError = null;
  }
  function leaveGame() {
    clearTimeout(botTimer); botTimer = null;
    stopPolling();
    stopRoomClock();
    stopRoomPoll();
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
      const isCur = !!cursor && cursor.r * N + cursor.c === i && canDraft();
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
    return viewer() === null ? [] : myRack();
  }
  // In review, the rack slots the reviewed move used: the tiles it played (a
  // blank counts as the blank) or swapped, or those of the suggested play
  // shown in its place, matched to the rack in order.
  function reviewUsedSlots() {
    const used = new Set();
    if (!R || R.k === 0 || !canAnalyze(R.k)) return used;
    const rack = rackShown();
    let want = [];
    if (R.ghost) want = R.ghost.tiles.map((t) => (t.b ? '?' : t.l));
    else {
      const m = G.state.moves[R.k - 1];
      if (m.t === 'play') want = m.tiles.map((t) => (t.b ? '?' : t.l));
      else if (m.t === 'swap') want = m.tiles.slice();
    }
    for (const l of want) {
      const i = rack.findIndex((x, j) => x === l && !used.has(j));
      if (i >= 0) used.add(i);
    }
    return used;
  }
  let rackDirty = false, boardDirty = false;   // a render was skipped mid-drag; redo it at release
  function renderRack() {
    if (drag && drag.active) { rackDirty = true; return; }
    const rack = rackShown();
    const used = new Set(pending.map((t) => t.ri));
    const reviewed = reviewUsedSlots();
    let html = '';
    for (let i = 0; i < C.RACK; i++) {
      const cls = ['sm-slot', sel === i ? 'sel' : '', marks.has(i) ? 'mark' : '', G.hidden ? 'hidden' : '', reviewed.has(i) ? (R.ghost ? 'used alt' : 'used') : ''].join(' ').trim();
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
    // Same Rack has no swaps, resigning or review
    for (const b of [ui.swap, ui.resign, ui.review]) b.style.display = G.kind === 'room' ? 'none' : '';
    if (G.kind === 'room') { renderRoom(); return; }
    ui.pass.textContent = 'Pass'; ui.pass.style.display = '';
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

    const mine = myTurn(), drafting = canDraft();
    const waiting = drafting && !mine;   // laying out a move while the other side is to play
    const opt = C.options(s);
    let preview = null;
    if (drafting && !swapMode && pending.length) preview = previewDraft(s);
    ui.board.classList.toggle('valid', !!(preview && preview.ok));
    if (stickyError) { /* an action failed: keep saying so until the draft changes */ }
    else if (preview) { setStatus(waiting ? preview.text.replace(/\.$/, '') + '. Not your turn yet.' : preview.text, preview.kind); statusIsPreview = true; }
    else if (statusIsPreview) setStatus('');
    ui.play.textContent = swapMode ? 'Swap ' + marks.size + ' & pass' : waiting ? 'Their turn' : preview && preview.ok ? 'Play for ' + preview.score : 'Play';
    ui.play.disabled = !mine || (swapMode ? marks.size === 0 : opt.mustPass);
    ui.swap.disabled = !mine || !opt.swap;
    ui.swap.textContent = swapMode ? 'Cancel swap' : 'Swap';
    ui.pass.disabled = !mine || swapMode;
    ui.recall.disabled = !drafting || !pending.length;
    ui.shuffle.disabled = !!R || viewer() === null || G.hidden;
    ui.resign.disabled = !!R || s.over || (G.kind === 'hotseat' ? false : G.me === null || (G.kind === 'online' && !G.names[1]));
    if (mine && opt.mustPass && !stickyError) setStatus('You have no tiles left. Pass to let ' + nameOf(1 - s.turn) + ' take the last turn.');
    renderOnlinePanel();
  }

  // ---- placing tiles -------------------------------------------------------
  function slotFor(letter) {
    const rack = myRack();
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
    let l = myRack()[ri];
    if (b) {
      const s = G.session, before = pending.length;
      l = await pickLetter();
      if (!alive(s) || pending.length !== before || !l || !canDraft() || occupied(r, c)) { if (alive(s)) render(); return; }
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
    if (!cell || !canDraft() || swapMode) return;
    const i = +cell.dataset.i, r = Math.floor(i / N), c = i % N;
    const pi = pending.findIndex((t) => t.r === r && t.c === c);
    if (pi >= 0) { takeBack(pi); return; }
    if (G.state.board[i]) return;
    if (sel >= 0) { place(r, c, sel, myRack()[sel] === '?'); return; }
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
    const rack = myRack();
    if (i >= rack.length || pending.some((t) => t.ri === i)) return;
    if (swapMode) { if (marks.has(i)) marks.delete(i); else marks.add(i); render(); return; }
    if (!canDraft()) return;
    // A tap puts the tile down at the board cursor and moves the cursor on, so
    // tapping tiles one after another lays a word. On an empty board the
    // cursor starts at the centre. With no cursor, the tile is picked up and
    // the next square tapped takes it.
    if (!cursor && !pending.length && G.state.board.every((x) => !x)) cursor = { r: (N - 1) / 2, c: (N - 1) / 2, down: false };
    if (cursor && !occupied(cursor.r, cursor.c)) { place(cursor.r, cursor.c, i, rack[i] === '?'); return; }
    sel = sel === i ? -1 : i;
    if (sel >= 0) setStatus('Tap a square to put it there. Or tap a square first, then tiles, to lay a word.');
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
      if (pi < 0 || !canDraft()) return;
      src = { kind: 'pending', pi, node: tile };
    }
    if (!src) return;
    if (src.kind === 'rack' && pending.some((t) => t.ri === src.i)) return;
    drag = { src, x: e.clientX, y: e.clientY, active: false, ghost: null, over: null, pointerId: e.pointerId, lifted: null, hiddenNode: null };
  }
  function activateDrag() {
    const rack = myRack();
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
    const rack = myRack();
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
      const ok = canDraft() && !G.state.board[target.i] && !pending.some((t) => t.r * N + t.c === target.i);
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
    const rack = myRack();
    const target = dropTarget(e.clientX, e.clientY);
    if (!target && rackBand(e.clientX, e.clientY)) {
      if (d.src.kind === 'pending') { pendingToRack(); if (!drag) return; }
      const idx = slotIndexAt(e.clientX, rack.length);
      if (idx !== d.src.i) reorderRack(rack, d.src.i, idx);
      endDrag(d); render(); return;
    }
    endDrag(d);
    if (!target || !canDraft()) { render(); return; }
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
    if (!canDraft()) return;
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
    const rack = myRack();
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
    if (G && G.kind === 'room') { if (G.phase === 'ready' && online() && myRound() < liveRound()) skipAhead(); return; }   // Same Rack: skip to the room's round
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
    if (G && G.kind === 'room') { roomPrimary(); return; }
    if (!myTurn()) {
      if (canDraft() && pending.length) { setStatus('Not your turn yet. The tiles stay where they are, ready to play when it is.'); statusIsPreview = true; }
      return;
    }
    if (swapMode) {
      const rack = myRack();
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
    turnUiAfterMove();
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
    if (G && G.kind === 'room') { persistRoom(); return; }
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
  const reviewAllowed = () => !!G && G.kind !== 'room' && (G.kind === 'bot' || G.state.over);
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
    if (!common) a.provisional = true;   // rated against the full list; redone once the common list arrives
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
      a += '<div class="sm-k">Summary' + (R.summary.done ? '' : ' (working…)') + '</div><div class="sm-performance">';
      // A finished game rates both players; an ongoing bot game only reveals
      // the viewer's turns. Keep empty seats visible without inventing a rating.
      for (const p of s.over ? [0, 1] : [G.me]) {
        const rows = R.summary.rows.filter((r) => r.p === p), rated = rows.length;
        const avg = rated ? (rows.reduce((t, r) => t + r.rating, 0) / rated).toFixed(1) : '—';
        const counts = rows.reduce((t, r) => { t[r.grade] = (t[r.grade] || 0) + 1; return t; }, {});
        a += '<div class="sm-performance-player"><div class="sm-performance-head"><b>' + esc(nameOf(p)) + '</b><span class="sm-performance-rating"><b>' + avg + '</b><small>average rating</small></span></div>' +
          '<div class="sm-note">' + plural(rated, 'turn') + ' rated' + (rated ? ' · ' + (counts.brilliant ? counts.brilliant + ' brilliant · ' : '') + (counts.best || 0) + ' best · ' + (counts.miss || 0) + ' to improve' : '') + '</div></div>';
      }
      a += '</div><div class="sm-note" style="margin:0 0 10px">Average of each player’s rated turns, including passes and swaps. The best common play rates 100; rare-word plays can rate higher.</div><div class="sm-summary">';
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
    if (rec.kind === 'room') return { kind: 'Same Rack', code: rec.words, when: rec.over ? 'finished' : rec.row && rec.row.phase !== 'lobby' ? 'round ' + rec.round : 'in the lobby' };
    const kind = rec.kind === 'bot' ? 'vs ' + botName(rec.level) : rec.kind === 'hotseat' ? 'Pass and play' : 'Online' + (rec.names && rec.names[1] ? ': ' + rec.names[0] + ' vs ' + rec.names[1] : rec.names && rec.names[0] ? ' with ' + rec.names[0] : '');
    const n = rec.moves ? rec.moves.length : 0;
    let when;
    if (rec.over) when = 'finished';
    else if (rec.kind === 'online' && rec.online && rec.online.player !== null) when = (n % 2 === rec.online.player) ? 'your turn' : 'their turn';
    else when = plural(n, 'move') + ' in';
    return { kind, when };
  }
  // A games-list row. A game waiting on this player carries a "Your turn" badge.
  function gameRowHtml(id, l) {
    const now = l.when === 'your turn';
    return '<button data-open="' + esc(id) + '"' + (now ? ' class="now"' : '') + '><b>' + esc(l.kind) + '</b>' + (now ? '<span class="sm-turn">Your turn</span>' : '') +
      '<small>' + esc(l.when) + ' · ' + esc(l.code || id) + '</small></button>';
  }
  const serverWhen = (m) => (m.finished || m.resigned) ? 'finished' : m.moves % 2 === m.seat ? 'your turn' : m.p2_name ? 'their turn' : 'waiting for a player';
  // Correct a row already on screen once the server has said whose turn it is.
  function markTurn(id, when) {
    const b = [...ui.overlay.querySelectorAll('button[data-open]')].find((x) => x.dataset.open === id);
    if (!b) return;
    const kind = b.querySelector('b').textContent;
    const holder = document.createElement('div');
    holder.innerHTML = gameRowHtml(id, { kind, when });
    const fresh = holder.firstElementChild;
    fresh.addEventListener('click', () => { closeOverlay(); openGame(id); });
    b.replaceWith(fresh);
    countWaiting();
  }
  function countWaiting() {
    const head = $('sm-m-yours');
    if (!head) return;
    const n = ui.overlay.querySelectorAll('.sm-games button.now').length;
    head.innerHTML = 'Your games' + (n ? ' <span class="sm-turn">' + n + ' waiting on you</span>' : '');
  }
  // Online games held only by a link (or when not signed in): ask the server
  // how far each has got, a handful at a time, and correct their rows.
  function refreshLinkGames(list) {
    if (!Net.enabled || !list) return;
    const open = list.filter((r) => r.kind === 'online' && !r.over && r.online && r.online.token && r.online.player !== null).slice(0, 8);
    for (const rec of open) {
      Net.rpc('get_game', { p_code: rec.id, p_token: rec.online.token }).then((row) => {
        if (!row || !row.moves || !row.seed || !ui.overlay.classList.contains('is-open')) return;
        let s;
        try { s = C.replay(C.unpack(rec.id, row.seed), row.moves.map((m) => C.unpack(rec.id, m.d))); } catch (e) { return; }   // no word list needed
        markTurn(rec.id, s.over ? 'finished' : s.turn === rec.online.player ? 'your turn' : row.full ? 'their turn' : 'waiting for a player');
      }).catch(() => {});
    }
  }
  // The bot's difficulty, 0 to 100, remembered between games. Games started
  // before the dial keep their named level (easy, medium or hard).
  let botLevel = (() => { const v = Number(store.get('sm.botLevel', 35)); return v >= 0 && v <= 100 ? Math.round(v / 5) * 5 : 35; })();
  const botName = (level) => (typeof level === 'number' ? 'Bot (level ' + level + ')' : 'Bot (' + level + ')');
  function levelWords(d) {
    return d >= 100 ? 'full strength' : d >= 80 ? 'expert' : d >= 60 ? 'strong' : d >= 40 ? 'club player' : d >= 20 ? 'casual' : 'new to the game';
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
    let html = '<h2>Seven Tiles</h2><p>Two racks, one bag, a 15×15 board.</p>' + note + (dictFailed ? '<p style="color:var(--bad)">The word list did not load, so no new game can start. Reload to try again.</p>' : '') + '<div class="sm-choices">' +
      '<div class="sm-botpick"><div class="sm-botrow"><b>Play the bot</b><span id="sm-m-lvl">' + esc(levelWords(botLevel)) + '</span></div>' +
      '<input type="range" id="sm-m-level" min="0" max="100" step="5" value="' + botLevel + '" aria-label="Bot difficulty, 0 to 100"' + noDict + '>' +
      '<div class="sm-botscale"><small>0: new to the game</small><small>100: full strength</small></div>' +
      '<button class="primary" id="sm-m-bot"' + noDict + '>Play at level <span id="sm-m-lvlnum">' + botLevel + '</span></button></div>' +
      '<button id="sm-m-hotseat"' + noDict + '><b>Two players, one device</b><small>pass it back and forth; racks hide between turns</small></button>' +
      '<button id="sm-m-same"' + noDict + '><b>Same Rack</b><small>a group plays the same racks</small></button>' +
      '<button id="sm-m-online"' + (Net.enabled && navigator.onLine !== false ? '' : ' disabled') + '><b>Play a friend online</b><small>' + (!Net.enabled ? 'not set up on this site yet' : navigator.onLine === false ? 'you are offline' : 'share a link; take turns whenever') + '</small></button>' +
      '</div>';
    if (list.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:14px" id="sm-m-yours">Your games</div><div class="sm-games">';
      for (const rec of list) html += gameRowHtml(rec.id, gameLabel(rec));
      html += '</div>';
    }
    if (user) html += '<div class="sm-note" id="sm-m-mine">Looking up your games…</div>';
    if (Net.enabled) html += '<div style="margin-top:12px;display:flex;justify-content:center">' + authRowHtml() + '</div>' + pushRowHtml();
    if (G) html += '<div class="sm-row" style="justify-content:center;margin-top:10px"><button id="sm-m-back">Back to the board</button></div>';
    openOverlay(html);
    if (Net.enabled) { bindAuth(ui.overlay); bindPush(ui.overlay); }
    if (user) {
      // games on the account that this browser has not seen (other devices, or a cleared browser)
      Net.rpc('my_games').then((mine) => {
        const note = $('sm-m-mine');
        if (!note) return;
        // the account's view of each game is fresher than this browser's copy: correct the rows above
        for (const m of mine || []) if (games.get(m.id)) markTurn(m.id, serverWhen(m));
        refreshLinkGames(list.filter((r) => !(mine || []).some((m) => m.id === r.id)));   // seats held here by link only
        const extra = (mine || []).filter((m) => !games.get(m.id));
        if (!extra.length) { note.remove(); return; }
        let h = '<div class="sm-k" style="text-align:left;margin-top:10px">Your games on other devices</div><div class="sm-games">';
        for (const m of extra) h += gameRowHtml(m.id, { kind: 'Online: ' + (m.p2_name ? m.p1_name + ' vs ' + m.p2_name : 'with ' + m.p1_name), when: serverWhen(m) });
        const holder = document.createElement('div');
        holder.innerHTML = h + '</div>';
        const added = [...holder.querySelectorAll('button[data-open]')];
        note.replaceWith(...holder.childNodes);
        added.forEach((b) => b.addEventListener('click', () => { closeOverlay(); openGame(b.dataset.open); }));
        countWaiting();
      }).catch(() => { const note = $('sm-m-mine'); if (note) note.textContent = 'Could not look up your games.'; });
    }
    if (!user) refreshLinkGames(list);
    countWaiting();
    const slider = $('sm-m-level');
    slider.addEventListener('input', () => { botLevel = +slider.value; store.set('sm.botLevel', botLevel); $('sm-m-lvl').textContent = levelWords(botLevel); $('sm-m-lvlnum').textContent = botLevel; });
    $('sm-m-bot').addEventListener('click', () => { closeOverlay(); startLocal('bot', botLevel); });
    ui.overlay.querySelectorAll('button[data-open]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); openGame(b.dataset.open); }));
    $('sm-m-hotseat').addEventListener('click', () => { closeOverlay(); startLocal('hotseat'); });
    $('sm-m-same').addEventListener('click', () => showSameSetup());
    $('sm-m-online').addEventListener('click', () => { closeOverlay(); createOnline(); });
    const back = $('sm-m-back');
    if (back) back.addEventListener('click', () => { closeOverlay(); setUrl(G.id); });
  }
  function showHandoff() {
    openOverlay('<h2>' + esc(nameOf(G.state.turn)) + '’s turn</h2><p>Pass the device over. The rack stays hidden until you tap.</p><button class="primary" id="sm-reveal">Show my rack</button>');
    $('sm-reveal').addEventListener('click', () => { G.hidden = false; closeOverlay(); render(); });
  }
  // the loaded list's name, linked where its licence asks for a link, and its credit line
  function lexiconCredit() {
    if (!lexicon) return 'plays are checked against the word list once it has loaded.';
    const name = lexicon.link ? '<a href="' + esc(lexicon.link) + '" target="_blank" rel="noopener">' + esc(lexicon.name) + '</a>' : esc(lexicon.name);
    if (lexicon.attribution) return 'plays are checked against the ' + name + '. ' + esc(lexicon.attribution);
    return 'plays are checked against ' + (lexicon.note ? esc(lexicon.note).replace(esc(lexicon.name), name) : name + '.');
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
      '<div><b>Same Rack:</b> a group plays the same racks. Your play scores for you alone. Then the best play made of everyday words goes on the board for everyone. The highest total wins.</div>' +
      '<div><b>Word list:</b> ' + lexiconCredit() + ' The ratings use only its common words, and the bot keeps mostly to them at low levels, less so as the level rises.</div>' +
      '</div>' +
      '<button class="primary" id="sm-help-ok" style="margin-top:12px">Got it</button>');
    $('sm-help-ok').addEventListener('click', closeOverlay);
  }
  // The tiles this player cannot see: the bag plus the other rack.
  function showUnseen() {
    if (G.kind === 'room') {   // the bag, and the rack while it is hidden
      const tiles = G.state.bag.concat(G.hidden ? G.state.rack : []), counts = {};
      for (const t of tiles) counts[t] = (counts[t] || 0) + 1;
      let html = '<h2>Unseen tiles</h2><p>' + G.state.bag.length + ' in the bag' + (G.hidden ? ' and ' + G.state.rack.length + ' on the next rack' : '') + '.</p><div class="sm-unseen">';
      for (const k of Object.keys(C.TILES)) html += '<div class="' + (counts[k] ? '' : 'none') + '">' + k + '<small>' + (counts[k] || 0) + '</small></div>';
      openOverlay(html + '</div><button class="primary" id="sm-unseen-ok">Close</button>');
      $('sm-unseen-ok').addEventListener('click', closeOverlay);
      return;
    }
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
    G = { id, kind, level: level === undefined ? null : level, names: kind === 'bot' ? ['You', botName(level)] : ['Player 1', 'Player 2'], state: C.newGame(randomSeed()), me: 0, hidden: false, session: ++sessions };
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
    if (rec && rec.kind === 'room') { openRoom(rec.words); return; }
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

  // ---- Same Rack --------------------------------------------------------------------
  // A group of up to twelve plays the same racks in a room on the server. Each
  // round everyone plays the same rack on their own copy of the board, and a
  // play scores for its player alone. Then the best play made of everyday
  // words goes on the board for everyone (core.js, given the common list), so
  // the whole game follows from the seed and every phone can deal every rack
  // by itself.
  //
  // With signal, players share the server's clock: a round opens for everyone
  // at once, closes at its deadline or once everyone is done, and the plays
  // are shown together. Without signal, a phone keeps going on its own clock
  // and files its plays when it can. The server shows the other plays of a
  // round only to a player who has finished it, so a late play could not have
  // used them. A player who falls behind catches up on their own clock, or
  // skips ahead to the room's round. See the rooms section of
  // plans/seven-tiles-supabase.sql.
  //
  // G for a room: { id: 'room:<words>', kind: 'room', words, token, me, names,
  //   seed, states, row, offline, offset, rtt, mine, others, phase, cur, seconds, ... }
  //   states[i]: the game after i rounds, worked out as far as needed.
  //   row: the server's last answer (saved with the game, so it opens offline).
  //   offset: server time minus this clock, from the quickest answer so far.
  //   mine: { round: { play, done, sent } }, this player's plays, sent or not.
  //   others: the other players' finished plays the server has shown, by 'round:player'.
  //   phase: 'lobby', 'ready' (your next round waits for you to start it on
  //     your own clock), 'play', 'wait' (you are done and the room is still
  //     playing your round), 'reveal' (the room is between rounds), 'over'
  //     (you have played every round) or 'watch' (no seat).
  //   cur: the round being played, { k, live, ends, move, score, word }.
  //   bots, botDue: the bots this page plays for (the host's), see "bots" below.
  // Saved as { id, kind: 'room', words, token, player, over, round, row, mine, cur: { k, ends }, bots }.
  const SAME_ROUNDS = [10, 15, 0], SAME_SECONDS = [60, 90, 120, 180, 0];
  const secondsWords = (t) => (t < 120 ? t + ' seconds' : t / 60 + ' minutes');
  const draftKey = (tiles) => tiles.map((t) => t.r + ',' + t.c + t.l + (t.b ? '*' : '')).sort().join('|');
  const draftMove = () => ({ t: 'play', tiles: pending.map((t) => ({ r: t.r, c: t.c, l: t.l, b: t.b })) });
  const roomId = (words) => 'room:' + words;
  // three words however they were typed: "Otter slate, plum" is otter-slate-plum
  function normWords(text) {
    const w = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    return w.length === 3 && w.every((x) => x.length <= 12) ? w.join('-') : null;
  }
  function roomFromUrl() {
    const m = location.pathname.match(/\/seven-tiles\/room\/([a-z-]+)\/?$/i);
    return normWords(new URLSearchParams(location.search).get('room') || (m && m[1]));
  }
  const unpackPlay = (str) => { try { return str ? C.unpack(G.words, str) : null; } catch (e) { return null; } };
  const roomPlayer = (p) => (G.row ? G.row.players.find((x) => x.player === p) : null) || null;
  const joinedAt = () => (roomPlayer(G.me) || {}).joined || 1;
  const online = () => !G.offline && !!G.row;
  // a failed call in words: one that never reached the server means no signal
  const whyFailed = (e) => (navigator.onLine === false || /fetch|network|load failed|no answer/i.test(e.message) ? 'no signal'
    : /room is full/.test(e.message) ? 'the room is full (12 players)' : e.message);
  // What decides a room's game besides its seed: the rules and both word lists.
  // A room keeps the one it was started with, and a page that differs (an old
  // copy from before an update, say) must not play it, or its boards would not
  // match everyone else's.
  const rulesKey = () => C.GROUP_VERSION + ':' + dict.size + ':' + common.size;

  // ---- the game, worked out from the seed
  function upTo(n) {
    const S = G.states;
    while (S.length <= n && !S[S.length - 1].over) S.push(C.resolveRound(S[S.length - 1], [], dict, common));
  }
  // the game before round k, or null when it ends before then
  function stateAt(k) { upTo(k - 1); const s = G.states[k - 1]; return s && !s.over ? s : null; }
  // round k as it went: its rack, best play, top play and board play
  function roundOf(k) { upTo(k); const s = G.states[k]; return s ? s.rounds[k - 1] : null; }
  const roundsLabel = (k) => 'Round ' + k + (G.row && G.row.limit ? ' of ' + G.row.limit : '');

  // ---- plays: this player's own, and the others' as the server shows them
  const mineAt = (k) => (G.me === null ? null : G.mine[k] || null);
  const entryOf = (k, p) => (p === G.me ? mineAt(k) : G.others.get(k + ':' + p) || null);
  function myRound() { if (G.me === null) return Infinity; let k = joinedAt(); while (mineAt(k) && mineAt(k).done) k++; return k; }
  // an entry's score on its round's board, worked out once
  function scored(e, k) {
    if (!e || !e.play) return null;
    if (e.resFor !== e.play) {
      const st = stateAt(k), move = unpackPlay(e.play);
      e.res = st ? C.checkPlay(st.board, st.rack, move, dict) : { ok: false, reason: 'There is no such round.' };
      e.resFor = e.play;
    }
    return e.res;
  }
  // the round the room plays next with everyone: the open one, or the one after the reveal
  const liveRound = () => (G.row.closed < G.row.round ? G.row.round : G.row.round + 1);

  // ---- choosing and opening a room
  function showSameSetup(note) {
    const name = store.get('sm.name', '') || (user && user.name) || '';
    openOverlay('<h2>Same Rack</h2>' +
      (note ? '<p class="sm-card-note">' + esc(note) + '</p>' : '') +
      '<div class="sm-k" style="text-align:left">Your name</div><input type="text" id="sm-live-name" maxlength="24" value="' + esc(name) + '">' +
      '<div class="sm-row" style="justify-content:center;margin-top:12px"><button class="primary" id="sm-live-new">Start a room</button></div>' +
      '<div class="sm-k" style="text-align:left;margin-top:16px">Or join a room</div>' +
      '<div class="sm-row" style="margin-top:0;flex-wrap:nowrap"><input type="text" id="sm-live-words" maxlength="40" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="Its three words"><button id="sm-live-join" style="flex:none">Join</button></div>' +
      '<div class="sm-note" id="sm-live-err" style="color:var(--bad)"></div>' +
      '<div class="sm-row" style="justify-content:center;margin-top:12px"><button id="sm-live-back">Back</button></div>');
    const err = (t) => { $('sm-live-err').textContent = t; };
    const named = () => {
      const n = $('sm-live-name').value.trim();
      if (!n) { err('Type your name first.'); $('sm-live-name').focus(); return null; }
      store.set('sm.name', n);
      return n;
    };
    const join = () => {
      if (!named()) return;
      const words = normWords($('sm-live-words').value);
      if (!words) { err('Type the room’s three words, like ' + newId() + '.'); return; }
      closeOverlay(); openRoom(words);
    };
    $('sm-live-new').addEventListener('click', () => { const n = named(); if (n) { closeOverlay(); createRoom(n); } });
    $('sm-live-join').addEventListener('click', join);
    $('sm-live-name').addEventListener('keydown', (e) => e.stopPropagation());
    $('sm-live-words').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') join(); });
    $('sm-live-back').addEventListener('click', showMenu);
  }
  async function createRoom(name) {
    const my = ++navGen, token = randomToken();
    setStatus('Opening a room…');
    await dictReady; await commonReady;
    if (my !== navGen) return;
    if (!dict || !common) { setStatus(''); showSameSetup('The word lists did not load. Reload to try again.'); return; }
    if (!Net.enabled) { setStatus(''); showSameSetup('Rooms are not set up on this site.'); return; }
    for (let attempt = 0; attempt < 5; attempt++) {
      const words = newId();
      try {
        await Net.rpc('create_room', { p_code: words, p_seed: C.pack(words, { s: randomSeed(), v: rulesKey() }), p_name: name, p_token: token });
        if (my !== navGen) return;
        games.put({ id: roomId(words), kind: 'room', words, token, player: 0, over: false, round: 0 });
        setStatus('');
        openRoom(words);
        return;
      } catch (e) {
        if (my !== navGen) return;
        if (/taken/.test(e.message)) continue;
        setStatus('');
        showSameSetup('Could not open a room: ' + whyFailed(e) + '.');
        return;
      }
    }
    setStatus('');
    showSameSetup('Could not find free words for a room. Try again.');
  }
  // Opens a room, taking a seat when there is one: the seat this browser
  // holds, the account's, or the next free one. A full or finished room is
  // watched instead. Without signal, a room this browser has played opens
  // from its saved copy.
  async function openRoom(words) {
    const my = ++navGen;
    await dictReady; await commonReady;
    if (my !== navGen) return;
    if (!dict || !common) { failToMenu('The word lists did not load. Reload to try again.'); return; }
    const id = roomId(words), rec = games.get(id);
    let token = (rec && rec.token) || null, row = null, t0 = Date.now(), offline = false;
    try {
      if (!Net.enabled) throw new Error('rooms are not set up on this site');
      row = await Net.rpc('get_room', { p_code: words, p_token: token });
      if (my !== navGen) return;
      if (!row) { failToMenu('There is no room called ' + words + '.'); return; }
      if (row.me === null && row.phase !== 'over' && row.players.length < 12) {
        let name = store.get('sm.name', '') || (user && user.name) || '';
        if (!name) {
          name = await askText('Join the room', 'Your name, shown to the other players.', 'Your name', '');
          if (my !== navGen) return;
          if (!name) { showMenu(); return; }
          store.set('sm.name', name);
        }
        const seat = await Net.rpc('join_room', { p_code: words, p_name: name, p_token: token || randomToken() });
        if (my !== navGen) return;
        token = seat.token;
        games.put({ id, kind: 'room', words, token, player: seat.player, over: false, round: row.round });
        t0 = Date.now();
        row = await Net.rpc('get_room', { p_code: words, p_token: token });
        if (my !== navGen) return;
      }
    } catch (e) {
      if (my !== navGen) return;
      if (!(rec && rec.row)) { failToMenu('Could not open room ' + words + ': ' + whyFailed(e) + '.'); return; }
      row = rec.row; offline = true;   // no signal: the copy saved here
    }
    let seed;
    try { seed = C.unpack(words, row.seed); } catch (e) { failToMenu('The record of room ' + words + ' is damaged.'); return; }
    if (!seed || !Number.isInteger(seed.s)) { failToMenu('The record of room ' + words + ' is damaged.'); return; }
    if (seed.v !== rulesKey()) { failToMenu('Room ' + words + ' was started on a different version of Seven Tiles. Reload the page to update it.'); return; }
    seed = seed.s;
    leaveGame();
    const saved = rec && rec.token === token ? rec : null;
    G = { id, kind: 'room', words, token: row.me === null ? null : token, me: row.me, names: [], seed, states: null, row: null, offline: false, offset: 0, rtt: Infinity,
          mine: (saved && saved.mine) || {}, others: new Map(), phase: null, cur: null, seconds: row.seconds, cardShown: 0, readyFor: 0,
          bots: ((saved && saved.bots) || []).map((b) => Object.assign({}, b, { seen: 0 })), botDue: {},
          state: null, hidden: true, session: ++sessions };
    seenMoves = 0;
    setUrl(id);
    setStatus(row.me === null ? (row.phase === 'over' ? 'This game is over.' : 'This room is full (12 players). You’re watching.') : '');
    integrateRoom(row, t0, Date.now(), offline);
    // a round that was under way carries on with the time it had left, when the room is not playing it with everyone
    const c = saved && saved.cur;
    if (c && c.k === myRound() && G.phase === 'ready') { beginRound(c.k, false, c.ends); settle(); }
    startRoomClock();
    if (!offline) flush();
  }

  // Folds an answer from the server (or, offline, the saved one) into the page.
  function integrateRoom(row, t0, t1, offline) {
    if (!row || !G || G.kind !== 'room') return;
    if (!offline) {
      if (G.row && !G.offline && row.now < G.row.now) return;   // an older answer that arrived late
      if (t1 - t0 <= G.rtt) { G.rtt = t1 - t0; G.offset = row.now - (t0 + t1) / 2; }   // the quickest answer gives the truest clock
    }
    G.offline = !!offline;
    G.row = row; G.seconds = row.seconds;
    G.names = [];
    for (const x of row.players) G.names[x.player] = x.name;
    if (!G.states || (G.states.length === 1 && G.states[0].opts.limit !== row.limit)) {
      try { G.states = [C.newGroup(G.seed, { limit: row.limit, board: 'engine' }, dict, common)]; }
      catch (e) { stopRoomPoll(); setStatus('This room’s game could not be dealt: ' + e.message, 'bad'); return; }
    }
    const others = new Map();
    for (const x of row.plays) {
      if (x.player === G.me) {
        const m = G.mine[x.round];
        if (!m || m.sent) G.mine[x.round] = { play: x.play, done: x.done, sent: true };   // what the server has, unless this phone has newer
      } else {
        const old = G.others.get(x.round + ':' + x.player);
        others.set(x.round + ':' + x.player, old && old.play === x.play && old.done === x.done ? old : { play: x.play, done: x.done });
      }
    }
    G.others = others;
    if (G.cur && G.cur.live && G.cur.k === row.round) G.cur.ends = row.round_ends ? row.round_ends - G.offset : null;
    settle();
    if (!offline) { reportEnd(); driveBots(); }
    persistRoom();
    scheduleRoomPoll();
  }
  // The engine knows the game is over before the server does when the bag
  // can no longer make a rack: the first page to see it says so.
  function reportEnd() {
    if (G.me === null || G.row.phase !== 'playing') return;
    const k = myRound();
    if (stateAt(k) || !G.states[G.states.length - 1].over || G.states[G.states.length - 1].endReason !== 'bag') return;
    const last = G.states.length - 1;
    if (G.reported === last + ':' + G.row.round) return;
    G.reported = last + ':' + G.row.round;
    Net.rpc('end_room', { p_code: G.words, p_token: G.token, p_round: last }).catch(() => { G.reported = null; });
  }
  function persistRoom() {
    if (!G || G.kind !== 'room' || G.me === null) return;
    const mine = {};
    for (const k of Object.keys(G.mine)) mine[k] = { play: G.mine[k].play, done: G.mine[k].done, sent: G.mine[k].sent };
    games.put({ id: G.id, kind: 'room', words: G.words, token: G.token, player: G.me, over: G.phase === 'over', round: Math.min(myRound(), 99),
                row: G.row, mine, cur: G.cur ? { k: G.cur.k, ends: G.cur.ends } : null, bots: G.bots.map((b) => ({ p: b.p, token: b.token, d: b.d, upto: b.upto, ready: b.ready })) });
  }

  // Works out where this player is, starts a round the room is playing with
  // everyone, and shows what goes with it.
  function settle() {
    if (!G || G.kind !== 'room') return;
    const was = G.phase, row = G.row, k = myRound();
    let phase;
    if (row.phase === 'lobby') phase = 'lobby';
    else if (G.me === null) phase = row.phase === 'over' ? 'over' : 'watch';
    else if (!stateAt(k) || (row.end_reason === 'bag' && k > row.round)) phase = 'over';
    else if (G.cur && G.cur.k === k) phase = 'play';
    else if (online() && row.phase === 'playing' && row.round === k && row.closed < k) { beginRound(k, true); phase = 'play'; }
    else if (online() && row.phase === 'playing' && row.round === k - 1) phase = row.closed < k - 1 ? 'wait' : 'reveal';
    else phase = 'ready';
    if (G.cur && (phase !== 'play' || G.cur.k !== k)) G.cur = null;
    G.phase = phase;
    // the board: before your round while you play it, after your last one otherwise
    const at = G.me === null ? (row.phase === 'lobby' ? 0 : row.closed) : Math.max(0, Math.min(k - 1, 99));
    upTo(at);
    G.state = G.states[Math.min(at, G.states.length - 1)];
    G.hidden = phase !== 'play';
    if (G.state.history.length !== seenMoves) seenMoves = G.state.history.length;
    render();
    // the room's own cards take over the screen, but never from another card (the menu, a blank's letter)
    const free = !ui.overlay.classList.contains('is-open') || !!$('sm-room-card');
    const last = k - 1;
    if (phase === 'lobby') { if (was !== 'lobby' && free) showLobby(); else updateLobby(); }
    else if (phase === 'over') {
      if (was !== 'over') { G.cardShown = last; if (free) showRoomOver(); }
      else if ($('sm-room-over') && $('sm-room-over').dataset.sig !== overSig()) showRoomOver();   // late rounds fill in
    }
    else if (G.me !== null && last >= joinedAt() && last > G.cardShown && phase !== 'wait' && phase !== 'play') {
      if (free) { G.cardShown = last; showRoundCard(last, true); }
    } else if ($('sm-room-card')) {
      const card = $('sm-room-card');
      if (card.dataset.k && card.dataset.sig !== roundSig(+card.dataset.k)) showRoundCard(+card.dataset.k, card.dataset.live === '1');
      else updateRoundCard();
    }
  }
  function beginRound(k, live, ends) {
    G.cur = { k, live, ends: live ? (G.row.round_ends ? G.row.round_ends - G.offset : null) : ends !== undefined ? ends : (G.seconds ? Date.now() + G.seconds * 1000 : null),
              move: null, score: 0, word: null };
    G.state = stateAt(k);
    resetTurnUi();
    const m = mineAt(k), move = m && m.play ? unpackPlay(m.play) : null, res = move ? C.checkPlay(G.state.board, G.state.rack, move, dict) : null;
    if (res && res.ok) { G.cur.move = move; G.cur.score = res.score; G.cur.word = res.main; pending = draftFrom(move); }   // a play sent before, back on the board
    closeRoomCard();
    setStatus('');
  }
  // a saved play laid back out on the board, matched to rack slots
  function draftFrom(move) {
    const rack = G.state.rack, used = new Set(), out = [];
    for (const t of move.tiles || []) {
      const ri = rack.findIndex((x, i) => x === (t.b ? '?' : t.l) && !used.has(i));
      if (ri < 0) return [];
      used.add(ri); out.push({ r: t.r, c: t.c, l: t.l, b: !!t.b, ri });
    }
    return out;
  }

  // ---- playing a round
  function roomPrimary() {
    if (G.phase === 'play') finishRound(false);
    else if (G.phase === 'ready') startOwnRound();
    else if (G.phase === 'reveal') roomReady();
    else if (G.phase === 'lobby') showLobby();
    else if (G.phase === 'over') showRoomOver();
  }
  function startOwnRound() {
    if (G.phase !== 'ready') return;
    beginRound(myRound(), false);
    G.phase = 'play';
    persistRoom();
    settle();
  }
  // The best legal play laid out this round is saved as you go, and sent (not
  // done) so that it stands if the round ends first.
  function keepBest(preview) {
    if (G.phase !== 'play' || !G.cur || G.me === null || !preview || !preview.ok || (G.cur.move && preview.score <= G.cur.score)) return;
    const move = draftMove(), res = C.checkPlay(G.state.board, G.state.rack, move, dict);
    if (!res.ok) return;
    G.cur.move = move; G.cur.score = res.score; G.cur.word = res.main;
    G.mine[G.cur.k] = { play: C.pack(G.words, move), done: false, sent: false };
    persistRoom();
    flush();
  }
  // Finish round, or time up: the better of the saved play and a legal one on the board stands.
  function finishRound(timeUp) {
    if (G.phase !== 'play' || !G.cur || G.me === null) return;
    if (drag) endDrag(drag);
    const k = G.cur.k, draft = pending.length ? draftMove() : null, res = draft ? C.checkPlay(G.state.board, G.state.rack, draft, dict) : null;
    const better = res && res.ok && (!G.cur.move || res.score > G.cur.score);
    const move = better ? draft : G.cur.move;
    if (!timeUp && !move && !window.confirm('End this round without a play?')) return;
    G.mine[k] = { play: move ? C.pack(G.words, move) : null, done: true, sent: false };
    G.cur = null;
    resetTurnUi();
    setStatus('');
    persistRoom();
    settle();
    flush();
  }
  // Behind the room: the rounds in between score nothing, and you join the room's round.
  function skipAhead() {
    const from = myRound(), to = liveRound();
    if (!window.confirm(to - from > 1 ? 'Skip rounds ' + from + ' to ' + (to - 1) + '? They score nothing for you.' : 'Skip round ' + from + '? It scores nothing for you.')) return;
    for (let k = from; k < to; k++) G.mine[k] = { play: null, done: true, sent: false };
    G.cardShown = to - 1;
    persistRoom();
    settle();
    flush();
  }
  async function roomReady() {
    if (G.phase !== 'reveal' || G.me === null) return;
    const want = G.row.round + 1, s = G.session, t0 = Date.now();
    if (G.readyFor >= want) return;
    G.readyFor = want;
    updateRoundCard(); render();
    try {
      const row = await ask('room_ready', { p_code: G.words, p_token: G.token, p_round: want });
      if (alive(s)) integrateRoom(row, t0, Date.now());
    } catch (e) {
      if (!alive(s)) return;
      G.readyFor = 0;
      wentOffline(e);
    }
  }

  // ---- talking to the server
  // Sends this player's unsent plays, oldest round first. A play the server
  // will never take (a round it has already finished, say) is let go.
  const ask = (fn, args, anon) => Promise.race([anon ? Net.anon(fn, args) : Net.rpc(fn, args), new Promise((_, no) => setTimeout(() => no(new Error('no answer')), 12000))]);
  let flushing = false;
  async function flush() {
    if (flushing || !G || G.kind !== 'room' || G.me === null) return;
    flushing = true;
    const s = G.session;
    try {
      for (;;) {
        const k = Object.keys(G.mine).map(Number).sort((a, b) => a - b).find((x) => !G.mine[x].sent);
        if (k === undefined) return;
        const m = G.mine[k], t0 = Date.now();
        let row;
        try { row = await ask('submit_play', { p_code: G.words, p_token: G.token, p_round: k, p_play: m.play, p_done: m.done }); }
        catch (e) {
          if (!alive(s)) return;
          if (/done with that round|no round|joined at round|not started|bad play/.test(e.message)) { if (G.mine[k] === m) m.sent = true; persistRoom(); continue; }
          wentOffline(e);
          return;
        }
        if (!alive(s)) return;
        if (G.mine[k] === m) m.sent = true;   // unless it was changed meanwhile, and that goes next
        integrateRoom(row, t0, Date.now());
      }
    } finally { flushing = false; }
  }
  function wentOffline() {
    if (!G || G.kind !== 'room') return;
    const was = G.offline;
    G.offline = true;
    if (!was) settle();
    scheduleRoomPoll();
  }
  // Polling: every two or three seconds with signal, and right after the moment
  // the clock says something changes; every few seconds without. A page in the
  // background stops asking, so after twenty seconds the others stop waiting for it.
  function stopRoomPoll() { clearTimeout(roomTimer); roomTimer = null; }
  function scheduleRoomPoll() {
    stopRoomPoll();
    if (!G || G.kind !== 'room' || document.visibilityState === 'hidden') return;
    const row = G.row, now = Date.now();
    let wait;
    if (G.offline) wait = 6000;
    else if (G.phase === 'over') { if (row.phase === 'over' && !row.players.some((x) => behind(x))) return; wait = 6000; }
    else if (G.phase === 'play' && G.cur.live) wait = G.cur.ends ? Math.min(3000, Math.max(250, G.cur.ends + 3300 - now)) : 3000;
    else if (G.phase === 'reveal') wait = row.next_starts ? Math.min(2000, Math.max(250, row.next_starts - G.offset + 250 - now)) : 2000;
    else if (G.phase === 'play' || G.phase === 'ready') wait = 5000;
    else wait = 2000;
    const s = G.session;
    roomTimer = setTimeout(() => { if (alive(s)) pollRoom(); }, wait);
  }
  // still playing rounds the room has finished
  const behind = (x) => x.player !== G.me && x.joined + x.finished <= G.row.closed;
  // How a player is playing right now: 'live' with the room, 'behind' (catching
  // up on their own clock) or 'off' (not heard from lately), shown as a dot.
  function liveness(p) {
    const row = G.row;
    if (p === G.me) return G.offline ? 'off' : (G.phase === 'ready' && row.phase !== 'lobby') || (G.phase === 'play' && G.cur && !G.cur.live) ? 'behind' : 'live';
    const x = roomPlayer(p) || {};
    return !x.here ? 'off' : row.phase !== 'lobby' && behind(x) ? 'behind' : 'live';
  }
  const DOT_WORDS = { live: 'playing with the room', behind: 'catching up', off: 'offline' };
  const dotHtml = (live) => '<i class="sm-dot ' + live + '" title="' + DOT_WORDS[live] + '"></i>';
  let roomAsking = false;
  async function pollRoom() {
    if (!G || G.kind !== 'room' || roomAsking) return;
    const s = G.session;
    roomAsking = true;
    const back = G.offline;
    try {
      if (Object.values(G.mine).some((m) => !m.sent)) { await flush(); if (!alive(s) || G.offline) return; }
      const t0 = Date.now();
      let row;
      try { row = await ask('get_room', { p_code: G.words, p_token: G.token }); }
      catch (e) { if (alive(s)) wentOffline(e); return; }
      if (!alive(s)) return;
      if (!row) { stopRoomPoll(); setStatus('This room no longer exists.', 'bad'); return; }
      integrateRoom(row, t0, Date.now());
      if (back && !stickyError) setStatus('Back online. Your rounds are in.', 'good');
    } finally { roomAsking = false; scheduleRoomPoll(); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && G.kind === 'room') pollRoom(); });
  window.addEventListener('online', () => { if (G && G.kind === 'room') pollRoom(); });

  // ---- bots
  // The host can seat bots in the lobby, to fill out a small game or to try a
  // room out. The host's page plays for them: each round a bot works out its
  // play at its level on the dial (core.js) and sends it as itself, by its own
  // token and never with the host's account. A bot is here while the host's
  // page is, and it never holds the room up for long: it plays a few seconds
  // into a round (at once when everyone else is done) and is ready for the next
  // round straight away. Rounds it missed while the host had no signal or
  // left the room go in once the host is back.
  // G.bots: [{ p, token, d, upto, ready, seen }]: its seat, token and level, the
  //   last round it has played, the round it said it was ready for, and when it last called.
  const BOT_LEVELS = [20, 40, 60, 80, 100];
  const isBot = (p) => G.bots.some((b) => b.p === p);
  async function addBot(d) {
    const s = G.session, token = randomToken();
    const seat = await ask('join_room', { p_code: G.words, p_name: 'Bot ' + (G.bots.length + 1) + ' (' + levelWords(d) + ')', p_token: token }, true);
    if (!alive(s)) return;
    G.bots.push({ p: seat.player, token, d, upto: 0, ready: 0, seen: Date.now() });
    persistRoom();
    pollRoom();
  }
  // a bot's play in round k, the same however often it is worked out
  function botPlay(b, k) {
    const st = stateAt(k);
    if (!st) return null;
    const view = { board: st.board, racks: [st.rack, []], turn: 0, bag: st.bag, finalTurns: null, over: false };
    const rnd = C.seededRandom((G.seed ^ (b.p * 7919 + k * 104729)) >>> 0);
    const m = C.botMoveAt(view, b.d, rnd, dict, { vocab: common, noEndgame: true, scoreOnly: true });
    return m.t === 'play' ? C.pack(G.words, { t: 'play', tiles: m.tiles }) : null;
  }
  // when a bot plays the open round: a few seconds in, or now if everyone else here is done
  function botDue(b, k, row) {
    const key = b.p + ':' + k;
    if (!G.botDue[key]) G.botDue[key] = Date.now() + (4 + Math.random() * (G.seconds ? Math.min(30, G.seconds * 0.4) : 20)) * 1000;
    const people = row.players.filter((x) => !isBot(x.player) && x.here && x.joined <= row.round && !behind(x));
    return people.length && people.every((x) => x.done) ? 0 : G.botDue[key];
  }
  // One pass over the bots, after each answer from the server: each plays the
  // rounds it owes, says it is ready, or just checks in so it counts as here.
  let botsBusy = false;
  async function driveBots() {
    if (botsBusy || !G || G.kind !== 'room' || !G.bots.length || G.offline || !G.row) return;
    botsBusy = true;
    const s = G.session;
    let moved = false;
    try {
      for (const b of G.bots) {
        let row = G.row;
        for (let step = 0; step < 30; step++) {
          if (!alive(s) || G.offline) return;
          const x = row.players.find((y) => y.player === b.p);
          if (!x || (row.phase === 'over' && b.upto >= row.round)) break;
          const k = Math.max(b.upto + 1, x.joined), open = row.phase === 'playing' && row.closed < row.round;
          let fn, args, after = null;
          if (row.phase !== 'lobby' && (k <= row.closed || (open && k === row.round && Date.now() >= botDue(b, k, row))) && stateAt(k)) {
            fn = 'submit_play'; args = { p_code: G.words, p_token: b.token, p_round: k, p_play: botPlay(b, k), p_done: true }; after = () => { b.upto = k; };
          } else if (row.phase === 'playing' && row.next_starts && b.upto >= row.round && b.ready <= row.round) {
            const want = row.round + 1;
            fn = 'room_ready'; args = { p_code: G.words, p_token: b.token, p_round: want }; after = () => { b.ready = want; };
          } else if (Date.now() - b.seen > 8000) {
            fn = 'get_room'; args = { p_code: G.words, p_token: b.token };
          } else break;
          try {
            const answer = await ask(fn, args, true);
            if (answer && answer.players) row = answer;   // the room as the bot sees it: the same clock and players
          } catch (e) {
            if (fn !== 'submit_play' || !/done with that round|no round/.test(e.message)) return;   // no signal: next time
          }
          b.seen = Date.now();
          if (after) { after(); moved = true; }
          if (fn === 'get_room') break;
        }
      }
    } finally {
      botsBusy = false;
      if (moved && alive(s)) { persistRoom(); pollRoom(); }
    }
  }

  // The clock: the round's countdown, the reveal's, and the end of a round on this page.
  function stopRoomClock() { if (roomClock) clearInterval(roomClock); roomClock = null; }
  function startRoomClock() {
    stopRoomClock();
    const s = G.session;
    roomClock = setInterval(() => {
      if (!alive(s)) { stopRoomClock(); return; }
      if (G.phase === 'play' && G.cur && G.cur.ends) { if (Date.now() >= G.cur.ends) finishRound(true); else paintClock(); }
      else if (G.phase === 'reveal') paintNext();
    }, 250);
  }
  function paintClock() {
    if (!G || !G.cur || !G.cur.ends) return;
    const left = Math.max(0, G.cur.ends - Date.now()), secs = Math.ceil(left / 1000), low = secs <= 10;
    const clock = $('sm-clock'), fill = $('sm-timefill');
    if (clock) { clock.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); clock.classList.toggle('low', low); }
    if (fill) { fill.style.width = (100 * left / (G.seconds * 1000)).toFixed(1) + '%'; fill.parentElement.classList.toggle('low', low); }
  }
  const nextIn = () => Math.max(0, Math.ceil((G.row.next_starts - G.offset - Date.now()) / 1000));
  function paintNext() {
    if (!G.row || !G.row.next_starts) return;
    const n = nextIn(), el = $('sm-next-in'), btn = $('sm-room-ready');
    if (el) el.textContent = n;
    if (btn && !btn.disabled) btn.textContent = 'Next round (' + n + ')';
  }

  // ---- standings and results
  // Each player's numbers over the rounds they have finished that this page
  // can see, measured against each round's best play.
  function roomStandings() {
    const rows = G.row.players.map((x) => ({ p: x.player, total: 0, possible: 0, share: 0, plays: 0, rounds: 0, tops: 0, bingos: 0, best_word: null, best_score: 0, rank: 0 }));
    for (const row of rows) {
      const keys = row.p === G.me ? Object.keys(G.mine).map(Number) : [...G.others.keys()].filter((key) => +key.split(':')[1] === row.p).map((key) => +key.split(':')[0]);
      for (const k of keys) {
        const e = entryOf(k, row.p), r = roundOf(k);
        if (!e || !e.done || !r) continue;
        row.rounds++; row.possible += r.best.score;
        const res = scored(e, k);
        if (!res || !res.ok) continue;
        row.total += res.score; row.plays++;
        if (res.score >= r.best.score) row.tops++;
        if (res.bingo) row.bingos++;
        if (res.score > row.best_score) { row.best_score = res.score; row.best_word = res.main; }
      }
      row.share = row.possible ? Math.round(100 * row.total / row.possible) : 0;
    }
    rows.sort((a, b) => b.total - a.total || a.p - b.p);
    for (const row of rows) row.rank = 1 + rows.filter((x) => x.total > row.total).length;
    return rows;
  }
  function roomWinner(rows) {
    if (!rows.length) return '';
    if (rows.length === 1) return (rows[0].p === G.me ? 'You scored ' : nameOf(rows[0].p) + ' scored ') + rows[0].total + '.';
    const top = rows.filter((x) => x.rank === 1);
    if (top.length > 1) return top.map((x) => nameOf(x.p)).join(' and ') + ' tie on ' + top[0].total + '.';
    return (top[0].p === G.me ? 'You win' : nameOf(top[0].p) + ' wins') + ' with ' + top[0].total + '.';
  }
  // One line on a round: the play that goes on the board, and this player's.
  function roomResult(k) {
    const r = roundOf(k);
    if (!r) return '';
    const best = '<b>' + esc(r.best.word) + '</b> for ' + r.best.score;
    const e = mineAt(k), res = scored(e, k);
    if (G.me === null) return best + ' goes on the board.';
    if (!e || !e.play) return 'You had no play. ' + best + ' goes on the board.';
    if (!res.ok) return 'Your play did not count (' + esc(res.reason.replace(/\.$/, '')) + '). ' + best + ' goes on the board.';
    const yours = 'You played ' + esc(res.main) + ' for ' + res.score;
    if (res.score > r.best.score) return yours + ', more than the best everyday play. ' + best + ' goes on the board.';
    if (res.score === r.best.score) return draftKey(unpackPlay(e.play).tiles) === draftKey(r.best.tiles) ? 'You found the best play, ' + best + ', and it goes on the board.' : yours + ', as much as the best play. ' + best + ' goes on the board.';
    return yours + '. ' + best + ' goes on the board.';
  }
  // A square per round of yours: how close your play came to the best.
  const SQUARES = { best: ['🟩', 'the best play or better'], close: ['🟨', 'three quarters or more'], half: ['🟧', 'half or more'], low: ['🟥', 'less'], none: ['⬛', 'no play'] };
  function squareKinds() {
    const out = [];
    for (let k = joinedAt(); k < myRound(); k++) {
      const r = roundOf(k), res = scored(mineAt(k), k);
      if (!r) break;
      if (!res || !res.ok) { out.push('none'); continue; }
      const f = r.best.score ? res.score / r.best.score : 1;
      out.push(f >= 1 ? 'best' : f >= 0.75 ? 'close' : f >= 0.5 ? 'half' : 'low');
    }
    return out;
  }
  const squaresHtml = () => '<div class="sm-squares">' + squareKinds().map((k, i) => '<i class="q-' + k + '" title="Round ' + (joinedAt() + i) + ': ' + SQUARES[k][1] + '"></i>').join('') + '</div>' +
    '<div class="sm-sqlegend">' + Object.keys(SQUARES).map((k) => '<span><i class="q-' + k + '"></i>' + SQUARES[k][1] + '</span>').join('') + '</div>';

  // ---- the room's screens
  function renderRoom() {
    const row = G.row, rows = roomStandings(), k = myRound();
    const mine = rows.find((x) => x.p === G.me), others = rows.filter((x) => x.p !== G.me);
    const boxes = mine ? [['You', mine.total], others.length ? [nameOf(others[0].p), others[0].total] : ['Best possible', mine.possible]]
      : [rows[0] ? [nameOf(rows[0].p), rows[0].total] : ['Nobody yet', 0], rows[1] ? [nameOf(rows[1].p), rows[1].total] : ['', '']];
    boxes.forEach(([name, score], p) => {
      const el = ui.players[p], nm = el.querySelector('.sm-name');
      nm.textContent = name; nm.classList.remove('link'); el.dataset.handle = '';
      el.querySelector('.sm-score').textContent = score;
      el.classList.remove('turn');
    });
    ui.bag.textContent = G.state.bag.length;
    const here = row.players.filter((x) => x.here && x.joined <= row.round && !behind(x));
    const doneHere = here.filter((x) => x.done).length;
    const signal = G.offline ? ' · <i>no signal</i>' : '';
    if (G.phase === 'lobby') ui.msg.innerHTML = '<b>Waiting to start.</b>' + signal;
    else if (G.phase === 'watch') ui.msg.innerHTML = '<i>Watching.</i> <b>' + roundsLabel(row.round) + '.</b> ' + (row.closed ? roomResult(row.closed) : '');
    else if (G.phase === 'play') ui.msg.innerHTML = '<b>' + roundsLabel(k) + '</b> · ' + (G.cur.ends ? '<span class="sm-clock" id="sm-clock"></span>' : 'no clock') +
      (G.cur.live ? ' · ' + doneHere + ' of ' + here.length + ' done' : ' · on your own clock') + signal + (G.cur.ends ? '<div class="sm-timebar"><i id="sm-timefill"></i></div>' : '');
    else if (G.phase === 'wait') ui.msg.innerHTML = '<b>Round ' + (k - 1) + '.</b> You are done. Waiting for ' + plural(here.length - doneHere, 'player') + '…';
    else if (G.phase === 'reveal') ui.msg.innerHTML = '<b>Round ' + (k - 1) + '.</b> ' + roomResult(k - 1) + ' Next round in <span id="sm-next-in">' + nextIn() + '</span>.';
    else if (G.phase === 'ready') ui.msg.innerHTML = '<b>' + roundsLabel(k) + '.</b> ' + readyWhy(k);
    else ui.msg.innerHTML = '<b>Game over.</b> ' + esc(roomWinner(rows)) + signal;
    paintClock();
    renderBoard();
    renderRack();
    renderRoomLog();
    renderRoomPanel(rows);
    const drafting = canDraft();
    const preview = drafting && pending.length ? previewDraft(G.state) : null;
    keepBest(preview);
    const saved = G.phase === 'play' && G.cur && G.cur.move ? G.cur : null;
    const onBoard = !!(saved && preview && preview.ok && draftKey(saved.move.tiles) === draftKey(pending));
    const savedNote = saved ? 'Saved: ' + saved.word + ' for ' + plural(saved.score, 'point') + '.' : '';
    ui.board.classList.toggle('valid', !!(preview && preview.ok));
    if (stickyError) { /* an action failed: keep saying so until the draft changes */ }
    else if (onBoard) { setStatus(sentence(preview.text) + ' Saved.', 'good'); statusIsPreview = true; }
    else if (preview) { setStatus(saved ? sentence(preview.text) + ' ' + savedNote : preview.text, preview.kind); statusIsPreview = true; }
    else if (saved) { setStatus(savedNote); statusIsPreview = true; }
    else if (statusIsPreview) setStatus('');
    const ready = G.readyFor > row.round || !!(roomPlayer(G.me) || {}).ready;
    const behindRoom = G.phase === 'ready' && online() && row.phase === 'playing' && k < liveRound();
    ui.play.textContent = G.phase === 'lobby' ? 'Room' : G.phase === 'over' ? 'Results' : G.phase === 'watch' ? 'Watching' : G.phase === 'wait' ? 'Waiting' : G.phase === 'reveal' ? (ready ? 'Ready' : 'Next round')
      : G.phase === 'ready' ? 'Start round ' + k : 'Finish round';
    ui.play.disabled = G.phase === 'watch' || G.phase === 'wait' || (G.phase === 'reveal' && ready);
    ui.pass.textContent = 'Skip to round ' + liveRound();
    ui.pass.style.display = behindRoom ? '' : 'none'; ui.pass.disabled = false;
    ui.recall.disabled = !drafting || !pending.length;
    ui.shuffle.disabled = G.hidden || G.me === null;
  }
  // why a round waits for you to start it
  function readyWhy(k) {
    const row = G.row;
    if (G.offline) return 'No signal.';
    if (row.phase === 'over') return 'The room has finished.';
    return 'The room is on round ' + liveRound() + '.';
  }
  function renderRoomLog() {
    ui.movesTitle.textContent = 'Rounds';
    ui.nav.hidden = true; ui.analysis.hidden = true;
    let html = '';
    const end = G.me === null ? G.row.closed + 1 : myRound();
    for (let k = G.me === null ? 1 : joinedAt(); k < end; k++) {
      const r = roundOf(k);
      if (!r) break;
      const res = scored(mineAt(k), k), found = res && res.ok && res.score >= r.best.score;
      const plays = topPlays(k).map((x) => (x.p === G.me ? 'you' : esc(nameOf(x.p))) + ' ' + (!x.res ? 'no play' : !x.res.ok ? 'did not count' : esc(x.res.main) + ' ' + x.res.score)).join(' · ');
      html += '<li data-k="' + k + '"><span><span class="n">' + k + '.</span>' + esc(r.best.word) + (plays ? '<small class="plays">' + plays + '</small>' : '') + '</span><b>' + r.best.score + (found ? ' <span style="color:var(--good)">★</span>' : '') + '</b></li>';
    }
    ui.log.innerHTML = html || '<li><span class="who">No rounds yet.</span></li>';
    ui.log.classList.remove('locked');
    ui.log.querySelectorAll('li[data-k]').forEach((li) => li.addEventListener('click', () => showRoundCard(+li.dataset.k, false)));
  }
  function renderRoomPanel(rows) {
    ui.online.style.display = '';
    const row = G.row, link = location.origin + pathFor(G.id);
    let html = '<div class="sm-k">Same Rack</div><div>Room <span class="sm-code">' + esc(G.words) + '</span></div><div class="sm-room-players">';
    for (const x of rows) {
      const p = roomPlayer(x.p) || {}, live = liveness(x.p);
      let status = '';
      if (x.p === G.me) status = G.offline ? 'no signal' : '';
      else if (live === 'off') status = row.phase === 'over' ? '' : 'offline';
      else if (live === 'behind') status = 'on round ' + (p.joined + p.finished);
      else if (G.phase === 'play' || G.phase === 'wait') status = p.joined > row.round ? 'next round' : p.done ? 'done' : '';
      else if (G.phase === 'reveal') status = p.ready ? 'ready' : '';
      html += '<div' + (x.p === G.me ? ' class="me"' : '') + '>' + dotHtml(live) + '<span>' + x.rank + '. ' + esc(nameOf(x.p)) + (x.p === G.me ? ' <small>you</small>' : '') + '</span>' +
        (status ? '<small class="st-' + status.replace(/ /g, '-') + '">' + status + '</small>' : '') + '<b>' + x.total + '</b></div>';
    }
    html += '</div>' + (row.phase !== 'over' ? '<div class="sm-row"><button id="sm-room-link">Copy invite link</button></div>' : '');
    ui.online.innerHTML = html;
    const b = $('sm-room-link');
    if (b) b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); b.textContent = 'Copied'; } catch (e) { window.prompt('Copy this link:', link); } });
  }
  const closeRoomCard = () => { if ($('sm-room-card')) closeOverlay(); };
  // The lobby: the room's words to read out, the link and its QR code, who is in, and for the host the settings.
  function showLobby() {
    const link = location.origin + pathFor(G.id), host = G.me === 0, last = store.get('sm.same', {});
    const limit = SAME_ROUNDS.includes(last.limit) ? last.limit : 10, seconds = SAME_SECONDS.includes(last.seconds) && last.seconds ? last.seconds : 90;
    const opts = (vals, cur, label) => vals.map((v) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label(v) + '</option>').join('');
    openOverlay('<div id="sm-room-card" hidden></div><h2>Same Rack</h2>' +
      '<div class="sm-room-words">' + esc(G.words.replace(/-/g, ' ')) + '</div>' +
      '<div class="sm-row" style="justify-content:center"><button id="sm-lobby-copy">Copy link</button>' + (navigator.share ? '<button id="sm-lobby-share">Share</button>' : '') + '<button id="sm-lobby-qr">QR code</button></div>' +
      '<div class="sm-qr" id="sm-lobby-qrbox" hidden></div>' +
      '<div class="sm-k" style="text-align:left;margin-top:14px" id="sm-lobby-count"></div><div class="sm-list sm-lobby" id="sm-lobby-players"></div>' +
      (host ? '<div class="sm-same-opts"><label>Rounds<select id="sm-lobby-rounds">' + opts(SAME_ROUNDS, limit, (n) => (n ? n + ' rounds' : 'The whole bag')) + '</select></label>' +
              '<label>Time per round<select id="sm-lobby-time">' + opts(SAME_SECONDS, seconds, (t) => (t ? secondsWords(t) : 'No clock')) + '</select></label></div>' +
              '<div class="sm-same-opts sm-addbot"><label>Bot<select id="sm-lobby-botlevel">' + opts(BOT_LEVELS, BOT_LEVELS.includes(last.bot) ? last.bot : 40, (d) => levelWords(d).replace(/^./, (c) => c.toUpperCase())) + '</select></label>' +
              '<button id="sm-lobby-addbot">Add a bot</button></div>'
            : '<p id="sm-lobby-wait" style="margin-top:10px">Waiting for ' + esc(nameOf(0)) + ' to start the game.</p>') +
      '<div class="sm-note" id="sm-lobby-err" style="color:var(--bad)"></div>' +
      '<div class="sm-row" style="justify-content:center;margin-top:12px"><button id="sm-lobby-leave">Games</button>' + (host ? '<button class="primary" id="sm-lobby-start">Start the game</button>' : '') + '</div>');
    $('sm-lobby-copy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied'; } catch (err) { window.prompt('Copy this link:', link); } });
    const share = $('sm-lobby-share');
    if (share) share.addEventListener('click', () => navigator.share({ text: 'Join my Same Rack room: ' + G.words.replace(/-/g, ' '), url: link }).catch(() => { /* closed without sharing */ }));
    $('sm-lobby-qr').addEventListener('click', () => {
      const box = $('sm-lobby-qrbox');
      if (!box.hidden) { box.hidden = true; return; }
      withQr(() => { if (!$('sm-lobby-qrbox')) return; const qr = window.qrcode(0, 'M'); qr.addData(link); qr.make(); box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); box.hidden = false; },
             () => { const err = $('sm-lobby-err'); if (err) err.textContent = 'Could not load the QR code.'; });
    });
    $('sm-lobby-leave').addEventListener('click', showMenu);
    const addBtn = $('sm-lobby-addbot');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const d = +$('sm-lobby-botlevel').value;
      store.set('sm.same', Object.assign(store.get('sm.same', {}), { bot: d }));
      addBtn.disabled = true; addBtn.textContent = 'Adding…';
      try { await addBot(d); if ($('sm-lobby-err')) $('sm-lobby-err').textContent = ''; }
      catch (e) { if ($('sm-lobby-err')) $('sm-lobby-err').textContent = 'Could not add a bot: ' + whyFailed(e) + '.'; }
      addBtn.disabled = false; addBtn.textContent = 'Add a bot';
    });
    const start = $('sm-lobby-start');
    if (start) start.addEventListener('click', async () => {
      const n = +$('sm-lobby-rounds').value, t = +$('sm-lobby-time').value, s = G.session, t0 = Date.now();
      store.set('sm.same', Object.assign(store.get('sm.same', {}), { limit: n, seconds: t }));
      start.disabled = true; start.textContent = 'Starting…';
      try { const row = await Net.rpc('start_room', { p_code: G.words, p_token: G.token, p_seconds: t, p_limit: n }); if (alive(s)) integrateRoom(row, t0, Date.now()); }
      catch (e) { if (!alive(s) || !$('sm-lobby-err')) return; $('sm-lobby-err').textContent = 'Could not start: ' + whyFailed(e) + '.'; start.disabled = false; start.textContent = 'Start the game'; }
    });
    updateLobby();
  }
  function updateLobby() {
    const list = $('sm-lobby-players');
    if (!list) return;
    list.innerHTML = G.row.players.map((x) => { const live = liveness(x.player); return '<div>' + dotHtml(live) + '<span>' + esc(x.name) + (x.player === G.me ? ' <small>you</small>' : '') + (x.player === 0 ? ' <small>host</small>' : '') + '</span>' + (live === 'off' && x.player !== G.me ? '<small>offline</small>' : '') + '</div>'; }).join('');
    $('sm-lobby-count').textContent = 'Players · ' + G.row.players.length;
    if (G.offline && $('sm-lobby-err')) $('sm-lobby-err').textContent = 'No signal.';
  }
  // Round k's plays this page can see, best first, each with its place: the
  // finished ones, and yours.
  function roundPlays(k) {
    const list = [];
    for (const x of G.row.players) {
      if (x.joined > k) continue;
      const e = entryOf(k, x.player), res = e && e.done ? scored(e, k) : null;
      if (e && e.done) list.push({ p: x.player, res, score: res && res.ok ? res.score : -1 });
    }
    list.sort((a, b) => b.score - a.score || a.p - b.p);
    for (const x of list) x.place = 1 + list.filter((y) => y.score > x.score).length;
    return list;
  }
  // the plays of round k placed third or better (more than three with ties), and yours when it is not among them
  function topPlays(k) {
    const list = roundPlays(k), top = list.filter((x) => x.score >= 0 && x.place <= 3), mine = list.find((x) => x.p === G.me);
    if (mine && !top.includes(mine)) top.push(mine);
    return top;
  }
  // A round's top plays. live: the card shown as you finish a round, with the
  // button for whatever comes next.
  function showRoundCard(k, live) {
    const r = roundOf(k);
    if (!r) return;
    const shown = G.me === null || (online() && G.row.closed >= k);   // the server shows the others once the room has closed the round
    let html = '<div id="sm-room-card" hidden data-k="' + k + '" data-live="' + (live ? 1 : 0) + '" data-sig="' + roundSig(k) + '"></div><h2>Round ' + k + '</h2><p>' + roomResult(k) + '</p>';
    let rows = '';
    for (const x of topPlays(k)) {
      rows += '<div' + (x.p === G.me ? ' class="me"' : '') + '><span>' + (x.score >= 0 ? x.place : '') + '</span><span>' + esc(nameOf(x.p)) + (x.p === G.me ? ' <small>you</small>' : '') + '</span>' +
        '<span class="w">' + (!x.res ? '<small>no play</small>' : x.res.ok ? esc(x.res.main) + (x.res.bingo ? ' <small>bingo</small>' : '') : '<small>' + esc(x.res.reason.replace(/\.$/, '')) + '</small>') + '</span>' +
        '<b>' + Math.max(0, x.score) + (x.score >= r.best.score ? ' <span style="color:var(--good)">★</span>' : '') + '</b></div>';
    }
    if (rows) html += '<div class="sm-list sm-roundplays">' + rows + '</div>';
    const late = shown ? G.row.players.filter((x) => x.joined <= k && x.player !== G.me && !(entryOf(k, x.player) || {}).done) : [];
    if (late.length) html += '<p class="sm-note">' + esc(late.map((x) => nameOf(x.player)).join(' and ')) + (late.length > 1 ? ' are' : ' is') + ' still playing.</p>';
    if (!shown) html += '<p class="sm-note">' + (G.offline ? 'The others’ plays show when you have signal.' : 'The others’ plays show when the round ends.') + '</p>';
    if (r.top.score > r.best.score) html += '<p class="sm-note">The top play was <b>' + esc(r.top.word) + '</b> for ' + r.top.score + '.</p>';
    html += '<div class="sm-row" style="justify-content:center"><button id="sm-round-close">' + (live ? 'Look at the board' : 'Close') + '</button>' +
      (live && G.me !== null ? '<button class="primary" id="sm-room-ready" hidden></button>' : '') + '</div>';
    openOverlay(html);
    $('sm-round-close').addEventListener('click', closeOverlay);
    const next = $('sm-room-ready');
    if (next) next.addEventListener('click', () => { if (G.phase === 'reveal') roomReady(); else { closeOverlay(); roomPrimary(); } });
    updateRoundCard();
  }
  // what a round's card shows depends on: whether the others' plays can be seen, and which have come in
  const roundSig = (k) => (G.me === null || (online() && G.row.closed >= k) ? 's' : 'h') + G.row.players.map((x) => (entryOf(k, x.player) || {}).done ? 1 : 0).join('');
  // the card's button follows the phase: the next round with everyone, or on your own clock
  function updateRoundCard() {
    const btn = $('sm-room-ready');
    if (!btn) return;
    const mine = roomPlayer(G.me), ready = G.readyFor > G.row.round || !!(mine && mine.ready);
    btn.hidden = !(G.phase === 'reveal' || G.phase === 'ready' || G.phase === 'over');
    if (G.phase === 'reveal') {
      const waiting = G.row.players.filter((x) => x.here && x.joined <= G.row.round + 1 && !x.ready && !behind(x) && x.player !== G.me).length;
      btn.disabled = ready;
      btn.textContent = ready ? (waiting ? 'Waiting for ' + plural(waiting, 'player') : 'Starting…') : 'Next round (' + nextIn() + ')';
    } else { btn.disabled = false; btn.textContent = G.phase === 'over' ? 'See the results' : 'Start round ' + myRound(); }
  }
  // The end: your numbers as three tiles, your rounds as squares, and the standings.
  function endStatsHtml(row) {
    return '<div class="sm-stats sm-endstats"><div><b>' + row.total + '</b><small>points</small></div>' +
      '<div><b>' + row.share + '%</b><small>of the best plays</small></div>' +
      '<div><b>' + row.tops + '<span class="of"> of ' + row.rounds + '</span></b><small>best plays found</small></div></div>' +
      (row.best_word ? '<p class="sm-endnote">Top word <b>' + esc(row.best_word) + '</b> for ' + row.best_score + (row.bingos ? ' · ' + plural(row.bingos, 'bingo') : '') + '</p>' : '');
  }
  function roomShareText(rows) {
    const squares = G.me === null ? '' : squareKinds().map((k) => SQUARES[k][0]).join('') + '\n';
    return 'Same Rack · ' + G.words + ' · ' + plural(Math.max(0, G.states.length - 1), 'round') + '\n' + squares +
      rows.map((x) => x.rank + '. ' + nameOf(x.p) + ' ' + x.total + ' (' + x.share + '%)').join('\n');
  }
  const overSig = () => roomStandings().map((x) => x.p + ':' + x.total + ':' + x.rounds).join(' ');
  function showRoomOver() {
    const rows = roomStandings(), mine = rows.find((x) => x.p === G.me), n = Math.max(0, G.states.length - 1);
    const bag = G.row.end_reason === 'bag' || G.states[G.states.length - 1].endReason === 'bag';
    const late = G.row.players.filter((x) => behind(x) || (G.row.phase !== 'over' && x.player !== G.me && x.joined + x.finished <= n));
    let html = '<div id="sm-room-card" hidden></div><div id="sm-room-over" hidden data-sig="' + overSig() + '"></div><h2>' + esc(roomWinner(rows).replace(/\.$/, '')) + '</h2><p>' + plural(n, 'round') + ' of ' + esc(G.words.replace(/-/g, ' ')) + (bag ? ', until the bag ran out' : '') + '.</p>';
    if (rows.length > 1) {
      html += '<div class="sm-list sm-standings"><div class="head"><span></span><span>Player</span><span>% of best</span><span>Total</span></div>';
      for (const x of rows) html += '<div' + (x.p === G.me ? ' class="me"' : '') + '><span>' + x.rank + '</span><span>' + esc(nameOf(x.p)) + (x.p === G.me ? ' <small>you</small>' : '') + '</span><span>' + x.share + '%</span><b>' + x.total + '</b></div>';
      html += '</div>';
      if (late.length) html += '<p class="sm-note">' + esc(late.map((x) => nameOf(x.player)).join(' and ')) + (late.length > 1 ? ' are' : ' is') + ' still playing.</p>';
      if (mine) html += '<div class="sm-k sm-endyou">Your game</div>';
    }
    if (mine) html += endStatsHtml(mine) + squaresHtml();
    html += '<div class="sm-row sm-endshare"><button id="sm-end-share">' + (navigator.share ? 'Share results' : 'Copy results') + '</button></div>' +
      '<div class="sm-row sm-endnav"><button id="sm-end-board">Look at the board</button><button class="primary" id="sm-end-new">New game</button></div>';
    openOverlay(html);
    const text = roomShareText(rows), share = $('sm-end-share');
    share.addEventListener('click', async () => {
      if (navigator.share) { navigator.share({ text }).catch(() => { /* closed without sharing */ }); return; }
      try { await navigator.clipboard.writeText(text); share.textContent = 'Copied'; } catch (e) { window.prompt('Copy this:', text); }
    });
    $('sm-end-board').addEventListener('click', closeOverlay);
    $('sm-end-new').addEventListener('click', showSameSetup);
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
    },
    // a call without the signed-in user's token, for a seat that goes by its own (a bot's)
    async anon(fn, args) {
      const r = await fetch(CFG.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: CFG.key, authorization: 'Bearer ' + CFG.key, 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && (data.message || data.hint)) || 'request failed');
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
  function openMyProfile() { if (!user) return; if (user.handle) showProfile(user.handle); else { setStatus('Your profile is still loading; trying again.'); loadProfile(); } }
  function signInGoogle() {
    try { if (linkToken && linkGame) sessionStorage.setItem('sm.linkToken', JSON.stringify({ id: linkGame, token: linkToken })); } catch (e) { /* ignore */ }
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
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
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl() } });
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
      const menuOpen = ui.overlay.classList.contains('is-open') && !!$('sm-m-hotseat');   // the card carries the account row: redraw it
      if (event === 'SIGNED_OUT') {
        // a shared device: the seats this browser opened while signed in must not stay playable.
        // Only a sign-out this person asked for does that; a session that merely expired keeps them.
        const asked = Date.now() - (store.get('sm.signout', 0) || 0) < 15000;
        if (asked) {
          for (const rec of games.list()) if (rec.kind === 'online') games.remove(rec.id);
          pushOff().catch(() => {});
          if (G && G.kind === 'online') { leaveGame(); setUrl(null); showMenu(); return; }
        }
        if (menuOpen) showMenu();
        else if (shownProfile && ui.overlay.classList.contains('is-open')) showProfile(shownProfile);
        else if (G) render();
        return;
      }
      if (menuOpen && (user && user.id) !== before) showMenu();
      else if (shownProfile && ui.overlay.classList.contains('is-open') && (user && user.id) !== before) showProfile(shownProfile);
      if (user && user.id !== before) { attachSeats(); pushRegister().catch(() => {}); }
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
    if (seat.player !== null) { persist(); pushRegister([{ code: id, token: seat.token }]).catch(() => {}); }
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
    if (changed) { G.state = s; extendReview(); turnUiAfterMove(); setStatus(''); }
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
      '<div class="sm-row"><button id="sm-refresh">Refresh</button></div>' + pushRowHtml();
    const rm = $('sm-rematch');
    if (rm) rm.addEventListener('click', startRematch);
    ui.online.querySelectorAll('button[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.link); b.textContent = 'Copied'; }
      catch (e) { window.prompt('Copy this link:', b.dataset.link); }
    }));
    $('sm-refresh').addEventListener('click', syncOnline);
    bindPush(ui.online);
  }

  // ---- turn notifications -----------------------------------------------------------
  // Web push: the device subscribes with the site's public key and tells the
  // server which seats it holds (and its account, when signed in); the server
  // notifies it when the other player moves. iPhones allow this only for a
  // game added to the Home Screen, so there the switch explains that step.
  const onIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  const pushPossible = () => Net.enabled && !!CFG.push && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64u = (s) => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  const seatsHeld = () => games.list().filter((r) => r.kind === 'online' && r.online && r.online.token).slice(0, 60).map((r) => ({ code: r.id, token: r.online.token }));
  async function pushReg() { return (await navigator.serviceWorker.getRegistration(BASE)) || navigator.serviceWorker.register(BASE + 'sw.js'); }
  async function pushSub() { if (!pushPossible()) return null; const reg = await navigator.serviceWorker.getRegistration(BASE); return reg ? reg.pushManager.getSubscription() : null; }
  // tell the server about seats this device holds (all of them, or the ones given)
  async function pushRegister(seats) {
    if (!store.get('sm.push', 0)) return;
    const sub = await pushSub();
    if (sub) await Net.rpc('push_subscribe', { p_sub: sub.toJSON(), p_seats: seats || seatsHeld() });
  }
  async function pushOn() {
    const perm = await Notification.requestPermission();   // asked from the button's click, as iPhones require
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this site in this browser’s settings.' : 'Notifications were not allowed.');
    const reg = await pushReg();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CFG.push) }));
    store.set('sm.push', 1);
    await Net.rpc('push_subscribe', { p_sub: sub.toJSON(), p_seats: seatsHeld() });
  }
  async function pushOff() {
    store.del('sm.push');
    const sub = await pushSub().catch(() => null);
    if (!sub) return;
    try { await Net.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); } catch (e) { /* the server forgets it when the push service does */ }
    await sub.unsubscribe().catch(() => {});
  }
  function pushRowHtml() {
    if (!Net.enabled || !CFG.push) return '';
    let inner;
    if (onIPhone && !standalone()) inner = 'Turn notifications: on iPhone, add this game to your Home Screen first (Share, then Add to Home Screen), then turn them on from the app.';
    else if (!pushPossible()) inner = 'Turn notifications: this browser cannot show them.';
    else if (Notification.permission === 'denied') inner = 'Turn notifications are blocked for this site in this browser’s settings.';
    else if (store.get('sm.push', 0)) inner = 'Turn notifications are on for this device. <button class="small" data-push="off">Turn off</button>';
    else inner = '<button class="small" data-push="on">Notify me when it’s my turn</button>';
    return '<div class="sm-note sm-push" style="margin-top:10px">' + inner + '</div>';
  }
  function bindPush(root) {
    root.querySelectorAll('button[data-push]').forEach((b) => b.addEventListener('click', async () => {
      const row = b.closest('.sm-push');
      b.disabled = true;
      let err = null;
      try { if (b.dataset.push === 'on') await pushOn(); else await pushOff(); } catch (e) { err = e; }
      if (!row.isConnected) return;
      const holder = document.createElement('div');
      holder.innerHTML = pushRowHtml();
      const fresh = holder.firstElementChild;
      if (err && fresh) fresh.insertAdjacentHTML('beforeend', '<div style="color:var(--bad)">' + esc(err.message || String(err)) + '</div>');
      if (fresh) { row.replaceWith(fresh); bindPush(fresh); } else row.remove();
    }));
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
  let profileGen = 0, shownProfile = null;   // the profile card on screen, so a sign-in returns to it
  // where a sign-in round trip lands: the profile being looked at, or else this very address
  const returnUrl = () => (shownProfile ? profileUrl(shownProfile) : location.origin + location.pathname + location.search);
  async function showProfile(handle) {
    if (!Net.enabled) { openOverlay('<h2>Profile</h2><p>Profiles need a connection, and this page is offline.</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', () => { closeOverlay(); if (!G) showMenu(); }); return; }
    let pr;
    const back = () => { shownProfile = null; closeOverlay(); if (!G) showMenu(); };
    shownProfile = handle;
    openOverlay('<h2>Profile</h2><p>Loading…</p><button id="sm-pr-close">Cancel</button>');
    const my = ++profileGen;
    $('sm-pr-close').addEventListener('click', () => { profileGen++; back(); });
    try { pr = await Net.rpc('profile', { p_handle: handle }); } catch (e) { if (my !== profileGen) return; openOverlay('<h2>Profile</h2><p>' + esc(e.message) + '</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', back); return; }
    if (my !== profileGen) return;
    if (!pr) { openOverlay('<h2>No such player</h2><p>Nobody has the code ' + esc(handle) + '.</p><button id="sm-pr-close">Close</button>'); $('sm-pr-close').addEventListener('click', back); return; }
    // on one's own profile, games in progress say whose turn it is, and the ones waiting on you come first
    let turns = null;
    if (pr.mine && pr.live && pr.live.length) {
      try { turns = new Map((await Net.rpc('my_games') || []).map((m) => [m.id, serverWhen(m)])); } catch (e) { /* the plain list stands */ }
      if (my !== profileGen) return;
      if (turns) pr.live.sort((a, b) => (turns.get(b.id) === 'your turn') - (turns.get(a.id) === 'your turn'));
    }
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
        (user ? (pr.is_friend ? '<button class="small" id="sm-pr-challenge">Challenge to a game</button><button class="small" id="sm-pr-unfriend">Remove friend</button>' : '<button class="small" id="sm-pr-friend">Add friend</button>') : '')) +
      '</div>' + (user || pr.mine ? '' : '<p class="sm-note" style="margin:6px 0 2px">Sign in to add ' + esc(pr.name) + ' as a friend or challenge them.</p><div style="display:flex;justify-content:center">' + authRowHtml() + '</div>');
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
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Against</div><div class="sm-summary sm-list">';
      for (const r of recs) html += '<div' + (r.handle ? ' data-u="' + esc(r.handle) + '"' : '') + '><span>' + esc(r.name || 'a guest') + '</span> <b>' + r.w + '–' + r.l + (r.t ? '–' + r.t : '') + '</b></div>';
      html += '</div>';
    }
    if (pr.live) {
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Games in progress</div><div class="sm-summary sm-list">';
      if (!pr.live.length) html += '<div class="sm-note">None right now.</div>';
      for (const g of pr.live) {
        const when = turns ? turns.get(g.id) : null;
        html += '<div data-g="' + esc(g.id) + '"' + (when === 'your turn' ? ' class="now"' : '') + '><span>' + esc(g.p1_name) + ' vs ' + esc(g.p2_name) + '</span>' +
          (when === 'your turn' ? '<span class="sm-turn">Your turn</span>' : '<small>' + (when === 'their turn' ? 'their turn · ' : '') + plural(num(g.moves), 'move') + (pr.mine ? '' : ' · watch') + '</small>') + '</div>';
      }
      html += '</div>';
    }
    if (pr.mine) {
      html += '<div class="sm-row" style="margin-top:8px"><label class="sm-note" style="margin:0"><input type="checkbox" id="sm-pr-public"' + (pr.public_games ? ' checked' : '') + '> Let anyone watch my games in progress from this page</label></div>';
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Friends</div><div class="sm-summary sm-list" id="sm-pr-friends">';
      if (!pr.friends.length) html += '<div class="sm-note">No friends yet. Add one by their code, or send them yours.</div>';
      for (const f of pr.friends) html += '<div data-u="' + esc(f.handle) + '"><span>' + esc(f.name) + '<small>' + esc(f.handle) + '</small></span><span class="sm-actions"><button class="small" data-ch="' + esc(f.handle) + '" data-n="' + esc(f.name) + '">Challenge</button><b>›</b></span></div>';
      html += '</div><div class="sm-row"><input type="text" id="sm-pr-code" placeholder="Friend code" maxlength="8" style="width:140px"><button class="small" id="sm-pr-add">Add friend</button></div>';
    }
    if (pr.results.length) {
      html += '<div class="sm-k" style="text-align:left;margin-top:12px">Past games</div><div class="sm-summary sm-list">';
      for (const r of pr.results.slice(0, 30)) html += '<div data-g="' + esc(r.game_id) + '"><span>' + (r.end_reason === 'disputed' ? 'Disputed' : (r.won === true ? 'Won' : r.won === false ? 'Lost' : 'Tied') + ' ' + num(r.my_score) + '–' + num(r.their_score)) + ' vs ' + esc(r.their_name || 'a guest') + '</span><small>' + esc(new Date(r.finished_at).toLocaleDateString()) + '</small></div>';
      html += '</div>';
    }
    html += '<div class="sm-row" style="justify-content:center;margin-top:12px"><button id="sm-pr-close">Close</button></div>';
    openOverlay(html);
    $('sm-pr-close').addEventListener('click', back);
    if (!user && !pr.mine) bindAuth(ui.overlay);
    ui.overlay.querySelectorAll('[data-u]').forEach((d) => d.addEventListener('click', () => showProfile(d.dataset.u)));
    ui.overlay.querySelectorAll('button[data-ch]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); challengeFriend(b.dataset.ch, b.dataset.n); }));
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
  // The QR code library, fetched on first use.
  function withQr(done, failed) {
    if (window.qrcode) { done(); return; }
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    sc.onload = done; sc.onerror = failed;
    document.head.appendChild(sc);
  }
  // A QR code of the profile link.
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
    withQr(() => { if (!cancelled) draw(); },
           () => { if (cancelled) return; openOverlay('<h2>QR code</h2><p>Could not load the QR library. The link is ' + esc(link) + '</p><button id="sm-qr-back">Back</button>'); $('sm-qr-back').addEventListener('click', () => showProfile(pr.handle)); });
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
  // an offline copy registered under the game's earlier address keeps serving that old page on this
  // device until it is dropped: any worker whose scope is not this page's goes (its caches go when ours activates)
  if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => { if (new URL(r.scope).pathname !== BASE) r.unregister(); })).catch(() => {});
  }
  if ('serviceWorker' in navigator && !LOCAL_HOST) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => { /* no offline copy, nothing lost */ });
  ui.newBtn.addEventListener('click', showMenu);
  ui.help.addEventListener('click', showHelp);
  ui.players.forEach((el) => el.addEventListener('click', () => { if (el.dataset.handle) showProfile(el.dataset.handle); }));
  ui.bagBtn.addEventListener('click', () => { if (G) showUnseen(); });
  dictReady.then(() => { if (G) render(); });

  const wanted = idFromUrl();
  const wantedProfile = new URLSearchParams(location.search).get('u') || (location.pathname.match(/\/seven-tiles\/u\/([A-Za-z0-9]+)\/?$/) || [])[1];
  const wantedRoom = roomFromUrl();
  if (wantedProfile) { history.replaceState(null, '', BASE); showProfile(wantedProfile.toUpperCase()); }
  else if (wantedRoom) openRoom(wantedRoom);
  else if (wanted) openGame(wanted);
  else {
    const latest = games.list().find((r) => !r.over);
    if (latest) openGame(latest.id); else showMenu();
  }

  window.__sm = { get game() { return G; }, get review() { return R; }, core: C, get dict() { return dict; }, games, enterReview, reviewGo, pollRoom };
})();
