// [ CLANS ] in the LEADERBOARD menu (server/omhp/clans.py ranks): every clan
// with its members' totals added up: lifetime damage, HP healed (BOSS HEAL
// scrolls) and levels. Sort by any of them, or by members. Your clan is marked.
//
//  1. { } WOLF PACK .............. 1,234,567
//      3 members  dmg 1,234,567  healed 100,000  levels 45
// (the second line wraps on a narrow screen, each total staying whole).

import * as api from "../api.js?v=b6664395f3";
import { el, fmt, padL } from "../ascii.js?v=b6664395f3";
import { state } from "../store.js?v=b6664395f3";
import { clanIn } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const SORTS = /** @type {const} */ ([["damage", "DAMAGE"], ["healing", "HEALING"], ["levels", "LEVELS"], ["members", "MEMBERS"]]);
let sort = "damage";
try {
  sort = localStorage.getItem("omhp.clanranks.sort") ?? sort;
} catch {
  /* ignore */
}
/** @type {any} */
let last = null;
let loadedAt = 0;

/** Fetch (at most every 15 s unless the sort changed) and draw. @param {boolean} [force] */
export async function loadClanRanks(force = false) {
  const host = $("panel-clanranks");
  if (last) render(last);
  else host.replaceChildren(el("div", "dim", "> loading..."));
  if (!force && last?.sort === sort && Date.now() - loadedAt < 15000) return;
  try {
    last = await api.getClanRanks(sort);
    loadedAt = Date.now();
    render(last);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** @param {any} data */
function render(data) {
  const host = $("panel-clanranks");
  const toggle = el("div", "rank-toggle clan-sort");
  for (const [key, label] of SORTS) {
    const b = el("button", "", `[ ${label} ]`);
    b.setAttribute("aria-pressed", String(sort === key));
    b.addEventListener("click", () => {
      sort = key;
      try {
        localStorage.setItem("omhp.clanranks.sort", key);
      } catch {
        /* ignore */
      }
      loadClanRanks(true);
    });
    toggle.append(b);
  }
  const W = 34;
  const title = `CLANS BY ${SORTS.find(([k]) => k === data.sort)?.[1] ?? "DAMAGE"}`;
  const table = el("div", "rank-table clan-rank-table");
  table.append(el("div", "clan-rank-line", `${title} ${"-".repeat(Math.max(0, W - title.length - 1))}`));
  if (!data.clans.length) table.append(el("div", "clan-rank-line", "  (no clans yet: found one in YOU > CLAN)"));
  const mine = clanIn(state.me?.badges);
  data.clans.forEach((/** @type {any} */ k, /** @type {number} */ i) => {
    const me = mine !== null && String(k.id) === mine;
    const value = fmt(k[data.sort]);
    const num = `${padL(String(i + 1), 2)}. `;
    // "{ } NAME" is 4 + name wide.
    const dots = ".".repeat(Math.max(1, W - num.length - 4 - k.name.length - 1 - value.length - 1));
    const [o, c] = Array.from(/** @type {string} */ (k.brackets));
    const look = el("span", "clan-look");
    for (const ch of [o, " ", c]) {
      const s = el("span", ch === " " ? "" : "clan-br badge-glyph", ch);
      if (ch !== " ") s.style.color = k.color;
      look.append(s);
    }
    const row = el("div", `clan-rank-row${me ? " me" : ""}`);
    const line = el("div", "clan-rank-line");
    line.append(num, look, " ", el("b", "", k.name), ` ${dots} ${value}${me ? " <" : ""}`);
    // The totals wrap as whole pieces when the panel is narrow.
    const stats = el("div", "clan-rank-stats dim");
    for (const [key, label] of [["members", k.members === 1 ? "member" : "members"], ["damage", "dmg"],
      ["healing", "healed"], ["levels", "levels"]]) {
      const v = fmt(k[key]);
      stats.append(el("span", key === data.sort ? "on" : "", key === "members" ? `${v} ${label}` : `${label} ${v}`));
    }
    row.append(line, stats);
    table.append(row);
  });
  host.replaceChildren(toggle, table, el("div", "dim", "members' lifetime totals added up :: healed = BOSS HEAL scrolls"));
}
