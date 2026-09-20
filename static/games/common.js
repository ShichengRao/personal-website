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
  LG.loop = function (update, render, input) {
    const STEP = 1 / 120;
    let last = 0, acc = 0, running = false, raf = 0;
    function frame(now) {
      if (!running) return;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      while (acc >= STEP) { update(STEP); if (input) input.flush(); acc -= STEP; }
      render();
      raf = requestAnimationFrame(frame);
    }
    return {
      start() { if (running) return; running = true; last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; }
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
