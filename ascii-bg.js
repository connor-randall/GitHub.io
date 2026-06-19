/* ============================================================================
 * ascii-bg.js — interactive ASCII mosaic background for conradrandy.com
 * ----------------------------------------------------------------------------
 * Injects a fixed, full-viewport <canvas> behind all page content and paints a
 * randomized field of ASCII glyphs. The field shimmers gently on its own; as
 * the cursor moves it lights up into a dense, glowing pool of characters that
 * trails the pointer. Reads the page's theme CSS variables (retro/dark/light)
 * so it always matches the active theme, and bakes an opaque colour palette so
 * the per-frame draw stays cheap. Honors prefers-reduced-motion.
 *
 * Self-contained: every page just needs <script src="ascii-bg.js?v=1"></script>
 * ==========================================================================*/
(function () {
  "use strict";

  // Sparse -> dense ramp. Cursor brightness indexes into this, so the hot
  // centre fills with heavy glyphs and the edges fade to dots and spaces.
  var RAMP = " .'`^\",:;Il!i~+_-?][}{1)|/rnvcz*XYUJCLQ0OZmwqpdbkhao#MW&8%B@$";
  // Glyphs used for the ambient (away-from-cursor) mosaic — a calm mix.
  var MOSAIC = "01<>[]{}/\\|=+-*:;.~^abcdef#%@$&XO";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- inject canvas + style ----------------------------------------------
  var style = document.createElement("style");
  style.textContent =
    "#ascii-bg{position:fixed;inset:0;width:100%;height:100%;z-index:-1;" +
    "pointer-events:none;display:block;}" +
    "body{background:transparent !important;}";
  document.head.appendChild(style);

  var canvas = document.createElement("canvas");
  canvas.id = "ascii-bg";
  var ctx = canvas.getContext("2d", { alpha: false });

  function mount() {
    if (!document.body) { return; }
    document.body.insertBefore(canvas, document.body.firstChild);
  }
  if (document.body) { mount(); }
  else { document.addEventListener("DOMContentLoaded", mount); }

  // ---- theme-aware palette -------------------------------------------------
  // Read --bg / --accent / --accent-2 from the document and pre-blend an
  // opaque colour for each brightness level, so the draw loop never builds
  // rgba strings or does alpha compositing.
  var LEVELS = 28;
  var palette = [];
  var bgColor = "#080d08";

  function parseColor(str) {
    str = (str || "").trim();
    var m;
    if ((m = str.match(/^#([0-9a-f]{3})$/i))) {
      return [parseInt(m[1][0] + m[1][0], 16),
              parseInt(m[1][1] + m[1][1], 16),
              parseInt(m[1][2] + m[1][2], 16)];
    }
    if ((m = str.match(/^#([0-9a-f]{6})$/i))) {
      return [parseInt(m[1].slice(0, 2), 16),
              parseInt(m[1].slice(2, 4), 16),
              parseInt(m[1].slice(4, 6), 16)];
    }
    if ((m = str.match(/rgba?\(([^)]+)\)/i))) {
      var p = m[1].split(",");
      return [+p[0], +p[1], +p[2]];
    }
    return [136, 255, 136];
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  function buildPalette() {
    var cs = getComputedStyle(document.documentElement);
    var bg = parseColor(cs.getPropertyValue("--bg") || "#080d08");
    var dim = parseColor(cs.getPropertyValue("--accent") || "#33ff33");
    var hot = parseColor(cs.getPropertyValue("--accent-2") || "#ffff00");
    bgColor = "rgb(" + (bg[0] | 0) + "," + (bg[1] | 0) + "," + (bg[2] | 0) + ")";
    palette = [];
    for (var i = 0; i < LEVELS; i++) {
      var t = i / (LEVELS - 1);
      // Glyph colour shifts from the accent toward the hot accent as it brightens.
      var col = mix(dim, hot, t * t);
      // Alpha: very faint at ambient, opaque under the cursor. Pre-blend over bg.
      var a = 0.05 + Math.pow(t, 1.6) * 0.95;
      var r = Math.round(lerp(bg[0], col[0], a));
      var g = Math.round(lerp(bg[1], col[1], a));
      var b = Math.round(lerp(bg[2], col[2], a));
      palette.push("rgb(" + r + "," + g + "," + b + ")");
    }
  }
  buildPalette();

  // Rebuild palette when the theme attribute changes.
  new MutationObserver(buildPalette).observe(document.documentElement,
    { attributes: true, attributeFilter: ["data-theme"] });

  // ---- grid ----------------------------------------------------------------
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, cols = 0, rows = 0, cellW = 0, cellH = 0, fontSize = 16;
  var mosaicGrid; // per-cell ambient glyph index into MOSAIC

  function setup() {
    W = window.innerWidth;
    H = window.innerHeight;
    fontSize = W < 640 ? 13 : 16;
    cellW = fontSize * 0.6;
    cellH = fontSize * 1.08;
    cols = Math.ceil(W / cellW);
    rows = Math.ceil(H / cellH);

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = fontSize + "px 'Courier New', monospace";
    ctx.textBaseline = "top";

    mosaicGrid = new Uint8Array(cols * rows);
    for (var i = 0; i < mosaicGrid.length; i++) {
      mosaicGrid[i] = (Math.random() * MOSAIC.length) | 0;
    }
  }

  // ---- pointer (eased trail) ----------------------------------------------
  var tx = -9999, ty = -9999;   // raw target
  var px = -9999, py = -9999;   // smoothed
  var RADIUS = 170;

  function move(x, y) { tx = x; ty = y; }
  window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (e.touches[0]) { move(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  window.addEventListener("mouseleave", function () { tx = -9999; ty = -9999; });

  // ---- draw ----------------------------------------------------------------
  var t0 = performance.now();

  function draw(now) {
    var time = (now - t0) / 1000;

    // Ease the pointer for a trailing, liquid feel.
    if (tx < -9000) { px = tx; py = ty; }
    else {
      if (px < -9000) { px = tx; py = ty; }
      px += (tx - px) * 0.12;
      py += (ty - py) * 0.12;
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    var rad2 = RADIUS * RADIUS;
    var lastLevel = -1;
    for (var r = 0; r < rows; r++) {
      var y = r * cellH;
      var cy = y + cellH * 0.5;
      for (var c = 0; c < cols; c++) {
        var x = c * cellW;

        // Gentle diagonal shimmer so the field is alive without the mouse.
        var amb = 0.045 + 0.03 * Math.sin(time * 0.9 + c * 0.35 + r * 0.22);

        // Cursor influence: soft falloff inside RADIUS.
        var inf = 0;
        if (px > -9000) {
          var dx = x - px, dy = cy - py;
          var d2 = dx * dx + dy * dy;
          if (d2 < rad2) {
            inf = 1 - Math.sqrt(d2) / RADIUS;
            inf *= inf; // ease
          }
        }

        var bright = amb + inf;
        if (bright < 0.05) { continue; } // cull near-invisible cells
        if (bright > 1) { bright = 1; }

        var ch;
        if (inf > 0.07) {
          // Near the cursor: index the dense ramp -> glowing blob of glyphs.
          var ri = (Math.pow(inf, 0.7) * (RAMP.length - 1)) | 0;
          ch = RAMP.charAt(ri);
        } else {
          // Ambient: the static randomized mosaic.
          ch = MOSAIC.charAt(mosaicGrid[r * cols + c]);
        }

        var level = (bright * (LEVELS - 1)) | 0;
        if (level !== lastLevel) { ctx.fillStyle = palette[level]; lastLevel = level; }
        ctx.fillText(ch, x, y);
      }
    }

    // Occasionally mutate a few ambient cells for a subtle flicker of life.
    if (mosaicGrid) {
      for (var m = 0; m < 6; m++) {
        var idx = (Math.random() * mosaicGrid.length) | 0;
        mosaicGrid[idx] = (Math.random() * MOSAIC.length) | 0;
      }
    }
  }

  // ---- run -----------------------------------------------------------------
  var running = true;
  var lastFrame = 0;
  var FRAME_MS = 1000 / 30; // throttle: a background doesn't need 60fps
  function loop(now) {
    requestAnimationFrame(loop);
    if (!running || now - lastFrame < FRAME_MS) { return; }
    lastFrame = now;
    draw(now);
  }

  function start() {
    setup();
    if (reduceMotion) {
      // Single static frame, no animation, no pointer reaction.
      px = -9999; py = -9999;
      draw(performance.now());
      return;
    }
    requestAnimationFrame(loop);
  }

  // Pause work when the tab is hidden.
  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
  });

  // Debounced resize.
  var rzTimer;
  window.addEventListener("resize", function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      setup();
      if (reduceMotion) { draw(performance.now()); }
    }, 150);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
