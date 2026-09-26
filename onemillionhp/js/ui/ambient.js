// Background mist around the boss: tinted by phase, rippling on hits.

import { startMist } from "./mist.js?v=f1fae6ed81";

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

export function startAmbient() {
  layer = document.getElementById("mist-bg");
  if (!layer || mist) return;
  mist = startMist(layer, { ambient: true, fps: 14, maxEyeFrac: 0.45, eye: fixedEye });
}

/** Fade the layer in (used after the name prompt clears). */
export function revealAmbient() {
  layer?.classList.add("shown");
}

/** @param {number} strength 0.2 (someone else's hit) .. 1.5 (ultimate) */
export function pulse(strength) {
  mist?.pulse(strength);
}

/** Tint the mist by boss state. @param {number} phase @param {boolean} dead */
export function setMood(phase, dead) {
  if (!layer) return;
  layer.classList.toggle("p2", phase === 2 && !dead);
  layer.classList.toggle("p3", phase >= 3 && !dead);
  layer.classList.toggle("dead", dead);
}
