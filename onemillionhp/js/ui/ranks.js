// [ RANKS ] panel: today / all-time leaderboards, and one per boss.

import * as api from "../api.js?v=b6664395f3";
import { duration, el, fmt, padL } from "../ascii.js?v=b6664395f3";
import { bossDef, now, state } from "../store.js?v=b6664395f3";
import { badgeTag, badgeWidth, crownStar, nameStar } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showGear } from "./gear.js?v=b6664395f3";
import { pageOf, pager } from "./pager.js?v=b6664395f3";

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
/** Which page of PREVIOUS BOSSES is showing (newest first). */
let bossPage = 0;
const BOSSES_PER_PAGE = 20;

/** Redraw from the last fetch, e.g. once we know which player is "you". */
export function redrawRanks() {
  if (lastLb) renderRanks(lastLb);
}

/** Show one boss's board next time the panel draws (the boss's [ LEADERBOARD ] button).
 * @param {number} seq */
export function showBossRanks(seq) {
  rankScope = `boss:${seq}`;
  ranksLoadedAt = 0;
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

/** The CROWN: today's biggest single hit, who holds it, and when it locks in.
 * @param {any} c {holder, ends_at, recent} */
function crownBox(c) {
  const box = el("div", "rank-crown");
  const head = el("div", "rank-crown-h");
  head.append(crownStar(), " THE CROWN ", el("span", "dim", ":: today's biggest single hit"));
  box.append(head);
  const h = c.holder;
  const left = duration(Math.max(0, c.ends_at - now()));
  if (h) {
    const mine = h.player_id === state.me?.id;
    const who = el("div", `rank-crown-who${mine ? " me" : ""}`);
    who.append(el("b", "", h.name), `  ${fmt(h.value)} damage${mine ? "  < you" : ""}`);
    box.append(who, el("div", "dim", `held for ${duration(Math.max(0, now() - h.since))}  ::  `
      + `${mine ? "keep it" : "it's theirs"} if nobody hits harder in the next ${left} (midnight MT)`));
  } else {
    box.append(el("div", "rank-crown-who", "nobody yet today."),
      el("div", "dim", `the first hit takes it. it locks in at midnight MT (${left}).`));
  }
  if (c.recent?.length) {
    const past = el("div", "rank-crown-past dim");
    past.append("RECENT: ", ...c.recent.flatMap((/** @type {any} */ r, /** @type {number} */ i) => [
      i ? "  ·  " : "", el("span", r.player_id === state.me?.id ? "me" : "", `${r.day.slice(5)} ${r.name} ${fmt(r.value)}`)]));
    box.append(past);
  }
  return box;
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
  const live = bosses.find((b) => b.status === "alive");
  if (live) toggle.append(button(`boss:${live.seq}`, "[ THIS BOSS ]", bossDef(live.def_id)?.tint ?? null));
  const parts = [toggle];
  if (lb.crown) parts.push(crownBox(lb.crown));
  const shown = rankScope.startsWith("boss:") ? bosses.find((b) => `boss:${b.seq}` === rankScope) : null;
  if (shown) {
    const how = shown.status === "alive" ? "FIGHTING IT NOW" : `SLAIN BY ${shown.killer_name ?? "?"}`;
    parts.push(el("div", "rank-boss-h", `BOSS #${String(shown.seq).padStart(3, "0")} ${shown.name}  ::  ${how}`));
  }
  // YOU: your own place on this board, even outside the top 10.
  if (lb.me && state.me) {
    const box = el("div", "rank-you");
    box.append(el("span", "rank-you-name", `YOU (${state.me.name})`));
    const bits = el("div", "rank-you-bits");
    for (const [key, label] of [["damage", "DAMAGE"], ["attacks", "ATTACKS"], ["crits", "CRITS"]]) {
      const r = lb.me[key];
      const cell = el("span", "rank-you-cell");
      cell.append(el("b", "", r?.rank ? `#${fmt(r.rank)}` : "--"), ` ${label} ${fmt(r?.value ?? 0)}`);
      bits.append(cell);
    }
    box.append(bits);
    if (!lb.me.damage?.rank) box.append(el("div", "rank-you-hint", "> not on this board yet. go hit something."));
    parts.push(box);
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
      const num = `${padL(String(i + 1), 2)}. `;
      const left = `${num}${r.name} `;
      const dots = ".".repeat(Math.max(1, W - left.length - badgeWidth(r.badges) - n.length - 1));
      const mine = r.player_id === state.me?.id;
      const span = el("span", mine ? "me" : "");
      const tag = badgeTag(r.badges, r.player_id);
      // Ticket #56: the name opens their gear card, like a name in CHAT.
      const who = /** @type {HTMLButtonElement} */ (el("button", "rank-who", r.name));
      who.type = "button";
      who.title = `see what ${r.name} is wearing`;
      who.addEventListener("click", () => showGear(r.player_id));
      span.append(num, ...(tag ? [tag, " "] : []), ...nameStar(r.badges), ...(r.player_id ? [who] : [r.name]), ...nameStar(r.badges), ` ${dots} ${n}${mine ? " <" : ""}\n`);
      pre.append(span);
    });
    parts.push(pre);
  }
  parts.push(el("div", "dim", rankScope === "today" ? "resets 00:00 UTC"
    : rankScope === "all" ? "since the first boss" : "damage, hits and crits on this boss only  ::  * = alive now"));
  // Every earlier boss's own board, under the leaderboard and a page at a time.
  if (bosses.length) {
    parts.push(el("div", "rank-sub rank-prev-h", "PREVIOUS BOSSES"));
    const newest = [...bosses].sort((x, y) => y.seq - x.seq);
    const page = pageOf(newest, bossPage, BOSSES_PER_PAGE);
    bossPage = page.page;
    const row = el("div", "rank-toggle rank-bosses");
    for (const b of page.items) {
      const alive = b.status === "alive";
      row.append(button(`boss:${b.seq}`, `[ #${b.seq} ${b.name}${alive ? " *" : ""} ]`, bossDef(b.def_id)?.tint ?? null));
    }
    parts.push(row, pager(page.page, page.pages, (to) => {
      bossPage = to;
      renderRanks(lb);
    }));
  }
  host.replaceChildren(...parts);
}
