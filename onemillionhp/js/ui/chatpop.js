// Ticket #181: on a desktop the CHAT can pop out into a floating window that
// stays open whatever tab you're on (AH, INVENTORY, SHOP...). Drag it by its
// title bar, resize it from the corner; [ DOCK ] puts it back in the tabs.
// Where it sits and how big it is are remembered in this browser. Phones and
// small windows never pop out (there's no room beside the panels).

import { el } from "../ascii.js?v=b6664395f3";

const KEY = "omhp.chat.popped";      // "1" while popped out
const BOX_KEY = "omhp.chat.pop_box"; // {x, y, w, h} in px
const MIN_KEY = "omhp.chat.pop_min"; // "1" while collapsed to its title bar
const DESKTOP = window.matchMedia("(min-width: 900px) and (pointer: fine)");
const MIN_W = 300;
const MIN_H = 240;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {HTMLButtonElement | null} */
let toggle = null;
/** @type {HTMLButtonElement | null} */
let minBtn = null;
/** The size place() last set: the ResizeObserver saves only sizes the player made. */
let placed = { w: 0, h: 0 };
const collapsed = () => read(MIN_KEY) === "1";
/** Called after popping in / out, so the tabs can redraw (tabs.js). @type {() => void} */
let onChange = () => {};

const read = (/** @type {string} */ k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (/** @type {string} */ k, /** @type {string | null} */ v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: just for this visit */
  }
};

/** Is the chat floating right now? */
export const chatPopped = () => DESKTOP.matches && read(KEY) === "1";

/** The saved box, kept on screen. */
function box() {
  /** @type {any} */
  let b = null;
  try {
    b = JSON.parse(read(BOX_KEY) ?? "null");
  } catch {
    b = null;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // First time: in the empty space right of the game if there's room, else bottom right.
  const appRight = document.getElementById("app")?.getBoundingClientRect().right ?? vw;
  const room = vw - appRight - 24;
  const w = Math.min(Math.max(Number(b?.w) || (room >= MIN_W ? Math.min(420, room) : 400), MIN_W), vw - 16);
  // No room beside the game: start shorter, so it covers less of the panels.
  const h = Math.min(Math.max(Number(b?.h) || (room >= MIN_W ? 460 : Math.round(vh * 0.4)), MIN_H), vh - 16);
  const firstX = room >= MIN_W ? appRight + 12 : vw - w - 24;
  const x = Math.min(Math.max(Number.isFinite(b?.x) ? b.x : firstX, 8), vw - w - 8);
  const y = Math.min(Math.max(Number.isFinite(b?.y) ? b.y : vh - h - 24, 8), vh - h - 8);
  return { x, y, w, h };
}

function place() {
  const panel = $("panel-chat");
  if (!chatPopped()) {
    for (const p of ["left", "top", "width", "height"]) panel.style.removeProperty(p);
    return;
  }
  const b = box();
  const min = collapsed();
  panel.classList.toggle("collapsed", min);
  panel.style.left = `${b.x}px`;
  panel.style.width = `${b.w}px`;
  if (min) { // just the title bar, where the window's bottom edge was
    panel.style.removeProperty("height");
    panel.style.top = `${Math.max(8, b.y + b.h - panel.getBoundingClientRect().height)}px`;
  } else {
    panel.style.top = `${b.y}px`;
    panel.style.height = `${b.h}px`;
  }
  placed = { w: b.w, h: min ? 0 : b.h };
}

function save() {
  const r = $("panel-chat").getBoundingClientRect();
  if (collapsed()) { // moved while collapsed: keep the saved height, follow the bar
    const b = box();
    write(BOX_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.bottom - b.h), w: b.w, h: b.h }));
    return;
  }
  write(BOX_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
  placed = { w: Math.round(r.width), h: Math.round(r.height) };
}

function paint() {
  const popped = chatPopped();
  const panel = $("panel-chat");
  panel.classList.toggle("chat-popped", popped);
  if (popped) panel.hidden = false;
  if (toggle) {
    toggle.hidden = !DESKTOP.matches;
    toggle.textContent = popped ? "[ DOCK ]" : "[ POP OUT ]";
    toggle.title = popped ? "put the chat back in the tabs" : "float the chat over the page, so it stays open on every tab";
  }
  if (minBtn) {
    minBtn.hidden = !popped;
    minBtn.textContent = collapsed() ? "[ + ]" : "[ _ ]";
    minBtn.title = collapsed() ? "open the chat window" : "shrink it to its title bar";
  }
  place();
}

/** Pop out or dock. @param {boolean} on */
export function setChatPopped(on) {
  write(KEY, on ? "1" : null);
  paint();
  onChange();
  const list = document.getElementById("chat-list");
  if (list) list.scrollTop = list.scrollHeight;
}

/** Drag the window by its title bar (not by its buttons). @param {HTMLElement} head */
function draggable(head) {
  head.addEventListener("pointerdown", (e) => {
    if (!chatPopped() || e.button !== 0 || /** @type {HTMLElement} */ (e.target).closest("button, input, a")) return;
    const panel = $("panel-chat");
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
    const move = (/** @type {PointerEvent} */ m) => {
      const x = Math.min(Math.max(m.clientX - dx, 8), window.innerWidth - r.width - 8);
      const y = Math.min(Math.max(m.clientY - dy, 8), window.innerHeight - r.height - 8);
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      panel.classList.remove("dragging");
      save();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  });
}

/** Wire it up once the chat exists. @param {() => void} changed what to redo after popping in / out */
export function initChatPop(changed) {
  onChange = changed;
  const head = /** @type {HTMLElement | null} */ (document.querySelector("#chat .chat-h"));
  if (!head || toggle) return; // once
  minBtn = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-pop-btn chat-min-btn"));
  minBtn.type = "button";
  minBtn.addEventListener("click", () => {
    write(MIN_KEY, collapsed() ? null : "1");
    paint();
  });
  toggle = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-pop-btn"));
  toggle.type = "button";
  toggle.addEventListener("click", () => setChatPopped(!chatPopped()));
  head.append(minBtn, toggle);
  draggable(head);
  // The corner resize: remember the new size once it settles. Only sizes the
  // player made: not the ones place() sets (a smaller window clamps it for a while).
  let t = 0;
  new ResizeObserver(() => {
    const panel = $("panel-chat");
    if (!chatPopped() || collapsed() || panel.classList.contains("dragging")) return;
    const r = panel.getBoundingClientRect();
    if (Math.abs(r.width - placed.w) < 2 && Math.abs(r.height - placed.h) < 2) return;
    clearTimeout(t);
    t = window.setTimeout(save, 300);
  }).observe($("panel-chat"));
  window.addEventListener("resize", () => chatPopped() && place());
  DESKTOP.addEventListener("change", () => {
    paint();
    onChange();
  });
  paint();
}
