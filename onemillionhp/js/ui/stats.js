// [ STATS ] in the YOU menu (ticket #95): your own lifetime numbers from
// GET /api/me/stats (Game.stats): hits, bosses, chests opened per kind, items
// looted per rarity, and the rest of what the achievement counters keep.

import * as api from "../api.js?v=b6664395f3";
import { bar, el, fmt } from "../ascii.js?v=b6664395f3";
import { state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const visible = () => !$("panel-stats").hidden;

/** @type {any} */
let stats = null;
let loadedAt = 0;
let loading = false;

/** Fetch (at most every 10 s) and draw. */
export async function loadStats() {
  if (visible()) render();
  if (loading || (stats && Date.now() - loadedAt < 10000)) return;
  loading = true;
  try {
    stats = await api.getStats();
    loadedAt = Date.now();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
    if (visible()) render();
  }
}

/** A heading like the other panels: "COMBAT ------". @param {string} title */
function heading(title) {
  const h = el("div", "panel-h", `${title} `);
  h.append(el("b", "", "-".repeat(Math.max(4, 30 - title.length))));
  return h;
}

/** A two-column table. @param {[string, string][]} rows */
function table(rows) {
  const t = el("table", "kv stats-kv");
  for (const [k, v] of rows) {
    const tr = el("tr");
    tr.append(el("td", "", k), el("td", "", v));
    t.append(tr);
  }
  return t;
}

/** Rows with a bar against the biggest, for counts per kind.
 * @param {[string, number, string][]} rows label, count, css class */
function bars(rows) {
  const most = Math.max(1, ...rows.map(([, n]) => n));
  const t = el("table", "kv stats-kv stats-bars");
  for (const [label, n, cls] of rows) {
    const tr = el("tr", n ? "" : "dim");
    const val = el("td", "");
    val.append(el("span", `stats-bar ${cls}`, bar(n / most, 12)), ` ${fmt(n)}`);
    tr.append(el("td", cls, label), val);
    t.append(tr);
  }
  return t;
}

const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

function render() {
  const host = $("panel-stats");
  if (!stats) {
    host.replaceChildren(el("div", "dim bag-note", loading ? "> loading..." : "> no stats yet."));
    return;
  }
  const s = stats;
  const c = s.counters ?? {};
  const content = state.content ?? {};
  /** @type {any[]} */
  const boxes = content.boxes ?? [];
  /** @type {any[]} */
  const rarities = content.rarities ?? [];
  const looted = Object.values(s.looted ?? {}).reduce((a, n) => a + Number(n), 0);
  const days = Math.max(1, Math.ceil((Date.now() / 1000 - s.since) / 86400));
  host.replaceChildren(
    heading("COMBAT"),
    table([
      ["TOTAL DAMAGE", fmt(s.damage)],
      ["ATTACKS", fmt(s.attacks)],
      ["CRITS", `${fmt(s.crits)} (${pct(s.crits, s.attacks)})`],
      ["BIGGEST HIT", fmt(s.biggest_hit)],
      ["AVERAGE HIT", s.attacks ? fmt(Math.round(s.damage / s.attacks)) : "-"],
      ["ULTIMATES", fmt(s.ultimates)], // they don't hit any more (ticket #311)
      ["BEST COMBO", fmt(c.combo_best ?? 0)],
      ["CRIT STREAK", fmt(c.crit_streak ?? 0)],
      ["DOUBLE HITS", fmt(c.double_strikes ?? 0)],
    ]),
    heading("BOSSES"),
    table([
      ["FOUGHT", fmt(s.bosses)],
      ["FINAL BLOWS", fmt(s.kills)],
      ["TOP 3 FINISHES", fmt(c.podiums ?? 0)],
      ["#1 DAMAGE", fmt(c.top_damage ?? 0)],
      ["BEST ON ONE", fmt(s.best_boss_damage)],
      ["CROWNS", fmt(s.crowns)],
    ]),
    heading(`CHESTS OPENED: ${fmt(s.boxes_opened)}`),
    bars(boxes.map((b) => [b.name, Number(s.opened?.[b.id] ?? 0), ""])),
    el("div", "dim stats-note", `longest run without a rare or better: ${fmt(c.dry_streak ?? 0)} chests`),
    heading(`ITEMS LOOTED: ${fmt(looted)}`),
    bars(rarities.filter((r) => s.looted?.[r.id] !== undefined)
      .map((r) => [String(r.label ?? r.id).toUpperCase(), Number(s.looted[r.id] ?? 0), `r-${r.id}`])),
    el("div", "dim stats-note", "drops from attacks and chests (not the shop, auction, city or gifts)"),
    heading("EVERYTHING ELSE"),
    table([
      ["ITEMS SOLD", fmt(c.items_sold ?? 0)],
      ["SHARDS SPENT", fmt(c.shards_spent ?? 0)],
      ["SCROLLS USED", fmt(c.scrolls_used ?? 0)],
      ["CHAT MESSAGES", fmt(c.chat_messages ?? 0)],
      ["PLAYING FOR", `${fmt(days)} day${days === 1 ? "" : "s"}`],
    ]),
  );
}
