// [ RANKS ] panel: today / all-time leaderboards, and one per boss.

import * as api from "../api.js?v=e54d3ddffb";
import { el, fmt, padL } from "../ascii.js?v=e54d3ddffb";
import { bossDef, state } from "../store.js?v=e54d3ddffb";
import { showError } from "./errors.js?v=e54d3ddffb";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ------------------------------------------------------------------ ranks

/** "today", "all" or "boss:<seq>". */
let rankScope = "today";
/** Every boss so far (newest first), for the per-boss buttons. @type {any[]} */
let bosses = [];
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
    const [lb, hist] = await Promise.all([api.getLeaderboard(rankScope), api.getHistory().catch(() => null)]);
    if (hist) bosses = hist.bosses;
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
  /** @param {string} scope @param {string} label @param {string | null} [tint] */
  const button = (scope, label, tint = null) => {
    const b = el("button", "", label);
    b.setAttribute("aria-pressed", String(rankScope === scope));
    if (tint) b.style.setProperty("--chip-tint", tint);
    b.addEventListener("click", () => {
      rankScope = scope;
      loadRanks(true);
    });
    return b;
  };
  const toggle = el("div", "rank-toggle");
  toggle.append(button("today", "[ TODAY ]"), button("all", "[ ALL TIME ]"));
  const parts = [toggle];
  if (bosses.length) {
    parts.push(el("div", "rank-sub", "BY BOSS"));
    const row = el("div", "rank-toggle rank-bosses");
    for (const b of [...bosses].sort((x, y) => x.seq - y.seq)) {
      const live = b.status === "alive";
      row.append(button(`boss:${b.seq}`, `[ #${b.seq} ${b.name}${live ? " *" : ""} ]`, bossDef(b.def_id)?.tint ?? null));
    }
    parts.push(row);
  }
  const shown = rankScope.startsWith("boss:") ? bosses.find((b) => `boss:${b.seq}` === rankScope) : null;
  if (shown) {
    const how = shown.status === "alive" ? "FIGHTING IT NOW" : `SLAIN BY ${shown.killer_name ?? "?"}`;
    parts.push(el("div", "rank-boss-h", `BOSS #${String(shown.seq).padStart(3, "0")} ${shown.name}  ::  ${how}`));
  }
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
  parts.push(el("div", "dim", rankScope === "today" ? "resets 00:00 UTC"
    : rankScope === "all" ? "since the first boss" : "damage, hits and crits on this boss only  ::  * = alive now"));
  host.replaceChildren(...parts);
}
