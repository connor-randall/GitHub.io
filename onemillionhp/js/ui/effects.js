// Human-readable item effects, shared by the bag, player panel and admin.

import { el, fmt } from "../ascii.js?v=b6664395f3";

/** @param {number} x */
const pct = (x) => `${(x * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** Each effect a mods object has: its key, value (higher is always better) and phrase.
 * @param {any} m @returns {{key: string, value: number, text: string}[]} */
export function effectEntries(m) {
  if (!m) return [];
  /** @type {{key: string, value: number, text: string}[]} */
  const out = [];
  const add = (/** @type {string} */ key, /** @type {number} */ value, /** @type {string} */ text) => out.push({ key, value, text });
  if (m.min_dmg) add("min_dmg", m.min_dmg, `+${m.min_dmg} MIN DMG`);
  if (m.max_dmg) add("max_dmg", m.max_dmg, `+${m.max_dmg} MAX DMG`);
  if (m.crit_chance) add("crit_chance", m.crit_chance, `+${pct(m.crit_chance)} CRIT`);
  if (m.crit_dmg) add("crit_dmg", m.crit_dmg, `+${pct(m.crit_dmg)} CRIT DMG`);
  if (m.double_strike) add("double_strike", m.double_strike, `${pct(m.double_strike)} DOUBLE STRIKE`);
  if (m.executioner) add("executioner", m.executioner, `+${pct(m.executioner)} DMG IN FINAL PHASE`);
  if (m.opener) add("opener", m.opener, `+${pct(m.opener)} DMG ABOVE HALF HP`);
  if (m.surge) add("surge", m.surge, `+${pct(m.surge)} DMG DURING EVENTS`);
  if (m.dmg_pct > 0) add("dmg_pct", m.dmg_pct, `+${pct(m.dmg_pct)} DAMAGE`);
  if (m.dmg_pct < 0) add("dmg_pct", m.dmg_pct, `-${pct(-m.dmg_pct)} DAMAGE`);
  if (m.save_attack) add("save_attack", m.save_attack, `${pct(m.save_attack)} FREE ATTACK`);
  if (m.ult_refund) add("ult_refund", m.ult_refund, `${pct(m.ult_refund)} ULT RECHARGE`);
  if (m.box_find) add("box_find", m.box_find, `+${pct(m.box_find)} BOX FIND`);
  if (m.loot_mult && m.loot_mult > 1) add("loot_mult", m.loot_mult - 1, `+${pct(m.loot_mult - 1)} LOOT`);
  if (m.loot_mult && m.loot_mult < 1) add("loot_mult", m.loot_mult - 1, `-${pct(1 - m.loot_mult)} LOOT`);
  return out;
}

/** Short effect phrases for a mods object. @param {any} m @returns {string[]} */
export function effectParts(m) {
  return effectEntries(m).map((e) => e.text);
}

/** The stats gear totals are capped on (content.cap_gear): damage, free
 * attacks, and loot only from below (the glass-cannon floor). */
const CAPPED = new Set(["loot_mult", "dmg_pct", "save_attack"]);

/** "TOTAL: ..." for what you wear: each capped stat that your gear goes past
 * its limit shows the real total in brackets, e.g. "+50% DAMAGE (+75%)",
 * so you can see how much is going to waste. @param {any} mods @param {any} [raw] */
export function totalLine(mods, raw) {
  const capped = effectEntries(mods);
  if (!capped.length) return [];
  const real = new Map(effectEntries(raw).map((e) => [e.key, e]));
  return joined(capped.map((e) => {
    const r = real.get(e.key);
    if (!raw || !CAPPED.has(e.key) || !r || Math.abs(r.value - e.value) < 1e-9) return el("span", "", e.text);
    const span = el("span", "", e.text);
    const over = el("span", "fx-over", ` (${r.text.split(" ")[0]})`);
    over.title = `your gear adds up to ${r.text}, but only ${e.text} counts (the cap): the rest is wasted`;
    span.append(over);
    return span;
  }));
}

/** What you're wearing in this item's slot (null: nothing, or this very item).
 * @param {any} item @param {any} me */
export function wornInSlot(item, me) {
  const id = me?.worn?.[item?.slot];
  return id && id !== item.id ? id : null;
}

/** This item's effects against the worn one's: green = better, red = worse,
 * each with the difference in brackets ("+10% LOOT (-5%)", ticket #112), grey = the same (as shown, so 1.234% vs 1.231% is the same). Worn effects this
 * item doesn't have come last, as this item's value (0) with what you wear now
 * (ticket #133: "0% CRIT (worn: +2%)", not "-2% CRIT", which read like a penalty
 * on this item): red if you'd lose a bonus, green if you'd shed a penalty.
 * @param {any} item @param {any} worn (the worn item, or null)
 * @returns {Node[]} */
export function compareSpans(item, worn) {
  const mine = effectEntries(item.mods);
  if (!worn) return mine.length ? joined(mine.map((e) => el("span", "", e.text))) : [];
  const theirs = new Map(effectEntries(worn.mods).map((e) => [e.key, e]));
  const nodes = mine.map((e) => {
    const worn = theirs.get(e.key);
    const other = worn?.value ?? 0;
    const same = worn?.text === e.text || Math.abs(e.value - other) < 1e-9;
    const cls = same ? "fx-same" : e.value > other ? "fx-better" : "fx-worse";
    const span = el("span", cls, e.text);
    span.title = same ? "same as what you're wearing"
      : cls === "fx-better" ? "better than what you're wearing" : "worse than what you're wearing";
    if (!same) span.append(el("span", "fx-diff", ` (${diffText(e.key, e.value - other)})`)); // ticket #112
    return span;
  });
  const have = new Set(mine.map((e) => e.key));
  for (const e of theirs.values()) {
    if (have.has(e.key) || !e.value) continue;
    const zero = e.text.replace(/^[+-]?[\d.,]+/, "0");
    const lost = el("span", `${e.value > 0 ? "fx-worse" : "fx-better"} fx-lost`, `${zero} (worn: ${e.text})`);
    lost.title = e.value > 0 ? "what you're wearing has this; this item doesn't (you'd lose it)"
      : "what you're wearing has this penalty; this item doesn't";
    nodes.push(lost);
  }
  return joined(nodes);
}

/** How far apart two values of one stat are: "+5", "-10%". @param {string} key @param {number} d */
function diffText(key, d) {
  const sign = d > 0 ? "+" : "-";
  return key === "min_dmg" || key === "max_dmg" ? `${sign}${fmt(Math.abs(d))}` : `${sign}${pct(Math.abs(d))}`;
}

/** "YOUR HITS: 4-14 :: CRIT 70-280 :: ULT: STRIKE IT RICH" with your gear
 * (ticket #64), so you can tell a high roll from a low one. Ults don't hit
 * (tickets #311 #312): just which one your charm gives. null before the
 * server sends it. @param {any} r @param {string} [cls] extra class @param {any} [ult] the worn charm's */
export function damageRanges(r, cls = "", ult = null) {
  if (!r?.hit) return null;
  const span = (/** @type {number[]} */ [a, b]) => (a === b ? fmt(a) : `${fmt(a)}-${fmt(b)}`);
  const line = el("div", `stats bag-note dmg-ranges ${cls}`.trim(), "YOUR HITS: ");
  line.append(...joined([
    el("span", "", `HIT ${span(r.hit)}`),
    el("span", "", `CRIT ${span(r.crit)}`),
    el("span", "", ult ? `ULT: ${ult.name}` : "NO ULT (WEAR A CHARM)"),
    ...(r.double ? [el("span", "dim", `DOUBLE STRIKE +${span(r.double)}`)] : []),
  ]));
  line.title = "with what you wear now; final phase, opener, event and x2 boosts come on top";
  return line;
}

/** Nodes with " :: " between them. @param {Node[]} nodes */
function joined(nodes) {
  return nodes.flatMap((n, i) => (i ? [document.createTextNode("  ::  "), n] : [n]));
}

/** "GLASS CANNON" (+damage, less loot) / "MISER" (+loot, less damage) / "". @param {any} item */
export function tradeName(item) {
  const d = item?.mods?.dmg_pct ?? 0;
  return d > 0 ? "GLASS CANNON" : d < 0 ? "MISER" : "";
}

/** "SCAVENGER", "POWER :: GLASS CANNON"... (short: "POWER :: GLASS", for cards). @param {any} item */
export function themeLine(item, short = false) {
  const trade = tradeName(item);
  return [item?.theme, short ? trade.split(" ")[0] : trade].filter(Boolean).join(" :: ");
}

/** What each effect means, for the item detail view. */
export const EFFECT_HELP = {
  // Ticket #126: every stat has a line (matched on how the stat's text ends).
  "MIN DMG": "raises the lowest your normal hit can roll",
  "MAX DMG": "raises the highest your normal hit can roll",
  "CRIT": "chance a hit is a critical hit (crits do much more damage)",
  "LOOT": "chance each attack finds an item: +10% LOOT makes every rarity 10% likelier to drop. It doesn't make rarer items likelier than common ones, and it doesn't touch chests (that's BOX FIND)",
  "FREE ATTACK": "chance an attack doesn't use up one of today's attacks",
  "ULT RECHARGE": "chance a normal attack recharges your spent ultimate",
  "DOUBLE STRIKE": "chance to hit twice in one attack",
  "CRIT DMG": "crits hit harder",
  "BOX FIND": "chance each attack finds a chest. counts in full up to +300%, then only the square root of the extra",
  "FINAL PHASE": "extra damage in the boss's final phase (usually below 10%)",
  "ABOVE HALF HP": "extra damage while the boss still has more than half its HP (opener)",
  "DURING EVENTS": "extra damage while a world event is running (surge)",
  "DAMAGE": "changes every hit. GLASS CANNON gear: +damage, less loot. MISER gear: -damage, more loot. APEX set: +damage",
};

/** One-line summary element. With ``worn`` (what you wear in its slot), each
 * effect is green if this item is better at it, red if worse.
 * @param {any} item @param {any} [worn] */
export function effectLine(item, worn = null) {
  const line = el("div", "stats");
  const nodes = compareSpans(item, worn);
  if (nodes.length) line.append(...nodes);
  else line.textContent = "NO BONUS. JUST VIBES.";
  if (item.ult) { // CHARM ULTS: a charm is also your ultimate
    const u = el("div", "ult-line");
    u.append(el("b", "", `ULT: ${item.ult.name}`), document.createTextNode(` :: ${item.ult.text}`));
    line.append(u);
  }
  if (worn) line.append(el("div", "dim fx-vs", `vs your ${item.slot}: ${worn.name}`));
  return line;
}

// ---------------------------------------------------------------- filters

/** Every equipment slot, in worn-equipment order (only some have items yet). */
export const EQUIP_SLOTS = /** @type {const} */ ([
  ["charm", "CHARM"], ["helmet", "HELMET"], ["necklace", "NECKLACE"], ["chestplate", "CHESTPLATE"],
  ["gauntlets", "GAUNTLETS"], ["weapon", "WEAPON"], ["greaves", "GREAVES"], ["boots", "BOOTS"],
]);

/** Effects you can filter equipment by: mods key -> label. */
export const EFFECT_FILTERS = /** @type {const} */ ([
  ["min_dmg", "MIN DMG"], ["max_dmg", "MAX DMG"], ["crit_chance", "CRIT CHANCE"], ["crit_dmg", "CRIT DMG"],
  ["double_strike", "DOUBLE STRIKE"], ["executioner", "FINAL PHASE DMG"], ["save_attack", "FREE ATTACK"],
  ["ult_refund", "ULT RECHARGE"], ["box_find", "BOX FIND"], ["loot_mult", "LOOT"],
  ["opener", "OPENER"], ["surge", "SURGE"], ["dmg_pct", "TRADE-OFF"],
]);

/** Does this item have the effect at all? @param {any} item @param {string} key */
export function hasEffect(item, key) {
  const v = item.mods?.[key] ?? 0;
  return key === "loot_mult" ? v > 1 : key === "dmg_pct" ? v !== 0 : v > 0;
}

/** Equipment filter shared by the YOU tab and the admin gallery; blank = any.
 * @param {any} item @param {{slot?: string, rarity?: string, effect?: string, q?: string}} f */
export function matchesFilter(item, f) {
  const q = (f.q ?? "").trim().toUpperCase();
  return (!f.slot || item.slot === f.slot) && (!f.rarity || item.rarity === f.rarity)
    && (!f.effect || hasEffect(item, f.effect))
    && (!q || item.name.includes(q) || effectParts(item.mods).join(" ").includes(q));
}
