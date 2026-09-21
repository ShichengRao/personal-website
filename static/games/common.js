/* Shared helpers for the Long Game arcade pages (/long-game/).
   Loaded before each game script. Everything hangs off window.LongGame so the
   games stay plain scripts with no build step. */
(function () {
  'use strict';
  const LG = {};

  LG.TAU = Math.PI * 2;
  LG.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  LG.lerp = (a, b, t) => a + (b - a) * t;
  LG.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  // 83.456 -> "1:23.46"
  LG.fmtTime = function (s) {
    if (!isFinite(s)) return '--:--.--';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  };
  LG.pct = (v) => Math.round(v * 100) + '%';

  // Size the canvas backing store for the device pixel ratio and hand back a
  // context that draws in logical (w x h) units. CSS controls the display size.
  LG.setupCanvas = function (canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.aspectRatio = w + ' / ' + h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  // Keyboard and mouse state scoped to one focusable element, so arrow keys and
  // space only reach the game while it has focus and never scroll the page.
  LG.Input = function (el, canvas, logicalW, logicalH) {
    const self = this;
    this.keys = new Set();      // codes currently held
    this.pressed = new Set();   // codes pressed since the last flush()
    this.mx = logicalW / 2;
    this.my = logicalH / 2;
    this.mouseMoved = false;    // set on every mousemove, cleared by flush()
    this.mouseDown = { left: false, right: false };
    this.mousePressed = { left: false, right: false };
    this.onBlur = null;
    this.el = el;
    el.tabIndex = 0;

    const PASS = /^(F\d+|Tab|Escape|Meta.*|Control.*|Alt.*)$/;
    el.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // let a focused overlay button activate normally (Enter/Space)
      if (e.target && e.target.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return;
      if (!e.repeat) {
        self.keys.add(e.code);
        self.pressed.add(e.code);
      }
      if (!PASS.test(e.code)) e.preventDefault();
    });
    el.addEventListener('keyup', function (e) { self.keys.delete(e.code); });
    // losing focus in any way (the stage, the window, or the tab going
    // hidden) drops every held key and lets the game pause itself
    function lost() {
      self.keys.clear();
      self.mouseDown.left = self.mouseDown.right = false;
      if (self.onBlur) self.onBlur();
    }
    el.addEventListener('blur', lost);
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', function () { if (document.hidden) lost(); });

    function toLogical(e) {
      const r = canvas.getBoundingClientRect();
      self.mx = (e.clientX - r.left) * (logicalW / r.width);
      self.my = (e.clientY - r.top) * (logicalH / r.height);
    }
    canvas.addEventListener('mousemove', function (e) { toLogical(e); self.mouseMoved = true; });
    canvas.addEventListener('mousedown', function (e) {
      toLogical(e);
      el.focus();
      if (e.button === 0) { self.mouseDown.left = true; self.mousePressed.left = true; }
      if (e.button === 2) { self.mouseDown.right = true; self.mousePressed.right = true; }
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) self.mouseDown.left = false;
      if (e.button === 2) self.mouseDown.right = false;
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };
  LG.Input.prototype.down = function () {
    for (let i = 0; i < arguments.length; i++) if (this.keys.has(arguments[i])) return true;
    return false;
  };
  LG.Input.prototype.hit = function () {
    for (let i = 0; i < arguments.length; i++) if (this.pressed.has(arguments[i])) return true;
    return false;
  };
  // Called by the loop after each simulation step has consumed edge events.
  LG.Input.prototype.flush = function () {
    this.pressed.clear();
    this.mousePressed.left = this.mousePressed.right = false;
    this.mouseMoved = false;
  };
  LG.Input.prototype.focus = function () { this.el.focus(); };

  // Fixed-timestep simulation with a render per animation frame. update(dt)
  // runs at STEP; render() once per frame. Long stalls (tab hidden) are capped
  // so the sim never tries to catch up on seconds of missed time. Edge inputs
  // (pressed keys, clicks) are flushed after every step, so a press is seen by
  // exactly one update whatever the display's refresh rate: never twice when a
  // 60 Hz frame runs two steps, never dropped by a 240 Hz frame that runs none.
  // With a tape: a recording tape captures the input every step, a playing
  // tape supplies it. step() runs one fixed step outside the animation loop,
  // for headless runs and video capture.
  LG.loop = function (update, render, input, tape) {
    const STEP = 1 / 120;
    let last = 0, acc = 0, running = false, raf = 0;
    function step() {
      if (tape && tape.playing) {
        if (!tape.apply(input)) { running = false; if (tape.onEnd) tape.onEnd(); return false; }
      } else if (input) {
        // the game only ever sees whole logical pixels: exactly what a tape
        // stores, so a replay aims and builds where the live run did
        input.mx = Math.round(input.mx); input.my = Math.round(input.my);
      }
      update(STEP);
      if (tape && tape.recording) tape.capture(input);
      if (input) input.flush();
      return true;
    }
    function frame(now) {
      if (!running) return;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      while (acc >= STEP && running) { if (!step()) break; acc -= STEP; }
      render();
      if (running) raf = requestAnimationFrame(frame);
    }
    return {
      start() { if (running) return; running = true; last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      step,
      get running() { return running; }
    };
  };

  // ---- replays ------------------------------------------------------------
  // A tape is the seed plus the input at every fixed step, run-length
  // encoded: [count, heldKeyBits, pressedKeyBits, mouseX, mouseY, buttonBits].
  // Every game runs on the fixed step with a seeded generator, so a tape
  // replays exactly. Pressed keys and clicks are edges and only apply on the
  // first step of a run.
  LG.KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
    'Space', 'KeyQ', 'KeyE', 'KeyJ', 'KeyK', 'KeyX', 'KeyZ', 'KeyC', 'KeyL', 'KeyV', 'KeyP', 'KeyR', 'Enter'];
  const KEYBIT = {};
  LG.KEYS.forEach(function (k, i) { KEYBIT[k] = 1 << i; });

  LG.Tape = function (game, version) { this.game = game; this.version = version; this.rec = null; this.recording = false; this.playing = false; this.onEnd = null; };
  LG.Tape.prototype.begin = function (seed, meta) {
    this.rec = { v: 1, game: this.game, version: this.version, seed, meta: meta || {}, date: new Date().toISOString(), steps: 0, runs: [] };
    this.recording = true; this.playing = false; this.lastRun = null;
  };
  LG.Tape.prototype.capture = function (input) {
    let k = 0, p = 0;
    input.keys.forEach(function (c) { k |= KEYBIT[c] || 0; });
    input.pressed.forEach(function (c) { p |= KEYBIT[c] || 0; });
    const x = input.mx, y = input.my;
    // bits: 1 left held, 2 right held, 4 left pressed, 8 right pressed, 16 mouse moved
    const b = (input.mouseDown.left ? 1 : 0) | (input.mouseDown.right ? 2 : 0) | (input.mousePressed.left ? 4 : 0) | (input.mousePressed.right ? 8 : 0) | (input.mouseMoved ? 16 : 0);
    const last = this.lastRun;
    // a step joins the previous run only when nothing edge-like happened in it
    if (last && !p && !(b & 28) && last[1] === k && last[3] === x && last[4] === y && (last[5] & 3) === (b & 3)) last[0]++;
    else { const run = [1, k, p, x, y, b]; this.rec.runs.push(run); this.lastRun = run; }
    this.rec.steps++;
    if (this.closing) { this.recording = false; this.closing = false; }
  };
  // finish() is called from inside the step that ends the game, so recording
  // closes after that step has been captured, not before
  LG.Tape.prototype.finish = function (result) { if (this.rec && this.recording) { this.rec.result = result; this.closing = true; } };
  LG.Tape.prototype.load = function (rec) {
    this.rec = rec; this.recording = false; this.playing = true;
    this.pos = 0; this.left = rec.runs.length ? rec.runs[0][0] : 0; this.step = 0;
  };
  // Supplies one step of input from the tape; false once it has run out.
  LG.Tape.prototype.apply = function (input) {
    const runs = this.rec.runs;
    if (this.pos >= runs.length) { this.playing = false; return false; }
    const run = runs[this.pos], first = this.left === run[0];
    input.keys.clear(); input.pressed.clear();
    LG.KEYS.forEach(function (c, i) { if (run[1] & (1 << i)) input.keys.add(c); if (first && (run[2] & (1 << i))) input.pressed.add(c); });
    input.mx = run[3]; input.my = run[4];
    input.mouseDown.left = !!(run[5] & 1); input.mouseDown.right = !!(run[5] & 2);
    input.mousePressed.left = first && !!(run[5] & 4); input.mousePressed.right = first && !!(run[5] & 8);
    input.mouseMoved = first && !!(run[5] & 16);
    this.left--; this.step++;
    if (this.left <= 0) { this.pos++; this.left = this.pos < runs.length ? runs[this.pos][0] : 0; }
    return true;
  };
  LG.Tape.prototype.toJSON = function () { return JSON.stringify(this.rec); };
  // 'LGR1:' + base64(gzip(json)): small enough to paste into a message.
  LG.Tape.prototype.toCompact = async function () {
    const json = this.toJSON();
    if (typeof CompressionStream === 'undefined') return 'LGJ1:' + btoa(json);
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'LGR1:' + btoa(bin);
  };
  LG.Tape.parse = async function (text) {
    text = text.trim();
    if (text.startsWith('LGJ1:')) return JSON.parse(atob(text.slice(5)));
    if (text.startsWith('LGR1:')) {
      const bin = atob(text.slice(5)), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(text);
  };
  LG.download = function (name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  LG.newSeed = function () { return ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1; };

  // Wires the shared replay panel: download / copy / load / paste. `watch`
  // is the game's function that replays a parsed tape.
  LG.replayPanel = function (prefix, tape, watch, status) {
    const $ = (id) => document.getElementById(prefix + id);
    const say = (t) => { if (status) status.textContent = t; };
    $('rep-download').onclick = function () {
      if (!tape.rec) return say('Nothing recorded yet.');
      LG.download(tape.game + '-' + tape.rec.date.replace(/[:.]/g, '-').slice(0, 19) + '.json', tape.toJSON());
      say('Saved ' + Math.round(tape.toJSON().length / 1024) + ' KB.');
    };
    $('rep-copy').onclick = async function () {
      if (!tape.rec) return say('Nothing recorded yet.');
      try { const c = await tape.toCompact(); await navigator.clipboard.writeText(c); say('Copied ' + Math.round(c.length / 1024) + ' KB to the clipboard. Paste it into a message.'); }
      catch (e) { say('Could not copy: ' + e.message); }
    };
    $('rep-file').onchange = async function () {
      const f = this.files[0]; if (!f) return;
      try { watch(await LG.Tape.parse(await f.text())); say('Watching ' + f.name); } catch (e) { say('Not a replay: ' + e.message); }
      this.value = '';
    };
    $('rep-paste').onclick = async function () {
      try { const text = await navigator.clipboard.readText(); watch(await LG.Tape.parse(text)); say('Watching the pasted replay.'); }
      catch (e) { say('Could not read a replay from the clipboard: ' + e.message); }
    };
  };

  // Personal bests live in this browser's local storage; absence is never an error.
  LG.store = {
    get(key, def) {
      try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode etc. */ }
    }
  };

  // The translucent panel over the canvas: start screen, pause, results.
  LG.overlay = function (el) {
    return {
      show(html) { el.innerHTML = html; el.classList.add('is-open'); },
      hide() { el.classList.remove('is-open'); },
      el
    };
  };

  // Horizontal "which style did you actually play" bar. t=0 is the left label.
  LG.styleBar = function (left, right, t, note) {
    const p = Math.round(LG.clamp(t, 0, 1) * 100);
    return '<div class="lg-style"><div class="lg-style-labels"><span>' + left + '</span><span>' + right +
      '</span></div><div class="lg-style-bar"><i style="left:' + p + '%"></i></div>' +
      (note ? '<div class="lg-style-note">' + note + '</div>' : '') + '</div>';
  };

  LG.setBar = function (el, frac, cls) {
    el.style.width = Math.round(LG.clamp(frac, 0, 1) * 100) + '%';
    if (cls !== undefined) el.className = 'lg-bar-fill ' + cls;
  };

  // Deterministic PRNG so headless tuning runs are repeatable.
  LG.rng = function (seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  window.LongGame = LG;
})();
