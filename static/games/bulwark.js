/* Bulwark: a bullet hell for players who would rather hold a position than
   thread a pattern. The ship is slow and tough; its directional shield absorbs
   bullets into charge, and charge buys either a beam (damage) or a barrier
   (a permanent wall that eats bullets until it wears through). Dashing drops
   the shield, moves you fast and widens the graze ring, which is the fast
   player's charge source; nothing in the game grants invulnerability. */
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
    hull: $('bw-hull'), shield: $('bw-shield'), charge: $('bw-charge'), boss: $('bw-boss'),
    time: $('bw-time'), phase: $('bw-phase'), hits: $('bw-hits'), style: $('bw-style'),
    bestTime: $('bw-best-time'), bestClean: $('bw-best-clean')
  };
  const BEST_KEY = 'lg-bulwark-best-v1';

  // ---- tuning -------------------------------------------------------------
  const T = {
    moveSpeed: 150, focusSpeed: 72, hurtR: 6, shieldR: 24, arcHalf: 65 * Math.PI / 180, grazeR: 38,
    magnetR: 80, magnetA: 800,      // the shield draws bullets in its cone onto itself
    hullMax: 100, hullRegen: 1.0, hullRegenDelay: 5,
    shieldMax: 100, shieldRegen: 20, shieldRegenDelay: 0.6, shieldBreakTime: 2.5, shieldReturn: 35,
    chargeMax: 100, absorbGain: 1.2, grazeGain: 2.5, dashGrazeMul: 3, dashGrazeR: 1.6, barrierGain: 0.5,
    beamCost: 30, beamDmg: 36, beamTime: 0.2, beamW: 10,
    barrierCost: 45, barrierHP: 180, barrierLen: 64, barrierDist: 48, barrierMax: 6,
    dashSpeed: 520, dashTime: 0.2, dashCD: 0.9,
    bossHP: 600, bossRegen: 4, bossRegenDelay: 5, bossR: 34,
    turretRate: 0.28, turretSpeed: 160
  };
  const KIND = {
    basic:   { r: 5,  power: 6,  dmg: 10, color: '#ffb347', core: '#fff3d6' },
    heavy:   { r: 7,  power: 10, dmg: 14, color: '#ff6b6b', core: '#ffe0e0' },
    turret:  { r: 4,  power: 5,  dmg: 8,  color: '#7ad7f0', core: '#e8fbff' },
    bouncer: { r: 5,  power: 6,  dmg: 10, color: '#b48cff', core: '#f1e9ff' },
    breaker: { r: 16, power: 45, dmg: 30, color: '#e06cff', core: '#ffffff' }
  };
  const TURRETS = [{ x: 0, y: 460, dir: 0 }, { x: W, y: 460, dir: Math.PI },
                   { x: 0, y: 600, dir: 0 }, { x: W, y: 600, dir: Math.PI }];

  // Each phase loops its script. Steps are cloned when entered because they
  // keep their own timers.
  const SCRIPTS = {
    1: [
      { kind: 'aimed', dur: 3.0, rate: 0.13, speed: 300 },
      { kind: 'rest', dur: 0.9 },
      { kind: 'rings', dur: 3.6, every: 1.2, n: 40, speed: 130 },
      { kind: 'rest', dur: 0.9 },
      { kind: 'spiral', dur: 4.0, arms: 2, rate: 0.05, spin: 2.4, speed: 150 },
      { kind: 'rest', dur: 1.1 }
    ],
    2: [
      { kind: 'aimed', dur: 3.0, rate: 0.12, speed: 320, turrets: true },
      { kind: 'rest', dur: 0.7 },
      { kind: 'curtain', dur: 4.0, every: 1.3, speed: 95, gap: 96 },
      { kind: 'breaker', dur: 1.6, n: 1, speed: 80 },
      { kind: 'rings', dur: 3.6, every: 1.2, n: 48, speed: 135, turrets: true },
      { kind: 'rest', dur: 1.0 }
    ],
    3: [
      { kind: 'spiral', dur: 4.0, arms: 3, rate: 0.05, spin: 3.0, speed: 160 },
      { kind: 'bouncers', dur: 2.0, n: 18, speed: 170 },
      { kind: 'curtain', dur: 3.9, every: 1.3, speed: 105, gap: 88 },
      { kind: 'breaker', dur: 2.2, n: 2, speed: 85 },
      { kind: 'rings', dur: 3.6, every: 0.9, n: 48, speed: 140, turrets: true },
      { kind: 'aimed', dur: 2.5, rate: 0.10, speed: 330 },
      { kind: 'rest', dur: 0.8 }
    ]
  };

  let rand = Math.random;
  let S = null;           // whole game state; see reset()
  let loop = null;

  function reset(seed) {
    rand = seed ? LG.rng(seed) : Math.random;
    S = {
      t: 0, state: 'ready',
      p: {
        x: W / 2, y: 600, aim: -Math.PI / 2, mouseAim: true,
        hull: T.hullMax, shield: T.shieldMax, shieldDown: 0, charge: 40,
        dash: 0, dashCD: 0, dashDx: 0, dashDy: -1, trail: [],
        lastHit: -99, lastAbsorb: -99, beam: 0, beamAng: 0, absorbFlash: 0
      },
      boss: { x: W / 2, y: 110, hp: T.bossHP, lastHit: -99, phase: 1, script: SCRIPTS[1], step: 0, cur: null,
              spin: 0, transition: 1.2, flash: 0, regenPulse: 0 },
      turretAcc: 0, bullets: [], barriers: [], particles: [],
      stats: { absorb: 0, graze: 0, barrier: 0, dmgTaken: 0, hits: 0, dashes: 0, beams: 0, barriersPlaced: 0, facing: 0 }
    };
    S.boss.cur = Object.assign({}, S.boss.script[0]);
  }

  // ---- bullets & spawning -----------------------------------------------
  function spawn(x, y, ang, speed, kind, extra) {
    const k = KIND[kind];
    const b = { x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, kind, r: k.r, power: k.power,
                dmg: k.dmg, grazed: false, bounces: 0, t: 0 };
    if (extra) Object.assign(b, extra);
    S.bullets.push(b);
  }
  function puff(x, y, color, n, speed, r) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, v = speed * (0.3 + rand() * 0.7);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + rand() * 0.3, max: 0.6, color, r: r || 2 });
    }
  }

  function runStep(step, dt) {
    const b = S.boss, p = S.p;
    step.t = (step.t || 0) + dt;
    step.acc = (step.acc || 0) + dt;
    switch (step.kind) {
      case 'aimed':
        while (step.acc >= step.rate) {
          step.acc -= step.rate;
          const a = Math.atan2(p.y - b.y, p.x - b.x) + (rand() - 0.5) * 0.05;
          spawn(b.x, b.y, a, step.speed, 'basic');
        }
        break;
      case 'rings':
        if (step.next === undefined) step.next = 0;
        if (step.t >= step.next) {
          step.next += step.every;
          const off = b.spin; b.spin += 0.37;
          for (let i = 0; i < step.n; i++) spawn(b.x, b.y, off + i * TAU / step.n, step.speed, 'basic');
        }
        break;
      case 'spiral':
        while (step.acc >= step.rate) {
          step.acc -= step.rate;
          for (let a = 0; a < step.arms; a++) spawn(b.x, b.y, b.spin + a * TAU / step.arms, step.speed, 'basic');
        }
        b.spin += step.spin * dt;
        break;
      case 'curtain':
        if (step.next === undefined) step.next = 0.2;
        if (step.t >= step.next) {
          step.next += step.every;
          const gx = 70 + rand() * (W - 140);
          for (let x = 16; x < W; x += 34) {
            if (Math.abs(x - gx) < step.gap / 2) continue;
            spawn(x, b.y + 46, Math.PI / 2, step.speed, 'heavy');
          }
        }
        break;
      case 'breaker':
        if (step.fired === undefined) { step.fired = 0; step.next = 0.3; }
        if (step.fired < step.n && step.t >= step.next) {
          step.fired++; step.next += 0.9;
          const a = Math.atan2(p.y - b.y, p.x - b.x);
          spawn(b.x, b.y + 20, a, step.speed, 'breaker');
        }
        break;
      case 'bouncers':
        if (!step.done) {
          step.done = true;
          for (let i = 0; i < step.n; i++) {
            const a = Math.PI / 2 + ((i / (step.n - 1)) - 0.5) * 2.6;
            spawn(b.x, b.y, a, step.speed * (0.85 + rand() * 0.3), 'bouncer');
          }
        }
        break;
      default: break; // rest
    }
    if (step.turrets) {
      S.turretAcc += dt;
      while (S.turretAcc >= T.turretRate) {
        S.turretAcc -= T.turretRate;
        for (const tr of TURRETS) spawn(tr.x, tr.y, tr.dir, T.turretSpeed, 'turret', { wave: rand() * TAU });
      }
    }
  }

  function startPhase(n) {
    const b = S.boss;
    b.phase = n; b.script = SCRIPTS[n]; b.step = 0; b.cur = Object.assign({}, b.script[0]);
    b.transition = 1.6; S.turretAcc = 0;
    for (const bl of S.bullets) puff(bl.x, bl.y, KIND[bl.kind].color, 1, 40, 2);
    S.bullets.length = 0;
  }

  function damageBoss(d) {
    const b = S.boss;
    b.hp -= d; b.lastHit = S.t; b.flash = 0.15;
    puff(b.x, b.y + T.bossR * 0.6, '#ffffff', 10, 140, 2);
    if (b.hp <= 0) { b.hp = 0; finish('won'); return; }
    if (b.phase === 1 && b.hp <= T.bossHP * 0.66) startPhase(2);
    else if (b.phase === 2 && b.hp <= T.bossHP * 0.33) startPhase(3);
  }

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

  // ---- update -------------------------------------------------------------
  function update(dt) {
    if (S.state !== 'running') return;
    S.t += dt;
    const p = S.p, b = S.boss, st = S.stats;

    // movement
    let mx = 0, my = 0;
    if (input.down('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.down('KeyD', 'ArrowRight')) mx += 1;
    if (input.down('KeyW', 'ArrowUp')) my -= 1;
    if (input.down('KeyS', 'ArrowDown')) my += 1;
    const ml = Math.hypot(mx, my);
    if (ml > 0) { mx /= ml; my /= ml; }
    p.dashCD = Math.max(0, p.dashCD - dt);
    if (input.hit('Space') && p.dashCD <= 0 && p.dash <= 0) {
      p.dash = T.dashTime; p.dashCD = T.dashCD; st.dashes++;
      if (ml > 0) { p.dashDx = mx; p.dashDy = my; } else { p.dashDx = Math.cos(p.aim); p.dashDy = Math.sin(p.aim); }
      p.trail.length = 0;
    }
    if (p.dash > 0) {
      p.dash -= dt;
      p.x += p.dashDx * T.dashSpeed * dt; p.y += p.dashDy * T.dashSpeed * dt;
      p.trail.push({ x: p.x, y: p.y, a: 1 });
      if (p.trail.length > 8) p.trail.shift();
    } else {
      const sp = input.down('ShiftLeft', 'ShiftRight') ? T.focusSpeed : T.moveSpeed;
      p.x += mx * sp * dt; p.y += my * sp * dt;
    }
    p.x = LG.clamp(p.x, 10, W - 10); p.y = LG.clamp(p.y, 200, H - 10);
    for (const tr of p.trail) tr.a -= dt * 4;

    // aim: the mouse owns it until a rotate key is used, and vice versa
    if (input.mouseMoved) p.mouseAim = true;
    if (input.down('KeyQ')) { p.aim -= 3.2 * dt; p.mouseAim = false; }
    if (input.down('KeyE')) { p.aim += 3.2 * dt; p.mouseAim = false; }
    if (p.mouseAim) p.aim = Math.atan2(input.my - p.y, input.mx - p.x);
    const toBoss = Math.atan2(b.y - p.y, b.x - p.x);
    if (Math.abs(wrapAngle(toBoss - p.aim)) < 35 * Math.PI / 180) st.facing += dt;

    // beam
    p.beam = Math.max(0, p.beam - dt);
    if ((input.mousePressed.left || input.hit('KeyJ')) && p.charge >= T.beamCost && p.beam <= 0) {
      p.charge -= T.beamCost; p.beam = T.beamTime; p.beamAng = p.aim; st.beams++;
      const dx = Math.cos(p.aim), dy = Math.sin(p.aim);
      const ox = b.x - p.x, oy = b.y - p.y, along = ox * dx + oy * dy;
      if (along > 0 && Math.abs(ox * dy - oy * dx) <= T.bossR + T.beamW / 2) damageBoss(T.beamDmg);
      if (S.state !== 'running') return;
    }
    // barrier
    if ((input.mousePressed.right || input.hit('KeyK')) && p.charge >= T.barrierCost) {
      p.charge -= T.barrierCost; st.barriersPlaced++;
      const cx = p.x + Math.cos(p.aim) * T.barrierDist, cy = p.y + Math.sin(p.aim) * T.barrierDist;
      const px = -Math.sin(p.aim) * T.barrierLen / 2, py = Math.cos(p.aim) * T.barrierLen / 2;
      const clampX = (v) => LG.clamp(v, 4, W - 4), clampY = (v) => LG.clamp(v, 60, H - 4);
      S.barriers.push({ x1: clampX(cx - px), y1: clampY(cy - py), x2: clampX(cx + px), y2: clampY(cy + py), hp: T.barrierHP, born: S.t });
      if (S.barriers.length > T.barrierMax) S.barriers.shift();
      puff(cx, cy, '#5b8dd9', 8, 60, 2);
    }

    // shield & hull recovery
    if (p.shieldDown > 0) {
      p.shieldDown -= dt;
      if (p.shieldDown <= 0) { p.shieldDown = 0; p.shield = T.shieldReturn; }
    } else if (S.t - p.lastAbsorb > T.shieldRegenDelay) {
      p.shield = Math.min(T.shieldMax, p.shield + T.shieldRegen * dt);
    }
    if (S.t - p.lastHit > T.hullRegenDelay) p.hull = Math.min(T.hullMax, p.hull + T.hullRegen * dt);
    p.absorbFlash = Math.max(0, p.absorbFlash - dt * 6);

    // boss
    b.x = W / 2 + 120 * Math.sin(S.t * 0.35);
    b.y = 110 + 10 * Math.sin(S.t * 0.9);
    b.flash = Math.max(0, b.flash - dt);
    if (b.transition > 0) {
      b.transition -= dt;
    } else {
      runStep(b.cur, dt);
      if (b.cur.t >= b.cur.dur) {
        b.step = (b.step + 1) % b.script.length;
        b.cur = Object.assign({}, b.script[b.step]);
      }
    }
    if (S.t - b.lastHit > T.bossRegenDelay && b.hp < T.bossHP) {
      b.hp = Math.min(T.bossHP, b.hp + T.bossRegen * dt);
      b.regenPulse += dt;
    } else b.regenPulse = 0;

    // bullets
    const shieldUp = p.shieldDown <= 0 && p.dash <= 0;
    const grazeR = p.dash > 0 ? T.grazeR * T.dashGrazeR : T.grazeR;
    const beamDx = Math.cos(p.beamAng), beamDy = Math.sin(p.beamAng);
    for (let i = S.bullets.length - 1; i >= 0; i--) {
      const bl = S.bullets[i];
      bl.t += dt;
      if (bl.kind === 'turret') bl.vy = 34 * Math.sin(bl.wave + bl.t * 5);
      // the shield pulls anything light in its cone onto itself: facing the
      // stream means absorbing the stream, so integrity is the budget to manage
      if (shieldUp && bl.kind !== 'breaker') {
        const mdx = p.x - bl.x, mdy = p.y - bl.y, md = Math.hypot(mdx, mdy);
        if (md < T.magnetR && md > 1 && Math.abs(wrapAngle(Math.atan2(-mdy, -mdx) - p.aim)) <= T.arcHalf) {
          const a = T.magnetA * dt / md; bl.vx += mdx * a; bl.vy += mdy * a;
        }
      }
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      if (bl.kind === 'bouncer' && bl.bounces < 1 &&
          ((bl.x < bl.r && bl.vx < 0) || (bl.x > W - bl.r && bl.vx > 0))) { bl.vx = -bl.vx; bl.bounces++; }
      if (bl.x < -40 || bl.x > W + 40 || bl.y < -40 || bl.y > H + 40) { S.bullets.splice(i, 1); continue; }

      // beam vaporizes whatever it touches while it lasts
      if (p.beam > 0) {
        const ox = bl.x - p.x, oy = bl.y - p.y, along = ox * beamDx + oy * beamDy;
        if (along > 0 && Math.abs(ox * beamDy - oy * beamDx) <= T.beamW / 2 + bl.r) {
          puff(bl.x, bl.y, KIND[bl.kind].core, 2, 60, 1.5);
          S.bullets.splice(i, 1); continue;
        }
      }
      // barriers
      let gone = false;
      for (let j = S.barriers.length - 1; j >= 0; j--) {
        const br = S.barriers[j];
        if (segDist(bl.x, bl.y, br.x1, br.y1, br.x2, br.y2) <= bl.r + 4) {
          if (bl.kind === 'breaker') { br.hp = 0; puff(bl.x, bl.y, '#e06cff', 24, 160, 3); }
          else { br.hp -= bl.power; const g = bl.power * T.barrierGain; p.charge = Math.min(T.chargeMax, p.charge + g); st.barrier += g; puff(bl.x, bl.y, '#9fb8e6', 2, 50, 1.5); }
          if (br.hp <= 0) { S.barriers.splice(j, 1); puff((br.x1 + br.x2) / 2, (br.y1 + br.y2) / 2, '#55617a', 10, 70, 2); }
          gone = true; break;
        }
      }
      if (gone) { S.bullets.splice(i, 1); continue; }

      // player
      const dx = bl.x - p.x, dy = bl.y - p.y, d = Math.hypot(dx, dy);
      if (shieldUp && d <= T.shieldR + bl.r && Math.abs(wrapAngle(Math.atan2(dy, dx) - p.aim)) <= T.arcHalf) {
        p.shield -= bl.power; p.lastAbsorb = S.t; p.absorbFlash = 1;
        const g = bl.power * T.absorbGain; p.charge = Math.min(T.chargeMax, p.charge + g); st.absorb += g;
        puff(bl.x, bl.y, '#8fb6ff', 4, 90, 2);
        if (p.shield <= 0) { p.shield = 0; p.shieldDown = T.shieldBreakTime; puff(p.x, p.y, '#5b8dd9', 24, 180, 3); }
        S.bullets.splice(i, 1); continue;
      }
      if (d <= T.hurtR + bl.r) {
        p.hull -= bl.dmg; p.lastHit = S.t; st.dmgTaken += bl.dmg; st.hits++;
        puff(p.x, p.y, '#ff6b6b', 12, 150, 2.5);
        S.bullets.splice(i, 1);
        if (p.hull <= 0) { p.hull = 0; finish('lost'); return; }
        continue;
      }
      if (!bl.grazed && d <= grazeR + bl.r) {
        bl.grazed = true;
        const g = T.grazeGain * (p.dash > 0 ? T.dashGrazeMul : 1);
        p.charge = Math.min(T.chargeMax, p.charge + g); st.graze += g;
        puff(bl.x, bl.y, '#ffffff', 1, 50, 1.2);
      }
    }

    for (let i = S.particles.length - 1; i >= 0; i--) {
      const q = S.particles[i];
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.95; q.vy *= 0.95;
      if (q.life <= 0) S.particles.splice(i, 1);
    }
  }

  // ---- render -------------------------------------------------------------
  function render() {
    const p = S.p, b = S.boss;
    ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 40; y < H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // the boss's zone
    ctx.fillStyle = 'rgba(209,73,91,0.05)'; ctx.fillRect(0, 0, W, 200);

    // turrets
    const turretsOn = b.transition <= 0 && b.cur && b.cur.turrets;
    for (const tr of TURRETS) {
      ctx.fillStyle = turretsOn ? '#7ad7f0' : '#2c3242';
      ctx.fillRect(tr.x === 0 ? 0 : W - 8, tr.y - 8, 8, 16);
    }

    // barriers
    for (const br of S.barriers) {
      const f = br.hp / T.barrierHP;
      ctx.strokeStyle = 'rgba(' + Math.round(91 + (85 - 91) * (1 - f)) + ',' + Math.round(141 + (97 - 141) * (1 - f)) + ',' + Math.round(217 + (122 - 217) * (1 - f)) + ',0.95)';
      ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(br.x1, br.y1); ctx.lineTo(br.x2, br.y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.15 + 0.35 * f) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(br.x1, br.y1); ctx.lineTo(br.x2, br.y2); ctx.stroke();
    }

    // boss
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.regenPulse > 0) {
      const k = (b.regenPulse % 1);
      ctx.strokeStyle = 'rgba(63,168,96,' + (0.5 * (1 - k)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, T.bossR + 6 + k * 26, 0, TAU); ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 6, 0, 0, T.bossR);
    g.addColorStop(0, b.flash > 0 ? '#ffffff' : '#ff8a9a'); g.addColorStop(1, b.flash > 0 ? '#ffd0d6' : '#8c1f2e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, T.bossR, 0, TAU); ctx.fill();
    ctx.rotate(S.t * 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const r = T.bossR * 0.55; if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.stroke();
    ctx.restore();
    if (b.transition > 0 && S.state === 'running') {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, b.transition) * 0.8 + ')';
      ctx.font = '600 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PHASE ' + b.phase, b.x, b.y + T.bossR + 22);
    }

    // bullets, batched by kind
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
      ctx.strokeStyle = 'rgba(224,108,255,' + (0.3 + 0.3 * Math.sin(bl.t * 12)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r + 5, 0, TAU); ctx.stroke();
    }

    // beam
    if (p.beam > 0) {
      const a = p.beam / T.beamTime;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.beamAng);
      ctx.fillStyle = 'rgba(255,220,120,' + (0.25 * a) + ')'; ctx.fillRect(0, -T.beamW, 1200, T.beamW * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * a) + ')'; ctx.fillRect(0, -T.beamW / 2 * a, 1200, T.beamW * a);
      ctx.restore();
    }

    // player
    for (const tr of p.trail) if (tr.a > 0) {
      ctx.fillStyle = 'rgba(223,230,245,' + (tr.a * 0.35) + ')'; ctx.beginPath(); ctx.arc(tr.x, tr.y, 8, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.dash > 0 ? T.grazeR * T.dashGrazeR : T.grazeR, 0, TAU); ctx.stroke();
    if (p.shieldDown > 0) {
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(209,73,91,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.shieldR, p.aim - T.arcHalf, p.aim + T.arcHalf); ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.dash <= 0) {
      const f = p.shield / T.shieldMax;
      ctx.strokeStyle = 'rgba(' + Math.round(140 + 115 * p.absorbFlash) + ',' + Math.round(180 + 75 * p.absorbFlash) + ',255,' + (0.3 + 0.7 * f) + ')';
      ctx.lineWidth = 3 + 3 * f;
      ctx.beginPath(); ctx.arc(p.x, p.y, T.shieldR, p.aim - T.arcHalf, p.aim + T.arcHalf); ctx.stroke();
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.aim);
    ctx.fillStyle = p.dash > 0 ? '#ffffff' : (S.t - p.lastHit < 0.25 ? '#ff9aa6' : '#dfe6f5');
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5b8dd9'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(4, -5); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(0, 0, T.hurtR, 0, TAU); ctx.fill();
    ctx.restore();

    for (const q of S.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // boss bar
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(40, 14, W - 80, 8);
    ctx.fillStyle = b.regenPulse > 0 ? '#3fa860' : '#d1495b'; ctx.fillRect(40, 14, (W - 80) * b.hp / T.bossHP, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(40 + (W - 80) * 0.33 - 1, 12, 2, 12); ctx.fillRect(40 + (W - 80) * 0.66 - 1, 12, 2, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px ui-monospace,Menlo,monospace'; ctx.textAlign = 'right';
    ctx.fillText(LG.fmtTime(S.t), W - 40, 44);
    if (b.regenPulse > 0) { ctx.textAlign = 'left'; ctx.fillStyle = '#3fa860'; ctx.fillText('boss recovering', 40, 44); }

    // HUD
    LG.setBar(ui.hull, p.hull / T.hullMax, p.hull < 30 ? 'bad' : 'good');
    LG.setBar(ui.shield, p.shield / T.shieldMax, p.shieldDown > 0 ? 'bad' : '');
    LG.setBar(ui.charge, p.charge / T.chargeMax, 'warn');
    LG.setBar(ui.boss, b.hp / T.bossHP, 'bad');
    ui.time.textContent = LG.fmtTime(S.t);
    ui.phase.textContent = String(b.phase);
    ui.hits.textContent = String(S.stats.hits);
    const st = S.stats, tot = st.absorb + st.graze + st.barrier;
    ui.style.innerHTML = LG.styleBar('Absorbed & walled', 'Grazed', tot ? st.graze / tot : 0.5, tot ? styleLabel(st) : 'Charge sources appear here');
  }

  function styleLabel(st) {
    const tot = st.absorb + st.graze + st.barrier;
    if (!tot) return '';
    const gz = st.graze / tot;
    const who = gz < 0.3 ? 'Bulwark' : gz < 0.6 ? 'Skirmisher' : 'Grazer';
    return who + ' — ' + LG.pct(st.absorb / tot) + ' absorbed, ' + LG.pct(st.barrier / tot) + ' walls, ' + LG.pct(gz) + ' grazed';
  }

  // ---- flow ---------------------------------------------------------------
  function finish(result) {
    S.state = result;
    const st = S.stats;
    const best = LG.store.get(BEST_KEY, {});
    let newTime = false, newClean = false;
    if (result === 'won') {
      if (best.time === undefined || S.t < best.time) { best.time = S.t; newTime = true; }
      if (best.hits === undefined || st.hits < best.hits) { best.hits = st.hits; newClean = true; }
      LG.store.set(BEST_KEY, best);
    }
    showBests();
    const tot = st.absorb + st.graze + st.barrier;
    overlay.show('<div>' +
      '<h2>' + (result === 'won' ? 'Boss down' : 'Hull breached') + '</h2>' +
      (result === 'won' ? '<span class="lg-tag">' + styleLabel(st).split(' — ')[0] + '</span>' : '<p>Phase ' + S.boss.phase + ', boss at ' + Math.round(S.boss.hp / T.bossHP * 100) + '%.</p>') +
      '<div class="lg-results">' +
      '<span>Time</span><b>' + LG.fmtTime(S.t) + (newTime ? ' ★' : '') + '</b>' +
      '<span>Hits taken</span><b>' + st.hits + (newClean ? ' ★' : '') + '</b>' +
      '<span>Damage taken</span><b>' + Math.round(st.dmgTaken) + '</b>' +
      '<span>Beams fired</span><b>' + st.beams + '</b>' +
      '<span>Barriers built</span><b>' + st.barriersPlaced + '</b>' +
      '<span>Dashes</span><b>' + st.dashes + '</b>' +
      '<span>Facing the boss</span><b>' + LG.pct(S.t ? st.facing / S.t : 0) + '</b>' +
      '</div>' +
      LG.styleBar('Absorbed & walled', 'Grazed', tot ? st.graze / tot : 0.5, tot ? styleLabel(st) : '') +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="bw-again">Play again</button></div>' +
      '<p class="lg-fine" style="margin-top:10px">★ new best in this browser</p></div>');
    $('bw-again').onclick = start;
    render();
    loop.stop();
  }

  function showBests() {
    const best = LG.store.get(BEST_KEY, {});
    ui.bestTime.textContent = best.time !== undefined ? LG.fmtTime(best.time) : '—';
    ui.bestClean.textContent = best.hits !== undefined ? best.hits + (best.hits === 0 ? ' (flawless)' : '') : '—';
  }

  function start() {
    reset();
    S.state = 'running';
    overlay.hide();
    input.focus();
    input.flush();
    loop.start();
  }
  function pause() {
    if (S.state !== 'running') return;
    S.state = 'paused';
    overlay.show('<div><h2>Paused</h2><p>Press P or click to resume.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="bw-resume">Resume</button></div></div>');
    $('bw-resume').onclick = resume;
    render();
    loop.stop();
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = 'running'; overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function showReady() {
    overlay.show('<div><h2>Bulwark</h2>' +
      '<p>Point the shield at what\'s coming and let it charge you. Spend charge on a beam, or on a barrier that eats bullets for as long as it lasts. Dash if you\'d rather not be hit at all.</p>' +
      '<p class="lg-fine">The boss recovers if you leave it alone for four seconds. So do you, more slowly.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="bw-start">Start</button></div></div>');
    $('bw-start').onclick = start;
  }

  loop = LG.loop(function (dt) {
    update(dt);
  }, function () {
    if (S.state === 'running' && input.hit('KeyP')) { input.flush(); pause(); return; }
    render();
    input.flush();
  });
  input.onBlur = function () { if (S.state === 'running') pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && (S.state === 'ready' || S.state === 'won' || S.state === 'lost')) start();
  });

  reset();
  showBests();
  showReady();
  render();

  // Headless hooks for tuning runs; not used by the page itself.
  window.__lg = window.__lg || {};
  window.__lg.bulwark = { get S() { return S; }, T, input, reset, update, render, finish, KIND, SCRIPTS };
})();
