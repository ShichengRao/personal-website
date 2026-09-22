/* Scrabble Mod page script: the board and rack UI, the bot's turns, pass-and-
   play on one device, and online games against a Supabase table when the page
   has been given a project. All rules live in core.js. */
(function () {
  'use strict';
  const C = window.ScrabbleMod;
  const CFG = window.SM_CONFIG || {};
  const N = C.N;
  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $('sm-app'), board: $('sm-board'), rack: $('sm-rack'), msg: $('sm-msg'), status: $('sm-status'), log: $('sm-log'),
    overlay: $('sm-overlay'), bag: $('sm-bagn'), players: [$('sm-p0'), $('sm-p1')], play: $('sm-play'), swap: $('sm-swap'),
    pass: $('sm-pass'), recall: $('sm-recall'), shuffle: $('sm-shuffle'), newBtn: $('sm-new'), help: $('sm-help'), online: $('sm-online-panel')
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const randomSeed = () => (Math.floor(Math.random() * 0x7fffffff) || 1);
  const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  // ---- dictionary --------------------------------------------------------
  let dict = null;
  const dictReady = fetch('/scrabble-mod/words.txt')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then((t) => { dict = C.buildDict(t); })
    .catch((e) => { setStatus('The word list failed to load (' + e.message + '). Reload to try again.', 'bad'); });

  // ---- session -----------------------------------------------------------
  // G: { kind: 'bot'|'hotseat'|'online', level, names, state, me, online: {code, token}, hidden }
  let G = null;
  let pending = [];       // [{r, c, l, b, ri}] tiles placed this turn, ri = rack slot
  let sel = -1;           // selected rack slot
  let cursor = null;      // {r, c, down}
  let swapMode = false;
  let marks = new Set();  // rack slots marked for a swap
  let busy = false;       // a move is in flight (bot thinking or server call)
  let pollTimer = null;

  const myTurn = () => !!G && !G.state.over && !busy && (G.kind === 'hotseat' ? !G.hidden : G.state.turn === G.me);
  const viewer = () => (G.kind === 'hotseat' ? G.state.turn : G.me);
  const nameOf = (p) => G.names[p] || (p === 0 ? 'Player 1' : 'Player 2');

  function setStatus(text, kind) {
    ui.status.textContent = text || '';
    ui.status.className = 'sm-status' + (kind ? ' ' + kind : '');
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
    const rack = G.state.racks[p];
    const used = new Set(pending.map((t) => t.ri));
    let html = '';
    for (let i = 0; i < C.RACK; i++) {
      const cls = ['sm-slot', sel === i ? 'sel' : '', marks.has(i) ? 'mark' : '', G.hidden ? 'hidden' : ''].join(' ').trim();
      const t = rack[i];
      html += '<div class="' + cls + '" data-i="' + i + '">' + (t && !used.has(i) ? tileHtml(t === '?' ? '?' : t, t === '?', '') : '') + '</div>';
    }
    ui.rack.innerHTML = html;
  }
  function describe(h, you) {
    const who = you ? 'You' : esc(nameOf(h.p));
    if (h.t === 'play') return who + ' played <b>' + esc(h.word) + '</b> for <b>' + h.score + '</b> point' + (h.score === 1 ? '' : 's') + (h.bingo ? ' (sweep!)' : '');
    if (h.t === 'swap') return who + ' swapped ' + h.n + ' tile' + (h.n === 1 ? '' : 's');
    return who + ' passed';
  }
  function render() {
    if (!G) return;
    const s = G.state;
    for (let p = 0; p < 2; p++) {
      const el = ui.players[p];
      el.querySelector('.sm-name').textContent = nameOf(p) + (G.kind !== 'hotseat' && p === G.me ? ' (you)' : '');
      el.querySelector('.sm-score').textContent = s.scores[p];
      el.classList.toggle('turn', !s.over && s.turn === p);
    }
    ui.bag.textContent = s.bag.length;
    const h = s.history[s.history.length - 1];
    if (s.over) {
      const w = s.scores[0] === s.scores[1] ? 'A tie.' : (s.scores[0] > s.scores[1] ? nameOf(0) : nameOf(1)) + ' wins.';
      ui.msg.innerHTML = '<b>Game over.</b> ' + esc(w);
    } else if (h) {
      const you = G.kind !== 'hotseat' && h.p === G.me;
      ui.msg.innerHTML = describe(h, you) + (s.finalTurns !== null ? ' · <i>bag empty, last turns</i>' : '');
    } else {
      ui.msg.innerHTML = s.turn === G.me || G.kind === 'hotseat' ? 'Your move. The first word covers the centre.' : esc(nameOf(s.turn)) + ' goes first.';
    }
    renderBoard();
    renderRack();
    let html = '';
    s.history.forEach((e) => {
      html += '<li><span><span class="who">' + esc(nameOf(e.p)) + '</span>' + (e.t === 'play' ? esc(e.word) + (e.bingo ? ' ★' : '') : e.t === 'swap' ? 'swap ×' + e.n : 'pass') + '</span>' + (e.t === 'play' ? '<b>+' + e.score + '</b>' : '') + '</li>';
    });
    ui.log.innerHTML = html || '<li><span class="who">No moves yet.</span></li>';
    ui.log.scrollTop = ui.log.scrollHeight;
    const mine = myTurn();
    const opt = C.options(s);
    ui.play.textContent = swapMode ? 'Swap ' + marks.size + ' & pass' : 'Play';
    ui.play.disabled = !mine || (swapMode ? marks.size === 0 : opt.mustPass);
    ui.swap.disabled = !mine || !opt.swap;
    ui.swap.textContent = swapMode ? 'Cancel swap' : 'Swap';
    ui.pass.disabled = !mine || swapMode;
    ui.recall.disabled = !mine || !pending.length;
    ui.shuffle.disabled = !G || G.hidden;
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
  function occupied(r, c) {
    return !!G.state.board[r * N + c] || pending.some((t) => t.r === r && t.c === c);
  }
  function advance() {
    if (!cursor) return;
    let { r, c } = cursor;
    do { if (cursor.down) r++; else c++; } while (r < N && c < N && occupied(r, c));
    if (r < N && c < N) cursor = { r, c, down: cursor.down }; else cursor = null;
  }
  async function place(r, c, ri, b) {
    let l = G.state.racks[viewer()][ri];
    if (b) { l = await pickLetter(); if (!l) return; }
    pending.push({ r, c, l, b, ri });
    sel = -1;
    cursor = { r, c, down: cursor ? cursor.down : false };
    advance();
    setStatus('');
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
    if (!slot || !G || G.hidden) return;
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
    if (/^[a-zA-Z]$/.test(e.key) && cursor) {
      e.preventDefault();
      const L = e.key.toUpperCase();
      if (occupied(cursor.r, cursor.c)) return;
      const s = slotFor(L);
      if (!s) { setStatus('No ' + L + ' on your rack.', 'bad'); return; }
      pending.push({ r: cursor.r, c: cursor.c, l: L, b: s.b, ri: s.ri });
      advance();
      setStatus('');
      render();
    }
  });
  ui.recall.addEventListener('click', recall);
  ui.shuffle.addEventListener('click', () => {
    if (!G || G.hidden) return;
    const rack = G.state.racks[viewer()];
    const keep = pending.map((t) => rack[t.ri]);
    for (let i = rack.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = rack[i]; rack[i] = rack[j]; rack[j] = t; }
    // re-point the pending tiles at wherever their letters went
    const taken = new Set();
    pending.forEach((t, k) => { const want = keep[k]; for (let i = 0; i < rack.length; i++) if (!taken.has(i) && rack[i] === want) { taken.add(i); t.ri = i; break; } });
    sel = -1; marks = new Set();
    render();
  });
  ui.swap.addEventListener('click', () => {
    if (!myTurn()) return;
    swapMode = !swapMode; marks = new Set(); pending = []; sel = -1;
    setStatus(swapMode ? 'Pick the tiles to swap, then confirm. Swapping uses your turn.' : '');
    render();
  });
  ui.pass.addEventListener('click', () => {
    if (!myTurn()) return;
    if (pending.length) { setStatus('Recall your tiles before passing.', 'bad'); return; }
    if (G.state.racks[G.state.turn].length && !window.confirm('Pass this turn without playing?')) return;
    commit({ t: 'pass' });
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
    if (G.kind === 'online') {
      busy = true; render(); setStatus('Sending…');
      try {
        const idx = G.state.moves.length;
        await Net.rpc('play_move', { p_code: G.online.code, p_token: G.online.token, p_index: idx, p_move: move });
      } catch (e) {
        busy = false; setStatus('Could not send that move: ' + e.message, 'bad'); render();
        syncOnline();
        return;
      }
      busy = false;
    }
    applyLocal(move);
  }
  function applyLocal(move) {
    G.state = C.apply(G.state, move, dict);
    pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set();
    setStatus('');
    persist();
    if (G.kind === 'hotseat' && !G.state.over) G.hidden = true;
    render();
    if (G.state.over) { stopPolling(); showGameOver(); return; }
    if (G.kind === 'bot' && G.state.turn !== G.me) scheduleBot();
    else if (G.kind === 'hotseat') showHandoff();
    else if (G.kind === 'online') startPolling();
  }
  function scheduleBot() {
    busy = true; render();
    setStatus(nameOf(1 - G.me) + ' is thinking…');
    setTimeout(async () => {
      await dictReady;
      if (!G || G.kind !== 'bot' || G.state.over) { busy = false; return; }
      const move = C.botMove(G.state, G.level, Math.random, dict);
      busy = false;
      applyLocal(move);
    }, 650);
  }
  function persist() {
    if (!G) return;
    if (G.kind === 'online') return;
    store.set('sm.local', { kind: G.kind, level: G.level, names: G.names, seed: G.state.seed, moves: G.state.moves, over: G.state.over, version: C.VERSION });
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
      ui.overlay.querySelectorAll('button[data-l]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); resolve(b.dataset.l || null); }));
      const onKey = (e) => { if (/^[a-zA-Z]$/.test(e.key)) { document.removeEventListener('keydown', onKey, true); closeOverlay(); resolve(e.key.toUpperCase()); } else if (e.key === 'Escape') { document.removeEventListener('keydown', onKey, true); closeOverlay(); resolve(null); } };
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
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); });
    });
  }

  function showMenu() {
    const saved = store.get('sm.local', null);
    const resumable = saved && saved.moves && !saved.over && saved.version === C.VERSION;
    openOverlay('<h2>Scrabble Mod</h2><p>Two racks, one bag, a 15×15 board. The full rules are below the game.</p><div class="sm-choices">' +
      (resumable ? '<button id="sm-m-resume"><b>Resume</b><small>the game in this browser (' + saved.moves.length + ' moves in)</small></button>' : '') +
      '<button data-bot="easy"><b>Play the bot: easy</b><small>plays middling words</small></button>' +
      '<button data-bot="medium"><b>Play the bot: medium</b><small>plays a good move, rarely the best</small></button>' +
      '<button data-bot="hard"><b>Play the bot: hard</b><small>always plays the highest-scoring move</small></button>' +
      '<button id="sm-m-hotseat"><b>Two players, one device</b><small>pass it back and forth; racks hide between turns</small></button>' +
      '<button id="sm-m-online"' + (Net.enabled ? '' : ' disabled') + '><b>Play a friend online</b><small>' + (Net.enabled ? 'share a link; take turns whenever' : 'not set up on this site yet') + '</small></button>' +
      '</div>');
    ui.overlay.querySelectorAll('button[data-bot]').forEach((b) => b.addEventListener('click', () => { closeOverlay(); startLocal('bot', b.dataset.bot); }));
    if (resumable) $('sm-m-resume').addEventListener('click', () => { closeOverlay(); resumeLocal(saved); });
    $('sm-m-hotseat').addEventListener('click', () => { closeOverlay(); startLocal('hotseat'); });
    $('sm-m-online').addEventListener('click', () => { closeOverlay(); createOnline(); });
  }
  function showHandoff() {
    openOverlay('<h2>' + esc(nameOf(G.state.turn)) + '’s turn</h2><p>Pass the device over. The rack stays hidden until you tap.</p><button class="primary" id="sm-reveal">Show my rack</button>');
    $('sm-reveal').addEventListener('click', () => { G.hidden = false; closeOverlay(); render(); });
  }
  function showHelp() {
    openOverlay('<h2>How to play</h2><p style="text-align:left">Make words across or down that connect to what is on the board; the first word covers the centre. ' +
      'Every word formed must be in the word list. Letter values add up, bonus squares multiply, and using all seven tiles in one turn is a <b>sweep</b> worth 40 extra points.</p>' +
      '<p style="text-align:left">Instead of playing you can <b>swap</b> any of your tiles (that uses your turn) or <b>pass</b>. Once the bag is empty each player gets one last turn, then the higher score wins. Leftover tiles cost nothing.</p>' +
      '<p style="text-align:left">Click a square and type, or click a rack tile and then a square. Click the cursor square again to switch between across and down.</p>' +
      '<button class="primary" id="sm-help-ok">Got it</button>');
    $('sm-help-ok').addEventListener('click', closeOverlay);
  }
  function showGameOver() {
    const s = G.state;
    const w = s.scores[0] === s.scores[1] ? 'A tie' : (s.scores[0] > s.scores[1] ? nameOf(0) : nameOf(1)) + ' wins';
    const why = s.endReason === 'passes' ? 'Both players passed twice in a row.' : 'The bag ran out and both players took a last turn.';
    openOverlay('<h2>' + esc(w) + '</h2><p>' + why + '</p><div class="sm-final"><div>' + esc(nameOf(0)) + '<b>' + s.scores[0] + '</b></div><div>' + esc(nameOf(1)) + '<b>' + s.scores[1] + '</b></div></div>' +
      '<div class="sm-k" style="text-align:left">Review: what you played vs the best play available</div><div class="sm-review" id="sm-review">Working through the game…</div>' +
      '<div class="sm-row" style="justify-content:center"><button id="sm-over-close">Look at the board</button><button class="primary" id="sm-over-new">New game</button></div>');
    $('sm-over-close').addEventListener('click', closeOverlay);
    $('sm-over-new').addEventListener('click', () => { closeOverlay(); showMenu(); });
    const who = G.kind === 'hotseat' ? new Set([0, 1]) : new Set([G.me]);
    computeReview(s, who, (rows, done) => {
      const el = $('sm-review');
      if (!el) return;
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
        if (who.has(p) && s.racks[p].length) {
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

  // ---- starting games ------------------------------------------------------------
  function startLocal(kind, level) {
    stopPolling();
    const seed = randomSeed();
    G = { kind, level: level || null, names: kind === 'bot' ? ['You', 'Bot (' + level + ')'] : ['Player 1', 'Player 2'], state: C.newGame(seed), me: 0, hidden: false };
    pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); busy = false;
    persist();
    render();
    setStatus('');
  }
  async function resumeLocal(saved) {
    await dictReady;
    if (!dict) return;
    try {
      G = { kind: saved.kind, level: saved.level, names: saved.names, state: C.replay(saved.seed, saved.moves, dict), me: 0, hidden: saved.kind === 'hotseat' };
    } catch (e) {
      store.del('sm.local'); setStatus('The saved game could not be restored.', 'bad'); showMenu(); return;
    }
    pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); busy = false;
    render();
    if (G.state.over) showGameOver();
    else if (G.kind === 'bot' && G.state.turn !== G.me) scheduleBot();
    else if (G.kind === 'hotseat') showHandoff();
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
    },
    async game(code) {
      const r = await fetch(CFG.url + '/rest/v1/games?id=eq.' + encodeURIComponent(code) + '&select=id,seed,moves,p1_name,p2_name', { headers: this.headers() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      return rows[0] || null;
    }
  };
  const onlineStore = () => store.get('sm.online', {});
  function rememberOnline(code, rec) { const all = onlineStore(); all[code] = rec; store.set('sm.online', all); }

  async function createOnline() {
    const name = await askText('Your name', 'Shown to your opponent.', 'Name', store.get('sm.name', ''));
    if (!name) { showMenu(); return; }
    store.set('sm.name', name);
    const seed = randomSeed(), token = randomToken();
    setStatus('Creating the game…');
    try {
      const code = await Net.rpc('create_game', { p_seed: seed, p_name: name, p_token: token });
      rememberOnline(code, { token, player: 0, name });
      history.replaceState(null, '', '?g=' + code);
      await openOnline(code);
    } catch (e) { setStatus('Could not create the game: ' + e.message, 'bad'); showMenu(); }
  }
  async function openOnline(code) {
    await dictReady;
    if (!dict) return;
    stopPolling();
    let row;
    try { row = await Net.game(code); } catch (e) { setStatus('Could not load game ' + code + ': ' + e.message, 'bad'); showMenu(); return; }
    if (!row) { setStatus('There is no game with the code ' + code + '.', 'bad'); showMenu(); return; }
    let rec = onlineStore()[code];
    if (!rec) {
      if (row.p2_name) { setStatus('Game ' + code + ' already has two players. You can watch it.', 'bad'); rec = { token: null, player: null, name: null }; }
      else {
        const name = await askText('Join ' + esc(row.p1_name || 'the game'), 'Shown to your opponent.', 'Your name', store.get('sm.name', ''));
        if (!name) { showMenu(); return; }
        store.set('sm.name', name);
        const token = randomToken();
        try {
          const player = await Net.rpc('join_game', { p_code: code, p_name: name, p_token: token });
          rec = { token, player, name };
          rememberOnline(code, rec);
          row = await Net.game(code);
        } catch (e) { setStatus('Could not join: ' + e.message, 'bad'); showMenu(); return; }
      }
    }
    let state;
    try { state = C.replay(row.seed, row.moves || [], dict); } catch (e) { setStatus('This game’s record is corrupt: ' + e.message, 'bad'); return; }
    G = { kind: 'online', level: null, names: [row.p1_name || 'Player 1', row.p2_name || null], state, me: rec.player, online: { code, token: rec.token }, hidden: false };
    pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set(); busy = false;
    render();
    setStatus(rec.player === null ? 'Watching.' : '');
    if (G.state.over) showGameOver(); else startPolling();
  }
  async function syncOnline() {
    if (!G || G.kind !== 'online' || busy) return;
    let row;
    try { row = await Net.game(G.online.code); } catch (e) { return; }
    if (!row) return;
    G.names = [row.p1_name || 'Player 1', row.p2_name || null];
    const moves = row.moves || [];
    if (moves.length > G.state.moves.length) {
      try {
        let s = G.state;
        for (let i = s.moves.length; i < moves.length; i++) s = C.apply(s, moves[i], dict);
        G.state = s;
        pending = []; sel = -1; cursor = null; swapMode = false; marks = new Set();
      } catch (e) { setStatus('The game record no longer matches this page: ' + e.message, 'bad'); return; }
      render();
      if (G.state.over) { stopPolling(); showGameOver(); }
      else if (G.state.turn === G.me && C.options(G.state).mustPass) commit({ t: 'pass' });
    } else render();
  }
  function startPolling() {
    stopPolling();
    const tick = () => { if (document.visibilityState === 'visible') syncOnline(); };
    pollTimer = setInterval(tick, G.state.turn === G.me ? 15000 : 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && G.kind === 'online') syncOnline(); });
  function renderOnlinePanel() {
    if (!G || G.kind !== 'online') { ui.online.style.display = 'none'; return; }
    ui.online.style.display = '';
    const link = location.origin + location.pathname + '?g=' + G.online.code;
    ui.online.innerHTML = '<div class="sm-k">Online game</div><div>Code <span class="sm-code">' + esc(G.online.code) + '</span></div>' +
      (G.names[1] ? '<div class="sm-note">' + esc(G.names[0]) + ' vs ' + esc(G.names[1]) + '. This page checks for new moves every few seconds while it is open; come back any time.</div>'
                  : '<div class="sm-note">Waiting for a second player. Send them this link:</div><input type="text" readonly value="' + esc(link) + '" id="sm-link"><div class="sm-row"><button id="sm-copy">Copy link</button></div>') +
      '<div class="sm-row"><button id="sm-refresh">Refresh</button></div>';
    const copy = $('sm-copy');
    if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); copy.textContent = 'Copied'; } catch (e) { $('sm-link').select(); } });
    $('sm-refresh').addEventListener('click', syncOnline);
  }

  // ---- boot ----------------------------------------------------------------------
  ui.newBtn.addEventListener('click', () => {
    if (G && !G.state.over && G.kind !== 'online' && !window.confirm('Abandon the current game?')) return;
    if (G && G.kind === 'online') history.replaceState(null, '', location.pathname);
    stopPolling();
    showMenu();
  });
  ui.help.addEventListener('click', showHelp);

  const code = new URLSearchParams(location.search).get('g');
  if (code && Net.enabled) openOnline(code.toUpperCase());
  else {
    const saved = store.get('sm.local', null);
    if (saved && saved.moves && !saved.over && saved.version === C.VERSION) resumeLocal(saved); else showMenu();
    if (code && !Net.enabled) setStatus('Online play is not set up on this site yet.', 'bad');
  }

  window.__sm = { get game() { return G; }, core: C, get dict() { return dict; } };
})();
