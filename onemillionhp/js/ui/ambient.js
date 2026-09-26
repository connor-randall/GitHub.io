// Background mist around the boss: tinted by phase, rippling on hits.

import { startMist } from "./mist.js?v=baded90f5e";

/** @type {import("./mist.js").Mist | null} */
let mist = null;
/** @type {HTMLElement | null} */
let layer = null;

export function startAmbient() {
  layer = document.getElementById("mist-bg");
  const boss = document.getElementById("boss-art");
  if (!layer || !boss || mist) return;
  mist = startMist(layer, {
    ambient: true,
    fps: 14,
    maxEyeFrac: 0.45,
    eye: () => {
      const r = boss.getBoundingClientRect();
      // Boss scrolled away or hidden (death screen): swirl around the page centre.
      return r.width && r.bottom > 0 && r.top < window.innerHeight ? r : null;
    },
  });
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
