// [ BAG ] panel: the collection log. Every item is listed; ones you have
// not found show as a dotted silhouette.

import * as api from "../api.js?v=0267a0c4ee";
import { el, fmt, setArt } from "../ascii.js?v=0267a0c4ee";
import { bossDef, emit, rarityById, state } from "../store.js?v=0267a0c4ee";
import { showError } from "./errors.js?v=0267a0c4ee";
import { itemLines, showOverlay } from "./fx.js?v=0267a0c4ee";
import { bonusLine } from "./player.js?v=0267a0c4ee";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// -------------------------------------------------------------------- bag

export function renderBag() {
  const host = $("panel-bag");
  const content = state.content;
  const me = state.me;
  if (!content || !me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  /** @type {Map<string, any>} */
  const owned = new Map(me.inventory.map((/** @type {any} */ i) => [i.item_id, i]));
  const items = [...content.items].sort(
    (a, b) => (rarityById(a.rarity)?.rank ?? 0) - (rarityById(b.rarity)?.rank ?? 0) || a.name.localeCompare(b.name),
  );
  const legend = el(
    "div",
    "bag-legend",
    `COLLECTION ${owned.size} / ${items.length}  ::  ${fmt(me.items_found)} DROPS TOTAL  ::  TAP AN ITEM`,
  );
  const grid = el("div", "bag-grid");
  for (const item of items) {
    const inv = owned.get(item.id);
    const card = /** @type {HTMLButtonElement} */ (el("button", "card" + (inv ? ` r-${item.rarity}` : " unknown")));
    card.type = "button";
    if (inv && me.equipped === item.id) card.classList.add("equipped");
    const pre = el("pre", "art");
    card.append(pre);
    card.setAttribute("aria-label", inv ? `${item.name}, ${item.rarity}` : "Undiscovered item");
    if (inv) card.addEventListener("click", () => itemDetail(item));
    else card.tabIndex = -1;
    grid.append(card);
    requestAnimationFrame(() =>
      setArt(pre, itemLines(item, { unknown: !inv, count: inv?.count, equipped: me.equipped === item.id }), 11),
    );
  }
  host.replaceChildren(legend, grid);
}

/** @param {any} item */
function itemDetail(item) {
  const me = state.me;
  const inv = me.inventory.find((/** @type {any} */ i) => i.item_id === item.id);
  const isEquipped = me.equipped === item.id;
  showOverlay((inner, close) => {
    const wrap = el("div", "item-detail");
    const pre = el("pre", `art r-${item.rarity}`);
    wrap.append(pre);
    wrap.append(el("div", "flavor", `"${item.flavor}"`));
    const chance = item.drop_chance > 0 ? `~1 in ${fmt(1 / item.drop_chance)} attacks` : "does not drop here";
    const stats = el("div", "stats");
    stats.append(bonusLine(item));
    stats.append(el("div", "dim", `DROP RATE ${chance}${item.boss_only ? "  ::  " + item.boss_only.map((/** @type {string} */ b) => bossDef(b)?.name ?? b).join(", ") + " ONLY" : ""}`));
    if (inv) stats.append(el("div", "dim", `OWNED x${inv.count}  ::  FIRST FOUND ${new Date(inv.first_found_at * 1000).toLocaleDateString()}`));
    wrap.append(stats);
    const actions = el("div", "actions");
    const eq = el("button", "", isEquipped ? "[ UNEQUIP ]" : "[ EQUIP ]");
    eq.addEventListener("click", async () => {
      try {
        state.me = await api.equip(isEquipped ? null : item.id);
        emit("me");
        close();
      } catch (e) {
        showError(/** @type {Error} */ (e).message);
      }
    });
    const cl = el("button", "", "[ CLOSE ]");
    cl.addEventListener("click", close);
    actions.append(eq, cl);
    wrap.append(actions);
    inner.append(wrap);
    setArt(pre, itemLines(item, { count: inv?.count, equipped: isEquipped, width: 26 }), 16);
  });
}
