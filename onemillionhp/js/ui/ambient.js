// Background mist around the boss, tinted by phase (hits don't ripple it).

import { overlayOpen } from "./fx.js?v=b6664395f3";
import { startMist } from "./mist.js?v=b6664395f3";

/** @type {import("./mist.js").Mist | null} */
let mist = null;
/** @type {HTMLElement | null} */
let layer = null;

/** A fixed spot on the screen for the swirl to circle: upper-middle of the
 * viewport, sized once. It ignores scrolling, so the background never jumps. */
let eyeRect = new DOMRect();
let eyeWidth = 0;
function fixedEye() {
  const w = window.innerWidth;
  if (w !== eyeWidth) {
    eyeWidth = w;
    const h = Math.max(window.innerHeight, 500);
    const ew = Math.min(440, w * 0.6), eh = h * 0.32;
    eyeRect = new DOMRect((w - ew) / 2, h * 0.38 - eh / 2, ew, eh);
  }
  return eyeRect;
}

// ------------------------------------------------------------- [FX:LOW]
// Low effects for weak computers: the mist is drawn once and stays still, and
// the glow animations (item names, badges) stop (style.css .fx-low). Chosen by
// the player ([FX] in the top bar), or switched on by itself if the page runs
// under 30 frames a second when it opens. A player's own choice always wins.

const FX_KEY = "omhp.fx";
/** @type {"full" | "low" | null} the player's own choice */
let fxChoice = (() => {
  try {
    const v = localStorage.getItem(FX_KEY);
    return v === "low" || v === "full" ? v : null;
  } catch {
    return null;
  }
})();
let fxAuto = false;
/** Frames drawn since the low mode began (one still frame, then nothing). */
let lowFrames = 0;

export const fxLow = () => (fxChoice ?? (fxAuto ? "low" : "full")) === "low";
export const fxAutoLow = () => fxChoice === null && fxAuto;

// A resize clears the canvas: LOW mode draws its one still frame again.
window.addEventListener("resize", () => (lowFrames = 0));

function applyFx() {
  document.documentElement.classList.toggle("fx-low", fxLow());
  lowFrames = 0; // draw one fresh still frame
}

/** The player picked FULL or LOW. @param {boolean} low */
export function setFxLow(low) {
  fxChoice = low ? "low" : "full";
  try {
    localStorage.setItem(FX_KEY, fxChoice);
  } catch {
    /* just for this visit */
  }
  applyFx();
}

/** Watch the first few seconds: under 30 fps, go LOW by itself (unless the
 * player chose). @param {() => void} onChange */
export function watchFrameRate(onChange) {
  applyFx();
  if (fxChoice !== null) return;
  let n = 0;
  let start = 0;
  const step = (/** @type {number} */ t) => {
    if (!start) start = t;
    n++;
    if (t - start < 3000) {
      requestAnimationFrame(step);
      return;
    }
    if (document.visibilityState === "visible" && n / ((t - start) / 1000) < 30 && fxChoice === null) {
      fxAuto = true;
      applyFx();
      onChange();
    }
  };
  setTimeout(() => requestAnimationFrame(step), 2500); // after the page has settled
}

export function startAmbient() {
  layer = document.getElementById("mist-bg");
  if (!layer || mist) return;
  const el = layer;
  mist = startMist(layer, {
    // 14 fps: the same smooth drift as before the canvas (it's cheap to draw now).
    ambient: true, fps: 14, maxEyeFrac: 0.45, eye: fixedEye,
    // Only draw once revealed, and not while a full-screen overlay (intro,
    // name prompt) with its own mist covers it. LOW effects: one still frame.
    active: () => el.classList.contains("shown") && !overlayOpen() && (!fxLow() || lowFrames++ < 1),
  });
}

/** Fade the layer in (used after the name prompt clears). */
export function revealAmbient() {
  layer?.classList.add("shown");
}

/** Tint the mist by boss state (and the boss's own colour, if it has one).
 * @param {number} phase @param {boolean} dead @param {string | null} [tint] */
export function setMood(phase, dead, tint = null) {
  if (layer) {
    if (tint && !dead) layer.style.setProperty("color", tint);
    else layer.style.removeProperty("color");
  }
  if (!layer) return;
  layer.classList.toggle("p2", phase === 2 && !dead);
  layer.classList.toggle("p3", phase >= 3 && !dead);
  layer.classList.toggle("dead", dead);
}
