// Someone forged a SOVEREIGN piece: on every open page the screen goes black
// and everyone watches. A wall of the game's ASCII fog fills the screen, then
// parts around the anvil; a stick figure walks slowly up with a hammer,
// raises it, slams it down, sparks fly, "NAME FORGED <$ SOVEREIGN $> ITEM"
// types out, and the fog rolls back in to close the scene. It can't be skipped (a
// must-choose overlay with no buttons: no click, Escape or tab closes it, and
// attack keys are ignored while it's up); scenes queue if several land at once.

import { el } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { itemById } from "../store.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";
import { shake, showOverlay } from "./fx.js?v=b6664395f3";
import { startMist } from "./mist.js?v=b6664395f3";

const W = 46;          // columns
const H = 8;           // rows; row 7 is the ground
const AX = 30;         // the anvil's left edge
const STOP = AX - 6;   // where the smith stops
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Ripples the fog when the hammer lands (set while a scene plays). */
let hits = () => {};

/** @typedef {{ch: string, cls: string}} Cell */
/** Someone's forge ({name, item_id, first}) or the admin's teaser ({text}).
 * @typedef {{name?: string, item_id: string, first?: boolean, text?: string}} Forged */

/** An empty scene with the ground and the anvil. @param {boolean} hot anvil top white-hot */
function base(hot = false) {
  /** @type {Cell[][]} */
  const g = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: " ", cls: "" })));
  for (let x = 0; x < W; x++) g[7][x] = { ch: "_", cls: "fs-ground" };
  const anvil = [
    [4, " _________ "],
    [5, " \\_______/=="],
    [6, "    | |    "],
    [7, "   /___\\   "],
  ];
  for (const [row, s] of /** @type {[number, string][]} */ (anvil)) put(g, row, AX, s, row === 4 && hot ? "fs-hot" : "fs-anvil");
  return g;
}

/** @param {Cell[][]} g @param {number} row @param {number} col @param {string} s @param {string} cls */
function put(g, row, col, s, cls) {
  [...s].forEach((ch, i) => {
    const x = col + i;
    if (ch !== " " && row >= 0 && row < H && x >= 0 && x < W) g[row][x] = { ch, cls };
  });
}

/** The smith, hammer held out in front, legs apart or together. @param {Cell[][]} g @param {number} x @param {number} step */
function walker(g, x, step) {
  put(g, 4, x, " o", "fs-man");
  put(g, 5, x, "/|\\", "fs-man");
  put(g, 5, x + 3, "=", "fs-handle");
  put(g, 5, x + 4, "#", "fs-head");
  put(g, 6, x, step % 2 ? " |" : "/ \\", "fs-man");
}

/** Hammer up over the head. @param {Cell[][]} g @param {number} x */
function raised(g, x) {
  put(g, 1, x + 2, "##", "fs-head");
  put(g, 2, x + 2, "/", "fs-handle");
  put(g, 3, x + 2, "/", "fs-handle");
  put(g, 4, x, " o/", "fs-man");
  put(g, 5, x, "/|", "fs-man");
  put(g, 6, x, "/ \\", "fs-man");
}

/** Hammer down flat on the anvil, the handle back to the hand. @param {Cell[][]} g @param {number} x */
function slammed(g, x) {
  put(g, 4, x, " o", "fs-man");
  put(g, 5, x, "/|\\", "fs-man");
  put(g, 4, x + 3, "_".repeat(AX + 2 - x - 3), "fs-handle");
  put(g, 4, AX + 2, "##", "fs-head");
  put(g, 6, x, "/ \\", "fs-man");
}

/** @type {{x: number, y: number, vx: number, vy: number, ch: string, cls: string}[]} */
let sparks = [];
function burst() {
  const ox = AX + 3; // where the hammer hit
  sparks = Array.from({ length: 22 }, (_, i) => ({
    x: ox, y: 3,
    vx: (Math.random() - 0.5) * 5.5,
    vy: -0.6 - Math.random() * 1.6,
    ch: "*+.'`*"[i % 6],
    cls: `fs-spark-${i % 3}`,
  }));
}
/** @param {Cell[][]} g */
function drawSparks(g) {
  for (const s of sparks) {
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (y >= 0 && y < 7 && x >= 0 && x < W) g[y][x] = { ch: s.ch, cls: s.cls };
    s.x += s.vx;
    s.y += s.vy;
    s.vy += 0.55; // they fall back down
  }
}

/** The grid as coloured runs. @param {HTMLElement} pre @param {Cell[][]} g */
function paint(pre, g) {
  /** @type {(Node | string)[]} */
  const out = [];
  g.forEach((row, r) => {
    let run = "";
    let cls = "";
    for (const c of row) {
      if (c.cls !== cls && run) {
        out.push(cls ? el("span", cls, run) : run);
        run = "";
      }
      cls = c.cls;
      run += c.ch;
    }
    if (run) out.push(cls ? el("span", cls, run) : run);
    if (r < H - 1) out.push("\n");
  });
  pre.replaceChildren(...out);
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {Forged} e */
function play(e) {
  // A tab in the background: its timers crawl, so the scene would still be
  // walking when they come back. Only pages someone is looking at play it.
  if (document.visibilityState !== "visible") return Promise.resolve();
  return showOverlay((inner, close) => {
    const overlay = inner.parentElement;
    overlay?.classList.add("forge-blackout");
    const host = el("div", "forge-scene");
    host.setAttribute("role", "status");
    const pre = el("pre", "forge-scene-art");
    const line = el("div", "forge-scene-text");
    host.append(pre, line);
    inner.append(host);
    // The fog: the same as the page background's (ambient mode on a canvas:
    // wisps hugging the edges and swirling in a loose ring around a clear
    // middle). It fades in already closed over the middle, drifts back out
    // to the edges to show the anvil, then closes in again to end it.
    const quick = reduced || fxLow();
    const mistEl = /** @type {HTMLCanvasElement} */ (el("canvas", "mist-bg forge-mist"));
    mistEl.setAttribute("aria-hidden", "true");
    overlay?.prepend(mistEl);
    const fog = { eyeScale: 0.7 };
    const mist = startMist(mistEl, {
      ambient: true, fps: 14, maxEyeFrac: 0.45,
      eye: () => host.getBoundingClientRect(),
      eyeScale: () => fog.eyeScale,
    });
    hits = () => mist.pulse(1.2);
    const shown = (/** @type {number} */ v) => (host.style.opacity = String(v));
    const fogged = (/** @type {number} */ v) => (mistEl.style.opacity = String(0.42 * v));
    // Draw the opening frame now: the fog's clear middle is sized to the
    // scene, and an empty scene would make it a tiny blob.
    const first = base();
    walker(first, 0, 0);
    paint(pre, first);
    line.textContent = " ";
    (async () => {
      shown(0);
      fogged(0);
      if (!quick) {
        await tween(1000, fogged);     // the fog fades in, close around the middle...
        await tween(1900, (p) => {     // ...and drifts back out to the edges
          fog.eyeScale = 0.7 + p * 0.3;
          shown(p);
        });
      } else {
        fog.eyeScale = 1;
        fogged(1);
        shown(1);
      }
      await animate(e, host, pre, line);
      if (!quick) {
        await tween(1600, (p) => {     // the fog closes back in over it
          fog.eyeScale = 1 - p * 0.3;
          shown(1 - p);
        });
        await tween(600, (p) => fogged(1 - p));
      }
    })().finally(() => {
      mist.stop();
      mistEl.remove();
      overlay?.classList.remove("forge-blackout");
      close();
    });
  }, { mustChoose: true });
}

/** Run ``fn(p)`` for p from 0 to 1 over ``ms`` (eased), once a frame.
 * @param {number} ms @param {(p: number) => void} fn */
function tween(ms, fn) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      fn(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      if (t < 1) requestAnimationFrame(step);
      else resolve(undefined);
    };
    requestAnimationFrame(step);
  });
}

/** @param {Forged} e @param {HTMLElement} host
 * @param {HTMLElement} pre @param {HTMLElement} line */
async function animate(e, host, pre, line) {
  const item = itemById(e.item_id);
  const quick = reduced || fxLow();
  if (!quick) {
    for (let x = 0; x <= STOP; x++) { // walking up, slowly
      const g = base();
      walker(g, x, x);
      paint(pre, g);
      await wait(150);
    }
    await wait(250);
    let g = base();
    walker(g, STOP, 0);
    paint(pre, g);
    await wait(200);
    g = base();
    raised(g, STOP);
    paint(pre, g);
    await wait(520);
  }
  // SLAM
  hits();
  sound.hit();
  sound.crit();
  if (!quick) shake("s");
  burst();
  for (let f = 0; f < (quick ? 0 : 9); f++) {
    const g = base(f < 3);
    slammed(g, STOP);
    drawSparks(g);
    paint(pre, g);
    await wait(85);
  }
  const still = base();  // the sparks have died down
  slammed(still, STOP);
  paint(pre, still);
  // NAME FORGED <$ SOVEREIGN $> ITEM, typed out
  const parts = /** @type {[string, string][]} */ (e.text ? [[e.text, "forge-scene-teaser"]] : [
    [e.first ? "FIRST EVER! " : "", "forge-scene-first"],
    [e.name ?? "SOMEONE", "forge-scene-who"],
    [" FORGED ", ""],
    [`<$ ${item?.name ?? e.item_id} $>`, `r-sovereign${item?.gear_set ? ` set-${item.gear_set}` : ""}`],
  ]);
  for (const [text, cls] of parts) {
    if (!text) continue;
    const span = el("span", cls, "");
    line.append(span);
    for (const ch of text) {
      span.textContent += ch;
      if (!quick) await wait(28);
    }
  }
  await wait(quick ? 4000 : 2800);
}

let queue = Promise.resolve();
/** Play the scene (after any pop-up already showing). Resolves when it's gone.
 * @param {Forged} e */
export function playForgeScene(e) {
  queue = queue.then(() => play(e), () => play(e));
  return queue;
}
