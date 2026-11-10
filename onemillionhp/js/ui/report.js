// Report a player: from the [N ONLINE] list or a CHAT message. Pick what for,
// add a note if you like; it lands in the admin panel's [ REPORTS ] (a chat
// report keeps a copy of the message).

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { state } from "../store.js?v=b6664395f3";
import { popup, showOverlay } from "./fx.js?v=b6664395f3";

const REASONS = [
  ["bot", "BOTTING / AUTO-CLICKING"],
  ["chat", "CHAT (spam, abuse)"],
  ["name", "OFFENSIVE NAME"],
  ["other", "SOMETHING ELSE"],
];

/** Can this page report ``playerId``? (named, and not yourself) @param {string} playerId */
export const canReport = (playerId) => Boolean(state.me?.name_chosen && !state.me.banned && playerId && playerId !== state.me.id);

/** A small [ REPORT ] button. @param {{player_id: string, name: string, chat_id?: number, text?: string}} who
 * @param {string} [label] @param {() => void} [before] runs first (e.g. close the list it's in) */
export function reportButton(who, label = "[ REPORT ]", before) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "report-btn", label));
  b.type = "button";
  b.title = `report ${who.name}`;
  b.setAttribute("aria-label", `report ${who.name}`);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    before?.();
    openReport(who);
  });
  return b;
}

/** @param {{player_id: string, name: string, chat_id?: number, text?: string}} who */
export function openReport(who) {
  showOverlay((inner, close) => {
    const box = el("div", "report-form");
    box.append(el("div", "report-head", `REPORT ${who.name}`));
    if (who.text) box.append(el("div", "report-quote", `"${who.text}"`));
    let reason = who.chat_id !== undefined ? "chat" : "bot";
    const picks = el("div", "report-reasons");
    const buttons = REASONS.map(([key, label]) => {
      const b = /** @type {HTMLButtonElement} */ (el("button", "report-reason", `( ) ${label}`));
      b.type = "button";
      b.addEventListener("click", () => {
        reason = key;
        paint();
      });
      picks.append(b);
      return /** @type {[string, string, HTMLButtonElement]} */ ([key, label, b]);
    });
    const paint = () => {
      for (const [key, label, b] of buttons) {
        b.textContent = `${key === reason ? "(*)" : "( )"} ${label}`;
        b.classList.toggle("on", key === reason);
      }
    };
    paint();
    const note = /** @type {HTMLTextAreaElement} */ (el("textarea", "report-note"));
    note.maxLength = 300;
    note.rows = 3;
    note.placeholder = "anything the admin should know? (optional)";
    const msg = el("div", "report-msg");
    const send = /** @type {HTMLButtonElement} */ (el("button", "", "[ SEND REPORT ]"));
    const cancel = /** @type {HTMLButtonElement} */ (el("button", "", "[ CANCEL ]"));
    send.type = cancel.type = "button";
    cancel.addEventListener("click", close);
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        await api.sendReport(who.player_id, reason, note.value, who.chat_id);
        close();
        popup("REPORT SENT. THANKS.", "proc");
      } catch (e) {
        msg.textContent = "> " + /** @type {Error} */ (e).message;
        send.disabled = false;
      }
    });
    const row = el("div", "report-buttons");
    row.append(send, cancel);
    box.append(picks, note, msg, row);
    inner.append(box);
  });
}
