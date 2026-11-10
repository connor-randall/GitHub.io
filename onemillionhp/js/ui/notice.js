// Messages from the admin: a pinned note atop the feed, and pop-ups pushed
// to every open page.

import { el } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { now } from "../store.js?v=b6664395f3";

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

// Ticket #123: [ HIDE ] folds the pinned spot to one line ([ SHOW ] brings it
// back). Remembered per browser for this exact set of messages: when the admin
// pins or rotates in something new, it shows again.
const HIDE_KEY = "omhp.pinned.hidden";
const signature = (/** @type {string[]} */ list) => list.join("\n");
const isHidden = (/** @type {string[]} */ list) => {
  try {
    return localStorage.getItem(HIDE_KEY) === signature(list);
  } catch {
    return hiddenNow === signature(list);
  }
};
/** For browsers without storage: hidden for this visit. */
let hiddenNow = "";
/** @param {boolean} hide */
function setHidden(hide) {
  const sig = hide ? signature(messages()) : "";
  hiddenNow = sig;
  try {
    if (hide) localStorage.setItem(HIDE_KEY, sig);
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    /* private mode: hiddenNow covers this visit */
  }
  shown = "";
  draw();
}

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
  if (messages().length < 2 || isHidden(messages())) return;
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
  const folded = isHidden(list);
  const many = list.length > 1 && !folded;
  const every = Math.max(5, rotating?.every ?? 60);
  const i = many ? (Math.floor(now() / every) + skipped) % list.length : 0;
  const key = `${folded ? "hidden" : i}/${list.length}:${list[i]}`;
  if (many && !ticker) ticker = setInterval(draw, 1000);
  if (!many && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
  // Clickable only when there's a next one to go to.
  host.classList.toggle("rotates", many);
  host.classList.toggle("folded", folded);
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
  const head = el("div", "pin-h");
  const label = el("span", "", "[ PINNED ]");
  if (many) label.append(el("span", "pin-count", ` ${i + 1}/${list.length}`));
  if (folded) label.append(el("span", "pin-count", ` hidden${list.length > 1 ? ` (${list.length})` : ""}`));
  const toggle = /** @type {HTMLButtonElement} */ (el("button", "btn-text pin-toggle", folded ? "[ SHOW ]" : "[ HIDE ]"));
  toggle.type = "button";
  toggle.title = folded ? "show the pinned message again" : "hide the pinned message (it comes back when there's a new one)";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation(); // not a tap for the next message
    setHidden(!folded);
  });
  toggle.addEventListener("keydown", (e) => e.stopPropagation());
  head.append(label, toggle);
  if (folded) {
    typing++;
    host.replaceChildren(head);
    host.hidden = false;
    return;
  }
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

/** Pop-ups on screen at once: more covered the [FEED] / [WORLD] / [YOU] tabs (ticket #256). */
const MAX_NOTICES = 2;

/** A pop-up at the top of the screen. Tap to dismiss; it leaves on its own after a while.
 * A second pop-up with the same ``key`` (default: the same text) updates the one already
 * up instead of stacking: the text is replaced, or "x2", "x3"... is added for a repeat.
 * @param {string} text @param {boolean} [fromAdmin] false = a game message (no ***ADMIN*** tag)
 * @param {string} [key] */
export function showNotice(text, fromAdmin = true, key = text) {
  const stack = $("notices");
  const same = /** @type {HTMLElement | undefined} */ ([...stack.children].find(
    (n) => /** @type {HTMLElement} */ (n).dataset.key === key && !n.classList.contains("leaving")));
  if (same) {
    const repeats = key === text ? Number(same.dataset.repeats ?? 1) + 1 : 1;
    same.dataset.repeats = String(repeats);
    const body = same.querySelector(".notice-text");
    if (body) body.textContent = repeats > 1 ? `${text}  x${repeats}` : text;
    stack.append(same); // newest at the bottom, like a fresh one
    clearTimeout(Number(same.dataset.timer));
    same.dataset.timer = String(setTimeout(() => same.click(), 20000));
    return;
  }
  const box = el("button", "notice");
  box.setAttribute("role", "alert");
  box.dataset.key = key;
  if (fromAdmin) box.append(adminTag());
  box.append(el("span", "notice-text", text), el("span", "notice-x", "[x]"));
  const leave = () => {
    box.classList.add("leaving");
    setTimeout(() => box.remove(), 350);
  };
  box.addEventListener("click", leave);
  stack.append(box);
  while (stack.children.length > MAX_NOTICES) stack.firstChild?.remove();
  box.dataset.timer = String(setTimeout(leave, 20000));
  sound.loot();
}
