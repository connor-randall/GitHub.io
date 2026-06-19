/* ============================================================================
 * ascii-bg.js — organic interactive ASCII background for conradrandy.com
 * ----------------------------------------------------------------------------
 * Injects a fixed, full-viewport <canvas> behind all page content and fills it
 * with a slowly morphing field of ASCII glyphs driven by animated value noise
 * (a flow field), so the whole background reads as one organic, living texture.
 * The cursor REPELS the field: characters near the pointer thin out, dim, and
 * flow outward, leaving a soft bubble that follows the mouse. Reads the page's
 * theme CSS variables (--bg / --accent / --accent-2) so it matches the site's
 * palette, and bakes an opaque colour palette so the per-frame draw stays cheap.
 * Honors prefers-reduced-motion.
 *
 * Self-contained: every page just needs <script src="ascii-bg.js?v=4"></script>
 * ==========================================================================*/
(function () {
  "use strict";

  // Sparse -> dense ramp. The organic field indexes into this by local density,
  // so bright regions of the flow field fill with heavy glyphs and faint
  // regions thin out to dots and spaces.
  var RAMP = " .'`^\",:;Il!i~+_-?][}{1)|/rnvcz*XYUJCLQ0OZmwqpdbkhao#MW&8%B@$";

  // ---- tunables ------------------------------------------------------------
  var NOISE_FREQ = 0.052;   // flow-field scale (smaller = larger organic blobs)
  var ASPECT = 1.8;         // vertical freq multiplier so blobs read round
  var WARP = 1.1;           // domain-warp amount (organic swirl vs. plain blobs)
  var FLOW_SPEED = 0.22;    // how fast the field morphs/drifts
  var AMB_MIN = 0.05;       // dimmest ambient brightness
  var AMB_MAX = 0.30;       // brightest ambient brightness
  var REPEL_RADIUS = 270;   // px radius the cursor pushes characters away
  var REPEL_STRENGTH = 0.9; // how strongly the bubble dims (0..1)
  var PUSH = 0.8;           // how far the field flows around the cursor

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

  // ---- value noise + fbm (the organic flow field) -------------------------
  function hash(ix, iy) {
    var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
  }
  function vnoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);
    var uy = fy * fy * (3 - 2 * fy);
    var a = hash(ix, iy), b = hash(ix + 1, iy);
    var c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y) {
    return vnoise(x, y) * 0.65 + vnoise(x * 2.03 + 5.2, y * 2.03 + 1.7) * 0.35;
  }

  // ---- theme-aware palette -------------------------------------------------
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
      // Glyph colour eases from the accent toward the hot accent as it brightens.
      var col = mix(dim, hot, t * t);
      // Alpha rises with brightness; pre-blend over bg so the draw is opaque.
      var a = 0.05 + Math.pow(t, 1.5) * 0.95;
      var r = Math.round(lerp(bg[0], col[0], a));
      var g = Math.round(lerp(bg[1], col[1], a));
      var b = Math.round(lerp(bg[2], col[2], a));
      palette.push("rgb(" + r + "," + g + "," + b + ")");
    }
  }
  buildPalette();

  new MutationObserver(buildPalette).observe(document.documentElement,
    { attributes: true, attributeFilter: ["data-theme"] });

  // ---- grid ----------------------------------------------------------------
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, cols = 0, rows = 0, cellW = 0, cellH = 0, fontSize = 16;
  var jitter; // small per-cell glyph randomness so contours aren't too smooth

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

    jitter = new Float32Array(cols * rows);
    for (var i = 0; i < jitter.length; i++) { jitter[i] = Math.random(); }
  }

  // ---- pointer (eased trail) ----------------------------------------------
  var tx = -9999, ty = -9999;   // raw target
  var px = -9999, py = -9999;   // smoothed
  function move(x, y) { tx = x; ty = y; }
  window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (e.touches[0]) { move(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  window.addEventListener("mouseleave", function () { tx = -9999; ty = -9999; });

  // ---- draw ----------------------------------------------------------------
  var t0 = performance.now();
  var RAMPN = RAMP.length - 1;

  function draw(now) {
    var time = (now - t0) / 1000 * FLOW_SPEED;

    // Ease the pointer for a trailing, liquid feel.
    if (tx < -9000) { px = tx; py = ty; }
    else {
      if (px < -9000) { px = tx; py = ty; }
      px += (tx - px) * 0.14;
      py += (ty - py) * 0.14;
    }
    var active = px > -9000;
    var R2 = REPEL_RADIUS * REPEL_RADIUS;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    var lastLevel = -1;
    for (var r = 0; r < rows; r++) {
      var y = r * cellH;
      var cy = y + cellH * 0.5;
      var fyBase = r * NOISE_FREQ * ASPECT;
      for (var c = 0; c < cols; c++) {
        var x = c * cellW;
        var fx = c * NOISE_FREQ;
        var fy = fyBase;
        var dim = 1;

        // Cursor repulsion: thin/dim the field and push it outward.
        if (active) {
          var dx = x + cellW * 0.5 - px;
          var dy = cy - py;
          var d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            var d = Math.sqrt(d2);
            var rep = 1 - d / REPEL_RADIUS;
            rep *= rep;
            dim = 1 - REPEL_STRENGTH * rep;
            if (d > 0.001) {
              var inv = (rep * PUSH) / d;
              fx += dx * inv;       // sample further "out" -> field flows around
              fy += dy * inv * ASPECT;
            }
          }
        }

        // Animated domain-warped value noise -> organic, morphing density.
        var w = vnoise(fx * 0.6 + time, fy * 0.6 - time * 0.5);
        var n = fbm(fx + w * WARP - time * 0.5, fy + w * WARP * 0.5);

        var bright = (AMB_MIN + n * (AMB_MAX - AMB_MIN)) * dim;
        if (bright < 0.045) { continue; }
        if (bright > 1) { bright = 1; }

        var gi = ((n * 0.85 + jitter[r * cols + c] * 0.15) * RAMPN) | 0;
        var level = (bright * (LEVELS - 1)) | 0;
        if (level !== lastLevel) { ctx.fillStyle = palette[level]; lastLevel = level; }
        ctx.fillText(RAMP.charAt(gi), x, y);
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
      px = -9999; py = -9999;
      draw(performance.now()); // single static frame, no animation
      return;
    }
    requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", function () {
    running = !document.hidden;
  });

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
