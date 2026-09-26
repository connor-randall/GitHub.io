// Drifting ASCII mist that swirls around a clear "eye" (e.g. a name box).
//
// Each frame fills a full-screen <pre> with characters from a light-to-dense
// ramp. Density = a smooth flowing field (layered sines in polar coordinates,
// so it slowly rotates around the eye and drifts outward) times a ring
// weight that hugs the eye and fades to faint haze further out.

const RAMP = " .'`,:;-~=+*";
const FPS = 18;

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
 * @param {HTMLElement} pre       full-screen <pre class="mist">
 * @param {() => DOMRect | null} eye  area to keep clear (and swirl around)
 * @returns {() => void} stop
 */
export function startMist(pre, eye) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cell = cellSize(pre);
  let cols = 0, rows = 0;
  const resize = () => {
    cell = cellSize(pre);
    cols = Math.ceil(window.innerWidth / cell.w) + 1;
    rows = Math.ceil(window.innerHeight / cell.h) + 1;
  };
  resize();
  window.addEventListener("resize", resize);

  const t0 = performance.now();
  let raf = 0;
  let last = 0;

  const frame = (/** @type {number} */ now) => {
    if (!pre.isConnected) return stop();
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS && !reduced) return;
    last = now;
    const t = (now - t0) / 1000;

    // Eye geometry in cell units (y doubled-ish: cells are taller than wide).
    const r = eye();
    const cx = r ? (r.left + r.width / 2) / cell.w : cols / 2;
    const cy = r ? (r.top + r.height / 2) / cell.h : rows / 2;
    // On narrow screens the box is nearly full width; cap the clear eye so
    // the mist still curls in along the sides (it sits behind the text).
    const rx = Math.min(r ? r.width / cell.w / 2 + 3 : 18, cols * 0.36);
    const ry = r ? r.height / cell.h / 2 + 2 : 5;

    let out = "";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const e = Math.sqrt(dx * dx + dy * dy); // 1.0 = edge of the clear eye
        if (e < 1) {
          out += " ";
          continue;
        }
        // Ring hugging the eye, then a faint haze everywhere else.
        const edge = Math.min(1, (e - 1) / 0.35);
        const ring = Math.exp(-((e - 1.7) ** 2) / 0.9);
        const weight = edge * Math.max(ring, 0.18);
        // Polar flow: rotates slowly around the eye and drifts outward.
        const a = Math.atan2(dy, dx);
        const u = a * 3 + t * 0.35;
        const v = e * 2.2 - t * 0.9;
        const n =
          Math.sin(u + Math.sin(v * 0.8 + t * 0.4) * 1.6) +
          Math.sin(v * 1.3 - Math.sin(u * 0.7 - t * 0.3) * 1.4) +
          Math.sin((x * 0.21 + y * 0.37) + t * 0.6);
        const val = Math.max(0, ((n / 3 + 1) / 2) * weight * 1.35 - 0.12);
        out += RAMP[Math.min(RAMP.length - 1, Math.floor(val * RAMP.length))];
      }
      out += "\n";
    }
    pre.textContent = out;
    if (reduced) stop();
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
  raf = requestAnimationFrame(frame);
  return stop;
}
