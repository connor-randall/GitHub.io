/* ============================================================================
 * logo-ascii.js — living ASCII wordmark for the home hero
 * ----------------------------------------------------------------------------
 * Renders "CONNOR RANDALL" into a canvas using the block-letter shapes as a
 * mask, then fills each "on" cell with an ASCII glyph that slowly morphs via
 * animated value noise — the same flow-field idea as the page background, so
 * the name shimmers and shifts in the site's steel-blue palette while staying
 * readable (only dense glyphs are used). Mounts into <div id="logo">.
 * Honors prefers-reduced-motion (renders a single static frame).
 * ==========================================================================*/
(function () {
  "use strict";

  // Block-letter mask (figlet "banner3"); any non-space cell is "on".
  var MASK = [
    "      ######   #######  ##    ## ##    ##  #######  ########",
    "     ##    ## ##     ## ###   ## ###   ## ##     ## ##     ##",
    "     ##       ##     ## ####  ## ####  ## ##     ## ##     ##",
    "     ##       ##     ## ## ## ## ## ## ## ##     ## ########",
    "     ##       ##     ## ##  #### ##  #### ##     ## ##   ##",
    "     ##    ## ##     ## ##   ### ##   ### ##     ## ##    ##",
    "      ######   #######  ##    ## ##    ##  #######  ##     ##",
    "",
    "########     ###    ##    ## ########     ###    ##       ##",
    "##     ##   ## ##   ###   ## ##     ##   ## ##   ##       ##",
    "##     ##  ##   ##  ####  ## ##     ##  ##   ##  ##       ##",
    "########  ##     ## ## ## ## ##     ## ##     ## ##       ##",
    "##   ##   ######### ##  #### ##     ## ######### ##       ##",
    "##    ##  ##     ## ##   ### ##     ## ##     ## ##       ##",
    "##     ## ##     ## ##    ## ########  ##     ## ######## ########"
  ];

  // Glyph set the letters churn through — funky/varied. The name periodically
  // resolves to SOLID blocks and freezes, so churn legibility matters less.
  var GLYPHS = "#%@&8B$WMObdpqkhoaeznxsw*+=<>?/\\|()[]{}!7ZX0";
  var GN = GLYPHS.length - 1;
  var SOLID = "█"; // full block — the "solid name appears" glyph

  var host = document.getElementById("logo");
  if (!host) { return; }

  var reduce = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ROWS = MASK.length;
  var COLS = 0;
  for (var i = 0; i < ROWS; i++) { if (MASK[i].length > COLS) { COLS = MASK[i].length; } }

  // Per-cell resolve threshold: as the "solid" front sweeps 0->1, a cell turns
  // solid once its threshold is crossed, so the name materialises with sparkle.
  var thresh = new Float32Array(ROWS * COLS);
  for (var ti = 0; ti < thresh.length; ti++) { thresh[ti] = Math.random(); }

  var canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.width = "100%";
  canvas.style.maxWidth = "560px";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Connor Randall");
  host.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  // ---- value noise --------------------------------------------------------
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
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash(ix, iy), b = hash(ix + 1, iy);
    var c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y) {
    return vnoise(x, y) * 0.65 + vnoise(x * 2.03 + 5.2, y * 2.03 + 1.7) * 0.35;
  }

  // ---- palette (accent -> accent-2, alpha rises with brightness) ----------
  var LEVELS = 16, palette = [];
  function parseColor(str) {
    str = (str || "").trim();
    var m;
    if ((m = str.match(/^#([0-9a-f]{3})$/i))) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    }
    if ((m = str.match(/^#([0-9a-f]{6})$/i))) {
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    }
    if ((m = str.match(/rgba?\(([^)]+)\)/i))) { var p = m[1].split(","); return [+p[0], +p[1], +p[2]]; }
    return [127, 168, 204];
  }
  function buildPalette() {
    var cs = getComputedStyle(document.documentElement);
    var dim = parseColor(cs.getPropertyValue("--accent") || "#7fa8cc");
    var hot = parseColor(cs.getPropertyValue("--accent-2") || "#aac6de");
    palette = [];
    for (var i = 0; i < LEVELS; i++) {
      var t = i / (LEVELS - 1);
      var r = Math.round(dim[0] + (hot[0] - dim[0]) * t);
      var g = Math.round(dim[1] + (hot[1] - dim[1]) * t);
      var b = Math.round(dim[2] + (hot[2] - dim[2]) * t);
      palette.push("rgba(" + r + "," + g + "," + b + "," + (0.55 + 0.45 * t).toFixed(3) + ")");
    }
  }
  buildPalette();
  new MutationObserver(buildPalette).observe(document.documentElement,
    { attributes: true, attributeFilter: ["data-theme"] });

  // ---- sizing -------------------------------------------------------------
  var cellW = 0, cellH = 0, fontSize = 0, dpr = 1;
  function setup() {
    var w = Math.min(host.clientWidth || 560, 560);
    cellW = w / COLS;
    fontSize = cellW / 0.6;
    cellH = fontSize * 1.06;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(ROWS * cellH * dpr);
    canvas.style.height = (ROWS * cellH) + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = fontSize + "px 'Courier New', monospace";
    ctx.textBaseline = "top";
  }

  // ---- draw ---------------------------------------------------------------
  var t0 = performance.now();

  // Phase machine: churn (funky morph) -> resolve (sweep to solid) ->
  // hold (frozen solid: "the name appears") -> dissolve (melt back) -> churn.
  var phase = "churn", phaseStart = 0, phaseDur = 0, inited = false;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function setPhase(p, now, dur) { phase = p; phaseStart = now; phaseDur = dur; }

  function draw(now) {
    if (!inited) { inited = true; setPhase("churn", now, rand(4500, 9000)); }
    var prog = phaseDur > 0 ? (now - phaseStart) / phaseDur : 1;
    if (prog >= 1) {
      if (phase === "churn")        { setPhase("resolve",  now, 430); }
      else if (phase === "resolve") { setPhase("hold",     now, rand(1700, 3200)); }
      else if (phase === "hold")    { setPhase("dissolve", now, 820); }
      else                          { setPhase("churn",    now, rand(4500, 9000)); }
      prog = 0;
    }
    // Fraction of (threshold-sorted) cells currently shown solid.
    var solidP = phase === "churn" ? 0
               : phase === "resolve" ? prog
               : phase === "hold" ? 1
               : 1 - prog; // dissolve

    var time = (now - t0) / 1000 * 0.6;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var r = 0; r < ROWS; r++) {
      var line = MASK[r];
      var y = r * cellH;
      for (var c = 0; c < line.length; c++) {
        if (line.charCodeAt(c) === 32) { continue; } // space = off
        if (solidP > 0 && thresh[r * COLS + c] < solidP) {
          ctx.fillStyle = palette[LEVELS - 1];        // bright, solid
          ctx.fillText(SOLID, c * cellW, y);
          continue;
        }
        // Funky churn: colour and glyph morph on separate, faster noise fields.
        var nb = fbm(c * 0.17 + time, r * 0.30 - time * 0.4);
        var ng = fbm(c * 0.62 - time * 1.7, r * 0.66 + 9.0);
        var lvl = (nb * (LEVELS - 1)) | 0;
        if (lvl < 0) { lvl = 0; } else if (lvl > LEVELS - 1) { lvl = LEVELS - 1; }
        var gi = (ng * GN) | 0;
        if (gi < 0) { gi = 0; } else if (gi > GN) { gi = GN; }
        ctx.fillStyle = palette[lvl];
        ctx.fillText(GLYPHS.charAt(gi), c * cellW, y);
      }
    }
  }

  // Static solid render for reduced-motion (the resolved name, no animation).
  function drawSolid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = palette[LEVELS - 1];
    for (var r = 0; r < ROWS; r++) {
      var line = MASK[r];
      for (var c = 0; c < line.length; c++) {
        if (line.charCodeAt(c) !== 32) { ctx.fillText(SOLID, c * cellW, r * cellH); }
      }
    }
  }

  // ---- run ----------------------------------------------------------------
  var running = true, lastFrame = 0, FRAME_MS = 1000 / 20;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!running || now - lastFrame < FRAME_MS) { return; }
    lastFrame = now;
    draw(now);
  }
  function start() {
    setup();
    if (reduce) { drawSolid(); return; }
    requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", function () { running = !document.hidden; });
  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () { setup(); if (reduce) { drawSolid(); } }, 150);
  });

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); }
  else { start(); }
})();
