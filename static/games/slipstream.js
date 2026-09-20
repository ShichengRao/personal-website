/* Slipstream: a top-down racer where pace management beats the perfect
   corner. Tires have a temperature (short-term: hot tires slide and, at 100°,
   go off for a few seconds) and a life (long-term: never comes back). Pushing
   is faster and cooks the tires; sitting in a slipstream cools them and adds
   top speed; the track is narrow enough that a car ahead physically blocks.
   Six AI drivers with different aggression race the same rules. */
(function () {
  'use strict';
  const LG = window.LongGame;
  const W = 960, H = 600, TAU = LG.TAU;
  const canvas = document.getElementById('ss-canvas');
  const ctx = LG.setupCanvas(canvas, W, H);
  const stage = document.getElementById('ss-stage');
  const input = new LG.Input(stage, canvas, W, H);
  const overlay = LG.overlay(document.getElementById('ss-overlay'));
  const $ = (id) => document.getElementById(id);
  const ui = {
    pos: $('ss-pos'), posof: $('ss-posof'), lap: $('ss-lap'), laps: $('ss-laps'),
    temp: $('ss-temp'), tempv: $('ss-tempv'), life: $('ss-life'), lifev: $('ss-lifev'),
    fTow: $('ss-flag-tow'), fPush: $('ss-flag-push'), fHot: $('ss-flag-hot'),
    laptime: $('ss-laptime'), lastlap: $('ss-lastlap'), bestlap: $('ss-bestlap'),
    tower: $('ss-tower').querySelector('tbody'), map: $('ss-map'),
    bestSprint: $('ss-best-sprint'), bestEndurance: $('ss-best-endurance')
  };
  const mapCtx = LG.setupCanvas(ui.map, 268, 180);
  const BEST_KEY = 'lg-slipstream-best-v1';

  // ---- tuning -------------------------------------------------------------
  const T = {
    trackW: 60, zoom: 1.3,
    vmax: 300, engine: 250, brake: 380, drag: 0.22, grassDrag: 2.2,
    alat: 520,            // lateral acceleration the tires can supply at full grip
    yawMax: 3.6, yawHigh: 0.38,
    gripK: 9, grassGripK: 3.5,
    pushVmax: 1.18, pushEngine: 1.6, towVmax: 1.05, towRange: 100, towLat: 18,
    heatBase: 10, heatPush: 2.0, heatSlide: 0.08, coolK: 0.15, coolTow: 5,   // Newtonian cooling: hot tires shed heat faster
    tempCold: 40, coldGrip: 0.75, tempHot: 78, hotGripLoss: 0.08,   // the operating window
    overheatTime: 3, overheatGrip: 0.75, overheatThrottle: 0.4,
    wearSlide: 0.00003, wearHeat: 0.00035, wearGripLoss: 0.8,
    carR: 10, carL: 22, carW: 12,
    modes: { sprint: 4, endurance: 10 }
  };
  const DRIVERS = [
    { name: 'Vettori', aggr: 0.95, color: '#e4433d' },
    { name: 'Okabe',   aggr: 0.85, color: '#f08a2e' },
    { name: 'Lund',    aggr: 0.70, color: '#e8c63a' },
    { name: 'Marsh',   aggr: 0.55, color: '#3fa860' },
    { name: 'Ibarra',  aggr: 0.40, color: '#4f8fe0' },
    { name: 'Pak',     aggr: 0.30, color: '#a86fe0' }
  ];
  const PLAYER_COLOR = '#f4f6fb';

  // ---- track --------------------------------------------------------------
  // Control points of a closed Catmull-Rom loop: a long main straight, a
  // fast sweeper, an S section, a run north, a top straight and a hairpin
  // down the left side back onto the straight.
  const CP = [[1100, 1370], [1800, 1370], [2150, 1250], [2290, 1000], [2230, 770],
              [2040, 630], [1800, 620], [1640, 760], [1470, 900], [1290, 920], [1150, 780],
              [1130, 560], [1180, 420], [1080, 330], [900, 300], [700, 300], [450, 330], [260, 450],
              [230, 700], [250, 1000], [300, 1220], [420, 1330], [600, 1370]];
  function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

  function buildTrack(cp) {
    const pts = [], n = cp.length;
    for (let i = 0; i < n; i++) {
      const p0 = cp[(i - 1 + n) % n], p1 = cp[i], p2 = cp[(i + 1) % n], p3 = cp[(i + 2) % n];
      const steps = Math.max(4, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 8));
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        pts.push({ x, y });
      }
    }
    const N = pts.length;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1e-6;
      a.s = s; a.len = l; a.tx = dx / l; a.ty = dy / l; a.nx = -a.ty; a.ny = a.tx;
      s += l;
    }
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      raw[i] = wrapAngle(Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx)) / a.len;
    }
    for (let i = 0; i < N; i++) {           // smooth curvature over ±5 samples
      let acc = 0;
      for (let k = -5; k <= 5; k++) acc += raw[(i + k + N) % N];
      pts[i].k = acc / 11;
    }
    const chunks = [];
    const CH = 20;
    for (let i = 0; i < N; i += CH) {
      const end = Math.min(N - 1, i + CH);
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, maxK = 0;
      for (let j = i; j <= end; j++) {
        const p = pts[j % N];
        minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
        maxK = Math.max(maxK, Math.abs(p.k));
      }
      chunks.push({ start: i, end, minx, miny, maxx, maxy, maxK });
    }
    return { pts, N, total: s, chunks };
  }
  const TRACK = buildTrack(CP);
  const HALF = T.trackW / 2;

  function nearestIndex(c) {
    const pts = TRACK.pts, N = TRACK.N;
    let best = c.si, bd = Infinity;
    for (let k = -6; k <= 30; k++) {
      const i = (c.si + k + N) % N, p = pts[i];
      const d = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---- state --------------------------------------------------------------
  let rand = Math.random;
  let S = null, loop = null;

  function makeCar(name, color, ai, aggr, gridIndex) {
    // grid: staggered pairs behind the start line, on the main straight
    const back = 40 + gridIndex * 34;
    const side = (gridIndex % 2 === 0 ? -1 : 1) * HALF * 0.45;
    const i0 = 0, p = TRACK.pts[i0];
    const x = p.x - p.tx * back + p.nx * side, y = p.y - p.ty * back + p.ny * side;
    const c = {
      name, color, ai, aggr, x, y, h: Math.atan2(p.ty, p.tx), vx: 0, vy: 0, spd: 0, slip: 0,
      steer: 0, throttle: 0, brake: 0, push: false, temp: 15, wear: 0, overheat: 0, overheats: 0,
      si: 0, lat: 0, dist: 0, lap: 0, halfSeen: false, progress: 0, lapStart: 0, lastLap: 0, bestLap: Infinity,
      finished: false, finishTime: 0, finishPos: 0, inTow: false, towTime: 0, pushTime: 0,
      latTarget: 0, commit: 0, mistake: 0, skill: 0.97 + rand() * 0.06, pushHold: 0
    };
    c.si = nearestIndex(c);
    c.progress = -back;
    return c;
  }

  function reset(mode, seed, opts) {
    opts = opts || {};
    rand = seed ? LG.rng(seed) : Math.random;
    S = {
      t: 0, race: 0, state: 'ready', mode: mode || 'sprint', laps: T.modes[mode || 'sprint'],
      cars: [], cam: { x: 0, y: 0 }, skids: [], smoke: [], countdown: 3, finishedCount: 0, playerDone: false
    };
    const order = DRIVERS.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const grid = [];
    for (let i = 0; i < order.length; i++) grid.push(order[i]);
    grid.splice(3, 0, { name: 'You', color: PLAYER_COLOR, player: true, aggr: opts.playerAggr || 0.5 });
    grid.forEach(function (d, i) {
      const c = makeCar(d.name, d.color, !d.player || !!opts.playerAI, d.aggr, i);
      if (d.player) { S.player = c; c.isPlayer = true; }
      S.cars.push(c);
    });
    S.cam.x = S.player.x; S.cam.y = S.player.y;
  }

  // ---- AI -----------------------------------------------------------------
  function cornerSpeed(k, grip, factor) {
    const ak = Math.abs(k);
    if (ak < 1e-5) return T.vmax * 1.2;
    return Math.min(T.vmax * 1.2, Math.sqrt(T.alat * grip / ak) * factor);
  }
  function gripOf(c) {
    let tempGrip = 1;
    if (c.temp < T.tempCold) tempGrip = T.coldGrip + (1 - T.coldGrip) * c.temp / T.tempCold;
    else if (c.temp > T.tempHot) tempGrip = 1 - T.hotGripLoss * (c.temp - T.tempHot) / (100 - T.tempHot);
    let g = tempGrip * (1 - T.wearGripLoss * c.wear);
    if (c.overheat > 0) g *= T.overheatGrip;
    return g;
  }

  function driveAI(c, dt) {
    const pts = TRACK.pts, N = TRACK.N;
    const grip = gripOf(c);
    const factor = (0.90 + 0.10 * c.aggr) * c.skill;
    // target speed: the slowest upcoming corner we couldn't brake for otherwise
    let target = T.vmax * 1.2, dist = 0;
    for (let k = 1; k <= 45; k++) {
      const p = pts[(c.si + k) % N];
      dist += p.len;
      const vc = cornerSpeed(p.k, grip, factor);
      const allowed = Math.sqrt(vc * vc + 2 * T.brake * 0.9 * dist);
      if (allowed < target) target = allowed;
    }
    const spd = c.spd;
    c.throttle = spd < target - 4 ? 1 : (spd < target ? 0.5 : 0);
    c.brake = spd > target + 10 ? 1 : (spd > target + 3 ? 0.4 : 0);
    // everyone lifts a little before the tires go off, except on the last lap
    const lastLap = c.lap >= S.laps - 1;
    if (c.temp > 94 && !lastLap && c.overheat <= 0) c.throttle = Math.min(c.throttle, 0.55);

    // where to be on the track: inside of the next corner, else the middle
    const ahead = pts[(c.si + 18) % N];
    let want = Math.abs(ahead.k) > 1 / 400 ? Math.sign(ahead.k) * HALF * 0.45 : 0;

    // overtaking and defending
    c.commit = Math.max(0, c.commit - dt);
    if (c.commit <= 0) {
      let front = null, fd = 1e9, behind = null, bd = 1e9;
      for (const o of S.cars) {
        if (o === c || o.finished) continue;
        let ds = o.progress - c.progress;
        if (ds > 0 && ds < fd && ds < 70 && Math.abs(o.lat - c.lat) < 16) { fd = ds; front = o; }
        if (ds < 0 && -ds < bd && -ds < 45) { bd = -ds; behind = o; }
      }
      // chargers attack whenever they can; patient drivers sit in the tow and
      // only go for it late, or when the car ahead is clearly slower
      const lapsLeft = S.laps - c.lap;
      const eager = c.aggr > 0.6 || lapsLeft <= 3 || (front && (front.spd < target - 15 || grip > gripOf(front) + 0.12));
      if (front && target > front.spd + 6 && eager) {
        want = front.lat > 0 ? -HALF * 0.6 : HALF * 0.6;
        c.commit = 1.2 + c.aggr;
      } else if (front && !eager) {
        want = front.lat;                                       // hold the tow
        c.commit = 0.4;
      } else if (behind && behind.spd > spd - 5 && c.aggr > 0.5) {
        want = LG.clamp(behind.lat, -HALF * 0.6, HALF * 0.6);   // mirror the attacker
        c.commit = 0.6;
      }
      c.latTarget = want;
    }
    // hot tires wander
    if (c.temp > 88) c.mistake += (rand() - 0.5) * (c.temp - 88) / 12 * 4 * dt; else c.mistake *= 0.9;
    c.mistake = LG.clamp(c.mistake, -8, 8);

    // pure pursuit toward a point ahead on the offset line
    const look = 36 + spd * 0.22;
    let d = 0, j = 0;
    while (d < look && j < 60) { d += pts[(c.si + j) % N].len; j++; }
    const tp = pts[(c.si + j) % N];
    const lat = c.latTarget + c.mistake;
    const tx = tp.x + tp.nx * lat, ty = tp.y + tp.ny * lat;
    const err = wrapAngle(Math.atan2(ty - c.y, tx - c.x) - c.h);
    c.steer = LG.clamp(err * 2.8, -1, 1);

    // push policy: straights only, while the tires can take it
    const straight = Math.abs(ahead.k) < 1 / 500 && Math.abs(pts[c.si].k) < 1 / 500;
    const limit = 45 + 50 * c.aggr;
    c.push = straight && c.overheat <= 0 && (c.temp < limit || (lastLap && c.temp < 92)) && c.throttle > 0.9;
  }

  function drivePlayer(c, dt) {
    const left = input.down('ArrowLeft', 'KeyA'), right = input.down('ArrowRight', 'KeyD');
    const target = left && !right ? -1 : right && !left ? 1 : 0;
    const rate = target === 0 ? 10 : 6;
    c.steer += LG.clamp(target - c.steer, -rate * dt, rate * dt);
    c.throttle = input.down('ArrowUp', 'KeyW') ? 1 : 0;
    c.brake = input.down('ArrowDown', 'KeyS') ? 1 : 0;
    c.push = input.down('ShiftLeft', 'ShiftRight') && c.throttle > 0;
  }

  // ---- physics ------------------------------------------------------------
  function stepCar(c, dt) {
    const onTrack = c.dist <= HALF + 3;
    let grip = gripOf(c);
    if (!onTrack) grip *= 0.55;
    const push = c.push && c.overheat <= 0;
    const vmax = T.vmax * (push ? T.pushVmax : 1) * (c.inTow ? T.towVmax : 1) * (onTrack ? 1 : 0.6);
    let thr = c.throttle;
    if (c.overheat > 0) thr = Math.min(thr, T.overheatThrottle);

    // speed along the velocity direction; the car's heading is separate
    let spd = Math.hypot(c.vx, c.vy);
    let vang = spd > 1 ? Math.atan2(c.vy, c.vx) : c.h;
    let forward = Math.cos(wrapAngle(vang - c.h)) >= 0;
    let v = forward ? spd : -spd;

    const eng = T.engine * (push ? T.pushEngine : 1) * Math.max(0, 1 - Math.max(v, 0) / vmax);
    v += thr * eng * dt;
    if (c.brake > 0) v = v > 0 ? Math.max(0, v - T.brake * c.brake * dt) : Math.max(-60, v - 120 * c.brake * dt);
    v -= v * (onTrack ? T.drag : T.grassDrag) * dt;
    if (v > vmax) v -= (v - vmax) * 3 * dt;

    // steering turns the nose; the tires then pull the velocity round after it,
    // but only as fast as their lateral grip allows -- beyond that the car
    // runs wide, which is what hot or worn tires feel like
    const av = Math.abs(v);
    const yaw = c.steer * T.yawMax * LG.clamp(av / 70, 0, 1) * (1 - T.yawHigh * Math.min(av / T.vmax, 1)) * (0.6 + 0.4 * grip) * (v >= 0 ? 1 : -1);
    c.h += yaw * dt;
    const slip = wrapAngle(c.h - vang) * (forward ? 1 : -1);
    const gripK = (onTrack ? T.gripK : T.grassGripK) * grip;
    const maxRot = (T.alat * grip) / Math.max(av, 30);
    const rot = LG.clamp(gripK * slip, -maxRot, maxRot) * dt * (forward ? 1 : -1);
    vang += rot;
    // scrubbing speed while sliding
    const slideMag = Math.abs(Math.sin(slip)) * av;
    v -= Math.sign(v) * slideMag * 0.9 * dt;
    c.vx = Math.cos(vang) * v; c.vy = Math.sin(vang) * v;
    if (!forward) { c.vx = -c.vx; c.vy = -c.vy; }
    // when nearly stopped, snap the velocity direction to the heading
    if (av < 5) { c.vx = Math.cos(c.h) * v; c.vy = Math.sin(c.h) * v; }
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.spd = av; c.slip = slip;

    // tires
    const heatIn = (0.55 + 0.45 * thr) * Math.pow(Math.max(v, 0) / T.vmax, 2) * T.heatBase * (push ? T.heatPush : 1) + slideMag * T.heatSlide;
    const cool = T.coolK * c.temp + (c.inTow ? T.coolTow : 0);
    c.temp = LG.clamp(c.temp + (heatIn - cool) * dt, 0, 100);
    if (c.temp >= 100 && c.overheat <= 0) { c.overheat = T.overheatTime; c.overheats++; }
    if (c.overheat > 0) { c.overheat -= dt; if (c.overheat <= 0) c.temp = Math.min(c.temp, 70); }
    c.wear = Math.min(1, c.wear + (slideMag * T.wearSlide + Math.max(0, c.temp - 65) * T.wearHeat) * dt);
    if (push && thr > 0) c.pushTime += dt;
    if (c.inTow) c.towTime += dt;

    if (onTrack && Math.abs(slip) > 0.22 && av > 60 && S.skids.length < 900) {
      S.skids.push({ x: c.x, y: c.y, x2: c.x - c.vx * dt * 3, y2: c.y - c.vy * dt * 3 });
    }
    if ((c.temp > 88 || c.overheat > 0) && rand() < 12 * dt) {
      S.smoke.push({ x: c.x - Math.cos(c.h) * 10, y: c.y - Math.sin(c.h) * 10, vx: (rand() - 0.5) * 20, vy: (rand() - 0.5) * 20, life: 0.8, max: 0.8, r: 3 + rand() * 3 });
    }
  }

  function trackCar(c) {
    const pts = TRACK.pts, N = TRACK.N;
    const prev = c.si;
    c.si = nearestIndex(c);
    const p = pts[c.si];
    c.lat = (c.x - p.x) * p.nx + (c.y - p.y) * p.ny;
    c.dist = Math.abs(c.lat);
    if (c.dist > HALF + 34) {                // the wall
      const side = Math.sign(c.lat);
      c.x = p.x + p.nx * side * (HALF + 34); c.y = p.y + p.ny * side * (HALF + 34);
      c.vx *= 0.6; c.vy *= 0.6;
    }
    if (c.si > N / 2 && c.si < N * 0.75) c.halfSeen = true;
    if (prev > N - 25 && c.si < 25 && c.halfSeen) {
      c.halfSeen = false;
      if (S.state === 'running' && !c.finished) {
        if (c.lap > 0 || S.race > 5) {
          c.lastLap = S.race - c.lapStart;
          if (c.lastLap < c.bestLap) c.bestLap = c.lastLap;
        }
        c.lap++; c.lapStart = S.race;
        if (c.lap >= S.laps) {
          c.finished = true; c.finishTime = S.race; S.finishedCount++; c.finishPos = S.finishedCount;
          if (c.isPlayer) { S.playerDone = true; }
        }
      }
    } else if (prev < 25 && c.si > N - 25) {
      c.lap = Math.max(0, c.lap - 1);   // went backwards over the line
    }
    c.progress = c.lap * TRACK.total + p.s + ((c.x - p.x) * p.tx + (c.y - p.y) * p.ty);
  }

  function collide(dt) {
    const cars = S.cars, n = cars.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = T.carR * 2;
      if (d >= min || d < 1e-3) continue;
      const nx = dx / d, ny = dy / d, over = (min - d) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rel = rvx * nx + rvy * ny;
      if (rel < 0) {
        const imp = -rel * 0.65;
        a.vx -= nx * imp; a.vy -= ny * imp; b.vx += nx * imp; b.vy += ny * imp;
        // the car behind pays more: it ran into someone
        const rear = a.progress < b.progress ? a : b, front = rear === a ? b : a;
        rear.vx *= 0.9; rear.vy *= 0.9; front.vx *= 0.97; front.vy *= 0.97;
      }
    }
  }

  function towCheck() {
    for (const c of S.cars) {
      c.inTow = false;
      if (c.finished) continue;
      const fx = Math.cos(c.h), fy = Math.sin(c.h);
      for (const o of S.cars) {
        if (o === c) continue;
        const dx = o.x - c.x, dy = o.y - c.y;
        const along = dx * fx + dy * fy, side = Math.abs(dx * -fy + dy * fx);
        if (along > 14 && along < T.towRange && side < T.towLat && Math.cos(o.h - c.h) > 0.6 && o.spd > 80) { c.inTow = true; c.towOf = o; break; }
      }
    }
  }

  // ---- update -------------------------------------------------------------
  function update(dt) {
    if (S.state !== 'running' && S.state !== 'countdown') return;
    S.t += dt;
    if (S.state === 'countdown') {
      S.countdown -= dt;
      if (S.countdown <= 0) { S.state = 'running'; S.race = 0; for (const c of S.cars) c.lapStart = 0; }
    } else S.race += dt;
    const live = S.state === 'running';
    towCheck();
    for (const c of S.cars) {
      if (c.ai) {
        if (live) driveAI(c, dt); else { c.throttle = 0; c.brake = 1; c.steer = 0; c.push = false; }
        if (c.finished) { c.push = false; c.throttle = Math.min(c.throttle, 0.4); }
      } else {
        drivePlayer(c, dt);
        if (!live) { c.throttle = 0; c.push = false; }
      }
      stepCar(c, dt);
    }
    collide(dt);
    for (const c of S.cars) trackCar(c);
    for (let i = S.smoke.length - 1; i >= 0; i--) {
      const q = S.smoke[i]; q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.r += 6 * dt;
      if (q.life <= 0) S.smoke.splice(i, 1);
    }
    if (S.playerDone && S.state === 'running' && !S.headless) {
      S.playerDoneT = (S.playerDoneT || 0) + dt;
      if (S.playerDoneT > 1.2) finish();
    }
    // camera leads the player a little in the direction of travel
    const p = S.player, k = 1 - Math.exp(-5 * dt);
    S.cam.x += (p.x + p.vx * 0.25 - S.cam.x) * k;
    S.cam.y += (p.y + p.vy * 0.25 - S.cam.y) * k;
  }

  function standings() {
    return S.cars.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishPos - b.finishPos;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  // ---- render -------------------------------------------------------------
  let mapReady = false;
  function drawMapBase() {
    const pts = TRACK.pts;
    mapCtx.fillStyle = '#141a14'; mapCtx.fillRect(0, 0, 268, 180);
    mapCtx.save(); mapCtx.translate(6, 6); mapCtx.scale(256 / 2400, 168 / 1500);
    mapCtx.lineWidth = 60; mapCtx.strokeStyle = '#2b2f36'; mapCtx.lineJoin = 'round';
    mapCtx.beginPath(); pts.forEach((p, i) => i ? mapCtx.lineTo(p.x, p.y) : mapCtx.moveTo(p.x, p.y)); mapCtx.closePath(); mapCtx.stroke();
    mapCtx.restore();
    mapReady = true;
  }
  const mapBase = document.createElement('canvas');
  function renderMap() {
    if (!mapReady) { drawMapBase(); mapBase.width = ui.map.width; mapBase.height = ui.map.height; mapBase.getContext('2d').drawImage(ui.map, 0, 0); }
    mapCtx.save(); mapCtx.setTransform(1, 0, 0, 1, 0, 0); mapCtx.drawImage(mapBase, 0, 0); mapCtx.restore();
    const sx = 256 / 2400, sy = 168 / 1500;
    for (const c of S.cars) {
      mapCtx.fillStyle = c.color; mapCtx.beginPath();
      mapCtx.arc(6 + c.x * sx, 6 + c.y * sy, c.ai ? 3 : 4, 0, TAU); mapCtx.fill();
    }
  }

  function drawCar(c) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h);
    if (c.inTow) { ctx.fillStyle = 'rgba(122,215,240,0.10)'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(T.towRange, -T.towLat); ctx.lineTo(T.towRange, T.towLat); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-T.carL / 2 + 2, -T.carW / 2 + 2, T.carL, T.carW);
    ctx.fillStyle = c.color; ctx.fillRect(-T.carL / 2, -T.carW / 2, T.carL, T.carW);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-4, -T.carW / 2 + 1, 8, T.carW - 2);
    ctx.fillStyle = '#111'; ctx.fillRect(-T.carL / 2 + 1, -T.carW / 2 - 1.5, 5, 1.5); ctx.fillRect(-T.carL / 2 + 1, T.carW / 2, 5, 1.5);
    ctx.fillRect(T.carL / 2 - 6, -T.carW / 2 - 1.5, 5, 1.5); ctx.fillRect(T.carL / 2 - 6, T.carW / 2, 5, 1.5);
    if (c.push && c.overheat <= 0 && c.throttle > 0) { ctx.fillStyle = 'rgba(255,190,80,0.9)'; ctx.fillRect(-T.carL / 2 - 6, -2, 6, 4); }
    if (c.overheat > 0) { ctx.strokeStyle = 'rgba(255,80,80,0.8)'; ctx.lineWidth = 1.5; ctx.strokeRect(-T.carL / 2 - 1, -T.carW / 2 - 1, T.carL + 2, T.carW + 2); }
    ctx.restore();
  }

  function render() {
    const z = T.zoom, vw = W / z, vh = H / z;
    const cx = S.cam.x, cy = S.cam.y;
    const left = cx - vw / 2, top = cy - vh / 2;
    ctx.fillStyle = '#243521'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.scale(z, z); ctx.translate(-left, -top);
    // grass texture: sparse dots
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    const gx0 = Math.floor(left / 80) * 80, gy0 = Math.floor(top / 80) * 80;
    for (let x = gx0; x < left + vw; x += 80) for (let y = gy0; y < top + vh; y += 80) ctx.fillRect(x + 20, y + 20, 3, 3);

    const pts = TRACK.pts, N = TRACK.N, m = T.trackW;
    const vis = TRACK.chunks.filter((ch) => ch.maxx + m > left && ch.minx - m < left + vw && ch.maxy + m > top && ch.miny - m < top + vh);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const pass of [[T.trackW + 8, '#c9c9c9'], [T.trackW, '#2b2f36']]) {
      ctx.lineWidth = pass[0]; ctx.strokeStyle = pass[1];
      for (const ch of vis) {
        ctx.beginPath();
        for (let i = ch.start; i <= ch.end + 1; i++) { const p = pts[i % N]; if (i === ch.start) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
    }
    // kerbs where it bends
    for (const ch of vis) {
      if (ch.maxK < 1 / 260) continue;
      for (let i = ch.start; i <= ch.end; i += 2) {
        const p = pts[i % N];
        if (Math.abs(p.k) < 1 / 260) continue;
        ctx.fillStyle = (Math.floor(i / 2) % 2) ? '#d64545' : '#f2f2f2';
        for (const side of [-1, 1]) {
          ctx.save(); ctx.translate(p.x + p.nx * side * (HALF + 1), p.y + p.ny * side * (HALF + 1)); ctx.rotate(Math.atan2(p.ty, p.tx));
          ctx.fillRect(-8, -3, 16, 6); ctx.restore();
        }
      }
    }
    // start line
    const s0 = pts[0];
    ctx.save(); ctx.translate(s0.x, s0.y); ctx.rotate(Math.atan2(s0.ty, s0.tx));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#f2f2f2' : '#222'; ctx.fillRect(-6 + j * 6, -HALF + i * (T.trackW / 6), 6, T.trackW / 6); }
    ctx.restore();
    // skids
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.beginPath();
    for (const sk of S.skids) { if (sk.x < left - 20 || sk.x > left + vw + 20 || sk.y < top - 20 || sk.y > top + vh + 20) continue; ctx.moveTo(sk.x, sk.y); ctx.lineTo(sk.x2, sk.y2); }
    ctx.stroke();
    // cars
    for (const c of S.cars) if (c !== S.player) drawCar(c);
    drawCar(S.player);
    for (const q of S.smoke) { ctx.globalAlpha = 0.35 * q.life / q.max; ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.restore();

    // countdown / messages
    if (S.state === 'countdown') {
      const n = Math.ceil(S.countdown);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W / 2 - 60, H / 2 - 60, 120, 120);
      ctx.fillStyle = '#fff'; ctx.font = '700 72px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), W / 2, H / 2);
      ctx.textBaseline = 'alphabetic';
    } else if (S.state === 'running' && S.race < 1.2) {
      ctx.fillStyle = 'rgba(63,168,96,0.9)'; ctx.font = '700 48px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('GO', W / 2, H / 2 - 40);
    }
    if (S.player.finished && S.state === 'running') {
      ctx.fillStyle = '#fff'; ctx.font = '700 40px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FINISH', W / 2, 80);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '13px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left';
    ctx.fillText(Math.round(S.player.spd * 0.62) + ' km/h', 14, H - 14);

    renderHUD();
    renderMap();
  }

  function renderHUD() {
    const p = S.player, st = standings();
    const pos = st.indexOf(p) + 1;
    ui.pos.textContent = S.state === 'ready' ? '—' : 'P' + pos;
    ui.posof.textContent = S.state === 'ready' ? '' : ' / ' + S.cars.length;
    ui.lap.textContent = String(Math.min(p.lap + 1, S.laps));
    ui.laps.textContent = String(S.laps);
    LG.setBar(ui.temp, p.temp / 100, p.temp < T.tempCold ? 'cool' : p.temp <= T.tempHot ? 'good' : p.temp < 92 ? 'warn' : 'bad');
    ui.tempv.textContent = Math.round(p.temp) + '°';
    LG.setBar(ui.life, 1 - p.wear, p.wear < 0.5 ? 'cool' : 'warn');
    ui.lifev.textContent = Math.round((1 - p.wear) * 100) + '%';
    ui.fTow.classList.toggle('on', p.inTow);
    ui.fPush.classList.toggle('on', p.push && p.overheat <= 0);
    ui.fHot.classList.toggle('on', p.overheat > 0);
    ui.laptime.textContent = LG.fmtTime(S.state === 'running' && !p.finished ? S.race - p.lapStart : 0);
    ui.lastlap.textContent = p.lastLap ? LG.fmtTime(p.lastLap) : '—';
    ui.bestlap.textContent = isFinite(p.bestLap) ? LG.fmtTime(p.bestLap) : '—';
    let html = '';
    const leader = st[0];
    st.forEach(function (c, i) {
      let gap;
      if (c.finished) gap = i === 0 ? LG.fmtTime(c.finishTime) : '+' + (c.finishTime - leader.finishTime).toFixed(1) + 's';
      else if (i === 0) gap = 'leader';
      else {
        const dp = leader.progress - c.progress;
        gap = dp > TRACK.total ? '+' + Math.floor(dp / TRACK.total) + ' lap' : '+' + (dp / Math.max(120, leader.spd || 200)).toFixed(1) + 's';
      }
      const tcol = c.temp < T.tempCold ? '#7ad7f0' : c.temp <= T.tempHot ? '#3fa860' : c.temp < 92 ? '#d9a23a' : '#d1495b';
      html += '<tr' + (c === p ? ' class="you"' : '') + '><td class="n">' + (i + 1) + '</td><td><span class="ss-dot" style="background:' + c.color + '"></span>' + c.name +
        '<span class="ss-temp" style="background:' + tcol + '" title="tire temp"></span></td><td class="g">' + gap + '</td></tr>';
    });
    ui.tower.innerHTML = html;
  }

  // ---- flow ---------------------------------------------------------------
  function styleOf(p) {
    const total = Math.max(1, p.finishTime || S.race);
    const tow = p.towTime / total, push = p.pushTime / total;
    let who = 'Steady';
    if (push > 0.22 && push >= tow) who = 'Charger';
    else if (tow > 0.30) who = 'Tow master';
    return { who, tow, push, t: LG.clamp(0.5 + (push - tow) * 1.2, 0, 1) };
  }

  function finish() {
    S.state = 'finished';
    const p = S.player, st = standings(), pos = st.indexOf(p) + 1;
    const style = styleOf(p);
    const best = LG.store.get(BEST_KEY, {});
    const b = best[S.mode] || {};
    let newPos = false, newLap = false;
    if (b.pos === undefined || pos < b.pos) { b.pos = pos; newPos = true; }
    if (isFinite(p.bestLap) && (b.lap === undefined || p.bestLap < b.lap)) { b.lap = p.bestLap; newLap = true; }
    best[S.mode] = b; LG.store.set(BEST_KEY, best);
    showBests();
    const ord = ['', 'st', 'nd', 'rd'][pos] || 'th';
    overlay.show('<div><h2>' + pos + ord + ' place</h2><span class="lg-tag">' + style.who + '</span>' +
      '<div class="lg-results">' +
      '<span>Race time</span><b>' + LG.fmtTime(p.finishTime) + '</b>' +
      '<span>Best lap</span><b>' + LG.fmtTime(p.bestLap) + (newLap ? ' ★' : '') + '</b>' +
      '<span>Finish</span><b>P' + pos + (newPos ? ' ★' : '') + '</b>' +
      '<span>Tire life left</span><b>' + Math.round((1 - p.wear) * 100) + '%</b>' +
      '<span>Time in tow</span><b>' + LG.pct(style.tow) + '</b>' +
      '<span>Time pushing</span><b>' + LG.pct(style.push) + '</b>' +
      '<span>Tires went off</span><b>' + p.overheats + '×</b>' +
      '</div>' +
      LG.styleBar('Tow & manage', 'Push & charge', style.t, style.who + ' — ' + LG.pct(style.tow) + ' of the race in a slipstream, ' + LG.pct(style.push) + ' pushing') +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="ss-again">Race again</button><button id="ss-menu">Change mode</button></div>' +
      '<p class="lg-fine" style="margin-top:10px">★ new best in this browser</p></div>');
    $('ss-again').onclick = function () { start(S.mode); };
    $('ss-menu').onclick = function () { reset(S.mode); showReady(); render(); };
    render();
    loop.stop();
  }

  function showBests() {
    const best = LG.store.get(BEST_KEY, {});
    for (const m of ['sprint', 'endurance']) {
      const b = best[m];
      ui[m === 'sprint' ? 'bestSprint' : 'bestEndurance'].textContent = b && b.pos ? 'P' + b.pos + (b.lap ? ' · lap ' + LG.fmtTime(b.lap) : '') : '—';
    }
  }

  function start(mode) {
    reset(mode);
    S.state = 'countdown';
    overlay.hide(); input.focus(); input.flush();
    loop.start();
  }
  function pause() {
    if (S.state !== 'running' && S.state !== 'countdown') return;
    S.paused = S.state; S.state = 'paused';
    overlay.show('<div><h2>Paused</h2><p>Press P or click to resume.</p><div class="lg-row" style="justify-content:center"><button class="primary" id="ss-resume">Resume</button></div></div>');
    $('ss-resume').onclick = resume;
    render(); loop.stop();
  }
  function resume() {
    if (S.state !== 'paused') return;
    S.state = S.paused; overlay.hide(); input.focus(); input.flush(); loop.start();
  }
  function showReady() {
    overlay.show('<div><h2>Slipstream</h2>' +
      '<p>Six drivers, ' + T.modes.sprint + ' or ' + T.modes.endurance + ' laps. Pushing is fast and cooks the tires; the tow cools them. The chargers lead early. Whether they still lead at the end is up to the tires.</p>' +
      '<div class="lg-row" style="justify-content:center"><button class="primary" id="ss-start-sprint">Sprint · ' + T.modes.sprint + ' laps</button><button class="primary" id="ss-start-endurance">Endurance · ' + T.modes.endurance + ' laps</button></div>' +
      '<p class="lg-fine" style="margin-top:12px">Sprint suits the chargers. Endurance is the long game.</p></div>');
    $('ss-start-sprint').onclick = function () { start('sprint'); };
    $('ss-start-endurance').onclick = function () { start('endurance'); };
  }

  loop = LG.loop(update, function () {
    if ((S.state === 'running' || S.state === 'countdown') && input.hit('KeyP')) { input.flush(); pause(); return; }
    render();
    input.flush();
  });
  input.onBlur = function () { pause(); };
  stage.addEventListener('keydown', function (e) {
    if (e.code === 'KeyP' && S.state === 'paused') resume();
    if (e.code === 'Enter' && S.state === 'ready') start(S.mode);
  });

  reset('sprint');
  showBests();
  showReady();
  render();

  window.__lg = window.__lg || {};
  window.__lg.slipstream = { get S() { return S; }, T, TRACK, input, reset, update, render, finish, standings, gripOf };
})();
