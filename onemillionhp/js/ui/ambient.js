// Background mist around the boss: tinted by phase, rippling on hits.

import { startMist } from "./mist.js?v=5fd73ddd5d";

/** @type {import("./mist.js").Mist | null} */
let mist = null;
/** @type {HTMLElement | null} */
let layer = null;

/** Screen rects of every visible line of text in the game, so the mist can
 * stay out from behind it. */
function textRects() {
  const app = document.getElementById("app");
  if (!app) return [];
  /** @type {DOMRect[]} */
  const rects = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const vh = window.innerHeight;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest("[hidden], #popups")) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width && r.bottom > 0 && r.top < vh) rects.push(r);
    }
  }
  // Inputs and buttons draw their own boxes; keep those clear too.
  app.querySelectorAll("button, input, select").forEach((b) => {
    const r = b.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < vh) rects.push(r);
  });
  return rects;
}

export function startAmbient() {
  layer = document.getElementById("mist-bg");
  const boss = document.getElementById("boss-art");
  if (!layer || !boss || mist) return;
  mist = startMist(layer, {
    ambient: true,
    fps: 14,
    maxEyeFrac: 0.45,
    avoid: textRects,
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
