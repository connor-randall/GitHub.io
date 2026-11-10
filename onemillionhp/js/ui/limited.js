// [ EVENTS ] (2026-11-06): the limited-time event (server/omhp/limited.py).
// Its countdown shows in one place only: at the top of the [EVENTS] menu, above
// the event's button: "*x* [EVENT ENDS IN 71:59:59] *x*", pulsing slightly. Once
// it's over it counts down to the next one. The [EVENTS] label turns amber while
// one is live.

import { el } from "../ascii.js?v=b6664395f3";
import { now, state } from "../store.js?v=b6664395f3";

/** "71:59:59" (hours run past 24). @param {number} secs */
const clock = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
/** "6d 23h" for the wait (the clock under a day). @param {number} secs */
const days = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  return d ? `${d}d ${Math.floor((s % 86400) / 3600)}h` : clock(s);
};

let blink = false;

export function paintLimited() {
  const box = document.getElementById("limited-timer");
  if (!box) return;
  const ev = state.boss?.limited;
  const live = Boolean(ev && ev.ends_at && now() < ev.ends_at && ev.live !== false);
  document.querySelector('#tabs [data-group="limited"] .tab-cat')?.classList.toggle("live", live);
  if (!ev) {
    box.hidden = true;
    return;
  }
  blink = !blink;
  const mark = blink ? "*x*" : "x*x";
  const text = live ? `[EVENT ENDS IN ${clock(ev.ends_at - now())}]`
    : ev.next_at && now() < ev.next_at ? `[NEXT EVENT IN ${days(ev.next_at - now())}]` : "[NEXT EVENT SOON]";
  const key = `${mark}|${text}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(el("span", "lx", mark), ` ${text} `, el("span", "lx", mark));
  }
  box.classList.toggle("waiting", !live);
  box.hidden = false;
}

export function initLimited() {
  paintLimited();
  window.setInterval(paintLimited, 1000);
}
