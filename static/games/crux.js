/* Crux: a platformer climbed rather than run. Holding grip on rock lets you
   cling and climb on a stamina bar that only refills on the ground, on rest
   ledges and on jug holds. Anchors are checkpoints you place yourself, three
   per pitch. Wall-jumps and dashes cost no stamina at all; falls and hazards
   cost you the way back to your last anchor. */
(function () {
  'use strict';
  const LG = window.LongGame;
  const TILE = 24, COLS = 22;
  const W = 528, H = 660, TAU = LG.TAU;

  // The wall, top row first. '#' rock, '~' ice (no grip), 'c' crumbling hold,
  // 'j' jug (regains stamina while gripped), 'R' rest ledge (checkpoint,
  // refills anchors), 'S' start, 'F' summit. Generated from block
  // definitions; a climbable face always ends with open air above both the
  // wall and the climber, or the mantle would be blocked.
  const LEVEL = [
    '######################',
    '#...........F........#',
    '#.........RRRRR#.....#',
    '#.........######.....#',
    '#.........######.....#',
    '#.........######.....#',
    '#....................#',
    '#...........RRRRRRRRR#',
    '#...........##########',
    '#...........##########',
    '#...........##########',
    '#............j########',
    '#...........##########',
    '#...........##########',
    '#...........##########',
    '#............j########',
    '#...........##########',
    '#...........##########',
    '#...........##########',
    '#............j########',
    '#...........##########',
    '#...........##########',
    '#...........##########',
    '#..........###########',
    '#............j########',
    '#...........##########',
    '#...........#........#',
    '#...........#........#',
    '#...........#........#',
    '#RRR.RRRRRRR.........~',
    '####.................~',
    '####.................~',
    '#....................~',
    '#........~~~.........~',
    '#........~~~.........~',
    '######...~~~.........~',
    '#####j...~~~.........~',
    '######...~~~.........~',
    '#........~~~.........~',
    '#........~~~.........~',
    '#....................~',
    '#######..............~',
    '#######..............~',
    '#######..............~',
    '#....................#',
    '#....................#',
    '#...RRRR~~~~~~~~~~...#',
    '#...~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '##j.~~~~~~~~~~~~~~...#',
    '###.~~~~~~~~~~~~~~...#',
    '###..................#',
    '###..................#',
    '###..................#',
    '###..................#',
    '####..cc..cc..RRRR...#',
    '####..##..##..###j...#',
    '####..##..##..####...#',
    '####..##..##..####...#',
    '####..........####...#',
    '####..........###j...#',
    '####..........####...#',
    '#.............####...#',
    '#.............####...#',
    '#.............###j...#',
    '#.............####...#',
    '#.............####...#',
    '#.............####...#',
    '#................#...#',
    '#................#...#',
    '#....................#',
    '#.............RRRRRRR#',
    '#......~~..###########',
    '#......~~..###########',
    '#......~~..j##########',
    '#......~~..###########',
    '#......~~..###########',
    '#......~~..j##########',
    '#...##.....###########',
    '#.S.##.....###########',
    '######################',
  ];
  const ROWS = LEVEL.length;
  const WORLD_H = ROWS * TILE;
  // Rows are top-down here; the design notes count from the floor.
  // the chimney chute is quick and misses anyone hugging a wall; the crux
  // chute falls straight down the climbing column, so it is slower and the
  // face has notches to duck into
  const CHUTES = [{ c: 19, r: 84 - 41, min: 2.4, max: 3.6 }, { c: 11, r: 84 - 78, min: 4.6, max: 6.6 }];
  const WIND = [{ r0: 84 - 37, r1: 84 - 26 }, { r0: 84 - 54, r1: 84 - 44 }, { r0: 84 - 73, r1: 84 - 65 }];

  const canvas = document.getElementById('cx-canvas');
  const ctx = LG.setupCanvas(canvas, W, H);
  const stage = document.getElementById('cx-stage');
  const input = new LG.Input(stage, canvas, W, H);
  const overlay = LG.overlay(document.getElementById('cx-overlay'));
  const $ = (id) => document.getElementById(id);
  const ui = {
    height: $('cx-height'), time: $('cx-time'), stamina: $('cx-stamina'), staminav: $('cx-staminav'),
    anchors: $('cx-anchors'), falls: $('cx-falls'), fRest: $('cx-flag-rest'), fWind: $('cx-flag-wind'),
    fAnchor: $('cx-flag-anchor'), style: $('cx-style'), bestTime: $('cx-best-time'), bestFalls: $('cx-best-falls'), bestClean: $('cx-best-clean')
  };
  const BEST_KEY = 'lg-crux-best-v1';
  const VERSION = 2;
  const tape = new LG.Tape('crux', VERSION);

  const T = {
    w: 14, h: 20, gravity: 1400, maxFall: 520, corner: 8,
    run: 130, groundAccel: 1500, airAccel: 800, friction: 1700, iceFriction: 250,
    jumpV: 490, jumpCut: 0.45, coyote: 0.1, buffer: 0.12,
    climbUp: 55, climbDown: 85, drainIdle: 5, drainUp: 20, drainDown: 8,
    wallJumpVx: 240, wallJumpVy: 400, wallLock: 0.12, hopVy: 380, hopCost: 15, hopTime: 0.2,
    dashSpeed: 400, dashTime: 0.16, dashEndVy: 120,
    staminaMax: 100, regenGround: 30, regenRest: 60, regenJug: 45,
    anchorTime: 1.2, anchorsPerPitch: 3, respawnStamina: 0.6, climbOutCost: 10,
    hardFall: 5.5 * TILE,
    rockR: 9, rockAccel: 900, rockMaxV: 420, rockWarn: 0.7,
    windPeriod: 7, windCalm: 4.5, windWarn: 0.8, windForce: 700,
    crumbleDelay: 1.0, crumbleRegrow: 3.5
  };

  let rand = Math.random;
  let S = null, loop = null;

  // ---- tiles --------------------------------------------------------------
  function tileAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '#';
    return LEVEL[r][c];
  }
  function crumbleState(c, r) {
    const k = c + ',' + r;
    let st = S.crumble[k];
    if (!st) { st = S.crumble[k] = { t: 0, broken: 0, touched: false }; }
    return st;
  }
  function solidAt(c, r) {
    const t = tileAt(c, r);
    if (t === '#' || t === 'R' || t === 'j' || t === '~') return true;
    if (t === 'c') return crumbleState(c, r).broken <= 0;
    return false;
  }
  const grippable = (t) => t === '#' || t === 'R' || t === 'j' || t === 'c';

  function reset(seed) {
    rand = seed ? LG.rng(seed) : Math.random;
    let sx = 2 * TILE, sy = (ROWS - 2) * TILE;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (LEVEL[r][c] === 'S') { sx = c * TILE + (TILE - T.w) / 2; sy = (r + 1) * TILE - T.h; }
    S = {
      t: 0, state: 'ready', camY: 0,
      p: {
        x: sx, y: sy, vx: 0, vy: 0, onGround: true, wallDir: 0, wallTile: '.', gripping: false, facing: 1,
        stamina: T.staminaMax, dashAvail: true, dashT: 0, dashDx: 0, dashDy: 0, coyoteT: 0, bufferT: 0, wallLock: 0,
        anchoring: 0, anchorsLeft: T.anchorsPerPitch, onRest: false, onIce: false, onJug: false,
        fallFrom: sy, dead: 0, autoGrip: 0, jumpHeld: false, hopT: 0
      },
      checkpoint: { x: sx, y: sy, grip: 0, rest: true },
      anchors: [], rocks: [], particles: [], crumble: {},
      chutes: CHUTES.map((ch) => ({ c: ch.c, r: ch.r, min: ch.min, max: ch.max, timer: 0, next: 1.5 + rand() * 2 })),
      wind: { t: rand() * T.windPeriod, dir: rand() < 0.5 ? -1 : 1 },
      stats: { gripT: 0, airT: 0, groundT: 0, restT: 0, anchorT: 0, dashes: 0, wallJumps: 0, hops: 0, anchorsPlaced: 0, falls: 0, maxHeight: 0 },
      hint: { text: '', until: 0, shown: {} }
    };
    S.camY = LG.clamp(S.p.y - H * 0.6, 0, WORLD_H - H);
  }

  function puff(x, y, color, n, speed, r, life) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, v = speed * (0.3 + rand() * 0.7);
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: life || 0.5, max: life || 0.5, color, r: r || 2 });
    }
  }

  // ---- player -------------------------------------------------------------
  const EPS = 0.01;   // the body's far edges are exclusive
  function rowsSpanned(p) { return [Math.floor(p.y / TILE), Math.floor((p.y + T.h - EPS) / TILE)]; }
  function colsSpanned(p) { return [Math.floor(p.x / TILE), Math.floor((p.x + T.w - EPS) / TILE)]; }

  function moveX(p, dx) {
    p.x += dx;
    const rs = rowsSpanned(p), cs = colsSpanned(p);
    for (let r = rs[0]; r <= rs[1]; r++) {
      if (dx > 0 && solidAt(cs[1], r)) { p.x = cs[1] * TILE - T.w; p.vx = 0; break; }
      if (dx < 0 && solidAt(cs[0], r)) { p.x = (cs[0] + 1) * TILE; p.vx = 0; break; }
    }
  }
  function moveY(p, dy) {
    p.y += dy;
    const rs = rowsSpanned(p), cs = colsSpanned(p);
    for (let c = cs[0]; c <= cs[1]; c++) {
      if (dy > 0 && solidAt(c, rs[1])) { p.y = rs[1] * TILE - T.h; p.vy = 0; p.landed = true; break; }
      if (dy < 0 && solidAt(c, rs[0])) {
        // corner correction: clipping a ceiling tile by a few pixels nudges
        // you sideways past it instead of stopping the jump dead
        const overlapL = (c + 1) * TILE - p.x, overlapR = p.x + T.w - c * TILE;
        if (c === cs[0] && cs[0] !== cs[1] && overlapL <= T.corner && !solidAt(c + 1, rs[0])) { p.x += overlapL; continue; }
        if (c === cs[1] && cs[0] !== cs[1] && overlapR <= T.corner && !solidAt(c - 1, rs[0])) { p.x -= overlapR; continue; }
        if (cs[0] === cs[1]) {
          if (overlapR <= T.corner && !solidAt(c - 1, rs[0]) && !solidAt(c - 1, rs[1])) { p.x -= overlapR; continue; }
          if (overlapL <= T.corner && !solidAt(c + 1, rs[0]) && !solidAt(c + 1, rs[1])) { p.x += overlapL; continue; }
        }
        p.y = (rs[0] + 1) * TILE; p.vy = 0; break;
      }
    }
  }
  function groundInfo(p) {
    const r = Math.floor((p.y + T.h + 0.5) / TILE), cs = colsSpanned(p);
    let on = false, rest = false, ice = false;
    for (let c = cs[0]; c <= cs[1]; c++) {
      if (solidAt(c, r)) {
        on = true;
        const t = tileAt(c, r);
        if (t === 'R') rest = true;
        if (t === '~') ice = true;
        if (t === 'c') touchCrumble(c, r);
      }
    }
    return { on, rest, ice, r };
  }
  function wallInfo(p) {
    const rs = rowsSpanned(p);
    const cl = Math.floor((p.x - 1) / TILE), cr = Math.floor((p.x + T.w) / TILE);
    let left = null, right = null;
    for (let r = rs[0]; r <= rs[1]; r++) {
      if (solidAt(cl, r) && !left) left = { c: cl, r, t: tileAt(cl, r) };
      if (solidAt(cr, r) && !right) right = { c: cr, r, t: tileAt(cr, r) };
    }
    return { left, right };
  }
  function touchCrumble(c, r) { crumbleState(c, r).touched = true; }

  function die(why) {
    const p = S.p;
    if (p.dead > 0 || S.state !== 'running') return;
    p.dead = 0.7; S.stats.falls++;
    p.gripping = false; p.anchoring = 0; p.dashT = 0;
    puff(p.x + T.w / 2, p.y + T.h / 2, why === 'rock' ? '#c9c2b8' : '#ff9a6b', 16, 160, 2.5, 0.6);
  }
  function respawn() {
    const p = S.p, cp = S.checkpoint;
    p.x = cp.x; p.y = cp.y; p.vx = 0; p.vy = 0; p.dead = 0; p.fallFrom = cp.y;
    p.stamina = cp.rest ? T.staminaMax : T.staminaMax * T.respawnStamina;
    p.autoGrip = cp.grip ? 0.6 : 0;
    p.dashAvail = true;
  }

  function update(dt) {
    if (S.state !== 'running') return;
    if (input.hit('KeyP')) { pause(); return; }
    S.t += dt;
    const p = S.p, st = S.stats;

    // hazards keep moving while the climber respawns
    updateWorld(dt);
    if (p.dead > 0) { p.dead -= dt; if (p.dead <= 0) respawn(); return; }

    const left = input.down('ArrowLeft', 'KeyA'), right = input.down('ArrowRight', 'KeyD');
    const up = input.down('ArrowUp', 'KeyW'), down = input.down('ArrowDown', 'KeyS');
    const gripKey = input.down('ShiftLeft', 'ShiftRight', 'KeyX') || p.autoGrip > 0;
    const jumpHit = input.hit('Space', 'KeyZ', 'KeyK');
    const jumpHeld = input.down('Space', 'KeyZ', 'KeyK');
    const dashHit = input.hit('KeyC', 'KeyL');
    const anchorHit = input.hit('KeyV');
    const h = (right ? 1 : 0) - (left ? 1 : 0);
    if (h) p.facing = h;
    p.autoGrip = Math.max(0, p.autoGrip - dt);
    p.wallLock = Math.max(0, p.wallLock - dt);
    p.hopT = Math.max(0, p.hopT - dt);
    p.coyoteT = Math.max(0, p.coyoteT - dt);
    p.bufferT = Math.max(0, p.bufferT - dt);
    if (jumpHit) p.bufferT = T.buffer;

    const g = groundInfo(p);
    const walls = wallInfo(p);
    const wasGrounded = p.onGround;
    p.onGround = g.on && p.vy >= 0;
    p.onRest = g.rest && p.onGround; p.onIce = g.ice && p.onGround;
    // the probe can find support a step before the collision snap does, so a
    // landing is judged here, before the fall origin is reset
    if (p.onGround && !wasGrounded && !p.gripping && (g.r * TILE - T.h) - p.fallFrom > T.hardFall) { die('fall'); return; }
    // a dash comes back on real ground, not on a pocket's floor: the crux face
    // is climbed between shelters, not dashed between them
    if (p.onGround) { p.coyoteT = T.coyote; if (!pocketInfo(p)) p.dashAvail = true; p.fallFrom = p.y; }
    if (p.onRest) {
      if (!S.checkpoint.rest || S.checkpoint.y !== p.y || Math.abs(S.checkpoint.x - p.x) > TILE) {
        S.checkpoint = { x: p.x, y: p.y, grip: 0, rest: true };
      }
      p.anchorsLeft = T.anchorsPerPitch;
    }

    // which wall could be gripped
    let wall = null, wallDir = 0;
    if (walls.left && (h <= 0 || !walls.right)) { wall = walls.left; wallDir = -1; }
    if (walls.right && (h > 0 || !wall)) { wall = walls.right; wallDir = 1; }
    if (walls.left && walls.right) { wall = p.facing < 0 ? walls.left : walls.right; wallDir = p.facing; }
    p.wallDir = wall ? wallDir : 0;
    p.wallTile = wall ? wall.t : '.';
    // from the ground you start a climb by holding up; in the air, grip alone catches the wall
    const wantGrip = wall && grippable(wall.t) && gripKey && p.stamina > 0 && p.dashT <= 0 && p.hopT <= 0;
    const canGrip = wantGrip && (!p.onGround || up);

    // ---- climbing out of a pocket: a fresh press of up (or jump) puts you
    // back on the face above. Holding up through the entry doesn't count, so
    // the pocket is never skipped by accident
    const pocket = p.onGround && p.dashT <= 0 ? pocketInfo(p) : null;
    if (!pocket) p.pocketArmed = false;
    else if (!up) p.pocketArmed = true;
    if (pocket && ((up && p.pocketArmed) || p.bufferT > 0)) {
      p.bufferT = 0;
      p.x = (pocket.c + pocket.open) * TILE + (pocket.open < 0 ? TILE - T.w : 0);
      p.y = pocket.exitRow * TILE + (TILE - T.h);
      p.vx = 0; p.vy = 0; p.gripping = true; p.wallDir = -pocket.open; p.onGround = false;
      p.fallFrom = p.y; p.stamina = Math.max(0, p.stamina - T.climbOutCost); p.autoGrip = 0.3;
      st.gripT += dt;
      puff(p.x + T.w / 2, p.y + T.h, '#dfe6f5', 4, 50, 1.5, 0.3);
      if (!S.hint.shown.out) { S.hint.shown.out = true; }
      return finishStep(dt);
    }

    // ---- dash
    if (dashHit && p.dashAvail && p.dashT <= 0) {
      let dx = h, dy = (down ? 1 : 0) - (up ? 1 : 0);
      if (!dx && !dy) dx = p.facing;
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      p.dashT = T.dashTime; p.dashDx = dx; p.dashDy = dy; p.dashAvail = false; p.gripping = false;
      st.dashes++;
      puff(p.x + T.w / 2, p.y + T.h / 2, '#ffffff', 6, 80, 2, 0.3);
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDx * T.dashSpeed; p.vy = p.dashDy * T.dashSpeed;
      if (p.dashT <= 0) { p.vy = Math.min(p.vy, T.dashEndVy); p.vx *= 0.6; }
      p.gripping = false;
      st.airT += dt;     // a dash is dynamic movement for the style meter
    } else if (canGrip || (p.gripping && wantGrip)) {
      // ---- gripping: cling, climb, rest on jugs, mantle over the top
      // a dash comes back on the ground or on a jug, not on every grab, so
      // a face can't be skipped with a dash-and-catch chain
      if (!p.gripping) { p.gripping = true; if (wall.t === 'j') p.dashAvail = true; }
      p.fallFrom = p.y;
      p.vx = 0;
      p.x = wallDir > 0 ? wall.c * TILE - T.w : (wall.c + 1) * TILE;
      const onJug = wall.t === 'j';
      if (wall.t === 'c') touchCrumble(wall.c, wall.r);
      let climb = 0;
      if (up) climb = -T.climbUp; else if (down) climb = T.climbDown;
      if (onJug) { p.stamina = Math.min(T.staminaMax, p.stamina + T.regenJug * dt); p.onJug = true; p.dashAvail = true; }
      else {
        p.onJug = false;
        p.stamina -= (climb < 0 ? T.drainUp : climb > 0 ? T.drainDown : T.drainIdle) * dt;
      }
      p.vy = climb;
      st.gripT += dt;
      // mantle: the body straddles the wall's top edge. A one-tile pocket in
      // the face counts too: climbing up into it steps you inside, where the
      // rocks can't reach; climbOut() below takes you back onto the face
      const rs = rowsSpanned(p);
      if (climb < 0 && !solidAt(wall.c, rs[0]) && solidAt(wall.c, rs[1]) && !solidAt(wall.c, rs[1] - 1) &&
          (rs[1] * TILE - p.y) > 6) {
        const nx = wall.c * TILE + (TILE - T.w) / 2, ny = rs[1] * TILE - T.h;
        let free = true;
        const c0 = Math.floor(nx / TILE), c1 = Math.floor((nx + T.w - EPS) / TILE);
        for (let c = c0; c <= c1; c++) if (solidAt(c, rs[1] - 1)) free = false;
        if (free) { p.x = nx; p.y = ny; p.vy = 0; p.gripping = false; p.onGround = true; p.fallFrom = ny; }
      }
      if (p.stamina <= 0) { p.stamina = 0; p.gripping = false; }
      // jump off the wall: a hop straight up when holding toward it (or nothing), else a wall-jump
      if (p.gripping && p.bufferT > 0) {
        p.bufferT = 0;
        if (h === 0 || h === wallDir) {
          if (p.stamina >= T.hopCost) { p.vy = -T.hopVy; p.stamina -= T.hopCost; p.gripping = false; p.hopT = T.hopTime; st.hops++; }
        } else {
          p.vx = -wallDir * T.wallJumpVx; p.vy = -T.wallJumpVy; p.wallLock = T.wallLock; p.gripping = false; st.wallJumps++;
          puff(p.x + T.w / 2, p.y + T.h, '#dfe6f5', 5, 60, 1.5, 0.3);
        }
      }
    } else {
      p.gripping = false; p.onJug = false;
      // ---- ordinary platforming
      const accel = p.onGround ? T.groundAccel : T.airAccel;
      const cap = T.run * (p.onIce ? 1.25 : 1);
      if (p.wallLock <= 0) {
        if (h) {
          // input accelerates up to the run cap and never past it; momentum
          // from a dash or wall-jump above the cap is left to decay below
          const same = Math.sign(p.vx) === h;
          if (!same || Math.abs(p.vx) < cap) {
            p.vx += h * accel * dt;
            if (Math.sign(p.vx) === h && Math.abs(p.vx) > cap) p.vx = h * cap;
          }
        } else {
          const f = (p.onGround ? (p.onIce ? T.iceFriction : T.friction) : T.airAccel * 0.5) * dt;
          if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
        }
      }
      if (Math.abs(p.vx) > cap) p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx) - cap, (p.onGround && !p.onIce ? 900 : 300) * dt);
      // jump / wall-jump
      if (p.bufferT > 0) {
        if (p.onGround || p.coyoteT > 0) {
          p.vy = -T.jumpV; p.bufferT = 0; p.coyoteT = 0; p.onGround = false;
        } else if (wall && p.dashT <= 0) {
          p.vx = -wallDir * T.wallJumpVx; p.vy = -T.wallJumpVy; p.wallLock = T.wallLock; p.bufferT = 0; st.wallJumps++;
          puff(p.x + T.w / 2, p.y + T.h, '#dfe6f5', 5, 60, 1.5, 0.3);
        }
      }
      // letting go of jump early caps the rise: short hop or full jump
      if (!jumpHeld && p.hopT <= 0 && p.vy < -T.jumpV * T.jumpCut) p.vy = -T.jumpV * T.jumpCut;
      // wind, only in the air
      if (!p.onGround) {
        const r = Math.floor((p.y + T.h / 2) / TILE);
        if (windGust() && inWind(r)) p.vx += S.wind.dir * T.windForce * dt;
      }
      p.vy = Math.min(T.maxFall, p.vy + T.gravity * dt);
      // sliding down an unclimbable wall is slower than falling
      if (wall && !p.onGround && p.vy > 0 && h === wallDir && wall.t !== '~') p.vy = Math.min(p.vy, 160);
      if (p.onGround) { st.groundT += dt; if ((p.onRest || p.onJug) && p.anchoring <= 0) st.restT += dt; } else st.airT += dt;
    }

    // ---- stamina & anchors
    if (p.onGround && !p.gripping) p.stamina = Math.min(T.staminaMax, p.stamina + (p.onRest ? T.regenRest : T.regenGround) * dt);
    const still = (p.onGround || p.gripping) && h === 0 && !up && !down && p.dashT <= 0;
    if (anchorHit && still && p.anchorsLeft > 0 && p.anchoring <= 0) p.anchoring = T.anchorTime;
    if (p.anchoring > 0) {
      if (!still) p.anchoring = 0;
      else {
        p.anchoring -= dt; st.anchorT += dt;
        if (p.anchoring <= 0) {
          p.anchoring = 0; p.anchorsLeft--; st.anchorsPlaced++;
          const a = { x: p.x, y: p.y, grip: p.gripping ? wallDir : 0, rest: false };
          S.anchors.push(a); S.checkpoint = a;
          puff(p.x + T.w / 2, p.y + T.h / 2, '#d9a23a', 8, 70, 2, 0.4);
        }
      }
    }

    return finishStep(dt);
  }

  // the part of a step after movement decisions: integrate, hazards, camera, hints
  function finishStep(dt) {
    const p = S.p, st = S.stats;
    // ---- integrate
    p.landed = false;
    moveX(p, p.vx * dt);
    moveY(p, p.vy * dt);
    if (p.landed && !p.onGround && !p.gripping) {
      if (p.y - p.fallFrom > T.hardFall) { die('fall'); return; }
      p.fallFrom = p.y;
      p.onGround = true;
      puff(p.x + T.w / 2, p.y + T.h, '#8f97a8', 3, 40, 1.5, 0.3);
    }
    if (!p.onGround && !p.gripping && p.vy < 0) p.fallFrom = Math.min(p.fallFrom, p.y);
    if (p.y > WORLD_H) { die('fall'); return; }

    // hazards touching the climber
    const cx = p.x + T.w / 2, cy = p.y + T.h / 2;
    for (const rk of S.rocks) {
      const dx = Math.max(p.x, Math.min(rk.x, p.x + T.w)) - rk.x, dy = Math.max(p.y, Math.min(rk.y, p.y + T.h)) - rk.y;
      if (dx * dx + dy * dy < T.rockR * T.rockR) { die('rock'); return; }
    }
    const rs = rowsSpanned(p), cs = colsSpanned(p);
    for (let r = rs[0]; r <= rs[1]; r++) for (let c = cs[0]; c <= cs[1]; c++) if (tileAt(c, r) === 'F') { finish(); return; }

    const height = (WORLD_H - (p.y + T.h)) / TILE;
    st.maxHeight = Math.max(st.maxHeight, height);
    // three one-time hints, each at the moment it applies
    const hint = S.hint;
    if (!hint.shown.grip && S.t > 1.5) { hint.shown.grip = true; showHint('Hold Shift against rock to grip it, then \u2191 to climb. Space jumps.', 8); }
    if (!hint.shown.jug && p.onJug) { hint.shown.jug = true; showHint('A yellow jug: hang here and stamina comes back.', 5); }
    if (!hint.shown.hop && p.gripping && st.gripT > 2.5) { hint.shown.hop = true; showHint('Space on the wall: hold away for a free wall-jump, or hold toward it for a hop straight up (15 stamina).', 8); }
    if (!hint.shown.anchor && p.onRest && height > 5) { hint.shown.anchor = true; showHint('Rest ledge: stamina and anchors refill. V plants an anchor anywhere you stand still; a fall brings you back to it.', 8); }
    if (!hint.shown.fall && st.falls === 1) { hint.shown.fall = true; showHint('Back at your last checkpoint. Anchors placed before a hard section make falls cheap.', 6); }
    if (!hint.shown.crux && p.onRest && height >= 55 && height <= 57) { hint.shown.crux = true; showHint('The crux: climb the wall on the right. The pockets in it are shelter from the rocks; press \u2191 again to climb out of one.', 9); }
    if (!hint.shown.pocket && p.onGround && pocketInfo(p)) { hint.shown.pocket = true; showHint('A pocket: the rocks can\'t reach you here. Rest, then press \u2191 again to climb out onto the face above.', 8); }
    // camera: keep the climber in the lower-middle, looking up
    const target = LG.clamp(p.y - H * 0.58, 0, WORLD_H - H);
    S.camY += (target - S.camY) * (1 - Math.exp(-6 * dt));
  }

  function showHint(text, secs) { S.hint.text = text; S.hint.until = S.t + secs; }

  // A pocket: standing inside the face with rock overhead and one open side.
  // The exit is the first row above where the open side is clear and the
  // face beside it is rock (a roof over the open side is skipped).
  function pocketInfo(p) {
    const c = Math.floor((p.x + T.w / 2) / TILE), r = Math.floor((p.y + T.h / 2) / TILE);
    if (!solidAt(c, r - 1)) return null;
    const openL = !solidAt(c - 1, r), openR = !solidAt(c + 1, r);
    if (openL === openR) return null;
    const open = openL ? -1 : 1;
    for (let rr = r - 1; rr >= r - 4; rr--) {
      if (!solidAt(c + open, rr) && solidAt(c, rr)) return { c, r, open, exitRow: rr };
    }
    return null;
  }

  // ---- world: rocks, wind, crumbling holds ---------------------------------
  function windPhase() { const t = S.wind.t % T.windPeriod; return t < T.windCalm ? 'calm' : t < T.windCalm + T.windWarn ? 'warn' : 'gust'; }
  function windGust() { return windPhase() === 'gust'; }
  function inWind(r) { for (const b of WIND) if (r >= b.r0 && r <= b.r1) return true; return false; }

  function updateWorld(dt) {
    const prev = Math.floor(S.wind.t / T.windPeriod);
    S.wind.t += dt;
    if (Math.floor(S.wind.t / T.windPeriod) !== prev) S.wind.dir = rand() < 0.5 ? -1 : 1;

    for (const ch of S.chutes) {
      ch.timer += dt;
      if (ch.timer >= ch.next) {
        ch.timer = 0; ch.next = ch.min + rand() * (ch.max - ch.min);
        S.rocks.push({ x: ch.c * TILE + TILE / 2, y: ch.r * TILE + TILE / 2, vy: 0, spin: rand() * TAU });
      } else if (ch.next - ch.timer < T.rockWarn && rand() < 20 * dt) {
        S.particles.push({ x: ch.c * TILE + TILE / 2 + (rand() - 0.5) * 16, y: ch.r * TILE + TILE, vx: (rand() - 0.5) * 30, vy: 20 + rand() * 40, life: 0.5, max: 0.5, color: '#b9b0a2', r: 2 });
      }
    }
    for (let i = S.rocks.length - 1; i >= 0; i--) {
      const rk = S.rocks[i];
      rk.vy = Math.min(T.rockMaxV, rk.vy + T.rockAccel * dt);
      rk.y += rk.vy * dt; rk.spin += 4 * dt;
      const c = Math.floor(rk.x / TILE), r = Math.floor((rk.y + T.rockR) / TILE);
      if (solidAt(c, r) || rk.y > WORLD_H) {
        puff(rk.x, rk.y + T.rockR, '#b9b0a2', 8, 90, 2, 0.4);
        S.rocks.splice(i, 1);
      }
    }
    const p = S.p;
    for (const k in S.crumble) {
      const c = S.crumble[k];
      if (c.broken > 0) {
        c.broken -= dt;
        if (c.broken <= 0) {
          // never regrow into the climber: wait until they have moved off
          const kc = k.split(','), tx = kc[0] * TILE, ty = kc[1] * TILE;
          const overlaps = p.x < tx + TILE && p.x + T.w > tx && p.y < ty + TILE && p.y + T.h > ty;
          if (overlaps) c.broken = 0.2; else { c.broken = 0; c.t = 0; }
        }
      }
      else if (c.touched) { c.t += dt; if (c.t >= T.crumbleDelay) { c.broken = T.crumbleRegrow; const kc = k.split(','); puff((+kc[0] + 0.5) * TILE, (+kc[1] + 0.5) * TILE, '#8a7a66', 8, 70, 2, 0.4); } }
      else c.t = Math.max(0, c.t - dt * 2);
      c.touched = false;
    }
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const q = S.particles[i]; q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 200 * dt;
      if (q.life <= 0) S.particles.splice(i, 1);
    }
  }

  // ---- render -------------------------------------------------------------
  function hash(c, r) { let h = (c * 73856093) ^ (r * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  function drawTile(c, r, t, camY) {
    const x = c * TILE, y = r * TILE - camY;
    const hv = hash(c, r);
    if (t === '~') {
      ctx.fillStyle = '#9fd3e6'; ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + hv * 0.2) + ')'; ctx.fillRect(x + 3, y + 3, 8, 3); ctx.fillRect(x + 12, y + 14, 6, 2);
      if (!solidAt(c, r - 1)) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x, y, TILE, 2); }
      return;
    }
    if (t === 'c') {
      const st = S.crumble[c + ',' + r];
      if (st && st.broken > 0) { ctx.strokeStyle = 'rgba(138,122,102,0.35)'; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4); ctx.setLineDash([]); return; }
      const shake = st && st.t > 0.25 ? (Math.random() - 0.5) * 2 : 0;   // visual only: never the seeded generator
      ctx.fillStyle = '#6b5a4a'; ctx.fillRect(x + shake, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(x + 4 + shake, y + 20); ctx.lineTo(x + 10 + shake, y + 12); ctx.lineTo(x + 8 + shake, y + 6); ctx.moveTo(x + 10 + shake, y + 12); ctx.lineTo(x + 19 + shake, y + 9); ctx.stroke();
      return;
    }
    // rock, rest ledge, jug
    const shade = 0.85 + hv * 0.3;
    const base = t === 'R' ? [86, 104, 88] : [74, 79, 92];
    ctx.fillStyle = 'rgb(' + Math.round(base[0] * shade) + ',' + Math.round(base[1] * shade) + ',' + Math.round(base[2] * shade) + ')';
    ctx.fillRect(x, y, TILE, TILE);
    if (!solidAt(c, r - 1)) { ctx.fillStyle = t === 'R' ? '#8fc79a' : 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, TILE, 3); }
    if (!solidAt(c - 1, r)) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, 2, TILE); }
    if (!solidAt(c + 1, r)) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + TILE - 2, y, 2, TILE); }
    if (hv > 0.7) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 6 + hv * 8, y + 8 + hv * 6, 5, 3); }
    if (t === 'j') {
      ctx.fillStyle = '#e8c63a'; ctx.beginPath();
      const side = !solidAt(c + 1, r) ? 1 : -1;   // notch on the exposed side
      const ex = side > 0 ? x + TILE : x;
      ctx.moveTo(ex, y + 6); ctx.lineTo(ex - side * 9, y + 12); ctx.lineTo(ex, y + 18); ctx.closePath(); ctx.fill();
    }
  }

  function drawFlag(c, r, camY) {
    const x = c * TILE + TILE / 2, y = r * TILE - camY + TILE;
    ctx.strokeStyle = '#e8eaf0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 30); ctx.stroke();
    ctx.fillStyle = '#d1495b'; ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x + 14 + Math.sin(S.t * 6) * 2, y - 24); ctx.lineTo(x, y - 18); ctx.closePath(); ctx.fill();
  }

  function render() {
    const p = S.p, camY = S.camY;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0e1220'); grad.addColorStop(1, '#161b2b');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    // distant haze bands for a sense of height
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < 6; i++) { const y = ((i * 380 - camY * 0.3) % (H + 200) + H + 200) % (H + 200) - 100; ctx.fillRect(0, y, W, 60); }

    // wind bands
    const phase = windPhase();
    for (const b of WIND) {
      const y0 = b.r0 * TILE - camY, y1 = (b.r1 + 1) * TILE - camY;
      if (y1 < 0 || y0 > H) continue;
      ctx.fillStyle = phase === 'gust' ? 'rgba(122,215,240,0.06)' : 'rgba(122,215,240,0.025)';
      ctx.fillRect(0, y0, W, y1 - y0);
      if (phase !== 'calm') {
        const strength = phase === 'gust' ? 1 : 0.4;
        ctx.strokeStyle = 'rgba(200,235,245,' + (0.35 * strength) + ')'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const hv = hash(i, b.r0);
          const len = 30 + hv * 50 * strength;
          let x = ((hv * 900 + S.wind.dir * S.t * (200 + 300 * strength)) % (W + 120) + W + 120) % (W + 120) - 60;
          const y = y0 + ((hash(b.r0, i) * (y1 - y0)) | 0);
          ctx.moveTo(x, y); ctx.lineTo(x - S.wind.dir * len, y);
        }
        ctx.stroke();
      }
    }

    // tiles in view
    const r0 = Math.max(0, Math.floor(camY / TILE)), r1 = Math.min(ROWS - 1, Math.floor((camY + H) / TILE));
    for (let r = r0; r <= r1; r++) for (let c = 0; c < COLS; c++) {
      const t = LEVEL[r][c];
      if (t === '.' || t === 'S') continue;
      if (t === 'F') { drawFlag(c, r, camY); continue; }
      drawTile(c, r, t, camY);
    }
    // chute mouths
    for (const ch of S.chutes) {
      const x = ch.c * TILE + TILE / 2, y = ch.r * TILE - camY;
      if (y < -30 || y > H + 30) continue;
      ctx.fillStyle = '#0a0c12'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI); ctx.fill();
      const soon = ch.next - ch.timer < T.rockWarn;
      if (soon) { ctx.strokeStyle = 'rgba(255,200,120,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI); ctx.stroke(); }
    }

    // rope from the last anchor
    if (S.checkpoint && !S.checkpoint.rest) {
      const a = S.checkpoint;
      const ax = a.x + T.w / 2, ay = a.y + T.h / 2 - camY, px = p.x + T.w / 2, py = p.y + T.h / 2 - camY;
      ctx.strokeStyle = 'rgba(217,162,58,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + px) / 2, Math.max(ay, py) + 12, px, py); ctx.stroke();
    }
    for (const a of S.anchors) {
      const x = a.x + T.w / 2 + (a.grip ? a.grip * 9 : 0), y = a.y + T.h / 2 - camY;
      if (y < -20 || y > H + 20) continue;
      ctx.fillStyle = '#d9a23a'; ctx.beginPath(); ctx.moveTo(x - 3, y - 6); ctx.lineTo(x + 3, y - 6); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f0d58a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 8, 3, 0, TAU); ctx.stroke();
    }

    // rocks
    for (const rk of S.rocks) {
      const y = rk.y - camY;
      ctx.save(); ctx.translate(rk.x, y); ctx.rotate(rk.spin);
      ctx.fillStyle = '#8a8378'; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a = i * TAU / 7, rr = T.rockR * (0.85 + hash(i, 3) * 0.3); if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(-3, -3, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // climber
    if (p.dead <= 0) {
      const x = p.x, y = p.y - camY;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 2, y + T.h - 2, T.w - 4, 3);
      ctx.fillStyle = p.dashT > 0 ? '#ffffff' : '#f08a2e';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y + 6, T.w, T.h - 6, 3); ctx.fill(); } else ctx.fillRect(x, y + 6, T.w, T.h - 6);
      ctx.fillStyle = '#f5d3b3'; ctx.beginPath(); ctx.arc(x + T.w / 2, y + 4.5, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2a1e'; ctx.fillRect(x + T.w / 2 - 4.5, y, 9, 3);
      // arms toward the wall when gripping, legs when running
      ctx.strokeStyle = '#f5d3b3'; ctx.lineWidth = 2.5; ctx.beginPath();
      if (p.gripping) {
        const wx = p.wallDir > 0 ? x + T.w + 2 : x - 2;
        ctx.moveTo(x + T.w / 2, y + 9); ctx.lineTo(wx, y + 4); ctx.moveTo(x + T.w / 2, y + 11); ctx.lineTo(wx, y + 14);
      } else {
        ctx.moveTo(x + T.w / 2 - 4, y + 9); ctx.lineTo(x + T.w / 2 - 6 - Math.sin(S.t * 12) * (Math.abs(p.vx) > 20 ? 3 : 0), y + 15);
        ctx.moveTo(x + T.w / 2 + 4, y + 9); ctx.lineTo(x + T.w / 2 + 6 + Math.sin(S.t * 12) * (Math.abs(p.vx) > 20 ? 3 : 0), y + 15);
      }
      ctx.stroke();
      if (p.stamina < T.staminaMax) {
        const f = p.stamina / T.staminaMax;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 5, y - 8, T.w + 10, 4);
        ctx.fillStyle = f > 0.5 ? '#3fa860' : f > 0.25 ? '#d9a23a' : '#d1495b'; ctx.fillRect(x - 5, y - 8, (T.w + 10) * f, 4);
      }
      if (p.anchoring > 0) {
        const f = 1 - p.anchoring / T.anchorTime;
        ctx.strokeStyle = '#d9a23a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + T.w / 2, y + T.h / 2, 16, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      }
      if (!p.dashAvail && !p.onGround && !p.gripping) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + T.w / 2 - 1, y + T.h + 2, 2, 2); }
    }

    for (const q of S.particles) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y - camY, q.r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;

    // a rock coming down your column (or the one beside your pocket): a
    // marker at the top of the screen
    for (const rk of S.rocks) {
      if (Math.abs(rk.x - (p.x + T.w / 2)) > 40 || rk.y > p.y) continue;
      const ry = rk.y - camY;
      if (ry > 0) continue;   // already on screen
      ctx.fillStyle = 'rgba(255,90,90,0.9)'; ctx.beginPath(); ctx.moveTo(rk.x - 9, 6); ctx.lineTo(rk.x + 9, 6); ctx.lineTo(rk.x, 20); ctx.closePath(); ctx.fill();
      ctx.font = '600 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ROCK', rk.x, 32);
    }
    // the current hint, if any
    if (S.hint.text && S.t < S.hint.until && S.state === 'running') {
      const a = Math.min(1, (S.hint.until - S.t) / 0.6);
      ctx.globalAlpha = a; ctx.fillStyle = 'rgba(10,12,18,0.8)'; ctx.fillRect(12, H - 46, W - 24, 34);
      ctx.fillStyle = '#e8eaf0'; ctx.font = '13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(S.hint.text, W / 2, H - 25, W - 40);
      ctx.globalAlpha = 1;
    }
    if (S.replay || S.hud) {
      const line = Math.max(0, Math.floor((WORLD_H - (p.y + T.h)) / TILE)) + ' m · ' + LG.fmtTime(S.t) + ' · stamina ' + Math.round(p.stamina) + ' · anchors ' + p.anchorsLeft + ' · falls ' + S.stats.falls;
      ctx.font = '13px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(8, 8, ctx.measureText(line).width + 16, 22);
      ctx.fillStyle = '#fff'; ctx.fillText(line, 16, 24);
      if (S.replay) { ctx.fillStyle = 'rgba(217,162,58,0.9)'; ctx.font = '700 12px sans-serif'; ctx.fillText('REPLAY' + (S.replayOld ? ' (older version)' : ''), 16, 46); }
    }
    // height ruler on the right edge
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'right';
    for (let r = r0; r <= r1; r++) { const hgt = ROWS - 1 - r; if (hgt % 10 === 0) { const y = (r + 1) * TILE - camY; ctx.fillRect(W - 10, y - 1, 6, 1); ctx.fillText(String(hgt), W - 12, y + 3); } }

    renderHUD();
  }

  function renderHUD() {
    const p = S.p, st = S.stats;
    ui.height.textContent = String(Math.max(0, Math.floor((WORLD_H - (p.y + T.h)) / TILE)));
    ui.time.textContent = LG.fmtTime(S.t);
    LG.setBar(ui.stamina, p.stamina / T.staminaMax, p.stamina > 50 ? 'good' : p.stamina > 25 ? 'warn' : 'bad');
    ui.staminav.textContent = String(Math.round(p.stamina));
    const pips = ui.anchors.children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < p.anchorsLeft);
    ui.falls.textContent = st.falls + (st.falls === 1 ? ' fall' : ' falls');
    ui.fRest.classList.toggle('on', p.onRest);
    ui.fWind.classList.toggle('on', windPhase() !== 'calm' && inWind(Math.floor((p.y + T.h / 2) / TILE)));
    ui.fAnchor.classList.toggle('on', p.anchoring > 0);
    const sty = styleOf();
    ui.style.innerHTML = LG.styleBar('Static', 'Dynamic', sty.t, sty.note);
  }

  // The meter describes the strategy, not only the motion: time on the rock,
  // resting on ledges and jugs, and standing still to place anchors all count
  // as the patient side; time in the air (jumps, hops, dashes) as the dynamic one.
  function styleOf() {
    const st = S.stats, patient = st.gripT + st.restT + st.anchorT, total = patient + st.airT;
    if (total < 1) return { who: 'Static', t: 0.5, note: 'Time on the rock, resting and anchoring vs time in the air appears here' };
    const air = st.airT / total;
    const who = air < 0.4 ? 'Static' : air > 0.6 ? 'Dynamic' : 'Mixed';
    return { who, t: air, note: who + ' — ' + LG.pct(1 - air) + ' on the rock, resting or anchoring (' + st.anchorsPlaced + ' anchor' + (st.anchorsPlaced === 1 ? '' : 's') + '), ' + LG.pct(air) + ' in the air' };
  }

  // ---- flow ---------------------------------------------------------------
  function finish() {
    S.state = 'won';
    const st = S.stats, sty = styleOf();
    tape.finish({ t: +S.t.toFixed(2), falls: st.falls });
    const best = LG.store.get(BEST_KEY, {});
    let newTime = false, newFalls = false, newClean = false;
    if (!S.replay) {
      if (best.time === undefined || S.t < best.time) { best.time = S.t; newTime = true; }
      if (best.falls === undefined || st.falls < best.falls) { best.falls = st.falls; newFalls = true; }
      if (st.falls === 0 && (best.clean === undefined || S.t < best.clean)) { best.clean = S.t; newClean = true; }
      LG.store.set(BEST_KEY, best);
    }
    showBests();
    overlay.show('<div><h2>Summit</h2><span class="lg-tag">' + sty.who + '</span>' +
      '<div class="lg-results">' +
      '<span>Time</span><b>' + LG.fmtTime(S.t) + (newTime ? ' ★' : '') + '</b>' +
      '<span>Falls</span><b>' + st.falls + (newFalls ? ' ★' : '') + (newClean ? ' · fastest clean ★' : '') + '</b>' +
      '<span>Anchors placed</span><b>' + st.anchorsPlaced + '</b>' +
      '<span>Wall-jumps</span><b>' + st.wallJumps + '</b>' +
      '<span>Dashes</span><b>' + st.dashes + '</b>' +
      '<span>Hops</span><b>' + st.hops + '</b>' +
      '</div>' +
      LG.styleBar('Static', 'Dynamic', sty.t, sty.note) +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="cx-again">Climb again</button></div>' +
      '<p class="lg-fine" style="margin-top:10px">★ new best in this browser</p></div>');
    $('cx-again').onclick = start;
    render();
    loop.stop();
  }
  function showBests() {
    const best = LG.store.get(BEST_KEY, {});
    ui.bestTime.textContent = best.time !== undefined ? LG.fmtTime(best.time) : '—';
    ui.bestFalls.textContent = best.falls !== undefined ? best.falls + (best.falls === 0 ? ' (clean)' : '') : '—';
    ui.bestClean.textContent = best.clean !== undefined ? LG.fmtTime(best.clean) : '—';
  }
  function start() {
    const seed = LG.newSeed();
    reset(seed); tape.begin(seed, {}); S.state = 'running';
    overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function watch(rec) {
    if (rec.game !== 'crux') throw new Error('that is a ' + rec.game + ' replay');
    reset(rec.seed);
    S.state = 'running'; S.replay = true; S.replayOld = rec.version !== VERSION;
    tape.load(rec);
    overlay.hide(); input.flush(); loop.start();
  }
  tape.onEnd = function () {
    if (S.state !== 'running') return;
    S.state = 'paused';
    overlay.show('<div><h2>Replay ended</h2><p>The recording stopped here.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="cx-back">Back</button></div></div>');
    $('cx-back').onclick = function () { reset(); showReady(); render(); };
    render();
  };
  function pause() {
    if (S.state !== 'running') return;
    S.state = 'paused';
    overlay.show('<div><h2>Paused</h2><p>Press P or click to resume.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="cx-resume">Resume</button></div></div>');
    $('cx-resume').onclick = resume;
    render(); loop.stop();
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = 'running'; overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function showReady() {
    overlay.show('<div><h2>Crux</h2>' +
      '<p>' + (ROWS - 2) + ' metres of wall. Hold Shift on rock to grip, ↑ to climb. Rest on the yellow jugs.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="cx-start">Start</button></div>' +
      '<p class="lg-fine" style="margin-top:12px">V plants an anchor: your own checkpoint. Falls over five metres, rocks and the wind will use it.</p></div>');
    $('cx-start').onclick = start;
  }

  loop = LG.loop(update, render, input, tape);
  LG.replayPanel('cx-', tape, watch, $('cx-rep-status'));
  input.onBlur = function () { pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.repeat || (e.target && e.target.tagName === 'BUTTON')) return;   // held keys don't count; buttons handle their own Enter/Space
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && (S.state === 'ready' || S.state === 'won')) start();
  });

  reset();
  showBests();
  showReady();
  render();

  window.__lg = window.__lg || {};
  window.__lg.crux = { get S() { return S; }, T, LEVEL, TILE, input, tape, loop, reset, update, render, finish, start, watch, solidAt,
    fly(c, r) { S.p.x = c * TILE + (TILE - T.w) / 2; S.p.y = (r + 1) * TILE - T.h; S.p.vx = S.p.vy = 0; S.camY = LG.clamp(S.p.y - H * 0.58, 0, WORLD_H - H); } };
})();
