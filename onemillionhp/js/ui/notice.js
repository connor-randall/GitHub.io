// Messages from the admin: a pinned note atop the feed, and pop-ups pushed
// to every open page.

import { el } from "../ascii.js?v=b7420735b5";
import * as sound from "../sound.js?v=b7420735b5";
import { now } from "../store.js?v=b7420735b5";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** ***ADMIN***, each star its own solid colour cycling through the rainbow,
 * the colours travelling from the outermost stars inward. */
export function adminTag() {
  const tag = el("span", "admin-tag");
  tag.setAttribute("aria-label", "ADMIN");
  const star = (/** @type {number} */ depth) => el("span", `admin-star d${depth}`, "*");
  tag.append(star(0), star(1), star(2), "ADMIN", star(2), star(1), star(0));
  return tag;
}

/** @type {{text: string} | null} */
let pin = null;
/** @type {{messages: string[], every: number} | null} */
let rotating = null;
let shown = "";
/** How many times this screen tapped ahead of the shared rotation. */
let skipped = 0;
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;
/** Bumped on every redraw, so an unfinished type-out stops when a newer one starts. */
let typing = 0;
let wired = false;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Show (or clear) the pinned message. @param {{text: string} | null | undefined} p */
export function setPinned(p) {
  pin = p && p.text ? p : null;
  draw();
}

/** Messages that take turns in the pinned spot. @param {{messages: string[], every: number} | null | undefined} r */
export function setRotating(r) {
  rotating = r && r.messages?.length ? r : null;
  draw();
}

const messages = () => [...(pin ? [pin.text] : []), ...(rotating?.messages ?? [])];

/** Tap (or Enter/Space) for the next message; the minute-by-minute rotation carries on from there. */
function next() {
  if (messages().length < 2) return;
  skipped++;
  draw();
}

/** What goes in the pinned spot right now: the pin, then the rotating
 * messages, one per ``every`` seconds of server time (so every screen
 * shows the same one and they all switch together, taps aside). */
function draw() {
  const host = $("pinned");
  if (!wired) {
    wired = true;
    host.addEventListener("click", next);
    host.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      next();
    });
  }
  const list = messages();
  if (!list.length) {
    clearInterval(ticker);
    typing++;
    ticker = undefined;
    shown = "";
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  const many = list.length > 1;
  const every = Math.max(5, rotating?.every ?? 60);
  const i = many ? (Math.floor(now() / every) + skipped) % list.length : 0;
  const key = `${i}/${list.length}:${list[i]}`;
  if (many && !ticker) ticker = setInterval(draw, 1000);
  if (!many && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
  // Clickable only when there's a next one to go to.
  host.classList.toggle("rotates", many);
  if (many) {
    host.tabIndex = 0;
    host.setAttribute("role", "button");
    host.title = "tap for the next message";
  } else {
    host.removeAttribute("tabindex");
    host.removeAttribute("role");
    host.removeAttribute("title");
  }
  if (key === shown && !host.hidden) return;
  const animate = many && shown !== "" && !host.hidden && !reduced;
  shown = key;
  const head = el("div", "pin-h", "[ PINNED ]");
  if (many) head.append(el("span", "pin-count", ` ${i + 1}/${list.length}`));
  const run = ++typing;
  const oldText = /** @type {HTMLElement | null} */ (host.querySelector(".pin-body .admin-text"));
  if (!animate || !oldText) {
    const body = el("div", "pin-body");
    body.append(adminTag(), " ", el("span", "admin-text", list[i]));
    host.replaceChildren(head, body);
    host.hidden = false;
    return;
  }
  // Terminal-style swap: the old line is backspaced away, the new one typed in.
  host.querySelector(".pin-h")?.replaceWith(head);
  retype(oldText, list[i], run);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Erase ``span``'s text, then type ``text`` into it, with a blinking cursor.
 * About a second at most, whatever the length. @param {HTMLElement} span @param {string} text @param {number} run */
async function retype(span, text, run) {
  addCursor(span);
  let cur = span.textContent ?? "";
  const eraseStep = Math.max(1, Math.ceil(cur.length / 15)); // ~0.3 s to wipe
  while (cur.length) {
    if (run !== typing) return;
    cur = cur.slice(0, -eraseStep);
    span.textContent = cur;
    await sleep(20);
  }
  const typeStep = Math.max(1, Math.ceil(text.length / 35)); // a letter at a time, ~1 s for long ones
  for (let n = typeStep; ; n += typeStep) {
    if (run !== typing) return;
    span.textContent = text.slice(0, n);
    if (n >= text.length) break;
    await sleep(30);
  }
  if (run === typing) span.parentElement?.querySelector(".type-cursor")?.remove();
}

/** A blinking "_" after the message while it's being typed. @param {HTMLElement} span */
function addCursor(span) {
  if (!span.nextElementSibling?.classList.contains("type-cursor")) span.after(el("span", "type-cursor", "_"));
}

/** A pop-up at the top of the screen. Tap to dismiss; it leaves on its own after a while.
 * @param {string} text */
export function showNotice(text) {
  const stack = $("notices");
  const box = el("button", "notice");
  box.setAttribute("role", "alert");
  box.append(adminTag(), el("span", "notice-text", text), el("span", "notice-x", "[x]"));
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
