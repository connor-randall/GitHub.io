// [ BAG ] panel: loot boxes, what you have equipped, and the collection log.
// Undiscovered items show as dotted silhouettes (hidden by default: there
// are over a hundred).

import * as api from "../api.js?v=bfef2eb086";
import { el, fmt, setArt } from "../ascii.js?v=bfef2eb086";
import { boxById, bossDef, emit, itemById, rarityById, state } from "../store.js?v=bfef2eb086";
import { EFFECT_HELP, effectLine, effectParts } from "./effects.js?v=bfef2eb086";
import { showError } from "./errors.js?v=bfef2eb086";
import { itemLines, openBoxSequence, showOverlay } from "./fx.js?v=bfef2eb086";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {"all" | "weapon" | "charm"} */
let slotFilter = "all";
let showUnknown = false;

/** @param {string} label @param {boolean} on @param {() => void} fn */
function chip(label, on, fn) {
  const b = el("button", "chip", label);
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", fn);
  return b;
}

export function renderBag() {
  const host = $("panel-bag");
  const content = state.content;
  const me = state.me;
  if (!content || !me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  const parts = [];

  // ---- loot boxes
  const boxes = me.boxes ?? [];
  const boxHead = el("div", "panel-h", "LOOT BOXES");
  parts.push(boxHead);
  if (!boxes.length) {
    parts.push(el("div", "dim bag-note", "> none yet. every attack has a small chance to drop one."));
  } else {
    const row = el("div", "box-row");
    for (const b of boxes) {
      const def = boxById(b.box_id);
      if (!def) continue;
      const card = el("div", "box-card");
      const pre = el("pre", "art");
      const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", `[ OPEN ] x${b.count}`));
      open.addEventListener("click", () => openBox(def));
      card.append(pre, el("div", "box-name", def.name), open);
      row.append(card);
      requestAnimationFrame(() => setArt(pre, def.art, 11));
    }
    parts.push(row);
  }
  if (me.next_crits > 0) parts.push(el("div", "bag-note crit-charge", `> NEXT ${me.next_crits} ATTACK(S) WILL CRIT`));

  // ---- equipped
  parts.push(el("div", "panel-h", "EQUIPPED"));
  const eq = el("div", "eq-row");
  for (const [slot, id] of /** @type {const} */ ([["WEAPON", me.equipped], ["CHARM", me.equipped_charm]])) {
    const item = id ? itemById(id) : null;
    const b = el("button", "eq-slot" + (item ? ` r-${item.rarity}` : " dim"), `${slot}: ${item ? item.name : "(empty)"}`);
    if (item) b.addEventListener("click", () => itemDetail(item));
    eq.append(b);
  }
  parts.push(eq);
  const total = effectParts(me.mods);
  parts.push(el("div", "stats bag-note", total.length ? `TOTAL: ${total.join("  ::  ")}` : "TOTAL: no bonuses yet"));

  // ---- collection
  /** @type {Map<string, any>} */
  const owned = new Map(me.inventory.map((/** @type {any} */ i) => [i.item_id, i]));
  const all = [...content.items].sort(
    (a, b) => (rarityById(b.rarity)?.rank ?? 0) - (rarityById(a.rarity)?.rank ?? 0) || a.name.localeCompare(b.name),
  );
  const shown = all.filter(
    (i) => (slotFilter === "all" || i.slot === slotFilter) && (showUnknown || owned.has(i.id)),
  );
  parts.push(el("div", "panel-h", `COLLECTION ${owned.size} / ${all.length}`));
  const chips = el("div", "chips");
  chips.append(
    chip("[ ALL ]", slotFilter === "all", () => ((slotFilter = "all"), renderBag())),
    chip("[ WEAPONS ]", slotFilter === "weapon", () => ((slotFilter = "weapon"), renderBag())),
    chip("[ CHARMS ]", slotFilter === "charm", () => ((slotFilter = "charm"), renderBag())),
    chip(showUnknown ? "[ HIDE UNFOUND ]" : "[ SHOW UNFOUND ]", showUnknown, () => ((showUnknown = !showUnknown), renderBag())),
  );
  parts.push(chips);
  if (!shown.length) {
    parts.push(el("div", "dim bag-note", "> nothing here yet. attack to find loot."));
  }
  const grid = el("div", "bag-grid");
  for (const item of shown) {
    const inv = owned.get(item.id);
    const card = /** @type {HTMLButtonElement} */ (el("button", "card" + (inv ? ` r-${item.rarity}` : " unknown")));
    card.type = "button";
    const isEq = me.equipped === item.id || me.equipped_charm === item.id;
    if (inv && isEq) card.classList.add("equipped");
    const pre = el("pre", "art");
    card.append(pre);
    card.setAttribute("aria-label", inv ? `${item.name}, ${item.rarity}` : "Undiscovered item");
    if (inv) card.addEventListener("click", () => itemDetail(item));
    else card.tabIndex = -1;
    grid.append(card);
    requestAnimationFrame(() => setArt(pre, itemLines(item, { unknown: !inv, count: inv?.count, equipped: isEq }), 11));
  }
  parts.push(grid);
  host.replaceChildren(...parts);
}

/** Open a box and play its animation (also used when one drops). @param {any} box */
export async function openBox(box) {
  try {
    const res = await api.openBox(box.id);
    state.me = res.me;
    emit("me");
    await openBoxSequence(box, res.result, async (id) => {
      state.me = await api.equip(id);
      emit("me");
    });
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** @param {any} item */
export function itemDetail(item) {
  const me = state.me;
  const inv = me.inventory.find((/** @type {any} */ i) => i.item_id === item.id);
  const isEquipped = me.equipped === item.id || me.equipped_charm === item.id;
  showOverlay((inner, close) => {
    const wrap = el("div", "item-detail");
    const pre = el("pre", `art r-${item.rarity}`);
    wrap.append(pre);
    wrap.append(el("div", "flavor", `"${item.flavor}"`));
    const stats = el("div", "stats");
    stats.append(effectLine(item));
    const help = Object.entries(EFFECT_HELP)
      .filter(([k]) => effectParts(item.mods).some((p) => p.includes(k)))
      .map(([k, v]) => `${k}: ${v}`);
    for (const h of help) stats.append(el("div", "dim", h));
    const chance = item.drop_chance > 0 ? `~1 in ${fmt(1 / item.drop_chance)} attacks` : "does not drop here";
    const only = item.boss_only
      ? "  ::  " + item.boss_only.map((/** @type {string} */ b) => bossDef(b)?.name ?? b).join(", ") + " ONLY"
      : "";
    stats.append(el("div", "dim", `${item.slot.toUpperCase()}  ::  DROP RATE ${chance}${only}`));
    if (inv) stats.append(el("div", "dim", `OWNED x${inv.count}  ::  FIRST FOUND ${new Date(inv.first_found_at * 1000).toLocaleDateString()}`));
    wrap.append(stats);
    const actions = el("div", "actions");
    if (inv) {
      const eq = el("button", "", isEquipped ? "[ UNEQUIP ]" : `[ EQUIP ${item.slot.toUpperCase()} ]`);
      eq.addEventListener("click", async () => {
        try {
          state.me = await api.equip(isEquipped ? null : item.id, item.slot);
          emit("me");
          close();
        } catch (e) {
          showError(/** @type {Error} */ (e).message);
        }
      });
      actions.append(eq);
    }
    const cl = el("button", "", "[ CLOSE ]");
    cl.addEventListener("click", close);
    actions.append(cl);
    wrap.append(actions);
    inner.append(wrap);
    setArt(pre, itemLines(item, { count: inv?.count, equipped: isEquipped, width: 26 }), 16);
  });
}
