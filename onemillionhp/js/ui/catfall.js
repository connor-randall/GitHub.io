// THE CAT WILL FALL: the screen goes black and the chat's (meow) cat, =^.^=,
// floats on from the left, bobbing, and hovers in the middle (blinking,
// flicking its tail, the odd meow); then a flash and "THE CAT WILL FALL" sweeps
// in with the new-boss entrance's big letters (same font, scramble and
// shadow), with "2X DAMAGE ACTIVATING IN 10:00" counting down under it.

import { el } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";
import { blockLetters, stackLayer, stampLetters } from "./aftermath.js?v=b6664395f3";
import { shake, showOverlay } from "./fx.js?v=b6664395f3";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CAT = "~=^.^=";
const FACES = { blink: "~=^-^=", flick: "-=^.^=", meow: "~=^o^=" };

/** Float the cat in from off the left edge to the middle, choppy like the
 * rest of the game's ASCII: it hops a character at a time, bobbing a step up or
 * down every frame. @param {HTMLElement} cat @param {() => boolean} fast */
async function floatIn(cat, fast) {
  const ch = cat.getBoundingClientRect().width / CAT.length || 16; // one character
  const dist = window.innerWidth / 2 + 80;
  const hop = ch * Math.max(1, Math.round(dist / ch / 24));         // whole characters, ~24 hops
  const steps = Math.ceil(dist / hop);
  const BOB = [0, -1, -2, -1];                                     // in quarter lines
  for (let i = steps; i > 0 && !fast(); i--) {
    cat.style.transform = `translate(${-i * hop}px, ${BOB[i % BOB.length] * 6}px)`;
    await wait(i < 6 ? 170 : 90);                                  // slows as it arrives
  }
  cat.style.transform = "";
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Play the scene. 2x damage switches on ``seconds`` after the letters land.
 * Resolves when it's gone. @param {number} seconds */
export function playCatFall(seconds = 600) {
  if (document.visibilityState !== "visible") return Promise.resolve();
  return showOverlay((inner, close) => {
    const overlay = /** @type {HTMLElement} */ (inner.parentElement);
    overlay.classList.add("aftermath", "catfall");
    inner.classList.add("aftermath-inner");
    const cat = el("div", "catfall-cat", CAT);
    inner.append(cat);
    let fast = reduced || fxLow();
    let ended = false;
    /** @type {() => void} */
    let finish = () => {};
    const done = new Promise((r) => (finish = () => r(undefined)));
    overlay.onclick = (e) => {
      if (!(e.target instanceof HTMLButtonElement)) fast = true; // tap: hurry it along
    };
    /** Show a face for a moment, then back to the plain cat. @param {string} face @param {number} ms */
    const pull = (face, ms) => {
      cat.textContent = face;
      setTimeout(() => !ended && (cat.textContent = CAT), ms);
    };

    (async () => {
      // 1. The cat floats on from the left and hovers in the middle...
      await floatIn(cat, () => fast);
      if (!reduced) cat.classList.add("catfall-float");
      // 2. ...blinks, flicks its tail, meows.
      if (!fast) {
        await wait(500);
        pull(FACES.blink, 160);
        await wait(700);
        pull(FACES.flick, 220);
        await wait(600);
        pull(FACES.meow, 500);
        sound.loot();
        await wait(900);
      }
      // 3. Flash, then THE CAT WILL FALL in the new-boss letters.
      shake("l");
      overlay.classList.add("flash");
      await wait(fast ? 60 : 180);
      overlay.classList.remove("flash");
      const budget = Math.max(40, Math.floor(window.innerWidth / 9)); // columns that stay readable
      const one = blockLetters("THE CAT WILL FALL");
      const lines = one[0].length <= budget ? [one] : [blockLetters("THE CAT"), blockLetters("WILL FALL")];
      const cols = Math.max(...lines.flat().map((l) => l.length));
      const px = Math.max(5, Math.min(30, (window.innerWidth * 0.92) / (cols * 0.6), (window.innerHeight * 0.45) / (lines.length * 6)));
      const letters = el("div", "appeared catfall-letters");
      letters.style.fontSize = `${px}px`;
      const layers = lines.map(() => stackLayer(letters, "appeared-name"));
      const count = el("div", "panic-count catfall-count", "");
      const actions = el("div", "actions");
      const ok = el("button", "", "[ GET READY ]");
      ok.addEventListener("click", finish);
      inner.append(letters, count, actions);
      for (const [i, l] of lines.entries()) {
        await stampLetters(layers[i], l, 1100 / lines.length, () => fast);
        shake("s");
        sound.hit();
      }
      shake("l");
      sound.crit();
      letters.classList.add("landed");

      // 4. 2X DAMAGE ACTIVATING IN 10:00, counting down (seconds only under a minute).
      const at = Date.now() + seconds * 1000;
      let n = 0;
      const blink = setInterval(() => {
        n++;
        if (n % 4 === 0) pull(FACES.flick, 220);
        else pull(FACES.blink, 160);
      }, 2200);
      const tick = () => {
        if (ended) return;
        const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
        if (s > 0) {
          const left = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
            : `${s} SECOND${s === 1 ? "" : "S"}`;
          count.textContent = `2X DAMAGE ACTIVATING IN ${left}`;
          setTimeout(tick, 250);
        } else {
          count.textContent = "2X DAMAGE IS ON!";
          count.classList.add("catfall-on");
          sound.ultimate();
          shake("l");
          setTimeout(finish, 2500);
        }
      };
      tick();
      actions.append(ok);
      ok.focus({ preventScroll: true });
      await done;
      clearInterval(blink);
    })().finally(() => {
      ended = true;
      overlay.classList.remove("aftermath", "catfall", "flash");
      close();
    });
  }, { mustChoose: true });
}
