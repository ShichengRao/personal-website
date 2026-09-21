/* Bulwark: a siege, not a bullet hell. The boss fills the arena with slow
   weather: bullets that take eight to twelve seconds to cross the screen and
   are never aimed at you, streams that telegraph for seconds before they
   flow, breakers that crawl toward your walls, bastions that rise between
   you and the boss. You click where to stand and drag where to build; the
   shield faces the boss on its own and the beam fires itself. A hit costs
   charge, not life. Nothing here needs to be answered in under a second,
   and the question the game asks is whether your structure holds. */
(function () {
  'use strict';
  const LG = window.LongGame;
  const W = 640, H = 720, TAU = LG.TAU;
  const canvas = document.getElementById('bw-canvas');
  const ctx = LG.setupCanvas(canvas, W, H);
  const stage = document.getElementById('bw-stage');
  const input = new LG.Input(stage, canvas, W, H);
  const overlay = LG.overlay(document.getElementById('bw-overlay'));
  const $ = (id) => document.getElementById(id);
  const ui = {
    integrity: $('bw-integrity'), heat: $('bw-heat'), charge: $('bw-charge'), boss: $('bw-boss'),
    time: $('bw-time'), phase: $('bw-phase'), hits: $('bw-hits'), income: $('bw-income'), auto: $('bw-auto'), style: $('bw-style'),
    bestTime: $('bw-best-time'), bestClean: $('bw-best-clean'), bestWalls: $('bw-best-walls')
  };
  const BEST_KEY = 'lg-bulwark-best-v2';
  const VERSION = 3;                          // bump when tuning changes enough to break old replays
  const tape = new LG.Tape('bulwark', VERSION);

  // ---- tuning -------------------------------------------------------------
  const T = {
    walkSpeed: 130, hurtR: 7, shieldR: 24, arcHalf: 70 * Math.PI / 180, magnetR: 84, magnetA: 900,
    keepOut: 250,                              // the player never goes above this line
    chargeMax: 300, chargeStart: 60,
    integrityMax: 100, hitGrace: 0.5,          // a hit spends charge; the shortfall comes off integrity
    heatMax: 100, heatDecay: 22, overloadTime: 2.5, overloadReset: 40,
    shieldGain: 4, wallGain: 1,
    beamCost: 60, beamReserve: 30, beamDmg: 8, beamTime: 0.25, beamW: 10, beamKillW: 18,   // auto-fire keeps a wall's worth in hand
    wallCost: 30, wallHP: 80, wallMin: 40, wallMax: 150, wallMax_n: 8, wallKeepOut: 200,
    bossHP: 100, bossR: 34,
    skyCloses: 240, skyStep: 30,               // after 4:00 the drizzle doubles every 30 s
    drizzle: { 1: 9, 2: 12, 3: 15 }, drizzleSpeed: [58, 78], drizzleCone: 55 * Math.PI / 180,
    sweepEvery: 10, sweepWarn: 2, sweepDur: 2.4, sweepRate: 22, sweepSpeed: 115,
    streamEvery: { 1: 13, 2: 11, 3: 9 }, streamWarn: 3.5, streamDur: 4, streamRate: 16, streamSpeed: 100,
    breakerEvery: 14, breakerSpeed: 42, breakerR: 14,
    bastionEvery: 16, bastionWarn: 3, bastionLife: 18, bastionLen: 140, bastionHP: 2, bastionMax: 2,
    wallMemory: 8
  };
  // hit: charge a hit costs; heat: what absorbing one adds to the shield
  const KIND = {
    basic:   { r: 5,  power: 1, hit: 12, heat: 6,  color: '#ffb347', core: '#fff3d6' },
    sweep:   { r: 5,  power: 1, hit: 12, heat: 8,  color: '#7ad7f0', core: '#e8fbff' },
    stream:  { r: 6,  power: 1, hit: 25, heat: 14, color: '#ff6b6b', core: '#ffe0e0' },
    breaker: { r: 14, power: 999, hit: 40, heat: 0, color: '#e06cff', core: '#ffffff' }
  };

  let rand = Math.random;
  let S = null, loop = null;

  function reset(seed) {
    rand = seed ? LG.rng(seed) : Math.random;
    S = {
      t: 0, state: 'ready', replay: false,
      p: { x: W / 2, y: 560, tx: W / 2, ty: 560, aim: -Math.PI / 2, charge: T.chargeStart, integrity: T.integrityMax,
           heat: 0, overload: 0, lastHit: -99, beam: 0, beamAng: 0, beamLen: 0, absorbFlash: 0, auto: true },
      boss: { x: W / 2, y: 100, hp: T.bossHP, phase: 1, flash: 0, drizzleAcc: 0,
              sweep: null, nextSweep: 6, stream: null, nextStream: 8, nextBreaker: 20, nextBastion: 14 },
      bullets: [], walls: [], bastions: [], particles: [], drag: null, msg: '', msgUntil: 0,
      stats: { absorb: 0, wallIncome: 0, hits: 0, hitsBy: {}, dmgTaken: 0, beams: 0, wallsBuilt: 0, wallsLost: 0, breakersKilled: 0, overloads: 0 }
    };
  }

  // ---- helpers --------------------------------------------------------------
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }
  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(d) < 1e-9) return false;
    const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function say(text, dur) { S.msg = text; S.msgUntil = S.t + (dur || 2); }
  function puff(x, y, color, n, speed, r) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, v = speed * (0.3 + rand() * 0.7);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + rand() * 0.3, max: 0.6, color, r: r || 2 });
    }
  }
  function spawn(x, y, ang, speed, kind, extra) {
    const k = KIND[kind];
    const b = { x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, kind, r: k.r, power: k.power, t: 0 };
    if (extra) Object.assign(b, extra);
    S.bullets.push(b);
  }
  function gain(n, source) {
    S.p.charge = Math.min(T.chargeMax, S.p.charge + n);
    if (source === 'shield') S.stats.absorb += n; else S.stats.wallIncome += n;
  }
  function phaseOf(hp) { return hp > T.bossHP * 0.66 ? 1 : hp > T.bossHP * 0.33 ? 2 : 3; }

  // ---- the player's decisions --------------------------------------------
  function wallEndpoints(x1, y1, x2, y2) {
    let dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) { dx = 1; dy = 0; len = 1; }
    const L = LG.clamp(len, T.wallMin, T.wallMax);
    return { x1, y1, x2: x1 + dx / len * L, y2: y1 + dy / len * L, len: L };
  }
  function wallAllowed(e) {
    const b = S.boss;
    if (segDist(b.x, b.y, e.x1, e.y1, e.x2, e.y2) < T.wallKeepOut) return 'too close to the boss';
    if (S.walls.length >= T.wallMax_n) return 'eight walls is the limit';
    if (S.p.charge < T.wallCost) return 'not enough charge';
    return null;
  }
  function buildWall(e) {
    S.walls.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, hp: T.wallHP, income: 0, born: S.t });
    S.p.charge -= T.wallCost; S.stats.wallsBuilt++;
    puff((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, '#5b8dd9', 10, 60, 2);
  }
  function fireBeam() {
    const p = S.p, b = S.boss;
    if (p.charge < T.beamCost || p.beam > 0) return false;
    p.charge -= T.beamCost; p.beam = T.beamTime; S.stats.beams++;
    const ang = Math.atan2(b.y - p.y, b.x - p.x); p.beamAng = ang;
    // the first bastion across the line takes the shot instead of the boss
    let hit = null, hitD = Infinity;
    for (const bs of S.bastions) if (bs.up && segsCross(p.x, p.y, b.x, b.y, bs.x1, bs.y1, bs.x2, bs.y2)) {
      const d = segDist(p.x, p.y, bs.x1, bs.y1, bs.x2, bs.y2); if (d < hitD) { hitD = d; hit = bs; }
    }
    const reach = hit ? hitD : Math.hypot(b.x - p.x, b.y - p.y);
    p.beamLen = reach;
    // breakers along the beam die
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const bl = S.bullets[i];
      if (bl.kind !== 'breaker') continue;
      const along = (bl.x - p.x) * Math.cos(ang) + (bl.y - p.y) * Math.sin(ang);
      if (along > 0 && along < reach && segDist(bl.x, bl.y, p.x, p.y, p.x + Math.cos(ang) * reach, p.y + Math.sin(ang) * reach) < T.beamKillW + bl.r) {
        S.bullets.splice(i, 1); S.stats.breakersKilled++; puff(bl.x, bl.y, '#e06cff', 14, 120, 3);
      }
    }
    if (hit) { hit.hp--; puff(p.x + Math.cos(ang) * reach, p.y + Math.sin(ang) * reach, '#d1495b', 8, 80, 2); if (hit.hp <= 0) S.bastions.splice(S.bastions.indexOf(hit), 1); say(hit.hp > 0 ? 'the bastion took the beam' : 'bastion down'); return true; }
    b.hp = Math.max(0, b.hp - T.beamDmg); b.flash = 0.15;
    puff(b.x, b.y, '#ffd0d6', 10, 120, 3);
    return true;
  }

  // ---- the boss's plan -----------------------------------------------------
  function drizzleRate() {
    const base = T.drizzle[S.boss.phase];
    const late = S.t > T.skyCloses ? Math.pow(2, 1 + Math.floor((S.t - T.skyCloses) / T.skyStep)) : 1;
    return base * late;
  }
  // The stream goes for whatever earns you the most: the wall with the most
  // recent income, or you if you have none.
  function streamTarget() {
    let best = null, bestInc = 15;
    for (const w of S.walls) if (w.income > bestInc) { bestInc = w.income; best = w; }
    if (best) return { x: (best.x1 + best.x2) / 2, y: (best.y1 + best.y2) / 2, wall: true };
    return { x: S.p.x, y: S.p.y, wall: false };
  }
  function bossStep(dt) {
    const b = S.boss, p = S.p;
    b.x = W / 2 + 170 * Math.sin(S.t * 0.28); b.y = 100 + 8 * Math.sin(S.t * 0.9);
    b.phase = phaseOf(b.hp);
    b.flash = Math.max(0, b.flash - dt);
    // drizzle: never aimed, always falling
    b.drizzleAcc += drizzleRate() * dt;
    while (b.drizzleAcc >= 1) {
      b.drizzleAcc -= 1;
      const a = Math.PI / 2 + (rand() * 2 - 1) * T.drizzleCone;
      spawn(b.x + (rand() - 0.5) * 30, b.y + 20, a, T.drizzleSpeed[0] + rand() * (T.drizzleSpeed[1] - T.drizzleSpeed[0]), 'basic');
    }
    // sweep: a fan that wipes across the sky, announced by a moving line
    if (!b.sweep && S.t >= b.nextSweep) b.sweep = { t: 0, dir: rand() < 0.5 ? 1 : -1, acc: 0 };
    if (b.sweep) {
      const sw = b.sweep; sw.t += dt;
      const k = (sw.t - T.sweepWarn) / T.sweepDur;
      sw.ang = Math.PI / 2 + sw.dir * (k * 2 - 1) * 60 * Math.PI / 180;
      if (sw.t >= T.sweepWarn) {
        sw.acc += T.sweepRate * dt;
        while (sw.acc >= 1) { sw.acc -= 1; spawn(b.x, b.y + 20, sw.ang + (rand() - 0.5) * 0.06, T.sweepSpeed, 'sweep'); }
      }
      if (sw.t >= T.sweepWarn + T.sweepDur) { b.sweep = null; b.nextSweep = S.t + T.sweepEvery; }
    }
    // stream: telegraphed, then a torrent at a fixed point
    if (!b.stream && S.t >= b.nextStream) { const tg = streamTarget(); b.stream = { t: 0, x: tg.x, y: tg.y, wall: tg.wall, acc: 0, ox: b.x, oy: b.y }; }
    if (b.stream) {
      const st = b.stream; st.t += dt;
      if (st.t < T.streamWarn) { st.ox = b.x; st.oy = b.y; }      // the lane follows the boss until it flows
      else {
        st.acc += T.streamRate * dt;
        const ang = Math.atan2(st.y - st.oy, st.x - st.ox);
        while (st.acc >= 1) { st.acc -= 1; spawn(st.ox, st.oy + 10, ang + (rand() - 0.5) * 0.05, T.streamSpeed, 'stream'); }
      }
      if (st.t >= T.streamWarn + T.streamDur) { b.stream = null; b.nextStream = S.t + T.streamEvery[b.phase]; }
    }
    // breakers crawl at the nearest wall from phase 2
    if (b.phase >= 2 && S.t >= b.nextBreaker) {
      b.nextBreaker = S.t + T.breakerEvery;
      spawn(b.x, b.y + 30, Math.PI / 2, T.breakerSpeed, 'breaker', { homing: true });
    }
    // bastions rise between the boss and wherever you are standing
    if (b.phase >= 2 && S.t >= b.nextBastion && S.bastions.length < T.bastionMax) {
      b.nextBastion = S.t + T.bastionEvery;
      const ang = Math.atan2(p.y - b.y, p.x - b.x), d = 150, cx = b.x + Math.cos(ang) * d, cy = b.y + Math.sin(ang) * d;
      const px = -Math.sin(ang), py = Math.cos(ang), L = T.bastionLen / 2;
      S.bastions.push({ x1: cx - px * L, y1: cy - py * L, x2: cx + px * L, y2: cy + py * L, t: 0, up: false, hp: T.bastionHP });
    }
    for (let i = S.bastions.length - 1; i >= 0; i--) {
      const bs = S.bastions[i]; bs.t += dt;
      if (!bs.up && bs.t >= T.bastionWarn) bs.up = true;
      if (bs.t >= T.bastionWarn + T.bastionLife) S.bastions.splice(i, 1);
    }
  }

  // ---- update -------------------------------------------------------------
  function update(dt) {
    if (S.state !== 'running') return;
    if (!S.replay && input.hit('KeyP')) { pause(); return; }
    if (!S.replay && input.hit('KeyR')) { start(); return; }
    S.t += dt;
    const p = S.p, b = S.boss, st = S.stats;
    if (S.msgUntil < S.t) S.msg = '';

    // decisions: a click is a destination, a right-drag is a wall, F and
    // Space are the beam
    if (input.mousePressed.left) { p.tx = LG.clamp(input.mx, 12, W - 12); p.ty = LG.clamp(input.my, T.keepOut, H - 12); }
    if (input.mousePressed.right) S.drag = { x: input.mx, y: input.my };
    if (S.drag && !input.mouseDown.right) {
      const e = wallEndpoints(S.drag.x, S.drag.y, input.mx, input.my), why = wallAllowed(e);
      if (why) say(why); else buildWall(e);
      S.drag = null;
    }
    if (input.hit('KeyF')) { p.auto = !p.auto; say(p.auto ? 'beam fires itself above ' + (T.beamCost + T.beamReserve) + ' charge' : 'beam on Space only'); }
    if (input.hit('Space')) fireBeam();
    if (p.auto && p.charge >= T.beamCost + T.beamReserve && p.beam <= 0) fireBeam();

    // walk
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d > 1) { const s = Math.min(d, T.walkSpeed * dt); p.x += dx / d * s; p.y += dy / d * s; }
    p.aim = Math.atan2(b.y - p.y, b.x - p.x);
    p.beam = Math.max(0, p.beam - dt);
    p.absorbFlash = Math.max(0, p.absorbFlash - dt * 6);

    // heat
    if (p.overload > 0) { p.overload -= dt; if (p.overload <= 0) { p.overload = 0; p.heat = T.overloadReset; } }
    else p.heat = Math.max(0, p.heat - T.heatDecay * dt);
    const shieldUp = p.overload <= 0;

    bossStep(dt);
    for (const w of S.walls) w.income *= Math.exp(-dt / T.wallMemory);

    // bullets
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const bl = S.bullets[i];
      bl.t += dt;
      if (bl.homing) {
        let tx = p.x, ty = p.y, best = Infinity;
        for (const w of S.walls) { const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2, dd = Math.hypot(mx - bl.x, my - bl.y); if (dd < best) { best = dd; tx = mx; ty = my; } }
        const a = Math.atan2(ty - bl.y, tx - bl.x); bl.vx = Math.cos(a) * T.breakerSpeed; bl.vy = Math.sin(a) * T.breakerSpeed;
      }
      // the shield's pull
      if (shieldUp && bl.kind !== 'breaker') {
        const ddx = p.x - bl.x, ddy = p.y - bl.y, dd = Math.hypot(ddx, ddy);
        if (dd < T.magnetR && dd > 1 && Math.abs(wrapAngle(Math.atan2(-ddy, -ddx) - p.aim)) < T.arcHalf) {
          const f = T.magnetA * (1 - dd / T.magnetR) * dt; bl.vx += ddx / dd * f; bl.vy += ddy / dd * f;
        }
      }
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      if (bl.x < -30 || bl.x > W + 30 || bl.y > H + 30 || bl.y < -40) { S.bullets.splice(i, 1); continue; }
      // walls absorb; a breaker demolishes
      let gone = false;
      for (let j = S.walls.length - 1; j >= 0 && !gone; j--) {
        const w = S.walls[j];
        if (segDist(bl.x, bl.y, w.x1, w.y1, w.x2, w.y2) <= bl.r + 4) {
          if (bl.kind === 'breaker') { S.walls.splice(j, 1); st.wallsLost++; puff(bl.x, bl.y, '#e06cff', 20, 140, 3); say('a breaker took a wall'); }
          else { w.hp -= bl.power; w.income += T.wallGain; gain(T.wallGain, 'wall'); puff(bl.x, bl.y, '#5b8dd9', 1, 40, 1.5); if (w.hp <= 0) { S.walls.splice(j, 1); st.wallsLost++; puff((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, '#5b8dd9', 14, 100, 2); } }
          gone = true;
        }
      }
      if (gone) { S.bullets.splice(i, 1); continue; }
      const ddx = bl.x - p.x, ddy = bl.y - p.y, dd = Math.hypot(ddx, ddy);
      if (bl.kind !== 'breaker' && shieldUp && dd <= T.shieldR + bl.r && Math.abs(wrapAngle(Math.atan2(ddy, ddx) - p.aim)) < T.arcHalf) {
        gain(T.shieldGain, 'shield'); p.absorbFlash = 1; p.heat += KIND[bl.kind].heat;
        if (p.heat >= T.heatMax) { p.heat = T.heatMax; p.overload = T.overloadTime; st.overloads++; say('shield overloaded: three seconds open', 3); }
        S.bullets.splice(i, 1); continue;
      }
      if (dd <= T.hurtR + bl.r) {
        S.bullets.splice(i, 1);
        if (S.t - p.lastHit < T.hitGrace) continue;
        p.lastHit = S.t; st.hits++; st.hitsBy[bl.kind] = (st.hitsBy[bl.kind] || 0) + 1;
        const cost = KIND[bl.kind].hit;
        const fromCharge = Math.min(p.charge, cost), short = cost - fromCharge;
        p.charge -= fromCharge; p.integrity -= short; st.dmgTaken += short;
        puff(p.x, p.y, short > 0 ? '#ff6b6b' : '#ffb347', 10, 120, 2.5);
        if (p.integrity <= 0) { p.integrity = 0; finish('lost'); return; }
      }
    }
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const q = S.particles[i];
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.95; q.vy *= 0.95;
      if (q.life <= 0) S.particles.splice(i, 1);
    }
    if (b.hp <= 0) finish('won');
  }

  // ---- render -------------------------------------------------------------
  function render() {
    const p = S.p, b = S.boss;
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 40; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 40; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(209,73,91,0.05)'; ctx.fillRect(0, 0, W, T.keepOut);
    ctx.strokeStyle = 'rgba(209,73,91,0.18)'; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(0, T.keepOut); ctx.lineTo(W, T.keepOut); ctx.stroke(); ctx.setLineDash([]);

    // shadows: what each wall keeps off the ground below it
    ctx.fillStyle = 'rgba(91,141,217,0.07)';
    for (const w of S.walls) {
      const l1 = Math.hypot(w.x1 - b.x, w.y1 - b.y) || 1, l2 = Math.hypot(w.x2 - b.x, w.y2 - b.y) || 1, R = 1400;
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
      ctx.lineTo(w.x2 + (w.x2 - b.x) / l2 * R, w.y2 + (w.y2 - b.y) / l2 * R); ctx.lineTo(w.x1 + (w.x1 - b.x) / l1 * R, w.y1 + (w.y1 - b.y) / l1 * R);
      ctx.closePath(); ctx.fill();
    }
    // the stream's lane while it is only a warning
    if (b.stream) {
      const st = b.stream, k = st.t / T.streamWarn;
      const ang = Math.atan2(st.y - st.oy, st.x - st.ox), L = 1100;
      ctx.save(); ctx.translate(st.ox, st.oy); ctx.rotate(ang);
      ctx.fillStyle = st.t < T.streamWarn ? 'rgba(255,107,107,' + (0.06 + 0.1 * (Math.sin(S.t * 10) * 0.5 + 0.5) * Math.min(1, k + 0.3)) + ')' : 'rgba(255,107,107,0.05)';
      ctx.fillRect(0, -14, L, 28);
      ctx.restore();
      if (st.t < T.streamWarn) {
        ctx.strokeStyle = 'rgba(255,107,107,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(st.x, st.y, 22 + 6 * Math.sin(S.t * 8), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,107,107,0.9)'; ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('stream in ' + (T.streamWarn - st.t).toFixed(1) + 's', st.x, st.y - 30);
      }
    }
    // the sweep's line while it is only a warning
    if (b.sweep && b.sweep.t < T.sweepWarn) {
      const sw = b.sweep, a0 = Math.PI / 2 - sw.dir * 60 * Math.PI / 180;
      ctx.strokeStyle = 'rgba(122,215,240,' + (0.25 + 0.35 * (Math.sin(S.t * 12) * 0.5 + 0.5)) + ')'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(a0) * 900, b.y + Math.sin(a0) * 900); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(122,215,240,0.9)'; ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('sweep ' + (sw.dir > 0 ? '→' : '←') + ' in ' + (T.sweepWarn - sw.t).toFixed(1) + 's', b.x, b.y + T.bossR + 40);
    }
    // the wall a drag would build
    if (S.drag && S.state === 'running') {
      const e = wallEndpoints(S.drag.x, S.drag.y, input.mx, input.my), why = wallAllowed(e);
      ctx.strokeStyle = why ? 'rgba(209,73,91,0.6)' : 'rgba(91,141,217,0.5)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); ctx.setLineDash([]);
      if (why) { ctx.fillStyle = 'rgba(209,73,91,0.9)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(why, (e.x1 + e.x2) / 2, Math.min(e.y1, e.y2) - 10); }
    }
    // walls
    for (const w of S.walls) {
      const f = w.hp / T.wallHP;
      ctx.strokeStyle = 'rgba(91,141,217,' + (0.5 + 0.5 * f) + ')'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.15 + 0.4 * f) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    }
    // bastions
    for (const bs of S.bastions) {
      ctx.lineCap = 'round';
      if (!bs.up) { ctx.strokeStyle = 'rgba(209,73,91,' + (0.3 + 0.4 * (Math.sin(S.t * 9) * 0.5 + 0.5)) + ')'; ctx.lineWidth = 8; ctx.setLineDash([5, 7]); }
      else { ctx.strokeStyle = bs.hp > 1 ? '#8c1f2e' : 'rgba(140,31,46,0.55)'; ctx.lineWidth = 9; }
      ctx.beginPath(); ctx.moveTo(bs.x1, bs.y1); ctx.lineTo(bs.x2, bs.y2); ctx.stroke(); ctx.setLineDash([]);
      if (bs.up) { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bs.x1, bs.y1); ctx.lineTo(bs.x2, bs.y2); ctx.stroke(); }
    }

    // boss
    ctx.save(); ctx.translate(b.x, b.y);
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, T.bossR);
    g.addColorStop(0, b.flash > 0 ? '#ffffff' : '#ff8a9a'); g.addColorStop(1, b.flash > 0 ? '#ffd0d6' : '#8c1f2e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, T.bossR, 0, TAU); ctx.fill();
    ctx.rotate(S.t * 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6, r = T.bossR * 0.55; if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.stroke(); ctx.restore();

    // bullets
    for (const kind in KIND) {
      const k = KIND[kind];
      ctx.fillStyle = k.color; ctx.beginPath();
      for (const bl of S.bullets) if (bl.kind === kind) { ctx.moveTo(bl.x + bl.r, bl.y); ctx.arc(bl.x, bl.y, bl.r, 0, TAU); }
      ctx.fill();
      ctx.fillStyle = k.core; ctx.beginPath();
      for (const bl of S.bullets) if (bl.kind === kind) { const r = bl.r * 0.45; ctx.moveTo(bl.x + r, bl.y); ctx.arc(bl.x, bl.y, r, 0, TAU); }
      ctx.fill();
    }
    for (const bl of S.bullets) if (bl.kind === 'breaker') {
      ctx.strokeStyle = 'rgba(224,108,255,' + (0.3 + 0.3 * Math.sin(bl.t * 8)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r + 5, 0, TAU); ctx.stroke();
    }
    // beam
    if (p.beam > 0) {
      const a = p.beam / T.beamTime;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.beamAng);
      ctx.fillStyle = 'rgba(255,220,120,' + (0.25 * a) + ')'; ctx.fillRect(0, -T.beamW, p.beamLen, T.beamW * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * a) + ')'; ctx.fillRect(0, -T.beamW / 2 * a, p.beamLen, T.beamW * a);
      ctx.restore();
    }
    // destination marker
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, 8, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.tx, p.ty); ctx.stroke(); ctx.setLineDash([]);
    }
    // player
    if (p.overload > 0) {
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(209,73,91,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.shieldR, p.aim - T.arcHalf, p.aim + T.arcHalf); ctx.stroke(); ctx.setLineDash([]);
    } else {
      const heat = p.heat / T.heatMax;
      ctx.strokeStyle = 'rgba(' + Math.round(140 + 115 * Math.max(heat, p.absorbFlash)) + ',' + Math.round(180 - 60 * heat + 75 * p.absorbFlash) + ',' + Math.round(255 - 150 * heat) + ',0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.shieldR, p.aim - T.arcHalf, p.aim + T.arcHalf); ctx.stroke();
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.aim);
    ctx.fillStyle = S.t - p.lastHit < 0.25 ? '#ff9aa6' : '#dfe6f5';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5b8dd9'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(0, 0, T.hurtR, 0, TAU); ctx.fill();
    ctx.restore();
    for (const q of S.particles) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;

    // boss bar and clock
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(40, 14, W - 80, 8);
    ctx.fillStyle = '#d1495b'; ctx.fillRect(40, 14, (W - 80) * b.hp / T.bossHP, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(40 + (W - 80) * 0.34 - 1, 12, 2, 12); ctx.fillRect(40 + (W - 80) * 0.67 - 1, 12, 2, 12);
    ctx.fillStyle = S.t > T.skyCloses ? '#d1495b' : 'rgba(255,255,255,0.6)'; ctx.font = '12px ui-monospace,Menlo,monospace'; ctx.textAlign = 'right';
    ctx.fillText(LG.fmtTime(S.t) + (S.t > T.skyCloses ? '  sky closing' : ''), W - 40, 44);
    if (S.msg) { ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 13px sans-serif'; ctx.fillText(S.msg, W / 2, H - 22); }
    if (S.replay || S.hud) {
      const bars = [['integrity', p.integrity / T.integrityMax, '#3fa860'], ['heat', p.heat / T.heatMax, p.overload > 0 ? '#d1495b' : '#7ad7f0'], ['charge', p.charge / T.chargeMax, '#d9a23a']];
      ctx.font = '11px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left';
      bars.forEach(function (bar, i) {
        const y = H - 80 + i * 18;
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(bar[0], 14, y + 9);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(80, y, 120, 8);
        ctx.fillStyle = bar[2]; ctx.fillRect(80, y, 120 * LG.clamp(bar[1], 0, 1), 8);
      });
      if (S.replay) { ctx.fillStyle = 'rgba(217,162,58,0.9)'; ctx.font = '700 12px sans-serif'; ctx.fillText('REPLAY' + (S.replayOld ? ' (older version)' : ''), 14, H - 88); }
    }
    // HUD
    LG.setBar(ui.integrity, p.integrity / T.integrityMax, p.integrity < 30 ? 'bad' : 'good');
    LG.setBar(ui.heat, p.heat / T.heatMax, p.overload > 0 ? 'bad' : p.heat > 70 ? 'warn' : 'cool');
    LG.setBar(ui.charge, p.charge / T.chargeMax, 'warn');
    LG.setBar(ui.boss, b.hp / T.bossHP, 'bad');
    ui.time.textContent = LG.fmtTime(S.t);
    ui.phase.textContent = String(b.phase);
    ui.hits.textContent = String(S.stats.hits);
    ui.auto.textContent = p.auto ? 'auto' : 'manual';
    const st = S.stats, tot = st.absorb + st.wallIncome;
    ui.income.textContent = tot ? Math.round(st.absorb) + ' / ' + Math.round(st.wallIncome) : '0 / 0';
    ui.style.innerHTML = LG.styleBar('Walls', 'Shield', tot ? st.absorb / tot : 0.5, tot ? styleLabel(st) : 'Where the charge comes from appears here');
  }
  function styleLabel(st) {
    const tot = st.absorb + st.wallIncome; if (!tot) return '';
    const sh = st.absorb / tot;
    const who = sh < 0.35 ? 'Engineer' : sh < 0.65 ? 'Skirmisher' : 'Rusher';
    return who + ' — ' + LG.pct(1 - sh) + ' from walls, ' + LG.pct(sh) + ' from the shield';
  }

  // ---- flow ---------------------------------------------------------------
  function finish(result) {
    S.state = result;
    const st = S.stats;
    tape.finish({ result, t: +S.t.toFixed(2), hits: st.hits, walls: st.wallsBuilt });
    const best = LG.store.get(BEST_KEY, {});
    let newTime = false, newClean = false, newWalls = false;
    if (result === 'won' && !S.replay) {
      if (best.time === undefined || S.t < best.time) { best.time = S.t; newTime = true; }
      if (best.hits === undefined || st.hits < best.hits) { best.hits = st.hits; newClean = true; }
      const tot = st.absorb + st.wallIncome;
      if (tot && st.wallIncome / tot >= 0.65 && (best.walls === undefined || S.t < best.walls)) { best.walls = S.t; newWalls = true; }
      LG.store.set(BEST_KEY, best);
    }
    showBests();
    const tot = st.absorb + st.wallIncome;
    overlay.show('<div>' +
      '<h2>' + (result === 'won' ? 'Boss down' : 'Structure failed') + '</h2>' +
      (result === 'won' ? '<span class="lg-tag">' + styleLabel(st).split(' — ')[0] + '</span>' : '<p>Phase ' + S.boss.phase + ', boss at ' + Math.round(S.boss.hp) + '%.</p>') +
      '<div class="lg-results">' +
      '<span>Time</span><b>' + LG.fmtTime(S.t) + (newTime ? ' ★' : '') + '</b>' +
      '<span>Hits taken</span><b>' + st.hits + (newClean ? ' ★' : '') + '</b>' +
      '<span>Integrity lost</span><b>' + Math.round(st.dmgTaken) + '</b>' +
      '<span>Beams</span><b>' + st.beams + '</b>' +
      '<span>Walls built / lost</span><b>' + st.wallsBuilt + ' / ' + st.wallsLost + '</b>' +
      '<span>Breakers beamed</span><b>' + st.breakersKilled + '</b>' +
      '<span>Overloads</span><b>' + st.overloads + '</b>' +
      '<span>Charge from walls</span><b>' + Math.round(st.wallIncome) + (newWalls ? ' · fastest engineer ★' : '') + '</b>' +
      '</div>' +
      LG.styleBar('Walls', 'Shield', tot ? st.absorb / tot : 0.5, tot ? styleLabel(st) : '') +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="bw-again">Play again</button></div>' +
      '<p class="lg-fine" style="margin-top:10px">★ new best in this browser</p></div>');
    $('bw-again').onclick = start;
    render();
    loop.stop();
  }
  function showBests() {
    const best = LG.store.get(BEST_KEY, {});
    ui.bestTime.textContent = best.time !== undefined ? LG.fmtTime(best.time) : '—';
    ui.bestClean.textContent = best.hits !== undefined ? String(best.hits) : '—';
    ui.bestWalls.textContent = best.walls !== undefined ? LG.fmtTime(best.walls) : '—';
  }
  function start() {
    const seed = LG.newSeed();
    reset(seed);
    tape.begin(seed, {});
    S.state = 'running';
    overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function watch(rec) {
    if (rec.game !== 'bulwark') throw new Error('that is a ' + rec.game + ' replay');
    reset(rec.seed);
    S.state = 'running'; S.replay = true; S.replayOld = rec.version !== VERSION;
    tape.load(rec);
    overlay.hide(); input.flush(); loop.start();
  }
  tape.onEnd = function () {
    if (S.state !== 'running') return;
    S.state = 'paused';
    overlay.show('<div><h2>Replay ended</h2><p>The recording stopped here.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="bw-back">Back</button></div></div>');
    $('bw-back').onclick = function () { reset(); showReady(); render(); };
    render();
  };
  function pause() {
    if (S.state !== 'running') return;
    S.state = 'paused';
    overlay.show('<div><h2>Paused</h2><p>Press P or click to resume.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="bw-resume">Resume</button></div></div>');
    $('bw-resume').onclick = resume;
    render(); loop.stop();
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = 'running'; overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function showReady() {
    overlay.show('<div><h2>Bulwark</h2>' +
      '<p>The weather is slow and it is never aimed at you. Stand where it is thin, build where it is thick, and let the beam fire itself.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="bw-start">Start</button></div>' +
      '<p class="lg-fine" style="margin-top:12px">Click to walk. Drag with the right button to build a wall (30 charge). The beam costs 60 and fires whenever it has it.</p></div>');
    $('bw-start').onclick = start;
  }

  loop = LG.loop(update, render, input, tape);
  $('bw-restart').onclick = function () { start(); };
  LG.replayPanel('bw-', tape, watch, $('bw-rep-status'));
  input.onBlur = function () { if (S.state === 'running') pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.repeat || (e.target && e.target.tagName === 'BUTTON')) return;
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && (S.state === 'ready' || S.state === 'won' || S.state === 'lost')) start();
  });

  reset();
  showBests();
  showReady();
  render();

  window.__lg = window.__lg || {};
  window.__lg.bulwark = { get S() { return S; }, T, input, tape, loop, reset, update, render, finish, start, watch, KIND, buildWall, wallEndpoints, wallAllowed };
})();
