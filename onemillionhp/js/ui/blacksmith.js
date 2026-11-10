// [ BLACKSMITH ] (YOU menu): merge duplicates into one refined copy, or pay
// shards to respec its numbers (server/omhp/refine.py). The server decides
// everything: eligibility, prices, the roll. This page shows what it says,
// asks twice before spending, keeps one request id per action so a retry
// never charges again, and plays the cat's animation only once the server has
// confirmed (blacksmith-scene.js). docs/BLACKSMITH_ANIMATIONS.md.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt, setArt } from "../ascii.js?v=b6664395f3";
import { emit, itemById, ownItemOf, rarityById, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { effectEntries } from "./effects.js?v=b6664395f3";
import { itemLines } from "./fx.js?v=b6664395f3";
import { loadoutTag } from "./loadouts.js?v=b6664395f3";
import { Workshop, glyphOf, stillMode } from "./blacksmith-scene.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any[]} */
let items = [];
let loadedAt = 0;
/** @type {string | null} */
let selected = null;
/** @type {"merge" | "respec" | "grind" | "affix"} */
let mode = "merge";
let pending = false;
let animating = false;
/** The button asked "SURE?" once: the action it's armed for. */
let armed = "";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let disarm;
/** The last finished operation (kept until another item or action). @type {any} */
let last = null;
let spokeOnOpen = false;
/** HOW IT WORKS stays open across redraws (every profile update redraws: ticket #216). */
let howOpen = false;

/** @type {{root: HTMLElement, scene: Workshop, modes: HTMLElement, list: HTMLElement, work: HTMLElement,
 *   detail: HTMLElement, result: HTMLElement, live: HTMLElement, skip: HTMLButtonElement} | null} */
let ui = null;

const LABEL = /** @type {Record<string, string>} */ ({
  damage: "DAMAGE", crit_chance: "CRIT CHANCE", crit_dmg: "CRIT DAMAGE", double_strike: "DOUBLE STRIKE",
  executioner: "EXECUTIONER", opener: "OPENER", surge: "SURGE", save_attack: "FREE ATTACK",
  ult_refund: "ULT REFUND", box_find: "BOX FIND", loot_mult: "LOOT",
});

/** @param {number} x */
const pct = (x) => `${(x * 100).toFixed(2)}%`;

/** A group's value from a mods object, as numbers (damage is the pair). @param {any} m @param {string} g */
const valuesOf = (m, g) => (g === "damage" ? [m.min_dmg, m.max_dmg] : g === "loot_mult" ? [m.loot_mult - 1] : [m[g]]);

/** "1-2" / "5.70%" / "+20.00%". @param {string} g @param {number[]} v */
function show(g, v) {
  if (g === "damage") return v[0] ? `${v[0]}-${v[1]}` : `+${v[1]} MAX`;
  return g === "loot_mult" ? `+${pct(v[0])}` : pct(v[0]);
}

/** Groups an item state refines, in the server's order. @param {any} s */
const groupsOf = (s) => Object.keys(s.respec.ranges);

/** UP / DOWN / SAME, with an arrow that doesn't rely on colour. @param {number[]} a @param {number[]} b */
function dir(a, b) {
  const d = b.reduce((n, v, i) => n + v - a[i], 0);
  return d > 1e-9 ? ["UP", "bs-up"] : d < -1e-9 ? ["DOWN", "bs-down"] : ["SAME", "dim"];
}

const visible = () => !$("panel-blacksmith").hidden;
const current = () => items.find((s) => s.item_id === selected) ?? null;

/** Open the BLACKSMITH on one item (the BAG's shortcut). @param {string} itemId @param {"merge" | "respec" | "grind"} [m] */
export function preselect(itemId, m) {
  selected = itemId;
  if (m) mode = m;
  last = null;
}

export async function loadBlacksmith(force = false) {
  if (!ui) build();
  if (!ui) return;
  const host = $("panel-blacksmith");
  if (ui.root.parentElement !== host) host.replaceChildren(ui.root);
  ui.scene.start();
  if (!spokeOnOpen) {
    spokeOnOpen = true;
    ui.scene.line("Duplicates on the left. Possibilities on the right.");
  }
  render();
  if ((!force && Date.now() - loadedAt < 4000) || pending || animating) return;
  try {
    items = (await api.getBlacksmith()).items;
    loadedAt = Date.now();
    if (!current()) selected = order()[0]?.item_id ?? null;
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
  render();
}

/** Refined first, then merge-ready, then rarest. */
function order() {
  const rank = (/** @type {any} */ s) => rarityById(itemById(s.item_id)?.rarity)?.rank ?? 0;
  return [...items].sort((a, b) => Number(b.bound) - Number(a.bound) || Number(b.merge.ok) - Number(a.merge.ok)
    || rank(b) - rank(a) || (itemById(a.item_id)?.name ?? "").localeCompare(itemById(b.item_id)?.name ?? ""));
}

function build() {
  const root = el("div", "blacksmith");
  const frame = el("div", "bs-frame");
  const title = el("div", "bs-title", "THE BLACKSMITH");
  const pre = el("pre", "bs-scene");
  pre.setAttribute("aria-hidden", "true");
  const say = el("div", "bs-say");
  const skip = /** @type {HTMLButtonElement} */ (el("button", "btn-text bs-skip", "[ SKIP ]"));
  skip.type = "button";
  skip.hidden = true;
  skip.addEventListener("click", () => ui?.scene.skip());
  frame.append(title, pre, say, skip);
  const modes = el("div", "bs-modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "what to do");
  const work = el("pre", "art bs-work");
  work.setAttribute("aria-hidden", "true");
  const detail = el("div", "bs-detail");
  const result = el("div", "bs-result");
  result.tabIndex = -1;
  const live = el("div", "sr-only");
  live.setAttribute("aria-live", "polite");
  const list = el("div", "bs-list");
  root.append(frame, modes, work, detail, result, live, el("div", "panel-h bs-list-h", "YOUR GEAR"), list);
  ui = { root, scene: new Workshop(pre, say), modes, list, work, detail, result, live, skip };
}

/** A button that asks "SURE?" first. @param {string} key @param {string} label @param {string} sure
 * @param {boolean} ok @param {() => void} go */
function twice(key, label, sure, ok, go) {
  const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn bs-go${armed === key ? " armed" : ""}`,
    armed === key ? sure : label));
  b.type = "button";
  b.disabled = !ok || pending || animating;
  b.addEventListener("click", () => {
    if (armed !== key) {
      armed = key;
      clearTimeout(disarm);
      disarm = setTimeout(() => {
        armed = "";
        render();
      }, 4000);
      render();
      return;
    }
    armed = "";
    clearTimeout(disarm);
    go();
  });
  return b;
}

function render() {
  if (!ui) return;
  const s = current();
  ui.modes.replaceChildren(...(/** @type {const} */ ([["merge", "[ MERGE ]"], ["respec", "[ RESPEC — REROLL STATS ]"],
    ["affix", "[ AFFIX — ADD A STAT ]"], ["grind", "[ GRINDSTONE ]"]]))
    .map(([m, label]) => {
      const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn bs-mode", label));
      b.type = "button";
      b.setAttribute("aria-pressed", String(mode === m));
      b.disabled = pending || animating;
      b.addEventListener("click", () => {
        if (mode === m) return;
        mode = m;
        armed = "";
        last = null;
        ui?.scene.line(m === "merge" ? "Copies in, one comes out. Nothing's lost but the spares."
          : m === "respec" ? "A reroll. Could go up, could go down. The rank stays put."
            : m === "affix" ? "A rune burned in. Something it never had."
              : "Don't like the roll? The wheel takes it off. The merge stays.");
        render();
      });
      return b;
    }));
  const item = s ? ownItemOf(itemById(s.item_id)) : null;
  ui.scene.setItem(item ? { glyph: glyphOf(item.slot), rarity: item.rarity } : null);
  if (item && s) {
    setArt(ui.work, itemLines({ ...item, refine_rank: s.rank }, { count: s.owned, width: 26 }), 14);
    ui.work.className = `art bs-work r-${item.rarity}`;
    ui.work.hidden = false;
  } else {
    ui.work.hidden = true;
  }
  ui.detail.replaceChildren(...(s && item ? detail(s, item) : [el("div", "dim bag-note", loadedAt
    ? "> nothing for the anvil yet. gear you find shows up here (city, shop and special pieces can't be refined)."
    : "> loading...")]));
  renderResult();
  renderList();
}

/** The selected item: rank, copies, and the chosen action with its price and preview.
 * @param {any} s @param {any} item */
function detail(s, item) {
  const parts = [];
  const head = el("div", "bs-head");
  head.append(el("span", `r-${item.rarity}`, item.name), el("span", "bs-rank", `  REFINEMENT +${s.rank} / +${s.max_rank}`));
  parts.push(head);
  parts.push(el("div", "dim", s.bound
    ? `1 refined copy · ${fmt(s.spares)} duplicate${s.spares === 1 ? "" : "s"}`
    : `${fmt(s.owned)} cop${s.owned === 1 ? "y" : "ies"} · untouched`));
  const table = el("div", "bs-stats");
  const groups = groupsOf(s);
  // Trade-offs (a damage bonus or penalty, a loot penalty) are the item's character: never touched.
  const fixed = effectEntries(s.base_mods).filter((e) => e.key === "dmg_pct" || (e.key === "loot_mult" && e.value < 0));
  if (mode === "merge") {
    const next = s.merge.next_mods;
    for (const g of groups) {
      const now = valuesOf(s.mods, g);
      const row = el("div", "bs-row");
      row.append(el("span", "bs-label", LABEL[g] ?? g), el("span", "", show(g, now)));
      if (next) {
        const after = valuesOf(next, g);
        const [word, cls] = dir(now, after);
        row.append(el("span", "dim", " -> "), el("span", cls, `${show(g, after)} ${word}`));
      }
      table.append(row);
    }
    parts.push(table);
    if (fixed.length) parts.push(el("div", "dim", `TRADE-OFF, never changes: ${fixed.map((e) => e.text).join(", ")}`));
    if (s.rank >= s.max_rank) {
      parts.push(el("div", "bs-note", "Max refinement. Sell extra copies for shards."));
    } else {
      const left = s.owned - s.merge.cost;
      parts.push(el("div", "dim", `uses ${s.merge.cost} duplicate${s.merge.cost === 1 ? "" : "s"} · leaves ${fmt(Math.max(1, left))} owned · free, never fails`));
      if (next && groups.every((g) => dir(valuesOf(s.mods, g), valuesOf(next, g))[0] === "SAME")) {
        parts.push(el("div", "bs-note", "The rank goes up, but its small numbers round to the same value."));
      }
    }
    if (!s.bound && s.merge.ok) parts.push(bindNote());
    if (s.merge.reason && s.rank < s.max_rank) parts.push(el("div", "bs-why", `> ${s.merge.reason}`));
    if (s.rank < s.max_rank) {
      const n = s.merge.cost;
      parts.push(actions(twice(`merge:${s.item_id}`, `[ MERGE — USE ${n} DUPLICATE${n === 1 ? "" : "S"} ]`,
        `[ SURE? MERGE ${n} INTO IT ]`, s.merge.ok, () => run("merge", s))));
    }
  } else if (mode === "respec") {
    for (const g of groups) {
      const r = s.respec.ranges[g];
      const row = el("div", "bs-row");
      row.append(el("span", "bs-label", LABEL[g] ?? r.label), el("span", "", show(g, r.now)),
        el("span", "dim", r.fixed ? "   can't change at this rank" : `   rolls ${show(g, r.low)} to ${show(g, r.high)}`));
      table.append(row);
    }
    parts.push(table);
    if (fixed.length) parts.push(el("div", "dim", `TRADE-OFF, never changes: ${fixed.map((e) => e.text).join(", ")}`));
    parts.push(el("div", "bs-note", "Stats may go up or down. Your merge rank stays."));
    parts.push(el("div", "dim", "every roll replaces the last one: no keeping the old roll, no refunds."));
    parts.push(el("div", "dim", s.respec.count
      ? `respecced ${s.respec.count}x so far · each one costs more: the next after this is ${fmt(s.respec.next_cost)}`
      : `first respec on this item · each one after costs more (next: ${fmt(s.respec.next_cost)})`));
    if (!s.bound && s.respec.ok) parts.push(bindNote());
    if (s.respec.reason) parts.push(el("div", "bs-why", `> ${s.respec.reason}`));
    const cost = s.respec.cost;
    parts.push(actions(twice(`respec:${s.item_id}:${s.revision}`, `[ ${last?.action === "respec" && last.item_id === s.item_id ? "RESPEC AGAIN" : "RESPEC"} — ${fmt(cost)} SHARDS ]`,
      `[ SURE? SPEND ${fmt(cost)} SHARDS ]`, s.respec.ok, () => run("respec", s))));
  } else if (mode === "affix") { // 2026-11-06: one extra random stat (refine.py AFFIX)
    const a = s.affix;
    parts.push(el("div", "bs-note", a.now
      ? `AFFIX: ${a.now.label} ${a.now.label === "LOOT" ? "+" : ""}${pct(a.now.value)} (rolled ${a.now.roll}%)`
      : "No affix yet. Burn one in: a random stat this item doesn't have."));
    const table2 = el("div", "bs-stats");
    for (const ch of a.choices) {
      if (a.now && ch.stat === a.now.stat) continue;
      const row = el("div", "bs-row");
      row.append(el("span", "bs-label", ch.label), el("span", "dim", `could land ${pct(ch.low)} to ${pct(ch.high)}`));
      table2.append(row);
    }
    parts.push(table2);
    parts.push(el("div", "dim", a.now
      ? "rolling again REPLACES the affix with a different stat. no keeping the old one, no refunds."
      : "one affix per copy. it stays through merges, respecs and the GRINDSTONE, and goes with the copy on the AUCTION HOUSE."));
    parts.push(el("div", "dim", `${a.count ? `rolled ${a.count}x so far · ` : ""}each roll costs 50% more than the last, up to 50,000.`));
    if (!s.bound && a.ok) parts.push(bindNote());
    if (a.reason) parts.push(el("div", "bs-why", `> ${a.reason}`));
    parts.push(actions(twice(`affix:${s.item_id}:${s.revision}`, `[ ${a.now ? "REROLL THE AFFIX" : "BURN IN AN AFFIX"} — ${fmt(a.cost)} SHARDS ]`,
      `[ SURE? SPEND ${fmt(a.cost)} SHARDS ]`, a.ok, () => run("affix", s))));
  } else {
    parts.push(el("div", "bs-note", s.respecced ? "THE GRINDSTONE: the respec roll comes off. The merge stays."
      : "Nothing to grind: this copy hasn't been respecced."));
    if (s.respecced) {
      parts.push(...refineDiff(s.mods, s.grind.after_mods, "NOW", "AFTER"));
      parts.push(el("div", "dim", s.rank
        ? `its bonuses go back to what +${s.rank} alone gives. the merge rank stays.`
        : "it's never been merged, so it goes back to a plain copy: the shop, the city and the forge take it again."));
      parts.push(el("div", "dim", `free, but the shards spent on respecs don't come back, and the next respec still costs ${fmt(s.respec.cost)}.`));
    }
    if (s.grind.reason) parts.push(el("div", "bs-why", `> ${s.grind.reason}`));
    parts.push(actions(twice(`grind:${s.item_id}:${s.revision}`, "[ GRIND OFF THE RESPEC ROLL ]",
      "[ SURE? GRIND OFF THE ROLL ]", s.grind.ok, () => run("grind", s))));
  }
  if (s.autosold) {
    parts.push(el("div", "dim bs-auto", `AUTO-SELL is on for ${rarityById(item.rarity)?.label ?? item.rarity}: new copies get sold, not kept for merging.`));
  }
  parts.push(lockRow(s)); // locked: unlock it to work on it; unlocked: lock it back (#269)
  const how = /** @type {HTMLDetailsElement} */ (el("details", "bs-how"));
  how.open = howOpen;
  how.addEventListener("toggle", () => (howOpen = how.open));
  how.append(el("summary", "", "HOW IT WORKS"),
    el("div", "dim", "MERGE: feed exact duplicates into one copy. +1 takes 1, +2 takes 2, then 4, 8, 16. Up to +5 (legendary +4, mythic and godly +3, ascended +2). Every rank adds 2% to each of its bonuses."),
    el("div", "dim", "RESPEC: each bonus rolls again, anywhere from 80% to 120% of the item's own value (plus 2% per rank). The same number can come up again."),
    el("div", "dim", "GRINDSTONE: takes a respec roll off, free. The merge rank stays (a copy that was never merged goes back to plain). The shards don't come back, and the item's respec price doesn't reset."),
    el("div", "dim", "PRICE: an item's first respec is 1,000 shards; every one after costs 50% more, up to 10,000 at most. The climb belongs to that copy: the GRINDSTONE doesn't reset it, and it leaves with the copy when you sell it on the AUCTION HOUSE (the buyer pays your price). Your next copy of that item starts at 1,000 again."),
    el("div", "dim", "AFFIX: for shards, burn ONE extra stat into the copy: a random one it doesn't have, worth 50-100% of a half-strength bonus for its rarity. Rolling again swaps it for a different stat. Starts at 5,000, +50% a roll, 50,000 at most. The GRINDSTONE leaves it alone."),
    el("div", "dim", "Trade-offs (a damage or loot penalty) never change. Your gear caps still apply."),
    el("div", "dim", "REFINED: a copy is refined once it's merged OR respecced (either one is enough). You hold one refined copy of each item, and it only goes through the AUCTION HOUSE (its rank, roll and respec price go with it). The shop, the city and the forge won't take it. Extra copies can go anywhere."));
  parts.push(how);
  return parts;
}

/**
 * A refined copy against the plain item, one row per stat: "BOX FIND 5.00% -> 5.20% UP".
 * Used here (GRINDSTONE) and by the AUCTION HOUSE to show what was refined.
 * @param {any} from @param {any} to @param {string} [fromLabel] @param {string} [toLabel] */
export function refineDiff(from, to, fromLabel = "PLAIN", toLabel = "THIS COPY") {
  const groups = Object.keys(LABEL).filter((g) => (g === "damage" ? (from.max_dmg || to.max_dmg)
    : g === "loot_mult" ? (from.loot_mult > 1 || to.loot_mult > 1) : (from[g] || to[g])));
  const head = el("div", "bs-row bs-diff-h dim");
  head.append(el("span", "bs-label", ""), el("span", "", `${fromLabel} -> ${toLabel}`));
  return [head, ...groups.map((g) => {
    const a = valuesOf(from, g);
    const b = valuesOf(to, g);
    const [word, cls] = dir(a, b);
    const row = el("div", "bs-row");
    row.append(el("span", "bs-label", LABEL[g]), el("span", "", `${show(g, a)} -> `), el("span", cls, `${show(g, b)}  ${word}`));
    return row;
  })];
}

/** The REFINED box on an item card: what was done to this copy (merged to
 * what rank, respecced how often) and every stat, the plain item's number
 * against this copy's. Nothing for a plain copy. @param {any} item */
export function refineBox(item) {
  const plain = itemById(item?.id);
  if (!plain || !(item.refine_rank || item.refine_respecced || item.refine_affix)) return [];
  const box = el("div", "auc-refine");
  const what = [item.refine_rank ? `MERGED TO +${item.refine_rank} (+${2 * item.refine_rank}% on every bonus)` : "",
    item.refine_respecced ? `RESPECCED${item.refine_respecs ? ` ${item.refine_respecs}x` : ""} (bonuses rerolled, 80-120%)` : "",
    item.refine_affix ? `AFFIX: ${item.refine_affix}` : ""]
    .filter(Boolean);
  box.append(el("div", "auc-refine-h", `REFINED :: ${what.join(" · ")}`), ...refineDiff(plain.mods, item.mods));
  return [box];
}

const bindNote = () => el("div", "bs-bind", "This copy becomes bound to you: only the AUCTION HOUSE can take it. Extra copies can still be sold anywhere.");

/** @param {HTMLElement} b */
const actions = (b) => {
  const row = el("div", "bs-actions");
  row.append(b);
  return row;
};

function renderList() {
  if (!ui) return;
  const rows = order().map((s) => {
    const item = ownItemOf(itemById(s.item_id)); // "RUSTED SWORD [2]" once merged
    const b = /** @type {HTMLButtonElement} */ (el("button", "bs-pick"));
    b.type = "button";
    b.setAttribute("aria-pressed", String(s.item_id === selected));
    b.disabled = pending || animating;
    // Ticket #223: what you wear and which loadouts it's in, as in the other menus.
    const worn = Object.values(state.me?.worn ?? {}).includes(s.item_id);
    const tag = loadoutTag(s.item_id);
    b.append(el("span", `r-${item?.rarity ?? "common"}`, item?.name ?? s.item_id),
      el("span", "dim", ` x${fmt(s.owned)}`),
      ...(worn ? [el("span", "dim", "  WORN")] : []),
      ...(tag ? [el("span", "item-loadouts", `  ${tag}`)] : []),
      ...(s.merge.ok ? [el("span", "bs-ready", "  MERGE READY")] : []));
    b.addEventListener("click", () => {
      if (selected === s.item_id) return;
      selected = s.item_id;
      armed = "";
      last = null;
      render();
    });
    return b;
  });
  ui.list.replaceChildren(...rows);
}

/** The last result, old -> new per stat, until another item or action. */
function renderResult(reveal = false) {
  if (!ui) return;
  const r = last;
  if (!r || r.item_id !== selected) {
    ui.result.replaceChildren();
    ui.result.hidden = true;
    return;
  }
  ui.result.hidden = false;
  const s = current();
  const groups = s ? groupsOf(s) : [];
  const head = r.action === "merge" ? `REFINEMENT +${r.rank_before} -> +${r.rank}`
    : r.action === "affix" ? `AFFIX :: ${r.label} +${pct(r.value)}${r.replaced ? ` (replaced ${LABEL[r.replaced] ?? r.replaced})` : ""}`
    : r.action === "grind" ? (r.plain ? "RESPEC ROLL GROUND OFF :: PLAIN AGAIN" : `RESPEC ROLL GROUND OFF :: STILL +${r.rank}`)
      : `REFINEMENT +${r.rank} — UNCHANGED`;
  const shown = r.action === "affix" ? [...new Set([...groups, r.stat, ...(r.replaced ? [r.replaced] : [])])] : groups;
  const rows = shown.map((g) => {
    const a = valuesOf(r.before, g);
    const b = valuesOf(r.after, g);
    const [word, cls] = dir(a, b);
    const row = el("div", "bs-row");
    row.append(el("span", "bs-label", LABEL[g] ?? g), el("span", "", `${show(g, a)} -> `), el("span", cls, `${show(g, b)}  ${word}`));
    return row;
  });
  const foot = r.action === "merge"
    ? el("div", "dim", r.unchanged ? "Refinement increased. Some stats round to the same value." : `${r.consumed} duplicate${r.consumed === 1 ? "" : "s"} merged in.`)
    : r.action === "grind" ? el("div", "dim", r.plain ? "It's a plain copy again." : "The merge rank stayed; the roll is gone.")
      : el("div", "dim", `${fmt(r.cost)} SHARDS SPENT`);
  ui.result.replaceChildren(el("div", "bs-result-h", head), ...rows, foot);
  if (reveal && !stillMode()) { // the rows come in one at a time, then it settles
    rows.forEach((row, i) => {
      row.classList.add("bs-later");
      setTimeout(() => row.classList.remove("bs-later"), 110 * (i + 1));
    });
  }
}

/** Ticket #252: "LOCKED" with its own [ UNLOCK ] (the lock only guards against stray sells);
 * ticket #269: unlocked, a [ LOCK ] to put it back once you're done. @param {any} s */
function lockRow(s) {
  const row = el("div", s.locked ? "item-locked" : "dim bs-lock",
    s.locked ? "LOCKED :: unlock it to work on it " : "UNLOCKED :: lock it so it can't be sold by mistake ");
  const b = el("button", "inline-btn", s.locked ? "[ UNLOCK ]" : "[ LOCK ]");
  b.addEventListener("click", async () => {
    try {
      state.me = (await api.lockItem(s.item_id, !s.locked)).me;
      emit("me");
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
    }
    loadBlacksmith(true);
  });
  row.append(b);
  return row;
}

/**
 * Merge or respec the selected item: one request id for this click (kept for
 * retries), the server's answer, then the animation of what it did.
 * @param {"merge" | "respec" | "grind" | "affix"} action @param {any} s */
async function run(action, s) {
  if (pending || animating || !ui) return;
  pending = true;
  last = null;
  ui.scene.line("Checking the forge...");
  render();
  const body = { item_id: s.item_id, expected_revision: s.revision, request_id: api.craftRequestId(),
    ...(action === "merge" ? { expected_rank: s.rank } : action === "respec" ? { expected_cost: s.respec.cost }
      : action === "affix" ? { expected_cost: s.affix.cost } : {}) };
  /** @type {any} */
  let res;
  try {
    res = await api.craft(action, body);
  } catch (e) {
    pending = false;
    showError(/** @type {Error} */ (e).message);
    ui.scene.line("Hm. The forge says no. Here's how things stand.");
    loadBlacksmith(true);
    return;
  }
  pending = false;
  state.me = res.me;
  emit("me");
  items = items.map((x) => (x.item_id === res.item_id ? res.state : x));
  const item = itemById(res.item_id);
  const mine = selected === res.item_id; // the player may have picked another item meanwhile
  const done = () => {
    animating = false;
    if (ui) ui.skip.hidden = true;
    last = res;
    if (action === "respec" || action === "affix") ui?.scene.line("Fresh from the forge.");
    if (ui) ui.live.textContent = action === "merge" ? `${item?.name ?? "Item"} is now +${res.rank}.`
      : action === "grind" ? `${item?.name ?? "Item"}'s respec roll is ground off.`
        : action === "affix" ? `${item?.name ?? "Item"} got the affix ${res.label}.`
          : `${item?.name ?? "Item"} respecced for ${res.cost} shards.`;
    render();
    renderResult(true);
    ui?.work.classList.add("bs-done");
    setTimeout(() => ui?.work.classList.remove("bs-done"), 600);
    ui?.result.focus({ preventScroll: true });
  };
  if (!mine || !item || !visible()) {
    last = res;
    render();
    return;
  }
  animating = true;
  ui.skip.hidden = stillMode();
  render();
  const glyph = glyphOf(item.slot);
  if (action === "merge") {
    ui.scene.merge({ glyph, rarity: item.rarity, consumed: res.consumed, from: res.rank_before, to: res.rank },
      res.unchanged ? "Fewer pieces. Same numbers, for now." : "Fewer pieces. More punch.", done);
  } else if (action === "respec" || action === "affix") {
    ui.scene.respec({ glyph, rarity: item.rarity, weapon: item.slot === "weapon" }, done);
  } else {
    ui.scene.grind({ glyph, rarity: item.rarity, label: res.plain ? "PLAIN" : `+${res.rank}` }, done);
  }
}

/** Leaving the tab: stop the timers; what was done stays done. */
export function leaveBlacksmith() {
  ui?.scene.stop();
}
