// A boss design from its share link, #design=<id> (ticket #237): look through its
// frames. Pending designs haven't been reviewed, and the card says so.

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { button, showOverlay } from "./fx.js?v=b6664395f3";

const FRAMES = /** @type {[string, string][]} */ ([
  ["phase1_art", "PHASE I"], ["phase1_hurt_art", "PHASE I HURT"], ["phase2_art", "PHASE II"],
  ["phase2_hurt_art", "PHASE II HURT"], ["phase3_art", "PHASE III"], ["phase3_hurt_art", "PHASE III HURT"],
  ["death_art", "DEATH"],
]);

/** @param {string} id */
export async function showSharedDesign(id) {
  /** @type {any} */
  let d;
  try {
    d = await api.getSharedDesign(id);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    return;
  }
  showOverlay((inner, close) => {
    inner.classList.add("design-share");
    let at = 0;
    const label = el("div", "dim");
    const art = el("pre", "design-share-art");
    const draw = () => {
      label.textContent = `${FRAMES[at][1]}  (${at + 1}/${FRAMES.length})`;
      art.textContent = d[FRAMES[at][0]];
    };
    /** @param {number} by */
    const step = (by) => {
      at = (at + by + FRAMES.length) % FRAMES.length;
      draw();
    };
    const actions = el("div", "actions");
    actions.append(button("[ < ]", () => step(-1)), button("[ > ]", () => step(1)), button("[ CLOSE ]", close));
    inner.append(el("h3", "", d.name), el("div", "dim", `by ${d.artist}  ::  ${String(d.status).toUpperCase()}`),
      ...(d.status === "pending" ? [el("div", "dim", "not reviewed yet")] : []), label, art, actions);
    draw();
  });
}
