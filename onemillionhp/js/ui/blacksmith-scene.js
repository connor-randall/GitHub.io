// THE BLACKSMITH's workshop, drawn in characters: the cat, the anvil, the
// forge and the quench basin (docs/BLACKSMITH_ANIMATIONS.md). Pure drawing:
// every frame is worked out from the time since the animation began, so a slow
// device skips ahead instead of stretching it, and nothing here touches game
// state. blacksmith.js says what to play and shows the server's result.

import * as sound from "../sound.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";

const W = 42;
const H = 8;
const FACE_REST = "~=^.^=";
const FACE_TALK = "~=^o^=";
const TALK_MS = 1200;
const TALK_STEP = 140;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** No moving sparks, steam or delays: reduced motion, or FX:LOW. */
export const stillMode = () => reduced || fxLow();

/** A small mark for the item on the anvil, by slot (its full art sits below the scene). */
const GLYPH = /** @type {Record<string, string>} */ ({
  weapon: "-|=>", charm: "(o)", helmet: "[^]", necklace: "o~o", chestplate: "[#]",
  gauntlets: "{=}", greaves: "|:|", boots: "|_",
});
export const glyphOf = (/** @type {string} */ slot) => GLYPH[slot] ?? "<*>";

const EMBERS = [".  :  .", " : . : ", ":  .  :"];

/** @typedef {{ch: string, cls: string}} Cell */

/** A blank grid. @returns {Cell[][]} */
const blank = () => Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: " ", cls: "" })));

/** Write text at (row, col); spaces leave what's underneath (overlays).
 * @param {Cell[][]} g @param {number} r @param {number} c @param {string} text @param {string} [cls] */
function put(g, r, c, text, cls = "") {
  if (r < 0 || r >= H) return;
  for (let i = 0; i < text.length; i++) {
    const x = c + i;
    if (x < 0 || x >= W || text[i] === " ") continue;
    g[r][x] = { ch: text[i], cls };
  }
}

/** Centre text on a column. @param {Cell[][]} g @param {number} r @param {number} mid @param {string} text @param {string} [cls] */
const putMid = (g, r, mid, text, cls = "") => put(g, r, mid - Math.floor(text.length / 2), text, cls);

const ANVIL_MID = 19;
const FORGE_MID = 36;

/** The workshop at rest: cat, anvil, forge, basin, and the hammer by the anvil.
 * @param {{face: string, ember: number, hammer: boolean}} o */
function base(o) {
  const g = blank();
  put(g, 3, 1, o.face, "bs-cat"); // just the face, level with the anvil
  if (o.hammer) { // resting against the anvil
    put(g, 3, 8, "[=]", "bs-tool");
    put(g, 4, 9, "|", "bs-tool");
    put(g, 5, 9, "|", "bs-tool");
  }
  put(g, 4, 12, "_______________", "bs-iron");
  put(g, 5, 12, "\\_____________/", "bs-iron");
  put(g, 6, 15, "|       |", "bs-iron");
  put(g, 7, 13, "__|_______|__", "bs-iron");
  putMid(g, 0, FORGE_MID, EMBERS[o.ember % EMBERS.length], "bs-ember");
  put(g, 1, 32, "[  ***  ]", "bs-fire");
  put(g, 2, 32, "[ ***** ]", "bs-fire");
  put(g, 3, 32, "[_______]", "bs-iron");
  put(g, 4, 33, "|     |", "bs-iron");
  put(g, 5, 32, "\\~~~~~~~/", "bs-water");
  put(g, 6, 33, "\\_____/", "bs-iron");
  return g;
}

/** The grid as spans, one per run of the same colour. @param {Cell[][]} g */
function toNodes(g) {
  /** @type {(Node)[]} */
  const out = [];
  for (let r = 0; r < H; r++) {
    let run = "";
    let cls = g[r][0].cls;
    const flush = () => {
      if (!run) return;
      const s = document.createElement("span");
      if (cls) s.className = cls;
      s.textContent = run;
      out.push(s);
    };
    for (const cell of g[r]) {
      if (cell.cls !== cls) {
        flush();
        run = "";
        cls = cell.cls;
      }
      run += cell.ch;
    }
    flush();
    if (r < H - 1) out.push(document.createTextNode("\n"));
  }
  return out;
}

/** Sparks around the anvil: a light burst, then a brighter one. */
const SPARKS = [
  [[2, 16, " .   + "], [3, 15, "+       +"], [4, 17, " . "]],
  [[1, 16, " +  .  +"], [2, 14, "+ *     * +"], [3, 14, ".         ."], [4, 16, "  *   *"]],
];

/**
 * One merge frame. ``t`` ms since it began.
 * @param {number} t @param {{glyph: string, rarity: string, consumed: number, from: number, to: number}} m
 * @param {number} ember @param {string} face */
function mergeFrame(t, m, ember, face) {
  const hammerBusy = t >= 350 && t < 1400;
  const g = base({ face, ember, hammer: !hammerBusy });
  const struck = t >= 950; // the copies have gone into the one
  const hot = t >= 350 && t < 1300;
  const itemCls = hot ? "bs-hot" : `r-${m.rarity}`;
  // The copies slide in from the left in whole-character steps.
  if (!struck) {
    const shown = Math.min(3, m.consumed);
    const step = Math.min(5, Math.floor(t / 70));
    for (let i = 0; i < shown; i++) {
      const start = 11 - i * 5;
      const end = ANVIL_MID - 2 - (shown - i) * 2;
      const col = t < 350 ? Math.round(start + ((end - start) * step) / 5) : end;
      put(g, 3, col, m.glyph, `r-${m.rarity} bs-copy`);
    }
    put(g, 2, 11, `x${m.consumed}`, "bs-count");
  }
  putMid(g, 3, ANVIL_MID, m.glyph, itemCls);
  // The hammer: up, then three blows (650, 950, 1300).
  const blow = [650, 950, 1300].find((at) => t >= at && t < at + 110);
  if (hammerBusy) {
    if (blow !== undefined) {
      put(g, 2, ANVIL_MID - 1, "[##]", "bs-tool");
      put(g, 1, ANVIL_MID + 2, "|", "bs-tool");
      put(g, 0, ANVIL_MID + 2, "|", "bs-tool");
    } else {
      put(g, 0, ANVIL_MID - 1, "[##]", "bs-tool");
      put(g, 1, ANVIL_MID + 2, "|", "bs-tool");
    }
  }
  if (t >= 650 && t < 800) for (const [r, c, s] of SPARKS[0]) put(g, /** @type {number} */ (r), /** @type {number} */ (c), /** @type {string} */ (s), "bs-spark");
  if (t >= 950 && t < 1150) for (const [r, c, s] of SPARKS[1]) put(g, /** @type {number} */ (r), /** @type {number} */ (c), /** @type {string} */ (s), "bs-spark");
  // The last blow: a thin ring goes out two cells and fades.
  if (t >= 1300 && t < 1650) {
    const w = t < 1420 ? 3 : t < 1540 ? 4 : 5;
    put(g, 3, ANVIL_MID - w - 1, "(", "bs-spark");
    put(g, 3, ANVIL_MID + w, ")", "bs-spark");
  }
  if (t >= 1300) putMid(g, 1, ANVIL_MID, `+${m.from} -> +${m.to}`, "bs-rank");
  return g;
}

/**
 * One respec frame.
 * @param {number} t @param {{glyph: string, rarity: string}} m @param {number} ember @param {string} face */
function respecFrame(t, m, ember, face) {
  const g = base({ face, ember: t >= 400 && t < 950 ? Math.floor(t / 180) : ember, hammer: true });
  const cls = t < 700 ? "bs-hot" : t < 1700 ? "bs-pale" : `r-${m.rarity}`;
  if (t < 400) { // into the forge, a step at a time
    const step = Math.min(5, Math.floor(t / 80));
    const col = Math.round(ANVIL_MID + ((FORGE_MID - ANVIL_MID) * step) / 5);
    putMid(g, step < 3 ? 3 : 2, col, m.glyph, t < 160 ? `r-${m.rarity}` : "bs-hot");
  } else if (t < 950) { // in the fire: embers rise
    putMid(g, 2, FORGE_MID, ` ${m.glyph} `, cls);
    putMid(g, 0, FORGE_MID, EMBERS[Math.floor(t / 180) % 3], "bs-ember");
  } else if (t < 1700) { // quenched: ripples, then steam over the basin
    putMid(g, 5, FORGE_MID, m.glyph, cls);
    if (t < 1250) {
      const w = t < 1050 ? 2 : t < 1150 ? 3 : 4;
      put(g, 5, FORGE_MID - w - 1, "~", "bs-water");
      put(g, 5, FORGE_MID + w, "~", "bs-water");
      put(g, 4, FORGE_MID - 2, t < 1100 ? " . : " : ": . :", "bs-steam");
    } else {
      const thick = t < 1450;
      put(g, 4, 31, thick ? ":.:.:.:.:.:" : " .  :  .  ", "bs-steam");
      put(g, 3, 31, thick ? ".:.:.:.:.:." : "  .   .    ", "bs-steam");
      if (thick) put(g, 2, 32, ":.:.:.:.:", "bs-steam");
    }
  } else { // back on the anvil
    putMid(g, 3, ANVIL_MID, m.glyph, cls);
  }
  return g;
}

const WHEEL = ["(|)", "(/)", "(-)", "(\\)"];

/**
 * One grindstone frame: a wheel turns beside the anvil, the item is held to it,
 * sparks fly off the far side, and it comes away plain.
 * @param {number} t @param {{glyph: string, rarity: string, label: string}} m @param {number} ember @param {string} face */
function grindFrame(t, m, ember, face) {
  const g = base({ face, ember, hammer: true });
  const spinning = t < 1250;
  const wheel = WHEEL[spinning ? Math.floor(t / 70) % 4 : 0];
  put(g, 2, ANVIL_MID + 3, "___", "bs-iron");
  put(g, 3, ANVIL_MID + 3, wheel, spinning ? "bs-spark" : "bs-tool");
  const touching = t >= 250 && t < 1150;
  putMid(g, 3, touching ? ANVIL_MID + 1 : ANVIL_MID - 1, m.glyph, touching ? "bs-hot" : `r-${m.rarity}`);
  if (touching) { // sparks off the wheel, a different spray every few frames
    const f = Math.floor(t / 90) % 3;
    put(g, 2, ANVIL_MID + 7, ["' .", ". '", " ',"][f], "bs-spark");
    put(g, 3, ANVIL_MID + 7, [" .", ".'", "' "][f], "bs-spark");
  }
  if (t >= 1150) putMid(g, 1, ANVIL_MID, m.label, "bs-rank");
  return g;
}

/** The scene: idle drawing, the cat's lines, and the animations. */
export class Workshop {
  /** @param {HTMLElement} pre @param {HTMLElement} say */
  constructor(pre, say) {
    this.pre = pre;
    this.say = say;
    this.ember = 0;
    this.talkFrom = -1e9;
    /** @type {{glyph: string, rarity: string} | null} */
    this.item = null;
    /** @type {number | null} */
    this.raf = null;
    /** @type {(() => void) | null} */
    this.finish = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.idle = null;
  }

  /** Start the slow ember flicker (every 2 s, only while it can be seen). */
  start() {
    this.stopIdle();
    this.draw();
    if (stillMode()) return;
    this.idle = setInterval(() => {
      if (document.hidden || !this.pre.isConnected || this.pre.closest("[hidden]") || this.raf !== null) return;
      this.ember++;
      this.draw();
    }, 2000);
  }

  stopIdle() {
    if (this.idle !== null) clearInterval(this.idle);
    this.idle = null;
  }

  /** Leaving the tab: no timers left running. The result (already saved) stays. */
  stop() {
    this.stopIdle();
    this.skip();
  }

  /** The item now on the anvil (null: an empty anvil). @param {{glyph: string, rarity: string} | null} item */
  setItem(item) {
    this.item = item;
    if (this.raf === null) this.draw();
  }

  /** A line from the cat: the whole line at once; the mouth moves ~1.2 s. @param {string} text */
  line(text) {
    this.say.textContent = `"${text}"`;
    this.talkFrom = performance.now();
    if (stillMode() || this.raf !== null) return;
    const tick = () => {
      this.draw();
      if (performance.now() - this.talkFrom < TALK_MS && this.raf === null) setTimeout(tick, TALK_STEP);
      else this.draw();
    };
    tick();
  }

  face() {
    const since = performance.now() - this.talkFrom;
    return !stillMode() && since < TALK_MS && Math.floor(since / TALK_STEP) % 2 === 0 ? FACE_TALK : FACE_REST;
  }

  draw() {
    const g = base({ face: this.face(), ember: this.ember, hammer: true });
    if (this.item) putMid(g, 3, ANVIL_MID, this.item.glyph, `r-${this.item.rarity}`);
    this.pre.replaceChildren(...toNodes(g));
  }

  /** Jump to the end of whatever is playing (the result is already in). */
  skip() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    const done = this.finish;
    this.finish = null;
    this.draw();
    done?.();
  }

  /**
   * Play a timeline, then ``onDone``. Lines and sounds fire at their times.
   * @param {number} length ms
   * @param {(t: number, face: string) => Cell[][]} frame
   * @param {[number, () => void][]} cues
   * @param {() => void} onDone */
  play(length, frame, cues, onDone) {
    this.skip();
    if (stillMode()) { // one beat: the result, no motion
      for (const [, cue] of cues) cue();
      onDone();
      return;
    }
    const t0 = performance.now();
    const fired = new Set();
    this.finish = onDone;
    const step = () => {
      const t = performance.now() - t0;
      cues.forEach(([at, cue], i) => {
        if (t >= at && !fired.has(i)) {
          fired.add(i);
          cue();
        }
      });
      if (t >= length) {
        this.raf = null;
        const done = this.finish;
        this.finish = null;
        this.draw();
        done?.();
        return;
      }
      this.pre.replaceChildren(...toNodes(frame(t, this.face())));
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** "A little purrcussive maintenance": copies onto the anvil, three blows, one item.
   * @param {{glyph: string, rarity: string, consumed: number, from: number, to: number}} m
   * @param {string} doneLine @param {() => void} onDone */
  merge(m, doneLine, onDone) {
    this.play(2100, (t, face) => mergeFrame(t, m, this.ember, face), [
      [0, () => this.line("Let's make these count.")],
      [650, () => sound.hammer()],
      [950, () => sound.hammer()],
      [1300, () => sound.hammer(true)],
      [1300, () => this.line(doneLine)],
    ], onDone);
  }

  /** THE GRINDSTONE: the respec roll ground off on the wheel. @param {{glyph: string, rarity: string, label: string}} m
   * @param {() => void} onDone */
  grind(m, onDone) {
    this.play(1500, (t, face) => grindFrame(t, m, this.ember, face), [
      [0, () => this.line("Off comes the roll. Hold still.")],
      [250, () => sound.hiss()],
      [700, () => sound.hiss()],
      [1150, () => this.line("Clean slate.")],
    ], onDone);
  }

  /** "Heat. Quench. New possibilities.": into the fire, into the water, back to the anvil.
   * @param {{glyph: string, rarity: string, weapon: boolean}} m @param {() => void} onDone */
  respec(m, onDone) {
    this.play(1700, (t, face) => respecFrame(t, m, this.ember, face), [
      [0, () => this.line(m.weapon ? "Same blade. New possibilities." : "Same gear. New possibilities.")],
      [400, () => this.line("Let's see what the heat brings out.")],
      [950, () => sound.hiss()],
    ], onDone);
  }
}
