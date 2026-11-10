// 2X DAMAGE: while the admin's switch is on, a thin trim of ASCII flames
// licks up along the bottom edge of the screen, above the [ 2X DAMAGE ] tag
// (the old Doom fire: a patchy, hidden fuel row whose heat drifts up, cooling
// and swaying as it rises, so it breaks into separate tongues instead of a
// solid wall). Drawn on one canvas, a few hundred characters at most, a few
// times a second, so it stays cheap. It never takes clicks, pauses while the tab is
// hidden, runs slower in LOW FX and stands still for reduced motion.

import { el } from "../ascii.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";

const ROWS = 6;                         // the last one is the hidden fuel row
const CELL = 16;                        // font size in px; columns = screen width / cell width
const MAX = 6;                          // fresh fuel's heat
const CHARS = " .'^*x#";                // cool to hot
const COLORS = ["#5a1408", "#a8230e", "#ff5a1f", "#ffa02e", "#ffe08a"];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {HTMLElement | null} */
let host = null;
/** @type {HTMLCanvasElement | null} */
let canvas = null;
let cols = 0;
let cw = 12;                            // one character's width, measured
let heat = new Uint8Array(0);
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

let font = `${CELL}px monospace`;      // the game's font, read once per resize

/** Size the canvas to the screen and work out how many columns fit. */
function measure() {
  if (!canvas) return;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  font = `${CELL}px ${getComputedStyle(document.body).getPropertyValue("--font").trim() || "monospace"}`;
  ctx.font = font;
  cw = ctx.measureText("M").width || CELL * 0.6;
  cols = Math.ceil(window.innerWidth / cw);
  heat = new Uint8Array(cols * ROWS);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(window.innerWidth * dpr);
  canvas.height = Math.ceil((ROWS - 1) * CELL * dpr);
  canvas.style.height = `${(ROWS - 1) * CELL}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** One step: refuel the bottom row, then every cell takes the heat of the
 * one below it (a little to the side), a little cooler. */
function step() {
  const last = (ROWS - 1) * cols;
  for (let x = 0; x < cols; x++) heat[last + x] = Math.random() < 0.35 ? MAX : 0; // patchy: separate tongues
  for (let y = 1; y < ROWS; y++) {
    for (let x = 0; x < cols; x++) {
      const src = y * cols + x;
      const dst = src - cols + ((Math.random() * 3) | 0) - 1; // sway left, straight or right
      if (dst < 0) continue;
      heat[dst] = Math.max(0, heat[src] - ((Math.random() * 2.6) | 0)); // ~1.3 cooler a row
    }
  }
}

function paint() {
  if (!canvas) return;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.clearRect(0, 0, window.innerWidth, (ROWS - 1) * CELL);
  ctx.font = font;
  ctx.textBaseline = "top";
  for (let y = 0; y < ROWS - 1; y++) { // the fuel row stays hidden
    for (let x = 0; x < cols; x++) {
      const h = heat[y * cols + x];
      if (!h) continue;
      ctx.fillStyle = COLORS[Math.min(COLORS.length - 1, Math.floor((h / (MAX + 1)) * COLORS.length))];
      ctx.fillText(CHARS[Math.min(CHARS.length - 1, Math.round((h / MAX) * (CHARS.length - 1)))], x * cw, y * CELL);
    }
  }
}

function loop() {
  timer = undefined;
  if (!host) return;
  if (document.visibilityState === "visible") {
    step();
    paint();
  }
  if (!reduced) timer = setTimeout(loop, fxLow() ? 250 : 110);
}

function onResize() {
  measure();
  if (reduced) for (let i = 0; i < ROWS * 2; i++) step();
  paint();
}

/** Light the fire (or put it out). @param {boolean} on */
export function setFire(on) {
  if (on === Boolean(host)) return;
  document.body.classList.toggle("fire-on", on);
  if (!on) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    window.removeEventListener("resize", onResize);
    host?.remove();
    host = canvas = null;
    return;
  }
  host = el("div", "fire-fx");
  host.setAttribute("aria-hidden", "true");
  const label = el("div", "fire-label", "[ 2X DAMAGE ]");
  canvas = /** @type {HTMLCanvasElement} */ (el("canvas", "fire-art"));
  host.append(canvas, label);
  document.body.append(host);
  window.addEventListener("resize", onResize);
  onResize();
  loop();
}
