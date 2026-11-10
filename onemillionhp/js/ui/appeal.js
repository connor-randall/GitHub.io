// Banned: a banner across the top of the page with [ APPEAL ]. The player
// writes a few lines and it lands in the admin panel's [ APPEALS ]; the
// banner then says it's waiting, or shows the admin's answer. An accepted
// appeal unbans them on the spot (the server pushes "appeal" to this page).

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { popup, showOverlay } from "./fx.js?v=b6664395f3";

const MAX = 500;
let wasBanned = false;

/** Redraw the banner from state.me (called on every "me"). */
export function paintBan() {
  const host = document.getElementById("ban-banner");
  const me = state.me;
  if (!host || !me) return;
  if (wasBanned && !me.banned) popup("APPEAL ACCEPTED. WELCOME BACK.", "proc");
  wasBanned = Boolean(me.banned);
  host.hidden = !me.banned;
  if (!me.banned) {
    host.replaceChildren();
    return;
  }
  const a = me.appeal ?? { status: null, can_send: true };
  const parts = [el("div", "ban-head", "YOU HAVE BEEN BANNED.")];
  if (a.status === "open") {
    parts.push(el("div", "ban-note", "your appeal is with the admin. you'll see the answer here."));
  } else if (a.status === "denied") {
    parts.push(el("div", "ban-note", "your appeal was denied." + (a.reply ? ` the admin said: "${a.reply}"` : "")));
    if (!a.can_send && a.can_send_at) {
      const when = new Date(a.can_send_at * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
      parts.push(el("div", "ban-note", `you can appeal again after ${when}.`));
    }
  } else {
    parts.push(el("div", "ban-note", "think this is a mistake? tell the admin what happened."));
  }
  if (a.can_send) {
    const btn = /** @type {HTMLButtonElement} */ (el("button", "ban-appeal", "[ APPEAL ]"));
    btn.type = "button";
    btn.addEventListener("click", openAppeal);
    parts.push(btn);
  }
  host.replaceChildren(...parts);
}

function openAppeal() {
  showOverlay((inner, close) => {
    const box = el("div", "appeal-form");
    const text = /** @type {HTMLTextAreaElement} */ (el("textarea", "appeal-text"));
    text.maxLength = MAX;
    text.rows = 6;
    text.placeholder = "why should you be let back in? (how you play, what device, anything that helps)";
    const count = el("div", "dim appeal-count", `0 / ${MAX}`);
    text.addEventListener("input", () => (count.textContent = `${text.value.length} / ${MAX}`));
    const msg = el("div", "appeal-msg");
    const send = /** @type {HTMLButtonElement} */ (el("button", "", "[ SEND APPEAL ]"));
    const cancel = /** @type {HTMLButtonElement} */ (el("button", "", "[ CANCEL ]"));
    send.type = cancel.type = "button";
    cancel.addEventListener("click", close);
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        await api.sendAppeal(text.value);
        state.me = await api.getMe();
        emit("me");
        close();
        popup("APPEAL SENT.", "proc");
      } catch (e) {
        msg.textContent = "> " + /** @type {Error} */ (e).message;
        send.disabled = false;
      }
    });
    const row = el("div", "appeal-buttons");
    row.append(send, cancel);
    box.append(el("div", "ban-head", "APPEAL YOUR BAN"), text, count, msg, row);
    inner.append(box);
    requestAnimationFrame(() => text.focus()); // after the overlay focuses its first button
  });
}

/** An action was refused with BANNED: fetch the profile so the banner shows. */
export function noteBanned() {
  api.getMe().then((m) => {
    state.me = m;
    emit("me");
  }).catch(() => showError("The dungeon has rejected you."));
}
