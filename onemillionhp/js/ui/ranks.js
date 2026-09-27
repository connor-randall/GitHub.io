// [ RANKS ] panel: today / all-time leaderboards.

import * as api from "../api.js?v=303339e3c3";
import { el, fmt, padL } from "../ascii.js?v=303339e3c3";
import { state } from "../store.js?v=303339e3c3";
import { showError } from "./errors.js?v=303339e3c3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ------------------------------------------------------------------ ranks

/** @type {"today"|"all"} */
let rankScope = "today";
let ranksLoadedAt = 0;
/** Last leaderboard fetched, so it can be redrawn without a request. */
/** @type {any} */
let lastLb = null;

/** Redraw from the last fetch, e.g. once we know which player is "you". */
export function redrawRanks() {
  if (lastLb) renderRanks(lastLb);
}

export async function loadRanks(force = false) {
  const host = $("panel-ranks");
  if (!force && Date.now() - ranksLoadedAt < 15000 && host.childElementCount) return;
  ranksLoadedAt = Date.now();
  // Keep whatever is showing until the new data arrives (no flash/jump).
  if (!host.childElementCount) host.append(el("div", "dim", "> loading..."));
  host.setAttribute("aria-busy", "true");
  try {
    const lb = await api.getLeaderboard(rankScope);
    renderRanks(lb);
    host.removeAttribute("aria-busy");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** @param {any} lb */
function renderRanks(lb) {
  lastLb = lb;
  const host = $("panel-ranks");
  const toggle = el("div", "rank-toggle");
  for (const [scope, label] of /** @type {const} */ ([["today", "[ TODAY ]"], ["all", "[ ALL TIME ]"]])) {
    const b = el("button", "", label);
    b.setAttribute("aria-pressed", String(rankScope === scope));
    b.addEventListener("click", () => {
      rankScope = scope;
      loadRanks(true);
    });
    toggle.append(b);
  }
  const parts = [toggle];
  const W = 34;
  for (const [key, title] of [["damage", "HIGHEST DAMAGE"], ["attacks", "MOST ATTACKS"], ["crits", "MOST CRITS"]]) {
    const rows = lb[key] ?? [];
    const pre = el("pre", "rank-table");
    pre.append(document.createTextNode(`${title} ${"-".repeat(Math.max(0, W - title.length - 1))}\n`));
    if (!rows.length) pre.append(document.createTextNode("  (nobody yet)\n"));
    rows.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
      // " 1. CONNOR ............ 1,234"
      const n = fmt(r.value);
      const left = `${padL(String(i + 1), 2)}. ${r.name} `;
      const dots = ".".repeat(Math.max(1, W - left.length - n.length - 1));
      const mine = r.player_id === state.me?.id;
      const span = el("span", mine ? "me" : "", `${left}${dots} ${n}${mine ? " <" : ""}\n`);
      pre.append(span);
    });
    parts.push(pre);
  }
  parts.push(el("div", "dim", rankScope === "today" ? "resets 00:00 UTC" : "since the first boss"));
  host.replaceChildren(...parts);
}
