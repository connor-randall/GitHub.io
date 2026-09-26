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
 *          avoid?: () => DOMRect[], frameLayer?: HTMLElement}} opts
 *   eye: area to keep clear (and swirl around); ambient: background mode
 *   (fainter ring + edge fog); maxEyeFrac: cap eye width as a fraction of
 *   the screen; avoid: rects (e.g. every line of text) the mist must stay
 *   out of, re-measured on scroll/resize and a few times a second;
 *   frameLayer: separate <pre> the frames are drawn into, so they can be
 *   styled brighter than the mist.
 * @returns {Mist}
 */
export function startMist(pre, opts) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fps = opts.fps ?? 18;
  const ambient = Boolean(opts.ambient);
  /** Per-cell layout from the avoided rects: 0 open mist, 1 inside a frame
   * (blank), 2 horizontal edge, 3 vertical edge, 4 corner. */
  let kind = new Uint8Array(0);
  /** Extra density just outside frames: mist piles up against them. */
  let pile = new Float32Array(0);
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

  /** Text rects -> cell boxes, merged into blocks, each drawn as a frame. */
  const buildMask = () => {
    kind = new Uint8Array(cols * rows);
    pile = new Float32Array(cols * rows);
    if (!opts.avoid) return;
    /** @type {number[][]} [x0, y0, x1, y1) in cells, text plus 1 col padding */
    const boxes = [];
    for (const r of opts.avoid()) {
      // Round (not floor/ceil) vertically so neighbouring blocks don't
      // swell into each other; always at least one row tall.
      const top = Math.round(r.top / cell.h);
      const b = [Math.floor(r.left / cell.w) - 1, top,
        Math.ceil(r.right / cell.w) + 1, Math.max(top + 1, Math.round(r.bottom / cell.h))];
      if (b[2] < 0 || b[3] < 0 || b[0] > cols || b[1] > rows) continue;
      // Blocks arrive pre-grouped; merge only genuine overlaps. Blocks that
      // merely touch share an edge, like a divider.
      for (let i = 0; i < boxes.length; i++) {
        const o = boxes[i];
        if (b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]) {
          b[0] = Math.min(b[0], o[0]); b[1] = Math.min(b[1], o[1]);
          b[2] = Math.max(b[2], o[2]); b[3] = Math.max(b[3], o[3]);
          boxes.splice(i, 1);
          i = -1; // grown: re-check against everything
        }
      }
      boxes.push(b);
    }
    const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ k) => {
      if (x >= 0 && y >= 0 && x < cols && y < rows && kind[y * cols + x] !== 1) kind[y * cols + x] = k;
    };
    for (const [x0, y0, x1, y1] of boxes) {
      for (let y = Math.max(0, y0); y < Math.min(rows, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) kind[y * cols + x] = 1;
      for (let x = x0; x < x1; x++) {
        set(x, y0 - 1, 2);
        set(x, y1, 2);
      }
      for (let y = y0; y < y1; y++) {
        set(x0 - 1, y, 3);
        set(x1, y, 3);
      }
      for (const [cx, cy] of [[x0 - 1, y0 - 1], [x1, y0 - 1], [x0 - 1, y1], [x1, y1]]) set(cx, cy, 4);
      // Mist piling up against the outside of the frame.
      for (let d = 1; d <= 3; d++) {
        const w = (4 - d) / 4 * 0.45;
        for (let x = x0 - 1 - d; x <= x1 + d; x++) {
          for (const y of [y0 - 1 - d, y1 + d]) {
            if (x >= 0 && y >= 0 && x < cols && y < rows) pile[y * cols + x] = Math.max(pile[y * cols + x], w);
          }
        }
        for (let y = y0 - 1 - d; y <= y1 + d; y++) {
          for (const x of [x0 - 1 - d, x1 + d]) {
            if (x >= 0 && y >= 0 && x < cols && y < rows) pile[y * cols + x] = Math.max(pile[y * cols + x], w);
          }
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
    if (maskDirty || now - maskAt > 350 || kind.length !== cols * rows) {
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
    let frames = "";
    const split = Boolean(opts.frameLayer);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const e = Math.sqrt(dx * dx + dy * dy); // 1.0 = edge of the clear eye
        const k = kind[y * cols + x];
        if (e < 1 || k === 1) {
          out += " ";
          if (split) frames += " ";
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
        weight += pile[y * cols + x];
        const val = Math.max(0, ((n / 3 + 1) / 2) * weight * fade * 1.35 - 0.12);
        if (k > 1) {
          // Frame edge: always drawn, lit up where the mist runs thick.
          const hot = val > 0.5;
          const ch = fade < 0.3 ? " " : k === 2 ? (hot ? "=" : "-") : k === 3 ? (hot ? "#" : "|") : hot ? "#" : "+";
          if (split) {
            frames += ch;
            out += " ";
          } else out += ch;
          continue;
        }
        out += RAMP[Math.min(RAMP.length - 1, Math.floor(val * RAMP.length))];
        if (split) frames += " ";
      }
      out += "\n";
      if (split) frames += "\n";
    }
    pre.textContent = out;
    if (opts.frameLayer) opts.frameLayer.textContent = frames;
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
