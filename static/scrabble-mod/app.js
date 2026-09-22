/* Scrabble Mod page script: the board and rack UI, the bot's turns, pass-and-
   play on one device, and online games against a Supabase project when the page
   has been given one. All rules live in core.js.

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
    board: $('sm-board'), rack: $('sm-rack'), msg: $('sm-msg'), status: $('sm-status'), log: $('sm-log'),
    overlay: $('sm-overlay'), bag: $('sm-bagn'), bagBtn: $('sm-bag'), players: [$('sm-p0'), $('sm-p1')], play: $('sm-play'),
    swap: $('sm-swap'), pass: $('sm-pass'), recall: $('sm-recall'), shuffle: $('sm-shuffle'), newBtn: $('sm-new'),
    help: $('sm-help'), resign: $('sm-resign'), online: $('sm-online-panel')
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const randomSeed = () => (Math.floor(Math.random() * 0x7fffffff) || 1);
  const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

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

  // Saved games, by id. { id, kind, level, names, seed, moves, over, updated, online?: {token, player, name} }
  const games = {
    all() { return store.get('sm.games', {}); },
    get(id) { return this.all()[id] || null; },
    put(rec) { const a = this.all(); rec.updated = Date.now(); a[rec.id] = rec; store.set('sm.games', a); },
    remove(id) { const a = this.all(); delete a[id]; store.set('sm.games', a); },
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
  let sessions = 0;
  let pending = [];       // [{r, c, l, b, ri}] tiles placed this turn, ri = rack slot
  let sel = -1;           // selected rack slot
  let cursor = null;      // {r, c, down}
  let swapMode = false;
  let marks = new Set();  // rack slots marked for a swap
  let busy = false;       // a move is in flight (bot thinking or server call)
  let pollTimer = null, botTimer = null;
  let statusIsPreview = false;

  const alive = (s) => !!G && G.session === s;
  const myTurn = () => !!G && !G.state.over && !busy && (G.kind === 'hotseat' ? !G.hidden : G.state.turn === G.me);
  const viewer = () => (G.kind === 'hotseat' ? G.state.turn : G.me);   // null for a spectator
  const nameOf = (p) => G.names[p] || (p === 0 ? 'Player 1' : 'Player 2');
  const isYou = (p) => G.kind !== 'hotseat' && p === G.me;

  function setStatus(text, kind) {
    ui.status.textContent = text || '';
    ui.status.className = 'sm-status' + (kind ? ' ' + kind : '');
    statusIsPreview = false;
  }
  function resetTurnUi() { pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); }
  function leaveGame() {
    clearTimeout(botTimer); botTimer = null;
    stopPolling();
    G = null; busy = false; resetTurnUi();
    ui.board.classList.remove('valid');
  }

  // ---- board & rack rendering ---------------------------------------------
  const cells = [];
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
  function renderBoard() {
    const s = G.state;
    const pend = new Map(pending.map((t) => [t.r * N + t.c, t]));
    const last = new Set();
    for (let k = s.history.length - 1; k >= 0; k--) {
      const h = s.history[k];
      if (h.t === 'play') { for (const t of h.tiles) last.add(t.r * N + t.c); break; }
    }
    for (let i = 0; i < N * N; i++) {
      const d = cells[i], t = s.board[i], p = pend.get(i);
      const bonus = C.bonusAt(i);
      let html;
      if (t) html = tileHtml(t.l, t.b, last.has(i) ? 'recent' : '');
      else if (p) html = tileHtml(p.l, p.b, 'pending');
      else html = bonus === '*' ? '' : esc(bonus);
      if (d.innerHTML !== html) d.innerHTML = html;
      const isCur = !!cursor && cursor.r * N + cursor.c === i && myTurn();
      d.classList.toggle('cursor', isCur);
      d.classList.toggle('down', isCur && cursor.down);
    }
  }
  function renderRack() {
    const p = viewer();
    const rack = p === null ? [] : G.state.racks[p];
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
    if (h.t === 'play') return who + ' played <b>' + esc(h.word) + '</b> for <b>' + h.score + '</b> point' + (h.score === 1 ? '' : 's') + (h.bingo ? ' (sweep!)' : '');
    if (h.t === 'swap') return who + ' swapped ' + h.n + ' tile' + (h.n === 1 ? '' : 's');
    if (h.t === 'resign') return who + ' resigned';
    return who + ' passed';
  }
  function verdict(s) {
    const w = C.winner(s);
    if (w === -1) return 'A tie';
    return nameOf(w) + ' wins';
  }
  function render() {
    if (!G) return;
    const s = G.state;
    for (let p = 0; p < 2; p++) {
      const el = ui.players[p];
      el.querySelector('.sm-name').textContent = nameOf(p) + (isYou(p) ? ' (you)' : '');
      el.querySelector('.sm-score').textContent = s.scores[p];
      el.classList.toggle('turn', !s.over && s.turn === p);
    }
    ui.bag.textContent = s.bag.length;
    const h = s.history[s.history.length - 1];
    if (s.over) ui.msg.innerHTML = '<b>Game over.</b> ' + esc(verdict(s)) + '.';
    else if (h) ui.msg.innerHTML = describe(h) + (s.finalTurns !== null ? ' · <i>bag empty, last turns</i>' : '');
    else ui.msg.innerHTML = (isYou(s.turn) || G.kind === 'hotseat') ? 'Your move. The first word covers the center.' : esc(nameOf(s.turn)) + ' goes first.';
    renderBoard();
    renderRack();
    let html = '';
    s.history.forEach((e) => {
      const what = e.t === 'play' ? esc(e.word) + (e.bingo ? ' ★' : '') : e.t === 'swap' ? 'swap ×' + e.n : e.t;
      html += '<li><span><span class="who">' + esc(nameOf(e.p)) + '</span>' + what + '</span>' + (e.t === 'play' ? '<b>+' + e.score + '</b>' : '') + '</li>';
    });
    ui.log.innerHTML = html || '<li><span class="who">No moves yet.</span></li>';
    ui.log.scrollTop = ui.log.scrollHeight;

    const mine = myTurn();
    const opt = C.options(s);
    // score what is laid out so far
    let preview = null;
    if (mine && !swapMode && pending.length && dict) preview = C.check(s, { t: 'play', tiles: pending.map((t) => ({ r: t.r, c: t.c, l: t.l, b: t.b })) }, dict);
    ui.board.classList.toggle('valid', !!(preview && preview.ok));
    if (preview) {
      if (preview.ok) {
        const extra = preview.words.slice(1).map((w) => w.word);
        setStatus(preview.main + ' for ' + preview.score + ' point' + (preview.score === 1 ? '' : 's') +
          (extra.length ? ' (also ' + extra.join(', ') + ')' : '') + (preview.bingo ? ' — a sweep!' : ''), 'good');
      } else setStatus(preview.reason);
      statusIsPreview = true;
    } else if (statusIsPreview) setStatus('');
    ui.play.textContent = swapMode ? 'Swap ' + marks.size + ' & pass' : preview && preview.ok ? 'Play for ' + preview.score : 'Play';
    ui.play.disabled = !mine || (swapMode ? marks.size === 0 : opt.mustPass);
    ui.swap.disabled = !mine || !opt.swap;
    ui.swap.textContent = swapMode ? 'Cancel swap' : 'Swap';
    ui.pass.disabled = !mine || swapMode;
    ui.recall.disabled = !mine || !pending.length;
    ui.shuffle.disabled = viewer() === null || G.hidden;
    ui.resign.disabled = s.over || (G.kind === 'hotseat' ? false : G.me === null);
    if (mine && opt.mustPass) setStatus('You have no tiles left. Pass to let ' + nameOf(1 - s.turn) + ' take the last turn.');
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
    if (b) { l = await pickLetter(); if (!l) return; }
    pending.push({ r, c, l, b, ri });
    sel = -1;
    cursor = { r, c, down: cursor ? cursor.down : false };
    advance();
    render();
  }
  function takeBack(i) {
    const t = pending[i];
    pending.splice(i, 1);
    cursor = { r: t.r, c: t.c, down: cursor ? cursor.down : false };
    render();
  }
  function recall() { pending = []; sel = -1; render(); }

  ui.board.addEventListener('click', (e) => {
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
    const slot = e.target.closest('.sm-slot');
    if (!slot || !G || G.hidden || viewer() === null) return;
    const i = +slot.dataset.i;
    const rack = G.state.racks[viewer()];
    if (i >= rack.length || pending.some((t) => t.ri === i)) return;
    if (swapMode) { if (marks.has(i)) marks.delete(i); else marks.add(i); render(); return; }
    if (!myTurn()) return;
    sel = sel === i ? -1 : i;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (ui.overlay.classList.contains('is-open')) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!myTurn() || swapMode) return;
    if (e.key === 'Enter') { e.preventDefault(); play(); return; }
    if (e.key === 'Escape') { recall(); return; }
    if (e.key === 'Backspace') { if (pending.length) { e.preventDefault(); takeBack(pending.length - 1); } return; }
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
      render();
    }
  });
  ui.recall.addEventListener('click', recall);
  ui.shuffle.addEventListener('click', () => {
    if (!G || G.hidden || viewer() === null) return;
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
    swapMode = !swapMode; marks = new Set(); pending = []; sel = -1;
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
    if (!G || G.state.over) return;
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
    if (!pending.length) { setStatus('Place some tiles first: click a square and type, or click a rack tile then a square.'); return; }
    commit({ t: 'play', tiles: pending.map((t) => ({ r: t.r, c: t.c, l: t.l, b: t.b })) });
  }

  // ---- moves ----------------------------------------------------------------
  async function commit(move) {
    if (!dict) { setStatus('Still loading the word list…'); await dictReady; if (!dict) return; }
    const res = C.check(G.state, move, dict);
    if (!res.ok) { setStatus(res.reason, 'bad'); return; }
    if (G.kind !== 'online') { applyLocal(move); return; }
    const s = G.session;
    busy = true; render(); setStatus('Sending…');
    let moves;
    try {
      moves = await Net.rpc('play_move', { p_code: G.id, p_token: G.online.token, p_index: G.state.moves.length, p_move: move });
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
      if (G.kind !== 'bot' || G.state.over || G.state.turn === G.me) { busy = false; render(); return; }
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
    else when = n + ' move' + (n === 1 ? '' : 's') + ' in';
    return { kind, when };
  }
  function showMenu() {
    setUrl(null);
    const list = games.list().slice(0, 12);
    let html = '<h2>Scrabble Mod</h2><p>Two racks, one bag, a 15×15 board. The full rules are below the game.</p><div class="sm-choices">' +
      '<button data-bot="easy"><b>Play the bot: easy</b><small>plays middling words</small></button>' +
      '<button data-bot="medium"><b>Play the bot: medium</b><small>plays a good move, rarely the best</small></button>' +
      '<button data-bot="hard"><b>Play the bot: hard</b><small>always plays the highest-scoring move</small></button>' +
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
    openOverlay('<h2>How to play</h2><p style="text-align:left">Make words across or down that connect to what is on the board; the first word covers the center. ' +
      'Every word formed must be in the word list. Letter values add up, bonus squares multiply, and using all seven tiles in one turn is a <b>sweep</b> worth 40 extra points.</p>' +
      '<p style="text-align:left">Instead of playing you can <b>swap</b> any of your tiles (that uses your turn) or <b>pass</b>. Once the bag is empty each player gets one last turn, then the higher score wins. Leftover tiles cost nothing.</p>' +
      '<p style="text-align:left">Click a square and type, or click a rack tile and then a square. The arrow keys, or a second click on the cursor square, switch between across and down. The board turns green when what you have laid out is a legal play.</p>' +
      '<button class="primary" id="sm-help-ok">Got it</button>');
    $('sm-help-ok').addEventListener('click', closeOverlay);
  }
  // The tiles this player cannot see: the bag plus the other rack.
  function showUnseen() {
    const s = G.state;
    const me = viewer();
    const opp = me === null ? null : 1 - me;
    const counts = {};
    for (const t of s.bag) counts[t] = (counts[t] || 0) + 1;
    if (opp !== null) for (const t of s.racks[opp]) counts[t] = (counts[t] || 0) + 1;
    let total = s.bag.length + (opp === null ? 0 : s.racks[opp].length);
    let html = '<h2>Unseen tiles</h2><p>' + s.bag.length + ' in the bag' + (opp === null ? '' : ' and ' + s.racks[opp].length + ' on ' + esc(nameOf(opp)) + '’s rack') + ': ' + total + ' in all.</p><div class="sm-unseen">';
    for (const k of Object.keys(C.TILES)) {
      const n = counts[k] || 0;
      html += '<div class="' + (n ? '' : 'none') + '">' + (k === '?' ? '?' : k) + '<small>' + n + ' of ' + C.TILES[k][0] + '</small></div>';
    }
    html += '</div><button class="primary" id="sm-unseen-ok">Close</button>';
    openOverlay(html);
    $('sm-unseen-ok').addEventListener('click', closeOverlay);
  }
  function showGameOver() {
    const s = G.state;
    const why = s.endReason === 'resign' ? esc(nameOf(s.resigned)) + ' resigned.' : s.endReason === 'passes' ? 'Both players passed twice in a row.' : 'The bag ran out and both players took a last turn.';
    openOverlay('<h2>' + esc(verdict(s)) + '</h2><p>' + why + '</p><div class="sm-final"><div>' + esc(nameOf(0)) + '<b>' + s.scores[0] + '</b></div><div>' + esc(nameOf(1)) + '<b>' + s.scores[1] + '</b></div></div>' +
      '<div class="sm-k" style="text-align:left">Review: what you played vs the best play available</div><div class="sm-review" id="sm-review">Working through the game…</div>' +
      '<div class="sm-row" style="justify-content:center"><button id="sm-over-close">Look at the board</button><button class="primary" id="sm-over-new">New game</button></div>');
    $('sm-over-close').addEventListener('click', closeOverlay);
    $('sm-over-new').addEventListener('click', () => { closeOverlay(); showMenu(); });
    const who = G.kind === 'hotseat' ? new Set([0, 1]) : G.me === null ? new Set([0, 1]) : new Set([G.me]);
    const session = G.session;
    computeReview(s, who, (rows, done) => {
      const el = $('sm-review');
      if (!el || !alive(session)) return;
      let html = '';
      let missed = 0;
      for (const r of rows) {
        const gap = r.best ? r.best.score - r.score : 0;
        missed += Math.max(0, gap);
        html += '<div><span>' + (who.size > 1 ? '<span class="who">' + esc(nameOf(r.p)) + '</span> ' : '') + (r.t === 'play' ? esc(r.word) + ' <b>' + r.score + '</b>' : r.t) + '</span>' +
          '<span>' + (r.best ? 'best ' + esc(r.best.word) + ' <b>' + r.best.score + '</b>' + (gap > 0 ? ' <span class="miss">−' + gap + '</span>' : '') : 'no play') + '</span></div>';
      }
      el.innerHTML = (html || 'No turns to review.') + (done ? '<div><span>Points left on the table</span><b>' + missed + '</b></div>' : '<div>…</div>');
    });
  }
  // Best play for each of the reviewed players' turns, replayed from the start
  // so nothing needs storing; runs in slices so the page stays responsive.
  function computeReview(final, who, cb) {
    const rows = [];
    let s = C.newGame(final.seed), i = 0;
    const step = () => {
      const t0 = Date.now();
      while (i < final.moves.length && Date.now() - t0 < 40) {
        const m = final.moves[i], p = s.turn;
        if (who.has(p) && s.racks[p].length && m.t !== 'resign') {
          const best = C.generate(s.board, s.racks[p], dict)[0] || null;
          const h = final.history[i];
          rows.push({ p, t: h.t, word: h.word, score: h.t === 'play' ? h.score : 0, best: best && { word: best.word, score: best.score } });
        }
        s = C.apply(s, m, dict);
        i++;
      }
      cb(rows, i >= final.moves.length);
      if (i < final.moves.length) setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  // ---- starting and opening games ------------------------------------------------
  function startLocal(kind, level) {
    leaveGame();
    let id = newId();
    while (games.get(id)) id = newId();
    G = { id, kind, level: level || null, names: kind === 'bot' ? ['You', 'Bot (' + level + ')'] : ['Player 1', 'Player 2'], state: C.newGame(randomSeed()), me: 0, hidden: false, session: ++sessions };
    persist();
    setUrl(id);
    render();
    setStatus('');
  }
  async function resumeLocal(rec) {
    await dictReady;
    if (!dict) return;
    leaveGame();
    let state;
    try { state = C.replay(rec.seed, rec.moves, dict); }
    catch (e) { setStatus('The saved game ' + rec.id + ' could not be restored.', 'bad'); showMenu(); return; }
    G = { id: rec.id, kind: rec.kind, level: rec.level, names: rec.names, state, me: 0, hidden: rec.kind === 'hotseat' && !state.over, session: ++sessions };
    setUrl(rec.id);
    render();
    setStatus('');
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
    const name = await askText('Your name', 'Shown to your opponent.', 'Name', store.get('sm.name', ''));
    if (!name) { showMenu(); return; }
    store.set('sm.name', name);
    const token = randomToken();
    setStatus('Creating the game…');
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      try {
        await Net.rpc('create_game', { p_code: id, p_seed: randomSeed(), p_name: name, p_token: token });
        games.put({ id, kind: 'online', names: [name, null], seed: null, moves: [], over: false, online: { token, player: 0 } });
        await openOnline(id);
        return;
      } catch (e) {
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
    await dictReady;
    if (!dict) return;
    leaveGame();
    const session = ++sessions;
    let row;
    try { row = await Net.rpc('get_game', { p_code: id }); } catch (e) { setStatus('Could not load game ' + id + ': ' + e.message, 'bad'); showMenu(); return; }
    if (sessions !== session) return;
    if (!row) { setStatus('There is no game called ' + id + '.', 'bad'); showMenu(); return; }
    let seat;
    try { seat = await seatFor(id, row); } catch (e) { setStatus('Could not join: ' + e.message, 'bad'); showMenu(); return; }
    if (sessions !== session) return;
    if (!seat) { showMenu(); return; }
    if (seat.player !== null) {
      // the join may have filled the second seat: reload the names
      try { row = await Net.rpc('get_game', { p_code: id }); } catch (e) { /* keep what we have */ }
      if (sessions !== session) return;
    }
    let state;
    try { state = C.replay(row.seed, row.moves || [], dict); } catch (e) { setStatus('This game’s record is corrupt: ' + e.message, 'bad'); return; }
    G = { id, kind: 'online', level: null, names: [row.p1_name || 'Player 1', row.p2_name || null], state, me: seat.player, online: { token: seat.token }, hidden: false, session };
    if (seat.player !== null) persist();
    setUrl(id);
    render();
    setStatus(seat.player === null ? 'Watching: this game already has two players.' : '');
    if (G.state.over) showGameOver();
    else { startPolling(); if (G.state.turn === G.me && C.options(G.state).mustPass) commit({ t: 'pass' }); }
  }
  // Fold the server's move list into ours. Idempotent: moves we already have
  // are skipped, so a poll and a submission can both deliver the same move.
  function integrate(moves, names) {
    if (names) G.names = names;
    moves = moves || [];
    let s = G.state;
    try { for (let i = s.moves.length; i < moves.length; i++) s = C.apply(s, moves[i], dict); }
    catch (e) { setStatus('The game record no longer matches this page: ' + e.message, 'bad'); return; }
    const changed = s !== G.state;
    if (changed) { G.state = s; resetTurnUi(); }
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

  // ---- boot ----------------------------------------------------------------------
  ui.newBtn.addEventListener('click', showMenu);
  ui.help.addEventListener('click', showHelp);
  ui.bagBtn.addEventListener('click', () => { if (G) showUnseen(); });

  const wanted = idFromUrl();
  if (wanted) openGame(wanted);
  else {
    const latest = games.list().find((r) => !r.over);
    if (latest) openGame(latest.id); else showMenu();
  }

  window.__sm = { get game() { return G; }, core: C, get dict() { return dict; }, games };
})();
