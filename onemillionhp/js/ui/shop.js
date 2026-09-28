// [ SHOP ] panel: sell loot for shards, spend shards on loot boxes.

import * as api from "../api.js?v=d1f30b6b1d";
import { el, fmt, setArt } from "../ascii.js?v=d1f30b6b1d";
import { boxById, emit, itemById, rarityById, state } from "../store.js?v=d1f30b6b1d";
import { openBox } from "./bag.js?v=d1f30b6b1d";
import { showError } from "./errors.js?v=d1f30b6b1d";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {{text: string, boxId?: string} | null} */
let note = null;
let confirmDupes = false;
let busy = false;

/** Run a shop call, take the new profile, redraw. @param {() => Promise<any>} call @param {(res: any) => void} [after] */
async function act(call, after) {
  if (busy) return;
  busy = true;
  try {
    const res = await call();
    state.me = res.me;
    after?.(res);
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    renderShop();
  }
}

export function renderShop() {
  const host = $("panel-shop");
  const content = state.content;
  const me = state.me;
  if (!content || !me || !content.shop) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  /** @type {Record<string, number>} */
  const sell = content.shop.sell;
  /** @type {Record<string, number>} */
  const boxes = content.shop.boxes;
  const parts = [];

  const wallet = el("div", "shop-wallet");
  wallet.append(el("span", "dim", "YOUR SHARDS  "), el("b", "", `<> ${fmt(me.shards ?? 0)}`));
  parts.push(wallet);
  if (note) {
    const line = el("div", "bag-note shop-note", `> ${note.text}`);
    const boxDef = note.boxId ? boxById(note.boxId) : null;
    if (boxDef && (me.boxes ?? []).some((/** @type {any} */ b) => b.box_id === boxDef.id)) {
      const open = el("button", "inline-btn", " [ OPEN IT ]");
      open.addEventListener("click", () => {
        note = null;
        openBox(boxDef).then(renderShop);
      });
      line.append(open);
    }
    parts.push(line);
  }

  // ---- buy
  parts.push(el("div", "panel-h", "BUY LOOT BOXES"));
  const row = el("div", "box-row");
  for (const [id, price] of Object.entries(boxes)) {
    const def = boxById(id);
    if (!def) continue;
    const card = el("div", "box-card");
    const pre = el("pre", "art");
    const buy = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", `[ BUY ] <> ${fmt(price)}`));
    buy.disabled = (me.shards ?? 0) < price;
    buy.addEventListener("click", () =>
      act(() => api.buyBox(id), () => (note = { text: `bought a ${def.name}.`, boxId: id })),
    );
    card.append(pre, el("div", "box-name", def.name), buy);
    row.append(card);
    requestAnimationFrame(() => setArt(pre, def.art, 11));
  }
  parts.push(row);

  // ---- sell
  parts.push(el("div", "panel-h", "SELL LOOT"));
  parts.push(
    el("div", "dim bag-note", Object.entries(sell).map(([r, p]) => `${r.toUpperCase()} ${p}`).join("  ::  ") + "  (shards each)"),
  );
  const equipped = new Set([me.equipped, me.equipped_charm].filter(Boolean));
  const owned = me.inventory
    .map((/** @type {any} */ inv) => ({ inv, item: itemById(inv.item_id) }))
    .filter((/** @type {any} */ x) => x.item)
    .sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        (rarityById(a.item.rarity)?.rank ?? 0) - (rarityById(b.item.rarity)?.rank ?? 0) ||
        a.item.name.localeCompare(b.item.name),
    );
  const dupeValue = owned.reduce(
    (/** @type {number} */ n, /** @type {any} */ x) => n + Math.max(0, x.inv.count - 1) * (sell[x.item.rarity] ?? 0),
    0,
  );
  if (dupeValue > 0) {
    const dupes = el("button", "shop-dupes", confirmDupes ? `[ SURE? KEEPS ONE OF EACH :: +${fmt(dupeValue)} ]` : `[ SELL ALL DUPLICATES +${fmt(dupeValue)} ]`);
    dupes.addEventListener("click", () => {
      if (!confirmDupes) {
        confirmDupes = true;
        renderShop();
        return;
      }
      confirmDupes = false;
      act(() => api.sellDuplicates(), (res) => (note = { text: `sold ${fmt(res.sold)} duplicates for ${fmt(res.shards_gained)} shards.` }));
    });
    parts.push(dupes);
  }
  if (!owned.length) parts.push(el("div", "dim bag-note", "> nothing to sell yet. attack to find loot."));
  const list = el("div", "shop-list");
  for (const { inv, item } of owned) {
    const price = sell[item.rarity] ?? 0;
    const r = el("div", "shop-item");
    r.append(el("span", `shop-name r-${item.rarity}`, item.name), el("span", "dim", `x${inv.count}`));
    const locked = equipped.has(item.id) && inv.count <= 1;
    if (locked || !price) {
      r.append(el("span", "dim shop-act", locked ? "EQUIPPED" : "--"));
    } else {
      const b = el("button", "inline-btn shop-act", `[ SELL +${price} ]`);
      b.addEventListener("click", () =>
        act(() => api.sellItem(item.id, 1), (res) => (note = { text: `sold ${item.name} for ${fmt(res.shards_gained)} shards.` })),
      );
      r.append(b);
    }
    list.append(r);
  }
  parts.push(list);
  host.replaceChildren(...parts);
}
