// "Are you human?" - pushed to a player from the admin panel, or by the bot
// scan to everyone it flags; 10 misses in total get the player banned. A grid of
// little ASCII faces; click the one it asks for. Attacks and scrolls are
// refused by the server until it's solved; three misses reshuffle it.

import * as api from "../api.js?v=b6664395f3";
import { box, el } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { popup, shake, showOverlay } from "./fx.js?v=b6664395f3";

let open = false;
/** @type {(() => void) | null} */
let closeIt = null;

/** Show the check if the player has one pending (and it isn't already up);
 * take it down if the admin cleared it. @param {any} me */
export function maybeCaptcha(me) {
  if (!me?.captcha || me.banned) { // banned: the ban banner (and its [ APPEAL ]) instead
    closeIt?.();
    return;
  }
  if (open) return;
  open = true;
  showOverlay((inner, done) => {
    const close = () => {
      open = false;
      closeIt = null;
      done();
    };
    if (!state.me?.captcha) { // cleared while it waited in the queue
      close();
      return;
    }
    closeIt = close;
    inner.classList.add("captcha");
    let busy = false;
    /** @param {any} ch @param {string} note */
    const draw = (ch, note) => {
      const head = el("pre", "art captcha-head", box(["ARE YOU HUMAN?"], { width: 30 }).join("\n"));
      const ask = el("div", "captcha-ask");
      ask.append("click the ", el("b", "captcha-find", ch.find), " box");
      const grid = el("div", "captcha-grid");
      ch.cells.forEach((/** @type {string} */ face, /** @type {number} */ i) => {
        const b = /** @type {HTMLButtonElement} */ (el("button", "captcha-cell", `[ ${face} ]`));
        b.type = "button";
        b.addEventListener("click", async () => {
          if (busy) return;
          busy = true;
          try {
            const res = await api.solveCaptcha(i);
            if (res.banned) { // too many misses: the server banned this player
              close();
              showError("Too many wrong answers. The dungeon has rejected you.");
              return;
            }
            if (res.me) {
              state.me = res.me;
              emit("me");
            }
            if (res.ok) {
              close();
              popup("THANKS, HUMAN.", "proc");
              return;
            }
            shake("s");
            draw(res.captcha, res.captcha.tries_left === 3 ? "nope. here's a new one." : `nope. ${res.captcha.tries_left} tries left.`);
          } catch {
            draw(ch, "couldn't check that. try again.");
          } finally {
            busy = false;
          }
        });
        grid.append(b);
      });
      inner.replaceChildren(head, ask, grid, el("div", "dim captcha-note", note));
      /** @type {HTMLElement | null} */ (grid.firstElementChild)?.focus({ preventScroll: true });
    };
    draw(state.me.captcha, "a quick check before you keep fighting.");
  }, { mustChoose: true });
}
