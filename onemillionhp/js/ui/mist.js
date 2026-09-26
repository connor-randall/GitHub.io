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

/** Measure one monospace cell in the given element's font. @param {HTMLElement} host */
function cellSize(host) {
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
 * @param {HTMLElement} pre  full-screen <pre>
 * @param {{eye: () => DOMRect | null, ambient?: boolean, fps?: number, maxEyeFrac?: number,
 *          avoid?: () => DOMRect[]}} opts
 *   eye: area to keep clear (and swirl around); ambient: background mode
 *   (fainter ring + edge fog); maxEyeFrac: cap eye width as a fraction of
 *   the screen; avoid: rects (e.g. every line of text) the mist must stay
 *   out of, re-measured on scroll/resize and a few times a second.
 * @returns {Mist}
 */
export function startMist(pre, opts) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fps = opts.fps ?? 18;
  const ambient = Boolean(opts.ambient);
  /** Per-cell multiplier: 0 inside avoided rects, soft falloff around them. */
  let mask = new Float32Array(0);
  let maskDirty = true;
  let maskAt = 0;
  let cell = cellSize(pre);
  let cols = 0, rows = 0;
  const resize = () => {
    cell = cellSize(pre);
    cols = Math.ceil(window.innerWidth / cell.w) + 1;
    rows = Math.ceil(window.innerHeight / cell.h) + 1;
    maskDirty = true;
  };
  resize();
  window.addEventListener("resize", resize);

  const markDirty = () => (maskDirty = true);
  if (opts.avoid) window.addEventListener("scroll", markDirty, { passive: true });

  const buildMask = () => {
    mask = new Float32Array(cols * rows).fill(1);
    if (!opts.avoid) return;
    const PAD = 1; // blank margin around text, in cells
    const SOFT = 2; // thinned band beyond that
    for (const r of opts.avoid()) {
      const x0 = Math.floor(r.left / cell.w), x1 = Math.ceil(r.right / cell.w);
      const y0 = Math.floor(r.top / cell.h), y1 = Math.ceil(r.bottom / cell.h);
      if (x1 < 0 || y1 < 0 || x0 > cols || y0 > rows) continue;
      for (let y = Math.max(0, y0 - PAD - SOFT); y < Math.min(rows, y1 + PAD + SOFT); y++) {
        const dy = y < y0 ? y0 - y : y >= y1 ? y - y1 + 1 : 0;
        for (let x = Math.max(0, x0 - PAD - SOFT); x < Math.min(cols, x1 + PAD + SOFT); x++) {
          const dx = x < x0 ? x0 - x : x >= x1 ? x - x1 + 1 : 0;
          const d = Math.max(dx, dy);
          const m = d <= PAD ? 0 : (d - PAD) / (SOFT + 1);
          const i = y * cols + x;
          if (m < mask[i]) mask[i] = m;
        }
      }
    }
  };

  const t0 = performance.now();
  let raf = 0;
  let last = 0;
  let stopped = false;
  /** Dissipation: 0 = normal, 1 = blown away. */
  let gone = 0;
  /** @type {{t: number, s: number}[]} */
  let ripples = [];

  const render = (/** @type {number} */ now) => {
    const t = (now - t0) / 1000;
    // Text moves (feed updates, tabs switch) without scrolling, so refresh
    // the mask a few times a second as well as on scroll/resize.
    if (maskDirty || now - maskAt > 350 || mask.length !== cols * rows) {
      buildMask();
      maskDirty = false;
      maskAt = now;
    }
    const r = opts.eye();
    const cx = r ? (r.left + r.width / 2) / cell.w : cols / 2;
    const cy = r ? (r.top + r.height / 2) / cell.h : rows / 2;
    const grow = 1 + gone * 2.5; // the eye opens up as the mist blows away
    const rx = Math.min(r ? r.width / cell.w / 2 + 3 : 18, cols * (opts.maxEyeFrac ?? 0.36)) * grow;
    const ry = (r ? r.height / cell.h / 2 + 2 : 5) * grow;
    const fade = 1 - gone;
    ripples = ripples.filter((p) => t - p.t < 2.5);

    let out = "";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const e = Math.sqrt(dx * dx + dy * dy); // 1.0 = edge of the clear eye
        const m = mask[y * cols + x];
        if (e < 1 || m === 0) {
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
          weight = edge * Math.max(ring, 0.18);
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
        const val = Math.max(0, ((n / 3 + 1) / 2) * weight * fade * m * 1.35 - 0.12);
        out += RAMP[Math.min(RAMP.length - 1, Math.floor(val * RAMP.length))];
      }
      out += "\n";
    }
    pre.textContent = out;
  };

  const frame = (/** @type {number} */ now) => {
    if (stopped || !pre.isConnected) return stop();
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / fps) return;
    last = now;
    render(now);
    if (reduced && !ripples.length && gone === 0) cancelAnimationFrame(raf); // one still frame
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("scroll", markDirty);
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
        cancelAnimationFrame(raf);
        requestAnimationFrame(step);
      });
    },
  };
}
