// MEOW MODE (world event): MEOW_CATS cats sit all over your screen and the
// server won't take an attack until you've petted every one (1-10 shards
// each, server/omhp/worldevents.py pet). A petted cat purrs, then turns and
// walks off the nearest edge one character at a time, legs going. Where the
// cats sit is fixed per player and event, so a reload puts them back.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The (meow) chat emote's cat (emotes.js), one line per frame.
// Each cat faces right or left (picked when it spawns): sitting, a blink, a tail flick.
const SIT = { right: [["~=^o^="], ["~=^-^="], ["-=^o^="]], left: [["=^o^=~"], ["=^-^=~"], ["=^o^=-"]] };
// Purring: the cat stays put, only the heart bobs.
const HAPPY = { right: [["~=^o^= <3"], ["~=^.^=  <3"]], left: [["=^o^=~ <3"], ["=^.^=~  <3"]] };
// Trotting off, the emote's walk: head first, tail behind.
const WALK_RIGHT = [["~=^.^="], ["~=^o^="]];
const WALK_LEFT = [["=^.^=~"], ["=^o^=~"]];
const STEP_MS = 70; // one character per step
// Where the face sits (its middle column) in each sprite: the walk starts with
// the head right where the sitting cat's was, so nothing jumps when it turns.
const FACE_COL = { right: 3, left: 2 };
const HAPPY_MS = 650;

/** The cats on screen: index -> its button (gone once it has walked off). @type {Map<number, HTMLButtonElement>} */
const shown = new Map();
/** Cats petted (or being petted) this event, so a redraw doesn't put them back. @type {Set<number>} */
const leaving = new Set();
let eventKey = "";
let layer = /** @type {HTMLElement | null} */ (null);
let idleTimer = 0;
let tick = 0;

/** A small seeded random (mulberry32) so a reload puts every cat where it was. @param {number} seed */
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {string} s */
function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Where each cat sits (fractions of the screen), spread so they don't pile up. @param {any} ev @param {number} n */
function spots(ev, n) {
  const r = rand(hash(`${state.me?.id ?? ""}:${ev.started_at}`));
  const cols = 4;
  const rows = Math.ceil(n / cols);
  const cells = [...Array(cols * rows).keys()].sort(() => r() - 0.5).slice(0, n);
  return cells.map((c) => ({
    face: /** @type {"right" | "left"} */ (r() < 0.5 ? "right" : "left"),
    x: 0.04 + ((c % cols) + 0.15 + r() * 0.6) * (0.84 / cols),
    y: 0.1 + (Math.floor(c / cols) + 0.15 + r() * 0.6) * (0.78 / rows),
  }));
}

function ensureLayer() {
  if (layer) return layer;
  layer = el("div", "meow-layer");
  layer.id = "meow-cats";
  document.body.append(layer);
  return layer;
}

/** Which way a cat sits. @param {HTMLElement} cat @returns {"right" | "left"} */
const faceOf = (cat) => (cat.dataset.face === "left" ? "left" : "right");

/** @param {HTMLElement} cat @param {string[]} frame */
const paint = (cat, frame) => {
  /** @type {HTMLElement} */ (cat.firstChild).textContent = frame.join("\n");
};

/** Keep the screen's cats in line with the running event (called on every boss / me update). */
export function syncMeowCats() {
  const b = state.boss;
  const ev = b && b.status === "alive" && b.event?.kind === "meow" && b.event.stage === "live" ? b.event : null;
  const key = ev ? `${ev.started_at}` : "";
  if (key !== eventKey) {
    // A new event, or it's over: whatever's still sitting there wanders off.
    for (const [i, cat] of shown) walkOff(i, cat);
    leaving.clear();
    eventKey = key;
  }
  if (!ev || !state.me?.name_chosen) {
    stopIdle();
    return;
  }
  const n = ev.cats ?? 10;
  const petted = new Set(state.me?.event?.petted ?? []);
  const where = spots(ev, n);
  for (let i = 0; i < n; i += 1) {
    if (petted.has(i) || leaving.has(i) || shown.has(i)) continue;
    const cat = /** @type {HTMLButtonElement} */ (el("button", "meow-cat"));
    cat.type = "button";
    cat.setAttribute("aria-label", `pet cat ${i + 1}`);
    cat.style.left = `${(where[i].x * 100).toFixed(2)}%`;
    cat.style.top = `${(where[i].y * 100).toFixed(2)}%`;
    cat.append(el("pre", "meow-cat-art"));
    cat.dataset.face = where[i].face;
    paint(cat, SIT[where[i].face][0]);
    cat.addEventListener("click", () => pet(i, cat));
    ensureLayer().append(cat);
    shown.set(i, cat);
  }
  startIdle();
}

/** Blinks and tail flicks, a few cats at a time. */
function startIdle() {
  if (idleTimer || reduced || fxLow()) return;
  idleTimer = window.setInterval(() => {
    tick += 1;
    for (const [i, cat] of shown) {
      if (leaving.has(i)) continue;
      const k = (tick + i * 7) % 23;
      paint(cat, SIT[faceOf(cat)][k === 0 ? 1 : k < 3 ? 2 : 0]);
    }
  }, 220);
}

function stopIdle() {
  if (!idleTimer) return;
  clearInterval(idleTimer);
  idleTimer = 0;
}

/** @param {number} i @param {HTMLButtonElement} cat */
async function pet(i, cat) {
  if (leaving.has(i)) return;
  leaving.add(i);
  cat.classList.add("petted");
  paint(cat, HAPPY[faceOf(cat)][0]);
  try {
    const res = await api.petCat(i);
    state.me = res.me;
    shardsPop(cat, res.shards);
    emit("me");
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    if (!/already petted/i.test(msg)) {
      leaving.delete(i);
      cat.classList.remove("petted");
      paint(cat, SIT[faceOf(cat)][0]);
      showError(msg);
      return;
    }
  }
  walkOff(i, cat);
}

/** "+7 <>" over a petted cat. @param {HTMLElement} cat @param {number} n */
function shardsPop(cat, n) {
  const pop = el("span", "meow-pop", `+${fmt(n)} <>`);
  pop.style.left = cat.style.left;
  pop.style.top = cat.style.top;
  ensureLayer().append(pop);
  setTimeout(() => pop.remove(), 1400);
}

/** Purr a moment, then walk off the nearest side, a character per step. @param {number} i @param {HTMLButtonElement} cat */
function walkOff(i, cat) {
  shown.delete(i);
  cat.disabled = true;
  cat.classList.add("petted");
  if (reduced) {
    setTimeout(() => cat.remove(), 300);
    return;
  }
  const r = cat.getBoundingClientRect();
  const right = r.left + r.width / 2 > window.innerWidth / 2;
  const frames = right ? WALK_RIGHT : WALK_LEFT;
  // One character's width, from the art as drawn now (its longest line).
  const art = /** @type {HTMLElement} */ (cat.firstChild);
  const cols = Math.max(...(art.textContent ?? "").split("\n").map((l) => l.length), 1);
  const step = art.getBoundingClientRect().width / cols;
  const start = (FACE_COL[faceOf(cat)] - FACE_COL[right ? "right" : "left"]) * step;
  let n = 0;
  let happy = 0;
  const purr = setInterval(() => paint(cat, HAPPY[faceOf(cat)][(happy += 1) % 2]), 200);
  setTimeout(() => {
    clearInterval(purr);
    const walk = setInterval(() => {
      n += 1;
      paint(cat, frames[n % 2]);
      cat.style.transform = `translateX(${start + (right ? 1 : -1) * n * step}px)`;
      const box = cat.getBoundingClientRect();
      if (box.left > window.innerWidth || box.right < 0 || n > 400) {
        clearInterval(walk);
        cat.remove();
      }
    }, STEP_MS);
  }, HAPPY_MS);
}
