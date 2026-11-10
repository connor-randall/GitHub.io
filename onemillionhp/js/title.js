// The browser tab's title. Ticket #219: your attacks lead it, "(3/5) ONE MILLION HP",
// so a background tab shows when the stack is full. A world event can flash it
// while the tab is hidden (worldevent.js); the count comes back after.

import { state } from "./store.js?v=b6664395f3";

const NAME = document.title;
let flashing = false;

/** The title when nothing is flashing. */
export function plainTitle() {
  const me = state.me;
  return me?.name_chosen ? `(${me.attacks_left ?? 0}/${me.attacks_per_day ?? 5}) ${NAME}` : NAME;
}

export function paintTitle() {
  const t = plainTitle();
  if (!flashing && document.title !== t) document.title = t;
}

/** A world event is (or stops) flashing the title. @param {boolean} on */
export function setFlashing(on) {
  flashing = on;
  if (!on) paintTitle();
}
