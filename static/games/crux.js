/* Crux: a climb you plan before you make it. The wall is a grid of holds,
   every hazard runs on a beat clock you can read, and the route is built
   with clicks: static moves to the next hold, dynos two holds out, waits on
   whatever you're holding. Stamina and time are computed as you plan, so
   the climb itself only shows you what you already decided. */
(function () {
  'use strict';
  const LG = window.LongGame, CX = window.CruxCore;
  const W = 528, H = 660, TAU = LG.TAU;
  const COLS = CX.COLS, ROWS = CX.ROWS, TILE = 34, X0 = 40, Y0 = 26;
  const BEAT_T = 0.5;                      // seconds per beat while climbing
  const canvas = document.getElementById('cx-canvas');
  const ctx = LG.setupCanvas(canvas, W, H);
  const stage = document.getElementById('cx-stage');
  const input = new LG.Input(stage, canvas, W, H);
  const overlay = LG.overlay(document.getElementById('cx-overlay'));
  const $ = (id) => document.getElementById(id);
  const ui = {
    wall: $('cx-wall'), par: $('cx-par'), beats: $('cx-beats'), stamina: $('cx-stamina'), staminav: $('cx-staminav'),
    status: $('cx-status'), style: $('cx-style'), climb: $('cx-climb'), undo: $('cx-undo'), wait: $('cx-wait'), clear: $('cx-clear'),
    random: $('cx-random'), attempts: $('cx-attempts'), bestBeats: $('cx-best-beats'), bestTry: $('cx-best-try'), seed: $('cx-seed')
  };
  const BEST_KEY = 'lg-crux-best-v2';
  const VERSION = 3;                      // bump when the rules change enough to break old replays
  const tape = new LG.Tape('crux', VERSION);

  // The set walls, one idea each. Seeds were picked by measuring hundreds of
  // generated walls and keeping ones where the shortest plan has to work
  // around a hazard, not just climb.
  const WALLS = [
    { name: '1 · Slab', tier: 1, seed: 1003 },
    { name: '2 · Chute', tier: 2, seed: 2054 },
    { name: '3 · Gale', tier: 3, seed: 3008 },
    { name: '4 · Crumble', tier: 4, seed: 4016 },
    { name: '5 · Crux', tier: 5, seed: 5096 },
    { name: '6 · Crux II', tier: 5, seed: 5082 }
  ];

  let S = null, loop = null;

  function reset(seed, tier) {
    const level = CX.generate(seed, tier);
    const sol = CX.solve(level);
    S = {
      t: 0, state: 'planning', level, seed, tier, par: sol ? sol.par : null, solution: sol ? sol.plan : null,
      plan: [], eval: null, attempts: 0, climb: null, fx: [],
      stats: { moves: 0, dynos: 0, waits: 0 }, replay: false
    };
    evaluate();
  }
  function wallId() { return S.tier + '-' + S.seed; }
  function evaluate() { S.eval = S.plan.length ? CX.evaluate(S.level, S.plan) : null; }
  function planEnd() {
    if (!S.eval || !S.eval.steps.length) return null;
    const last = S.eval.steps[S.eval.steps.length - 1];
    return { c: last.c, r: last.r, beat: last.beat, stamina: last.stamina };
  }
  const cellAt = (c, r) => CX.cellAt(S.level, c, r);
  const cellX = (c) => X0 + c * TILE + TILE / 2;
  const cellY = (r) => Y0 + r * TILE + TILE / 2;

  // ---- planning ----------------------------------------------------------
  function addStep(step) {
    if (S.eval && (S.eval.fatal || S.eval.ok)) return false;   // nothing goes after a fall or the anchor
    S.plan.push(step); evaluate(); return true;
  }
  function undo() { if (S.plan.length) { S.plan.pop(); evaluate(); } }
  function clearPlan() { S.plan = []; evaluate(); }
  function clickCell(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    const cell = cellAt(c, r);
    if (!S.plan.length) { if (cell === 'G') addStep({ t: 's', c, r }); return; }
    const end = planEnd();
    if (S.eval.fatal || S.eval.ok) {
      // after a finished plan a click on the path trims back to that step
      const i = S.eval.steps.findIndex((s) => s.c === c && s.r === r);
      if (i >= 0) { S.plan.length = i + 1; evaluate(); }
      return;
    }
    if (c === end.c && r === end.r) { addStep({ t: 'w', c, r }); return; }
    const mv = CX.movesFrom(S.level, end.c, end.r).find((m) => m.c === c && m.r === r);
    if (mv) { addStep({ t: mv.t, c, r }); return; }
    const i = S.eval.steps.findIndex((s) => s.c === c && s.r === r);
    if (i >= 0) { S.plan.length = i + 1; evaluate(); }
  }

  // ---- climbing ----------------------------------------------------------
  function climb() {
    if (S.state !== 'planning' || !S.eval || S.plan.length < 2) return;
    S.attempts++;
    S.state = 'climbing';
    S.climb = { i: 1, t: 0, fall: 0, done: false };
    overlay.hide();
  }
  function stepClimb(dt) {
    const cl = S.climb, steps = S.eval.steps;
    if (cl.fall > 0) {
      cl.fall += dt;
      if (cl.fall > 1.1) fell();
      return;
    }
    cl.t += dt / BEAT_T;
    while (cl.t >= 1) {
      cl.t -= 1;
      const st = steps[cl.i];
      if (st.fatal) { cl.fall = 0.001; cl.t = 0; return; }
      if (cl.i === steps.length - 1) { summit(); return; }
      cl.i++;
    }
  }
  function summit() {
    S.state = 'won';
    const st = { moves: 0, dynos: 0, waits: 0 };
    for (const s of S.plan) if (s.t === 'm') st.moves++; else if (s.t === 'd') st.dynos++; else if (s.t === 'w') st.waits++;
    S.stats = st;
    const beats = S.eval.beats;
    tape.finish({ beats, attempts: S.attempts, stamina: S.eval.stamina });
    let newBeats = false, newTry = false;
    if (!S.replay) {
      const all = LG.store.get(BEST_KEY, {}), best = all[wallId()] || {};
      if (best.beats === undefined || beats < best.beats) { best.beats = beats; newBeats = true; }
      if (S.attempts === 1 && !best.firstTry) { best.firstTry = true; newTry = true; }
      all[wallId()] = best; LG.store.set(BEST_KEY, all);
    }
    showBests();
    const total = st.moves + st.dynos, dyn = total ? st.dynos / total : 0;
    const who = dyn < 0.25 ? 'Static' : dyn < 0.6 ? 'Mixed' : 'Dynamic';
    overlay.show('<div><h2>Summit</h2><span class="lg-tag">' + who + '</span>' +
      '<div class="lg-results">' +
      '<span>Beats</span><b>' + beats + (newBeats ? ' ★' : '') + '</b>' +
      '<span>Par</span><b>' + (S.par === null ? '—' : S.par) + '</b>' +
      '<span>Stamina left</span><b>' + S.eval.stamina + '</b>' +
      '<span>Attempts</span><b>' + S.attempts + (newTry ? ' · first try ★' : '') + '</b>' +
      '<span>Static moves</span><b>' + st.moves + '</b>' +
      '<span>Dynos</span><b>' + st.dynos + '</b>' +
      '<span>Waits</span><b>' + st.waits + '</b>' +
      '</div>' +
      LG.styleBar('Static', 'Dynamic', dyn, beats <= (S.par || 0) ? 'That is the fastest plan this wall allows.' : 'Par ' + S.par + ': a faster plan exists.') +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="cx-next">Next wall</button><button id="cx-replan">Plan again</button></div>' +
      '<p class="lg-fine" style="margin-top:10px">★ new best in this browser</p></div>');
    $('cx-next').onclick = nextWall;
    $('cx-replan').onclick = function () { overlay.hide(); S.state = 'planning'; S.climb = null; };
    render();
  }
  function fell() {
    S.state = 'fell';
    const f = S.eval.fatal;
    overlay.show('<div><h2>Fell at beat ' + f.index + '</h2><p>' + cap(f.text) + '.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="cx-revise">Revise the plan</button></div>' +
      '<p class="lg-fine">The route is kept up to the fall. Click a hold on the path to trim back to it.</p></div>');
    $('cx-revise').onclick = function () { overlay.hide(); S.state = 'planning'; S.climb = null; };
    render();
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- update -------------------------------------------------------------
  function update(dt) {
    S.t += dt;
    if (S.state === 'climbing') { if (input.hit('KeyP')) { pause(); return; } stepClimb(dt); return; }
    if (S.state !== 'planning') return;
    if (input.mousePressed.left) {
      const c = Math.floor((input.mx - X0) / TILE), r = Math.floor((input.my - Y0) / TILE);
      clickCell(c, r);
    }
    if (input.mousePressed.right || input.hit('KeyZ', 'Backspace')) undo();
    if (input.hit('KeyW', 'Space')) { const e = planEnd(); if (e) addStep({ t: 'w', c: e.c, r: e.r }); }
    if (input.hit('Enter')) climb();
    if (input.hit('KeyR')) clearPlan();
    if (input.hit('KeyP')) pause();
  }

  // ---- render -------------------------------------------------------------
  function beatShown() {
    if (S.state === 'climbing' && S.climb) return S.climb.i;
    return S.plan.length ? S.plan.length : 1;   // the beat the next click would be
  }
  function climberPos() {
    const steps = S.eval ? S.eval.steps : null;
    if (S.state === 'climbing' && S.climb && steps) {
      const cl = S.climb, a = steps[cl.i - 1], b = steps[cl.i];
      if (cl.fall > 0) { const k = cl.fall; return { x: cellX(b.c) + k * 12, y: cellY(b.r) + k * k * 520, fall: true }; }
      const k = cl.t < 0.5 ? 2 * cl.t * cl.t : 1 - Math.pow(-2 * cl.t + 2, 2) / 2;
      const x = LG.lerp(cellX(a.c), cellX(b.c), k), y = LG.lerp(cellY(a.r), cellY(b.r), k);
      const hop = b.t === 'd' ? -Math.sin(k * Math.PI) * 26 : b.t === 'w' ? Math.sin(k * TAU) * 1.5 : -Math.sin(k * Math.PI) * 6;
      return { x, y: y + hop };
    }
    const e = planEnd();
    if (e) return { x: cellX(e.c), y: cellY(e.r) };
    return null;
  }
  function drawHold(c, r, type, gone) {
    const x = cellX(c), y = cellY(r);
    ctx.save(); ctx.translate(x, y);
    if (gone) ctx.globalAlpha = 0.25;
    switch (type) {
      case 'j':
        ctx.fillStyle = '#6fb37a'; ctx.beginPath(); ctx.ellipse(0, 2, 11, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0e1017'; ctx.beginPath(); ctx.ellipse(0, -1, 7, 3, 0, 0, TAU); ctx.fill(); break;
      case 'c':
        ctx.fillStyle = '#d9a23a'; ctx.fillRect(-11, -2, 22, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-11, 1, 22, 2); break;
      case 'l':
        ctx.fillStyle = '#e8eaf0'; ctx.fillRect(-15, -3, 30, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-15, 3, 30, 3);
        ctx.fillStyle = '#3fa860'; ctx.fillRect(-15, -3, 30, 2); break;
      case 'p':
        ctx.fillStyle = '#050608'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 9, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#7ad7f0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 11, 9, 0, 0, TAU); ctx.stroke(); break;
      case 'x':
        ctx.fillStyle = '#a97c5b'; ctx.beginPath(); ctx.moveTo(-11, 4); ctx.lineTo(-6, -5); ctx.lineTo(3, -3); ctx.lineTo(11, 3); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#0e1017'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(0, 2); ctx.lineTo(-2, 6); ctx.moveTo(0, 2); ctx.lineTo(5, -1); ctx.stroke(); break;
      case 'F':
        ctx.strokeStyle = '#d9a23a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#d9a23a'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill(); break;
    }
    ctx.restore();
  }
  function render() {
    const beat = beatShown();
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H);
    // the rock
    ctx.fillStyle = '#151923'; ctx.fillRect(X0, Y0, COLS * TILE, (ROWS - 1) * TILE);
    ctx.fillStyle = '#1f2432'; ctx.fillRect(X0, Y0 + (ROWS - 1) * TILE, COLS * TILE, TILE);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(X0 + c * TILE, Y0); ctx.lineTo(X0 + c * TILE, Y0 + ROWS * TILE); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(X0, Y0 + r * TILE); ctx.lineTo(X0 + COLS * TILE, Y0 + r * TILE); }
    ctx.stroke();
    // heights
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'right';
    for (let r = 0; r < ROWS - 1; r += 3) ctx.fillText((ROWS - 1 - r) * 3 + 'm', X0 - 6, cellY(r) + 3);

    // wind bands, brighter on a gust beat
    for (const band of S.level.winds) {
      const g = CX.gustAt(band, beat);
      ctx.fillStyle = g ? 'rgba(122,215,240,0.16)' : 'rgba(122,215,240,0.06)';
      ctx.fillRect(X0, Y0 + band.r0 * TILE, COLS * TILE, (band.r1 - band.r0 + 1) * TILE);
      ctx.strokeStyle = 'rgba(122,215,240,' + (g ? 0.7 : 0.25) + ')'; ctx.lineWidth = 1.5; ctx.beginPath();
      const phase = S.t * (g ? 260 : 40);
      for (let i = 0; i < (band.r1 - band.r0 + 1) * 2; i++) {
        const y = Y0 + band.r0 * TILE + 9 + i * 17, len = g ? 46 : 22;
        const x = X0 + ((phase + i * 97) % (COLS * TILE + len)) - len;
        ctx.moveTo(Math.max(X0, x), y); ctx.lineTo(Math.min(X0 + COLS * TILE, x + len), y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(122,215,240,0.8)'; ctx.font = '600 10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(g ? 'GUST' : 'wind', X0 + COLS * TILE - 4, Y0 + band.r0 * TILE + 11);
    }
    // chutes: the column, a rock icon at the top, the rock itself on its beat
    for (const ch of S.level.chutes) {
      const x = X0 + ch.c * TILE, on = CX.rockAt(ch, beat);
      ctx.fillStyle = on ? 'rgba(209,73,91,0.16)' : 'rgba(209,73,91,0.05)'; ctx.fillRect(x, Y0, TILE, (ROWS - 1) * TILE);
      ctx.fillStyle = on ? '#d1495b' : 'rgba(209,73,91,0.55)'; ctx.beginPath(); ctx.moveTo(x + TILE / 2 - 7, Y0 - 4); ctx.lineTo(x + TILE / 2 + 7, Y0 - 4); ctx.lineTo(x + TILE / 2, Y0 + 5); ctx.closePath(); ctx.fill();
      if (on) {
        const k = S.state === 'climbing' && S.climb ? S.climb.t : 0.5;
        const ry = Y0 + k * (ROWS - 1) * TILE;
        ctx.fillStyle = '#9aa3b5'; ctx.beginPath(); ctx.moveTo(x + 9, ry - 8); ctx.lineTo(x + 24, ry - 10); ctx.lineTo(x + 28, ry + 2); ctx.lineTo(x + 20, ry + 10); ctx.lineTo(x + 8, ry + 6); ctx.closePath(); ctx.fill();
      }
    }

    // holds
    const gone = new Set();
    if (S.eval) for (let i = 1; i < S.eval.steps.length; i++) { const a = S.eval.steps[i - 1], b = S.eval.steps[i]; if ((a.c !== b.c || a.r !== b.r) && cellAt(a.c, a.r) === 'x') gone.add(a.c + ',' + a.r); }
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) { const t = cellAt(c, r); if (t !== '.') drawHold(c, r, t, gone.has(c + ',' + r)); }

    // what the next click can reach
    if (S.state === 'planning') {
      if (!S.plan.length) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
        for (let c = 0; c < COLS; c++) { ctx.beginPath(); ctx.arc(cellX(c), cellY(ROWS - 1), 12, 0, TAU); ctx.stroke(); }
        ctx.setLineDash([]);
      } else if (!S.eval.fatal && !S.eval.ok) {
        const e = planEnd();
        for (const mv of CX.movesFrom(S.level, e.c, e.r)) {
          ctx.strokeStyle = mv.t === 'd' ? 'rgba(217,162,58,0.8)' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
          ctx.setLineDash(mv.t === 'd' ? [3, 3] : []);
          ctx.beginPath(); ctx.arc(cellX(mv.c), cellY(mv.r), 13, 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    // the plan
    if (S.eval) {
      const steps = S.eval.steps;
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1], b = steps[i];
        const done = S.state === 'climbing' && S.climb && i < S.climb.i;
        ctx.strokeStyle = b.fatal ? 'rgba(209,73,91,0.9)' : done ? 'rgba(255,255,255,0.25)' : b.t === 'd' ? 'rgba(217,162,58,0.85)' : 'rgba(91,141,217,0.85)';
        ctx.setLineDash(b.t === 'd' ? [5, 5] : []);
        if (b.t === 'w') { ctx.beginPath(); ctx.arc(cellX(b.c), cellY(b.r), 15, 0, TAU); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(cellX(a.c), cellY(a.r)); ctx.lineTo(cellX(b.c), cellY(b.r)); ctx.stroke(); }
      }
      ctx.setLineDash([]);
      // beat numbers at every hold the plan touches
      ctx.font = '600 9px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
      const seen = new Map();
      for (let i = 0; i < steps.length; i++) { const s = steps[i]; seen.set(s.c + ',' + s.r, i); }
      for (const [key, i] of seen) {
        const [c, r] = key.split(',').map(Number);
        ctx.fillStyle = '#0b0d14'; ctx.beginPath(); ctx.arc(cellX(c) + 12, cellY(r) - 11, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = steps[i].fatal ? '#d1495b' : '#e8eaf0'; ctx.fillText(String(i), cellX(c) + 12, cellY(r) - 8);
      }
      const f = S.eval.fatal;
      if (f) {
        const s = steps[f.index];
        ctx.strokeStyle = '#d1495b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cellX(s.c) - 9, cellY(s.r) - 9); ctx.lineTo(cellX(s.c) + 9, cellY(s.r) + 9); ctx.moveTo(cellX(s.c) + 9, cellY(s.r) - 9); ctx.lineTo(cellX(s.c) - 9, cellY(s.r) + 9); ctx.stroke();
      }
    }

    // climber
    const cp = climberPos();
    if (cp) {
      ctx.save(); ctx.translate(cp.x, cp.y);
      if (cp.fall) ctx.rotate(S.climb.fall * 6);
      ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(0, -4, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(0, 9); ctx.moveTo(-7, -9); ctx.lineTo(0, 1); ctx.lineTo(7, -9); ctx.moveTo(-6, 15); ctx.lineTo(0, 9); ctx.lineTo(6, 15); ctx.stroke();
      ctx.restore();
    }

    // stamina bar on the right and the beat readout
    const e = planEnd();
    const stam = S.state === 'climbing' && S.climb && S.eval ? S.eval.steps[Math.max(0, S.climb.i - 1)].stamina : (e ? e.stamina : CX.STAMINA);
    const bx = X0 + COLS * TILE + 26, by = Y0 + 40, bh = (ROWS - 1) * TILE - 60;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(bx, by, 10, bh);
    ctx.fillStyle = stam < 25 ? '#d1495b' : stam < 50 ? '#d9a23a' : '#3fa860'; ctx.fillRect(bx, by + bh * (1 - stam / CX.STAMINA), 10, bh * stam / CX.STAMINA);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
    ctx.fillText(String(stam), bx + 5, by + bh + 14); ctx.fillText('stam', bx + 5, by - 8);
    ctx.textAlign = 'left'; ctx.font = '600 11px ui-monospace,Menlo,monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(S.state === 'climbing' ? 'beat ' + (S.climb ? S.climb.i : 0) : 'next: beat ' + beat, X0, Y0 - 9);
    if (S.replay) { ctx.fillStyle = 'rgba(217,162,58,0.9)'; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('REPLAY' + (S.replayOld ? ' (older version)' : ''), W - 12, Y0 - 9); }

    drawTimeline(beat);
    updatePanel();
  }
  // Beat ruler: rock beats per chute, gust beats per band, the plan's beats.
  function drawTimeline(beat) {
    const y0 = Y0 + ROWS * TILE + 14, n = Math.max(24, Math.min(48, (S.eval ? S.eval.steps.length : 0) + 6));
    const x0 = X0, bw = (COLS * TILE) / n;
    ctx.font = '9px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let b = 0; b < n; b += 4) ctx.fillText(String(b), x0 + b * bw + bw / 2, y0);
    let y = y0 + 8;
    const row = (label, color, test) => {
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right'; ctx.fillText(label, x0 - 5, y + 8);
      for (let b = 0; b < n; b++) { if (test(b)) { ctx.fillStyle = color; ctx.fillRect(x0 + b * bw + 1, y, bw - 2, 9); } }
      y += 12;
    };
    S.level.chutes.forEach((ch, i) => row('rock' + (S.level.chutes.length > 1 ? ' ' + (ch.c + 1) : ''), '#d1495b', (b) => CX.rockAt(ch, b)));
    S.level.winds.forEach((band) => row('gust', '#7ad7f0', (b) => CX.gustAt(band, b)));
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'right'; ctx.fillText('plan', x0 - 5, y + 8);
    if (S.eval) for (let b = 0; b < Math.min(n, S.eval.steps.length); b++) {
      const s = S.eval.steps[b];
      ctx.fillStyle = s.fatal ? '#d1495b' : s.t === 'd' ? '#d9a23a' : s.t === 'w' ? '#8f97a8' : '#5b8dd9';
      ctx.fillRect(x0 + b * bw + 1, y, bw - 2, 9);
    }
    if (beat < n) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + beat * bw + 0.5, y0 + 7, bw - 1, y - y0 + 4); }
  }
  function updatePanel() {
    const e = planEnd();
    const stam = e ? e.stamina : CX.STAMINA;
    LG.setBar(ui.stamina, stam / CX.STAMINA, stam < 25 ? 'bad' : stam < 50 ? 'warn' : 'good');
    ui.staminav.textContent = String(stam);
    ui.beats.textContent = S.eval ? String(S.eval.steps.length - 1) : '0';
    ui.par.textContent = S.par === null ? '—' : String(S.par);
    ui.attempts.textContent = String(S.attempts);
    let status;
    if (!S.plan.length) status = 'Click a ground cell to start the route.';
    else if (S.eval.ok) status = 'Reaches the anchor at beat ' + S.eval.beats + ' with ' + S.eval.stamina + ' stamina. Press Climb.';
    else if (S.eval.fatal) status = 'Falls at beat ' + S.eval.fatal.index + ': ' + S.eval.fatal.text + '. Undo, or click an earlier hold to trim the route.';
    else status = 'Beat ' + e.beat + ' on ' + (CX.HOLDS[cellAt(e.c, e.r)] || {}).name + '. Click a ringed hold to move (dashed rings are dynos), the hold you\'re on to wait.';
    ui.status.textContent = status;
    ui.climb.disabled = !(S.state === 'planning' && S.eval && S.plan.length >= 2);
    const st = { moves: 0, dynos: 0 };
    for (const s of S.plan) if (s.t === 'm') st.moves++; else if (s.t === 'd') st.dynos++;
    const total = st.moves + st.dynos;
    ui.style.innerHTML = LG.styleBar('Static', 'Dynamic', total ? st.dynos / total : 0.5, total ? st.moves + ' static, ' + st.dynos + ' dynos' : 'The plan\'s style shows here');
  }

  // ---- flow ---------------------------------------------------------------
  function showBests() {
    const all = LG.store.get(BEST_KEY, {}), best = all[wallId()] || {};
    ui.bestBeats.textContent = best.beats !== undefined ? best.beats + ' beats' + (S.par !== null && best.beats <= S.par ? ' (par)' : '') : '—';
    ui.bestTry.textContent = best.firstTry ? 'yes' : '—';
  }
  function start(seed, tier) {
    reset(seed, tier);
    tape.begin(seed, { tier });
    ui.seed.textContent = 'wall ' + tier + '-' + seed;
    showBests(); overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function startWall(i) { const w = WALLS[i]; ui.wall.value = String(i); start(w.seed, w.tier); }
  function randomWall() { ui.wall.value = 'random'; start(LG.newSeed(), 3 + Math.floor(Math.random() * 3)); }
  function nextWall() {
    const i = WALLS.findIndex((w) => w.seed === S.seed && w.tier === S.tier);
    if (i >= 0 && i < WALLS.length - 1) startWall(i + 1); else randomWall();
  }
  function watch(rec) {
    if (rec.game !== 'crux') throw new Error('that is a ' + rec.game + ' replay');
    reset(rec.seed, rec.meta.tier || 3);
    S.replay = true; S.replayOld = rec.version !== VERSION;
    ui.seed.textContent = 'wall ' + S.tier + '-' + S.seed + ' (replay)';
    tape.load(rec);
    showBests(); overlay.hide(); input.flush(); loop.start();
  }
  tape.onEnd = function () {
    if (S.state === 'won') return;
    overlay.show('<div><h2>Replay ended</h2><p>The recording stopped here.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="cx-back">Back</button></div></div>');
    $('cx-back').onclick = function () { startWall(0); };
    render();
  };
  function pause() {
    if (S.state !== 'climbing' && S.state !== 'planning') return;
    S.paused = S.state; S.state = 'paused';
    overlay.show('<div><h2>Paused</h2><div class="lg-row" style="justify-content:center"><button class="primary" id="cx-resume">Resume</button></div></div>');
    $('cx-resume').onclick = resume;
    render(); loop.stop();
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = S.paused; overlay.hide(); input.focus(); input.flush(); loop.start();
  }

  loop = LG.loop(update, render, input, tape);
  WALLS.forEach((w, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = w.name; ui.wall.appendChild(o); });
  const ro = document.createElement('option'); ro.value = 'random'; ro.textContent = 'Random wall'; ui.wall.appendChild(ro);
  ui.wall.onchange = function () { if (this.value === 'random') randomWall(); else startWall(Number(this.value)); };
  ui.climb.onclick = function () { input.focus(); climb(); };
  ui.undo.onclick = function () { input.focus(); if (S.state === 'planning') undo(); };
  ui.wait.onclick = function () { input.focus(); if (S.state === 'planning') { const e = planEnd(); if (e) addStep({ t: 'w', c: e.c, r: e.r }); } };
  ui.clear.onclick = function () { input.focus(); if (S.state === 'planning') clearPlan(); };
  ui.random.onclick = randomWall;
  LG.replayPanel('cx-', tape, watch, $('cx-rep-status'));
  input.onBlur = function () { if (S.state === 'climbing') pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.repeat || (e.target && e.target.tagName === 'BUTTON')) return;
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && S.state === 'fell') { overlay.hide(); S.state = 'planning'; S.climb = null; }
    if (e.code === 'Enter' && S.state === 'won') nextWall();
  });

  startWall(0);
  render();

  window.__lg = window.__lg || {};
  window.__lg.crux = { get S() { return S; }, input, tape, loop, reset, update, render, start, startWall, randomWall, watch, climb, addStep, undo, clearPlan, WALLS, core: CX };
})();
