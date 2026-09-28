// Messages from the admin: a pinned note atop the feed, and pop-ups pushed
// to every open page.

import { el } from "../ascii.js?v=a46acbc584";
import * as sound from "../sound.js?v=a46acbc584";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Show (or clear) the pinned message. @param {{text: string} | null | undefined} pin */
export function setPinned(pin) {
  const host = $("pinned");
  if (!pin || !pin.text) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.replaceChildren(
    el("div", "pin-h", "[ PINNED ]"),
    el("div", "pin-body"),
  );
  /** @type {HTMLElement} */ (host.lastChild).append(el("span", "admin-tag", "***ADMIN***"), " ", el("span", "admin-text", pin.text));
  host.hidden = false;
}

/** A pop-up at the top of the screen. Tap to dismiss; it leaves on its own after a while.
 * @param {string} text */
export function showNotice(text) {
  const stack = $("notices");
  const box = el("button", "notice");
  box.setAttribute("role", "alert");
  box.append(el("span", "admin-tag", "***ADMIN***"), el("span", "notice-text", text), el("span", "notice-x", "[x]"));
  const leave = () => {
    box.classList.add("leaving");
    setTimeout(() => box.remove(), 350);
  };
  box.addEventListener("click", leave);
  stack.append(box);
  while (stack.children.length > 3) stack.firstChild?.remove();
  setTimeout(leave, 20000);
  sound.loot();
}
