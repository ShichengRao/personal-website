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
    '####..........####...#',
    '####..........###j...#',
    '#.............####...#',
    '#.............####...#',
    '#.............####...#',
    '#.............####...#',
    '#.............###j...#',
    '#.............####...#',
    '#.............####...#',
    '#.............####...#',
    '#....................#',
    '#................RRRR#',
    '#................#####',
    '#................#####',
    '#................#####',
    '#............###.#####',
    '#............###.#####',
    '#............j##.#####',
    '#.......##...###.#####',
    '#.S.....##...###.#####',
    '######################',
  ];
  const ROWS = LEVEL.length;
  const WORLD_H = ROWS * TILE;
  // Rows are top-down here; the design notes count from the floor.
  // the chimney chute is quick and misses anyone hugging a wall; the crux
  // chute falls straight down the climbing column, so it is slower and the
  // face has notches to duck into
  const CHUTES = [{ c: 19, r: 84 - 41, min: 2.4, max: 3.6 }, { c: 11, r: 84 - 78, min: 3.8, max: 5.4 }];
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
    fAnchor: $('cx-flag-anchor'), style: $('cx-style'), bestTime: $('cx-best-time'), bestFalls: $('cx-best-falls')
  };
  const BEST_KEY = 'lg-crux-best-v1';

  const T = {
    w: 14, h: 20, gravity: 1400, maxFall: 520, corner: 8,
    run: 130, groundAccel: 1500, airAccel: 800, friction: 1700, iceFriction: 250,
    jumpV: 490, jumpCut: 0.45, coyote: 0.1, buffer: 0.12,
    climbUp: 55, climbDown: 85, drainIdle: 5, drainUp: 20, drainDown: 8,
    wallJumpVx: 240, wallJumpVy: 400, wallLock: 0.12, hopVy: 380, hopCost: 15,
    dashSpeed: 400, dashTime: 0.16, dashEndVy: 120,
    staminaMax: 100, regenGround: 30, regenRest: 60, regenJug: 45,
    anchorTime: 1.2, anchorsPerPitch: 3, respawnStamina: 0.6,
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
      stats: { gripT: 0, airT: 0, groundT: 0, dashes: 0, wallJumps: 0, hops: 0, anchorsPlaced: 0, falls: 0, maxHeight: 0 }
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
    return { on, rest, ice };
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
    p.coyoteT = Math.max(0, p.coyoteT - dt);
    p.bufferT = Math.max(0, p.bufferT - dt);
    if (jumpHit) p.bufferT = T.buffer;

    const g = groundInfo(p);
    const walls = wallInfo(p);
    p.onGround = g.on && p.vy >= 0;
    p.onRest = g.rest && p.onGround; p.onIce = g.ice && p.onGround;
    if (p.onGround) { p.coyoteT = T.coyote; p.dashAvail = true; p.fallFrom = p.y; }
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
    const wantGrip = wall && grippable(wall.t) && gripKey && p.stamina > 0 && p.dashT <= 0;
    const canGrip = wantGrip && (!p.onGround || up);

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
      // mantle: the body straddles the wall's top edge. A one-tile notch in
      // the face counts too, but only when pushing into it; otherwise you
      // climb past (hop over the gap) rather than being pulled into every pocket
      const rs = rowsSpanned(p);
      const notch = solidAt(wall.c, rs[1] - 2);
      if (climb < 0 && !solidAt(wall.c, rs[0]) && solidAt(wall.c, rs[1]) && !solidAt(wall.c, rs[1] - 1) &&
          (rs[1] * TILE - p.y) > 6 && (!notch || h === wallDir)) {
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
          if (p.stamina >= T.hopCost) { p.vy = -T.hopVy; p.stamina -= T.hopCost; p.gripping = false; p.hopT = 0.15; st.hops++; }
        } else {
          p.vx = -wallDir * T.wallJumpVx; p.vy = -T.wallJumpVy; p.wallLock = T.wallLock; p.gripping = false; st.wallJumps++;
          puff(p.x + T.w / 2, p.y + T.h, '#dfe6f5', 5, 60, 1.5, 0.3);
        }
      }
    } else {
      p.gripping = false; p.onJug = false;
      // ---- ordinary platforming
      const accel = p.onGround ? T.groundAccel : T.airAccel;
      if (p.wallLock <= 0) {
        if (h) p.vx += h * accel * dt;
        else {
          const f = (p.onGround ? (p.onIce ? T.iceFriction : T.friction) : T.airAccel * 0.5) * dt;
          if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
        }
      }
      const cap = T.run * (p.onIce ? 1.25 : 1);
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
      p.hopT = Math.max(0, p.hopT - dt);
      // wind, only in the air
      if (!p.onGround) {
        const r = Math.floor((p.y + T.h / 2) / TILE);
        if (windGust() && inWind(r)) p.vx += S.wind.dir * T.windForce * dt;
      }
      p.vy = Math.min(T.maxFall, p.vy + T.gravity * dt);
      // sliding down an unclimbable wall is slower than falling
      if (wall && !p.onGround && p.vy > 0 && h === wallDir && wall.t !== '~') p.vy = Math.min(p.vy, 160);
      if (p.onGround) st.groundT += dt; else st.airT += dt;
    }

    // ---- stamina & anchors
    if (p.onGround && !p.gripping) p.stamina = Math.min(T.staminaMax, p.stamina + (p.onRest ? T.regenRest : T.regenGround) * dt);
    const still = (p.onGround || p.gripping) && h === 0 && !up && !down && p.dashT <= 0;
    if (anchorHit && still && p.anchorsLeft > 0 && p.anchoring <= 0) p.anchoring = T.anchorTime;
    if (p.anchoring > 0) {
      if (!still) p.anchoring = 0;
      else {
        p.anchoring -= dt;
        if (p.anchoring <= 0) {
          p.anchoring = 0; p.anchorsLeft--; st.anchorsPlaced++;
          const a = { x: p.x, y: p.y, grip: p.gripping ? wallDir : 0, rest: false };
          S.anchors.push(a); S.checkpoint = a;
          puff(p.x + T.w / 2, p.y + T.h / 2, '#d9a23a', 8, 70, 2, 0.4);
        }
      }
    }

    // ---- integrate
    p.landed = false;
    const wasGround = p.onGround;
    moveX(p, p.vx * dt);
    moveY(p, p.vy * dt);
    if (p.landed && !wasGround && !p.gripping) {
      if (p.y - p.fallFrom > T.hardFall) { die('fall'); return; }
      p.fallFrom = p.y;
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
    // camera: keep the climber in the lower-middle, looking up
    const target = LG.clamp(p.y - H * 0.58, 0, WORLD_H - H);
    S.camY += (target - S.camY) * (1 - Math.exp(-6 * dt));
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
    for (const k in S.crumble) {
      const c = S.crumble[k];
      if (c.broken > 0) { c.broken -= dt; if (c.broken <= 0) { c.broken = 0; c.t = 0; } }
      else if (c.touched) { c.t += dt; if (c.t >= T.crumbleDelay) { c.broken = T.crumbleRegrow; const p = k.split(','); puff((+p[0] + 0.5) * TILE, (+p[1] + 0.5) * TILE, '#8a7a66', 8, 70, 2, 0.4); } }
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
      const shake = st && st.t > 0.25 ? (rand() - 0.5) * 2 : 0;
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

  function styleOf() {
    const st = S.stats, moving = st.gripT + st.airT;
    if (moving < 1) return { who: 'Static', t: 0.5, note: 'Grip time vs air time appears here' };
    const air = st.airT / moving;
    const who = air < 0.4 ? 'Static' : air > 0.6 ? 'Dynamic' : 'Mixed';
    return { who, t: air, note: who + ' — ' + LG.pct(1 - air) + ' of the moving time on the rock, ' + LG.pct(air) + ' in the air' };
  }

  // ---- flow ---------------------------------------------------------------
  function finish() {
    S.state = 'won';
    const st = S.stats, sty = styleOf();
    const best = LG.store.get(BEST_KEY, {});
    let newTime = false, newFalls = false;
    if (best.time === undefined || S.t < best.time) { best.time = S.t; newTime = true; }
    if (best.falls === undefined || st.falls < best.falls) { best.falls = st.falls; newFalls = true; }
    LG.store.set(BEST_KEY, best);
    showBests();
    overlay.show('<div><h2>Summit</h2><span class="lg-tag">' + sty.who + '</span>' +
      '<div class="lg-results">' +
      '<span>Time</span><b>' + LG.fmtTime(S.t) + (newTime ? ' ★' : '') + '</b>' +
      '<span>Falls</span><b>' + st.falls + (newFalls ? ' ★' : '') + '</b>' +
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
  }
  function start() {
    reset(); S.state = 'running';
    overlay.hide(); input.focus(); input.flush(); loop.start();
  }
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
      '<p>' + (ROWS - 2) + ' metres of wall. Hold grip on rock to cling and climb; stamina comes back on the ground, on the green rest ledges and on the yellow jugs. Anchors are checkpoints you place yourself. Wall-jumps and dashes are free.</p>' +
      '<p class="lg-fine">Falls of more than five metres, rocks and long drops send you back to your last anchor.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="cx-start">Start</button></div></div>');
    $('cx-start').onclick = start;
  }

  loop = LG.loop(update, function () {
    if (S.state === 'running' && input.hit('KeyP')) { input.flush(); pause(); return; }
    render();
    input.flush();
  });
  input.onBlur = function () { pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && (S.state === 'ready' || S.state === 'won')) start();
  });

  reset();
  showBests();
  showReady();
  render();

  window.__lg = window.__lg || {};
  window.__lg.crux = { get S() { return S; }, T, LEVEL, TILE, input, reset, update, render, finish, solidAt,
    fly(c, r) { S.p.x = c * TILE + (TILE - T.w) / 2; S.p.y = (r + 1) * TILE - T.h; S.p.vx = S.p.vy = 0; S.camY = LG.clamp(S.p.y - H * 0.58, 0, WORLD_H - H); } };
})();
