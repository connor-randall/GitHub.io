// Background mist around the boss: tinted by phase, rippling on hits.

import { startMist } from "./mist.js?v=292b438de3";

/** @type {import("./mist.js").Mist | null} */
let mist = null;
/** @type {HTMLElement | null} */
let layer = null;
/** @type {HTMLElement | null} */
let frameLayer = null;

/** Blocks that each get one ASCII frame in the mist. Text inside one of
 * these is framed together; anything else is framed on its own. */
const FRAME_BLOCKS = [
  ".top .logo", ".statusline", ".boss-num", ".boss-name", ".boss-sub", ".taunt", ".hp", "#name-nag",
  "#btn-attack", ".pips", ".reset-in", "#btn-ult", ".ult-warn", ".keys", ".lasthit", ".globals",
  ".tabs", ".panel", ".dead-box", ".foot p",
].join(", ");

/** One screen rect per framed block: the union of the text inside it (tight
 * around the words, not the full-width element). */
function textRects() {
  const app = document.getElementById("app");
  if (!app) return [];
  /** @type {Map<Element, {l: number, t: number, r: number, b: number}>} */
  const groups = new Map();
  const add = (/** @type {Element} */ key, /** @type {DOMRect} */ r) => {
    const g = groups.get(key);
    if (g) {
      g.l = Math.min(g.l, r.left); g.t = Math.min(g.t, r.top);
      g.r = Math.max(g.r, r.right); g.b = Math.max(g.b, r.bottom);
    } else groups.set(key, { l: r.left, t: r.top, r: r.right, b: r.bottom });
  };
  const range = document.createRange();
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const vh = window.innerHeight;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    // Boss art has the eye; decorative ===== rules don't need frames.
    if (!parent || parent.closest("[hidden], #popups, #boss-art, .rule")) continue;
    const key = parent.closest(FRAME_BLOCKS) ?? parent;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width && r.bottom > 0 && r.top < vh) add(key, r);
    }
  }
  // Buttons and inputs draw their own boxes; frame the whole control.
  app.querySelectorAll("button, input, select").forEach((b) => {
    if (b.closest("[hidden]")) return;
    const r = b.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < vh) add(b.closest(FRAME_BLOCKS) ?? b, r);
  });
  return [...groups.values()].map((g) => new DOMRect(g.l, g.t, g.r - g.l, g.b - g.t));
}

export function startAmbient() {
  layer = document.getElementById("mist-bg");
  frameLayer = document.getElementById("mist-frames");
  const boss = document.getElementById("boss-art");
  if (!layer || !boss || mist) return;
  mist = startMist(layer, {
    ambient: true,
    fps: 14,
    maxEyeFrac: 0.45,
    avoid: textRects,
    frameLayer: frameLayer ?? undefined,
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
  frameLayer?.classList.add("shown");
}

/** @param {number} strength 0.2 (someone else's hit) .. 1.5 (ultimate) */
export function pulse(strength) {
  mist?.pulse(strength);
}

/** Tint the mist by boss state. @param {number} phase @param {boolean} dead */
export function setMood(phase, dead) {
  for (const el of [layer, frameLayer]) {
    if (!el) continue;
    el.classList.toggle("p2", phase === 2 && !dead);
    el.classList.toggle("p3", phase >= 3 && !dead);
    el.classList.toggle("dead", dead);
  }
}
