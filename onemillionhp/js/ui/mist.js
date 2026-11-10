// Drifting ASCII mist that swirls around a clear "eye" (the name box, or
// the boss).
//
// Each frame fills a full-screen <pre> with characters from a light-to-dense
// ramp. Density = a smooth flowing field (layered sines in polar coordinates,
// so it slowly rotates around the eye and drifts outward) times a weight:
// a ring hugging the eye, faint haze, and (ambient mode) fog at the screen
// edges. Ripples are rings that expand from the eye when something hits.

const RAMP = " .'`,:;-~=+*";

/** @typedef {{stop: () => void, dissipate: (ms: number) => Promise<void>, pulse: (strength: number) => void}} Mist */

// The mist waits for the page to finish loading (fonts, scripts) before it
// starts drawing; on a slow phone that alone made loading ~5x faster.
let pageReady = document.readyState === "complete";
if (!pageReady) {
  window.addEventListener("load", () => setTimeout(() => (pageReady = true), 120), { once: true });
}

/** The font a <canvas> mist draws with: the element's own CSS font. @param {HTMLElement} host */
const canvasFont = (host) => {
  const cs = getComputedStyle(host);
  return `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
};

/** Measure one monospace cell in the given element's font. @param {HTMLElement} host */
function cellSize(host) {
  if (host instanceof HTMLCanvasElement) {
    const ctx = /** @type {CanvasRenderingContext2D} */ (host.getContext("2d"));
    ctx.font = canvasFont(host);
    const cs = getComputedStyle(host);
    const size = parseFloat(cs.fontSize) || 12;
    return { w: ctx.measureText("M".repeat(20)).width / 20 || 7, h: parseFloat(cs.lineHeight) || size * 1.15 };
  }
  const probe = document.createElement("span");
  probe.textContent = "M".repeat(20);
  probe.style.setProperty("visibility", "hidden");
  probe.style.setProperty("position", "absolute");
  host.append(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { w: r.width / 20 || 7, h: parseFloat(getComputedStyle(host).lineHeight) || r.height || 13 };
}

/**
 * @param {HTMLElement} pre  full-screen <pre>, or a <canvas>: the same characters drawn as
 *   pixels at 1x (no text layout, no hi-DPI raster: far cheaper for the
 *   always-on background)
 * @param {{eye: () => DOMRect | null, ambient?: boolean, fps?: number, maxEyeFrac?: number,
 *          active?: () => boolean, eyeScale?: () => number, density?: () => number,
 *          fill?: () => number}} opts
 *   eye: area to keep clear (and swirl around); ambient: background mode
 *   (fainter ring + edge fog); maxEyeFrac: cap eye width as a fraction of
 *   the screen; active: return false to skip drawing (e.g. while hidden);
 *   eyeScale: shrink (<1) or widen (>1) the clear eye, e.g. to swallow the
 *   boss; density: extra thickness (1 = normal); fill: mist everywhere, not
 *   just in the ring (0 = none, 1 = a solid wall).
 * @returns {Mist}
 */
export function startMist(pre, opts) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones get fewer frames: the mist is decoration, the game comes first.
  const small = window.innerWidth < 700;
  const fps = Math.min(opts.fps ?? 18, small ? 12 : 18);
  const ambient = Boolean(opts.ambient);
  const canvas = pre instanceof HTMLCanvasElement ? pre : null;
  const ctx = canvas?.getContext("2d") ?? null;
  let cell = cellSize(pre);
  let cols = 0, rows = 0;
  // Phones resize the viewport as the address bar hides/shows while
  // scrolling. Only rebuild the grid when the width changes or the screen
  // grows, so scrolling never makes the mist jump.
  let lastW = 0;
  const resize = () => {
    const w = window.innerWidth;
    const newRows = Math.ceil(window.innerHeight / cell.h) + 1;
    if (w === lastW && newRows <= rows) return;
    lastW = w;
    cell = cellSize(pre);
    cols = Math.ceil(w / cell.w) + 1;
    rows = Math.max(newRows, Math.ceil(window.innerHeight / cell.h) + 1);
    if (canvas) {
      canvas.width = Math.ceil(w);
      canvas.height = Math.ceil(rows * cell.h);
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
    }
  };
  resize();
  window.addEventListener("resize", resize);

  const t0 = performance.now();
  let raf = 0;
  let timer = 0;
  let stopped = false;
  /** Dissipation: 0 = normal, 1 = blown away. */
  let gone = 0;
  /** @type {{t: number, s: number}[]} */
  let ripples = [];

  const render = (/** @type {number} */ now) => {
    const t = (now - t0) / 1000;
    const r = opts.eye();
    const cx = r ? (r.left + r.width / 2) / cell.w : cols / 2;
    const cy = r ? (r.top + r.height / 2) / cell.h : rows / 2;
    const grow = Math.max(0.02, (1 + gone * 2.5) * (opts.eyeScale?.() ?? 1)); // the eye opens up as the mist blows away
    const thick = opts.density?.() ?? 1;
    const fill = opts.fill?.() ?? 0;
    const rx = Math.min(r ? r.width / cell.w / 2 + 3 : 18, cols * (opts.maxEyeFrac ?? 0.36)) * grow;
    const ry = (r ? r.height / cell.h / 2 + 2 : 5) * grow;
    const fade = 1 - gone;
    ripples = ripples.filter((p) => t - p.t < 2.5);

    /** @type {string[]} */
    const lines = [];
    for (let y = 0; y < rows; y++) {
      let out = "";
      for (let x = 0; x < cols; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const e = Math.sqrt(dx * dx + dy * dy); // 1.0 = edge of the clear eye
        if (e < 1) {
          out += " ";
          continue;
        }
        const edge = Math.min(1, (e - 1) / 0.35);
        const ring = Math.exp(-((e - 1.7) ** 2) / 0.9);
        let weight;
        if (ambient) {
          // Fog creeping in from the screen edges + a looser ring round the boss.
          const ex = Math.abs(x / cols - 0.5) * 2, ey = Math.abs(y / rows - 0.5) * 2;
          const border = Math.max(ex, ey) ** 4 * 0.7;
          const wide = Math.exp(-((e - 2.0) ** 2) / 1.8); // looser, wider swirl
          weight = edge * Math.max(wide * 1.05, border, 0.05);
        } else {
          weight = edge * Math.max(ring, 0.18, fill);
        }
        // Ripples: rings racing outward from the eye after a hit.
        for (const p of ripples) {
          const age = t - p.t;
          const band = Math.exp(-((e - (1.1 + age * 3.2)) ** 2) / 0.12);
          weight += band * p.s * Math.exp(-age * 1.6);
        }
        // Polar flow: rotates slowly around the eye and drifts outward.
        const a = Math.atan2(dy, dx);
        const u = a * 3 + t * 0.35;
        const v = e * 2.2 - t * 0.9;
        const n =
          Math.sin(u + Math.sin(v * 0.8 + t * 0.4) * 1.6) +
          Math.sin(v * 1.3 - Math.sin(u * 0.7 - t * 0.3) * 1.4) +
          Math.sin(x * 0.21 + y * 0.37 + t * 0.6);
        const val = Math.max(0, ((n / 3 + 1) / 2) * weight * fade * 1.35 * thick - 0.12);
        out += RAMP[Math.min(RAMP.length - 1, Math.floor(val * RAMP.length))];
      }
      lines.push(out);
    }
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = canvasFont(canvas);
      ctx.fillStyle = getComputedStyle(canvas).color; // follows the phase tint (and its fade)
      ctx.textBaseline = "top";
      lines.forEach((line, y) => ctx.fillText(line, 0, y * cell.h));
    } else {
      pre.textContent = lines.join("\n");
    }
  };

  // Wake only when a frame is due (a timer), then draw on the next animation
  // frame. Polling requestAnimationFrame 60 times a second to skip most of
  // them kept the whole page producing 60 frames a second for nothing.
  const schedule = () => {
    timer = window.setTimeout(() => (raf = requestAnimationFrame(frame)), 1000 / fps);
  };
  const frame = (/** @type {number} */ now) => {
    if (stopped || !pre.isConnected) return stop();
    // Don't compete with the page while it's still loading, and don't draw
    // mist nobody can see.
    if (pageReady && (!opts.active || opts.active())) {
      render(now);
      if (reduced && !ripples.length && gone === 0) return; // one still frame
    }
    schedule();
  };

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };

  raf = requestAnimationFrame(frame);

  return {
    stop,
    pulse(strength) {
      if (reduced || stopped) return;
      ripples.push({ t: (performance.now() - t0) / 1000, s: strength });
      if (ripples.length > 6) ripples.shift();
    },
    dissipate(ms) {
      return new Promise((resolve) => {
        if (reduced || stopped) {
          stop();
          resolve();
          return;
        }
        const start = performance.now();
        const step = () => {
          gone = Math.min(1, (performance.now() - start) / ms);
          render(performance.now());
          if (gone < 1) requestAnimationFrame(step);
          else {
            stop();
            resolve();
          }
        };
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        requestAnimationFrame(step);
      });
    },
  };
}
