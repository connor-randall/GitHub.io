// The LIBRARY (library.html): a read-only catalogue of every item and chest for
// the wiki. Built only from /api/content, the same data every game page
// loads, so it shows nothing a player couldn't already fetch. No login.

import { getContent } from "./api.js?v=b6664395f3";
import { el, fmt, setArts } from "./ascii.js?v=b6664395f3";
import { forwardToCanonical } from "./home.js?v=b6664395f3";
import { state } from "./store.js?v=b6664395f3";
import { EFFECT_HELP, EQUIP_SLOTS, effectParts, themeLine, tradeName } from "./ui/effects.js?v=b6664395f3";
import { itemLines } from "./ui/fx.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const SLOT_LABEL = Object.fromEntries(EQUIP_SLOTS);
const BOX_REWARD = /** @type {Record<string, (r: any) => string>} */ ({
  attacks: (r) => `+${r.amount} attack${r.amount === 1 ? "" : "s"}`,
  next_crit: (r) => `next ${r.amount} hit${r.amount === 1 ? "" : "s"} crit`,
  scroll: () => "a random scroll",
  ultimate: () => "ultimate recharged",
});

/** @type {any} */
let content = null;

/** "1 in 158,000". @param {number} p */
const oneIn = (p) => `1 in ${fmt(1 / p)}`;
const rarityRank = (/** @type {string} */ id) => content.rarities.find((/** @type {any} */ r) => r.id === id)?.rank ?? 0;
const rarityLabel = (/** @type {string} */ id) => content.rarities.find((/** @type {any} */ r) => r.id === id)?.label ?? id;
const bossName = (/** @type {string} */ id) => content.bosses.find((/** @type {any} */ b) => b.id === id)?.name ?? id;

/** This item's share of its rarity (items can weigh less than 1, e.g. 0.5). The
 * public data has no weights, but its per-attack chance is the rarity's chance
 * x that share; for chest-only rarities (no attack chance) every item weighs 1.
 * @param {any} item */
function shareOfRarity(item) {
  const r = content.rarities.find((/** @type {any} */ x) => x.id === item.rarity);
  if (r?.drop_chance > 0 && item.drop_chance > 0) return item.drop_chance / r.drop_chance;
  const pool = content.items.filter((/** @type {any} */ i) => i.rarity === item.rarity && !i.city_only && !i.boss_only);
  return 1 / (pool.length || 1);
}

/** Per chest opened: the chance of this exact item, for every chest that can give it. @param {any} item */
function chestChances(item) {
  if (item.city_only || item.boss_only) return [];
  const share = shareOfRarity(item);
  const out = [];
  for (const b of content.boxes) {
    const row = (b.odds ?? []).find((/** @type {any} */ o) => o.kind === "item" && o.rarity === item.rarity);
    if (row) out.push({ box: b.name, chance: row.chance * share });
  }
  return out;
}

/** Where an item comes from, in words. @param {any} item */
function sources(item) {
  if (item.city_only) return [`CITY reward (${item.city_only.toUpperCase()})`];
  const out = [];
  if (item.drop_chance > 0) {
    out.push(item.boss_only
      ? `drops only from ${item.boss_only.map(bossName).join(", ")}: ${oneIn(item.drop_chance)} attacks`
      : `drops from attacks: ${oneIn(item.drop_chance)} attacks`);
  }
  for (const c of chestChances(item)) out.push(`${c.box}: ${oneIn(c.chance)} opened`);
  if (!out.length) out.push("not found in attacks or chests right now");
  return out;
}

/** @param {any} item */
const sourceKind = (item) => (item.city_only ? "city" : item.boss_only ? "boss" : item.drop_chance > 0 ? "drops" : "chest");

/** The effects with what each one means. @param {any} item */
function statsText(item) {
  const parts = effectParts(item.mods);
  if (!parts.length) return "NO BONUS. JUST VIBES.";
  return parts.join("  ::  ");
}

/** @param {any} item */
function helpText(item) {
  const help = effectParts(item.mods)
    .map((p) => Object.entries(EFFECT_HELP).find(([k]) => p.endsWith(k))?.[1])
    .filter(Boolean);
  return [...new Set(help)].join("; ");
}

// ------------------------------------------------------------------ items

function fillFilters() {
  const add = (/** @type {string} */ id, /** @type {[string, string][]} */ opts) =>
    $(id).append(...opts.map(([v, label]) => Object.assign(el("option", "", label), { value: v })));
  add("library-slot", EQUIP_SLOTS.filter(([s]) => content.items.some((/** @type {any} */ i) => i.slot === s))
    .map(([s, label]) => [s, label]));
  add("library-rarity", content.rarities.map((/** @type {any} */ r) => [r.id, r.label]));
  const themes = [...new Set(content.items.map((/** @type {any} */ i) => i.theme).filter(Boolean))].sort();
  add("library-theme", themes.map((t) => [String(t), String(t)]));
}

function matches(/** @type {any} */ item) {
  const v = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ ($(id)).value;
  if (v("library-slot") && item.slot !== v("library-slot")) return false;
  if (v("library-rarity") && item.rarity !== v("library-rarity")) return false;
  if (v("library-theme") && item.theme !== v("library-theme")) return false;
  if (v("library-source") && sourceKind(item) !== v("library-source")) return false;
  const q = v("library-search").trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.flavor, item.theme, item.slot, rarityLabel(item.rarity), statsText(item), tradeName(item)]
    .join(" ").toLowerCase().includes(q);
}

function drawItems() {
  const shown = content.items
    .filter(matches)
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      rarityRank(b.rarity) - rarityRank(a.rarity) || a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));
  $("library-shown").textContent = `${fmt(shown.length)} of ${fmt(content.items.length)} items`;
  /** @type {[HTMLElement, string[]][]} */
  const arts = [];
  const cards = shown.map((/** @type {any} */ item) => {
    const card = el("article", "library-card");
    const art = el("pre", `art r-${item.rarity}`);
    arts.push([art, itemLines(item, { width: 26 })]);
    card.append(art, el("div", "library-stats", statsText(item)));
    const help = helpText(item);
    if (help) card.append(el("div", "library-meta", `(${help})`));
    if (item.flavor) card.append(el("div", "library-flavor", `"${item.flavor}"`));
    const meta = el("div", "library-meta");
    meta.append(el("div", "", `${rarityLabel(item.rarity)} ${SLOT_LABEL[item.slot] ?? item.slot.toUpperCase()}` +
      (item.theme ? `  ::  ${themeLine(item)}` : "")));
    for (const s of sources(item)) meta.append(el("div", "", `> ${s}`));
    card.append(meta, el("div", "library-id", item.id));
    return card;
  });
  $("library-grid").replaceChildren(...cards);
  requestAnimationFrame(() => setArts(arts, 12));
}

// ------------------------------------------------------------------ chests

function drawBoxes() {
  /** @type {[HTMLElement, string[]][]} */
  const arts = [];
  const cards = content.boxes.map((/** @type {any} */ b) => {
    const card = el("article", "library-card");
    const art = el("pre", "art");
    arts.push([art, b.art]);
    const table = el("table", "library-odds");
    for (const o of b.odds ?? []) {
      const what = o.kind === "item" ? `${rarityLabel(o.rarity)} item` : (BOX_REWARD[o.kind]?.(o) ?? o.kind);
      const tr = el("tr");
      tr.append(el("td", o.kind === "item" ? `r-${o.rarity}` : "", what),
        el("td", "", `${(o.chance * 100).toFixed(o.chance >= 0.01 ? 1 : 5).replace(/\.?0+$/, "")}%`));
      table.append(tr);
    }
    const price = content.shop?.boxes?.[b.id];
    card.append(el("b", "", b.name), art, ...(b.flavor ? [el("div", "library-flavor", `"${b.flavor}"`)] : []),
      el("div", "library-meta", `${b.chance > 0 ? `drops from attacks: ${oneIn(b.chance)} attacks` : "never drops from attacks"}` +
        (price ? `  ::  shop ${fmt(price)} shards` : "")),
      table, el("div", "library-id", b.id));
    return card;
  });
  $("library-box-list").replaceChildren(...cards);
  requestAnimationFrame(() => setArts(arts, 12));
}

// ------------------------------------------------------------------ events

/** How often an event comes up when the director picks one. @param {any} e */
function eventOdds(e) {
  if (e.id === "second_wind") return "random: on a boss's killing blow";
  if (!e.share) return "only when the admin starts it";
  return `about 1 in ${Math.max(1, Math.round(1 / e.share))} events (${(e.share * 100).toFixed(1)}%)`;
}

function drawEvents() {
  const cards = (content.events ?? []).map((/** @type {any} */ e) => {
    const card = el("article", "library-card library-event");
    const head = el("div", "library-event-head");
    head.append(el("b", "", e.name), el("span", "dim", e.length));
    card.append(head, el("div", "library-stats", e.what), el("div", "library-flavor", `> ${e.reward}`),
      el("div", "library-meta", eventOdds(e)), el("div", "library-id", e.id));
    return card;
  });
  if (!cards.length) cards.push(el("p", "dim", "no events listed yet."));
  $("library-event-list").replaceChildren(...cards);
}

// ------------------------------------------------------------------ export

function download() {
  const data = {
    exported_at: new Date().toISOString(),
    content_version: content.version,
    rarities: content.rarities.map((/** @type {any} */ r) => ({ id: r.id, label: r.label, rank: r.rank,
      drop_chance_per_attack: r.drop_chance })),
    items: content.items.map((/** @type {any} */ i) => ({
      id: i.id, name: i.name, rarity: i.rarity, slot: i.slot, theme: i.theme || null, trade_off: tradeName(i) || null,
      flavor: i.flavor, art: i.art, effects: effectParts(i.mods), mods: i.mods,
      boss_only: i.boss_only ? i.boss_only.map((/** @type {string} */ b) => ({ id: b, name: bossName(b) })) : null,
      city_only: i.city_only ?? null, drop_chance_per_attack: i.drop_chance,
      chest_chances: chestChances(i).map((c) => ({ box: c.box, chance_per_open: c.chance })),
    })),
    chests: content.boxes.map((/** @type {any} */ b) => ({ id: b.id, name: b.name, flavor: b.flavor, art: b.art,
      drop_chance_per_attack: b.chance, shop_price: content.shop?.boxes?.[b.id] ?? null, contents: b.odds })),
    events: (content.events ?? []).map((/** @type {any} */ e) => ({ id: e.id, name: e.name, length: e.length,
      what_it_does: e.what, reward: e.reward, how_often: eventOdds(e) })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "onemillionhp-library.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ boot

function show(/** @type {string} */ view) {
  document.querySelectorAll(".library-tab[data-view]").forEach((b) =>
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.view === view)));
  $("library-items").hidden = view !== "items";
  $("library-boxes").hidden = view !== "boxes";
  $("library-events").hidden = view !== "events";
  if (view === "boxes") drawBoxes();
  if (view === "events") drawEvents();
}

async function boot() {
  content = state.content = await getContent();
  $("library-count").textContent =
    `${fmt(content.items.length)} items  ::  ${content.boxes.length} chests  ::  ${(content.events ?? []).length} events`;
  fillFilters();
  let timer = 0;
  const redraw = () => {
    clearTimeout(timer);
    timer = window.setTimeout(drawItems, 120);
  };
  for (const id of ["library-search", "library-slot", "library-rarity", "library-theme", "library-source"]) {
    $(id).addEventListener("input", redraw);
  }
  document.querySelectorAll(".library-tab[data-view]").forEach((b) =>
    b.addEventListener("click", () => show(/** @type {HTMLElement} */ (b).dataset.view ?? "items")));
  $("library-download").addEventListener("click", download);
  drawItems();
}

if (!forwardToCanonical("library")) {
  boot().catch(() => {
    $("library-count").textContent = "could not load the item list. refresh to try again.";
  });
}
