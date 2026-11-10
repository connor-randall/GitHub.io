// [ WORLD ] / [ CLAN ] at the top of the main CHAT (ticket #153): clan members
// flip between the world chat and their clan's chat without going to YOU >
// CLAN. CLAN shows the very same clan chat (clan.js mountClanChat). The choice
// is remembered on this browser; it only shows while you're in a clan.

import { el } from "../ascii.js?v=b6664395f3";
import { on, state } from "../store.js?v=b6664395f3";
import { clanIn } from "./badges.js?v=b6664395f3";
import { mountClanChat } from "./clan.js?v=b6664395f3";

const KEY = "omhp.chat.view";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

let view = "world";
try {
  view = localStorage.getItem(KEY) === "clan" ? "clan" : "world";
} catch {
  /* ignore */
}

/** @type {HTMLElement | null} */
let bar = null;
/** @type {HTMLElement | null} */
let clanHost = null;

const inClan = () => Boolean(clanIn(state.me?.badges));

function paint() {
  if (!bar || !clanHost) return;
  const clan = inClan() && view === "clan";
  bar.hidden = !inClan();
  for (const b of bar.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String((/** @type {HTMLElement} */ (b).dataset.view === "clan") === clan));
  }
  for (const id of ["chat-list", "chat-form", "chat-note"]) $(id).hidden = clan;
  const was = clanHost.hidden;
  clanHost.hidden = !clan;
  if (clan && was) mountClanChat(clanHost);
}

/** @param {string} v */
function choose(v) {
  view = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  if (clanHost) clanHost.hidden = true; // so paint() mounts it fresh
  paint();
}

export function initChatSwitch() {
  const head = document.querySelector("#chat .chat-h");
  if (!head) return;
  bar = el("span", "chat-switch");
  for (const [v, label] of [["world", "[ WORLD ]"], ["clan", "[ CLAN ]"]]) {
    const b = /** @type {HTMLButtonElement} */ (el("button", "btn-text", label));
    b.type = "button";
    b.dataset.view = v;
    b.addEventListener("click", () => choose(v));
    bar.append(b);
  }
  head.append(bar);
  clanHost = el("div", "chat-clan");
  clanHost.id = "chat-clan";
  clanHost.hidden = true;
  $("chat-list").before(clanHost);
  paint();
  on("me", paint); // joined or left a clan
}
