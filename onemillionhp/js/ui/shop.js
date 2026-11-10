// [ SHOP ] panel: sell loot for shards, spend shards on loot boxes.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt, holdHeight, setArt } from "../ascii.js?v=b6664395f3";
import { boxById, emit, itemById, ownItem, ownItemOf, rarityById, SCROLLS, state } from "../store.js?v=b6664395f3";
import { chip, openBox } from "./bag.js?v=b6664395f3";
import { withOdds } from "./boxodds.js?v=b6664395f3";
import { effectLine, wornInSlot } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { loadoutTag } from "./loadouts.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {{text: string, boxId?: string} | null} */
let note = null;
let confirmDupes = false;
/** A rarity whose auto-sell box was just ticked, waiting for [ YES ] because it sells things you own. */
let pendingAuto = /** @type {string | null} */ (null);
let busy = false;
/** An item whose last copy is in a saved loadout, waiting for its second SELL click. */
let armedSell = "";
/** Ticket #87: items in SELL LOOT showing their stats against what you wear. @type {Set<string>} */
const statsOpen = new Set();
const ALL_STATS_KEY = "omhp.shop.all_stats";
/** [x] SHOW ALL STATS: every row shows them. */
/** Ticket #180: items sold down to none this visit stay as a SOLD row, so
 * the rows under the pointer don't slide up into the next click. Ticket #209:
 * only for SOLD_ROW_MS (and never past leaving the shop). @type {Map<string, number>} */
const soldOut = new Map();
const SOLD_ROW_MS = 60_000;
// Ticket #227: rarities SELL ALL DUPLICATES leaves alone (remembered in this browser).
const DUPE_SKIP_KEY = "omhp.dupes.skip";
/** @type {Set<string>} */
const dupeSkip = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DUPE_SKIP_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
})();
let allStats = (() => {
  try {
    return localStorage.getItem(ALL_STATS_KEY) === "1";
  } catch {
    return false;
  }
})();

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

/** How many of each box / scroll the BUY box is set to (ticket #313), kept across redraws. @type {Map<string, number>} */
const qty = new Map();
const MAX_BUY = 1000; // the server's MAX_SHOP_BUY

/** "[ 25 ] [MAX] [ BUY 25 ] <> 750": how many to buy, the button following the total.
 * @param {string} key @param {number} price @param {(n: number) => void} buy */
function buyControls(key, price, buy) {
  const wrap = el("div", "shop-buy");
  const input = /** @type {HTMLInputElement} */ (el("input", "shop-qty"));
  input.type = "number";
  input.min = "1";
  input.max = String(MAX_BUY);
  input.inputMode = "numeric";
  input.value = String(qty.get(key) ?? 1);
  input.setAttribute("aria-label", "how many to buy");
  const btn = /** @type {HTMLButtonElement} */ (el("button", "inline-btn"));
  const count = () => Math.max(1, Math.min(MAX_BUY, Math.floor(Number(input.value)) || 1));
  const paint = () => {
    const n = count();
    btn.textContent = `[ BUY${n > 1 ? ` ${fmt(n)}` : ""} ] <> ${fmt(price * n)}`;
    btn.disabled = (state.me?.shards ?? 0) < price * n;
  };
  const max = /** @type {HTMLButtonElement} */ (el("button", "inline-btn shop-max", "[MAX]"));
  max.title = "as many as your shards buy (up to 1,000)";
  max.addEventListener("click", () => {
    input.value = String(Math.max(1, Math.min(MAX_BUY, Math.floor((state.me?.shards ?? 0) / price))));
    qty.set(key, count());
    paint();
  });
  input.addEventListener("input", () => {
    qty.set(key, count());
    paint();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !btn.disabled) btn.click();
  });
  btn.addEventListener("click", () => buy(count()));
  paint();
  wrap.append(input, max, btn);
  return wrap;
}

/** Ticket #209: leaving the shop drops its SOLD rows (the next visit starts clean). */
export function leaveShop() {
  soldOut.clear();
}

export function renderShop() {
  const host = $("panel-shop");
  const content = state.content;
  const me = state.me;
  const prices = me?.shop ?? content?.shop; // me.shop has the admin's price changes applied
  if (!content || !me || !prices) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  // Typing a BUY amount: a redraw (every attack refreshes you) would wipe it.
  // Only the amount boxes: a ticked checkbox keeps focus too, and must redraw (ticket #321).
  if (host.contains(document.activeElement) && document.activeElement?.classList.contains("shop-qty")) return;
  /** @type {Record<string, number>} */
  const sell = prices.sell;
  /** @type {Record<string, number>} */
  const boxes = prices.boxes;
  holdHeight(host);
  const keep = rowOnScreen(host);
  /** Art drawn once the panel is in the page (setArt measures it). @type {[HTMLElement, string[], number][]} */
  const arts = [];
  const parts = [];

  const wallet = el("div", "shop-wallet");
  wallet.append(el("span", "dim", "YOUR SHARDS  "), el("b", "", `<> ${fmt(me.shards ?? 0)}`));
  parts.push(wallet);
  // Always there (blank until the first sale), so a note never pushes the list down.
  if (!note) parts.push(el("div", "bag-note shop-note shop-msg", "\u00a0"));
  else {
    const line = el("div", "bag-note shop-note shop-msg", `> ${note.text}`);
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
    const pre = withOdds(el("pre", "art"), id);
    const buy = buyControls(`box:${id}`, price, (n) =>
      act(() => api.buyBox(id, n), () => (note = { text: n > 1 ? `bought ${fmt(n)}x ${def.name}.` : `bought a ${def.name}.`,
        boxId: id })));
    card.append(pre, el("div", "box-name", def.name), buy);
    row.append(card);
    arts.push([pre, def.art, 11]);
  }
  parts.push(row);

  // ---- scrolls: a flat price each (only the ones switched on)
  /** @type {Record<string, number>} */
  const scrolls = prices.scrolls ?? {};
  const scrollIds = Object.keys(scrolls).filter((id) => id in SCROLLS);
  if (scrollIds.length) {
    parts.push(el("div", "panel-h", "BUY SCROLLS"));
    const srow = el("div", "box-row");
    for (const id of scrollIds) {
      const def = SCROLLS[/** @type {keyof typeof SCROLLS} */ (id)];
      const price = scrolls[id];
      const card = el("div", "box-card scroll-card");
      const pre = el("pre", "art");
      pre.style.setProperty("color", def.color);
      const buy = buyControls(`scroll:${id}`, price, (n) =>
        act(() => api.buyScroll(id, n), () => (note = {
          text: `bought ${n > 1 ? `${fmt(n)}x` : "a"} ${def.name}. ${n > 1 ? "they're" : "it's"} in your BAG.` })));
      card.title = def.description;
      const art = el("div", "scroll-card-art"); // sized to this (the card's width counts its padding)
      art.append(pre);
      card.append(art, el("div", "box-name", def.name), el("div", "dim scroll-card-desc", def.description), buy);
      srow.append(card);
      arts.push([pre, def.art, 9]);
    }
    parts.push(srow);
  }

  // ---- sell scrolls (ticket #302): a quarter of the shop price
  /** @type {Record<string, number>} */
  const scrollSell = prices.scroll_sell ?? {};
  const held = (me.scrolls ?? []).filter((/** @type {any} */ s) => s.count > 0 && scrollSell[s.scroll_id]
    && s.scroll_id in SCROLLS);
  if (held.length) {
    parts.push(el("div", "panel-h", "SELL SCROLLS"));
    const slist = el("div", "shop-list");
    for (const s of held) {
      const def = SCROLLS[/** @type {keyof typeof SCROLLS} */ (s.scroll_id)];
      const each = scrollSell[s.scroll_id];
      const r = el("div", "shop-item");
      const name = el("span", "", def.name);
      name.style.setProperty("color", def.color);
      r.append(name, el("span", "dim", `x${s.count}  :: ${fmt(each)} each`));
      const one = el("button", "inline-btn shop-act", `[ SELL 1 ] +${fmt(each)}`);
      one.addEventListener("click", () => act(() => api.sellScroll(s.scroll_id, 1),
        (res) => (note = { text: `sold a ${def.name} for ${fmt(res.shards)} shards.` })));
      r.append(one);
      if (s.count > 1) {
        const n = Math.min(s.count, MAX_BUY);
        const all = el("button", "inline-btn shop-act", `[ SELL ${n} ] +${fmt(each * n)}`);
        all.addEventListener("click", () => act(() => api.sellScroll(s.scroll_id, n),
          (res) => (note = { text: `sold ${fmt(n)}x ${def.name} for ${fmt(res.shards)} shards.` })));
        r.append(all);
      }
      slist.append(r);
    }
    parts.push(slist);
  }

  // ---- sell
  parts.push(el("div", "panel-h", "SELL LOOT"));
  parts.push(
    el("div", "dim bag-note", Object.entries(sell).map(([r, p]) => `${r.toUpperCase()} ${p}`).join("  ::  ") + "  (shards each)"),
  );
  const toggleAll = el("button", "inline-btn shop-all-stats", `[${allStats ? "x" : " "}] SHOW ALL STATS`);
  toggleAll.setAttribute("aria-pressed", String(allStats));
  toggleAll.title = "every item's stats against what you're wearing: green better, red worse (or click a name)";
  toggleAll.addEventListener("click", () => {
    allStats = !allStats;
    try {
      localStorage.setItem(ALL_STATS_KEY, allStats ? "1" : "0");
    } catch {
      /* private mode: just for this visit */
    }
    renderShop();
  });
  parts.push(toggleAll);
  const equipped = new Set(Object.values(me.worn ?? {}).filter(Boolean));
  // Everything that drops, plus the buildings' own city pieces (sold one at a time:
  // never by SELL ALL DUPLICATES or auto-sell). The one-per-server uniques are keepsakes.
  const cityPiece = (/** @type {any} */ i) => i.city_only && i.id === `city_${i.city_only}_${i.rarity}`;
  const sellable = me.inventory
    .map((/** @type {any} */ inv) => ({ inv, item: itemById(inv.item_id) }))
    .filter((/** @type {any} */ x) => x.item && (!x.item.city_only || cityPiece(x.item)))
    .sort(byRarityThenName);
  const owned = sellable.filter((/** @type {any} */ x) => !x.item.city_only); // what the bulk sells look at
  /** Duplicates' shard value by rarity (locked items never sell). @type {Map<string, number>} */
  const dupeBy = new Map();
  for (const x of owned) {
    const v = x.inv.locked ? 0 : Math.max(0, x.inv.count - 1) * (sell[x.item.rarity] ?? 0);
    if (v > 0) dupeBy.set(x.item.rarity, (dupeBy.get(x.item.rarity) ?? 0) + v);
  }
  const dupeValue = [...dupeBy].reduce((n, [rid, v]) => n + (dupeSkip.has(rid) ? 0 : v), 0);

  // ---- auto-sell: ticked rarities are sold the moment they drop
  /** @type {string[]} */
  const auto = me.autosell ?? [];
  /** Turn auto-sell on/off for one rarity; ``now`` is what happens to the copies you own (ticket #73).
   * @param {string} rid @param {boolean} on @param {"all" | "dupes" | "none"} [now] */
  const setAuto = (rid, on, now = "all") => {
    const next = on ? [...auto, rid] : auto.filter((r) => r !== rid);
    const label = rarityById(rid)?.label ?? rid.toUpperCase();
    act(() => api.setAutosell(next, now), (res) => {
      note = { text: on ? `auto-selling ${label}.${res.sold ? ` sold ${fmt(res.sold)} for ${fmt(res.shards_gained)} shards.` : ""}`
        : `stopped auto-selling ${label}.` };
    });
  };
  /** What ticking a rarity could sell right now: everything (the equipped copy stays)
   * or just the duplicates. @param {string} rid */
  const sellsNow = (rid) => owned
    .filter((/** @type {any} */ x) => x.item.rarity === rid && !x.inv.locked)
    .reduce((/** @type {{n: number, v: number, dn: number, dv: number}} */ t, /** @type {any} */ x) => {
      const n = x.inv.count - (equipped.has(x.item.id) ? 1 : 0);
      const d = x.inv.count - 1;
      const each = sell[rid] ?? 0;
      return { n: t.n + n, v: t.v + n * each, dn: t.dn + d, dv: t.dv + d * each };
    }, { n: 0, v: 0, dn: 0, dv: 0 });
  /** Mythic and above: auto-selling these always asks first. @param {string} rid */
  const precious = (rid) => (rarityById(rid)?.rank ?? 0) >= (rarityById("mythic")?.rank ?? Infinity);
  const autoRow = el("div", "shop-auto");
  autoRow.dataset.anchor = "auto";
  autoRow.append(el("span", "dim", "AUTO-SELL: "));
  for (const r of content.rarities) {
    if (!(sell[r.id] > 0)) continue;
    const on = auto.includes(r.id) || pendingAuto === r.id;
    const lab = el("label", `shop-auto-opt r-${r.id}`);
    const box = /** @type {HTMLInputElement} */ (el("input", ""));
    box.type = "checkbox";
    box.checked = on;
    box.disabled = busy;
    box.addEventListener("change", () => {
      if (!box.checked) {
        if (pendingAuto !== r.id) return setAuto(r.id, false);
        pendingAuto = null; // unticked while asking = cancel
        renderShop();
        return;
      }
      // Ask first when it sells things they own, and always for the rare tiers
      // (mythic and up, ascended included): owning none yet is when it hurts most.
      if (sellsNow(r.id).n > 0 || precious(r.id)) {
        pendingAuto = r.id;
        renderShop();
      } else setAuto(r.id, true);
    });
    lab.append(box, el("span", "shop-auto-mark", on ? "[x]" : "[ ]"), ` ${r.label}`);
    autoRow.append(lab);
  }
  parts.push(autoRow);
  // KEEP ONE OF EACH (tickets #73 / #90 / #61): the first copy of something new skips auto-sell.
  const keepOne = Boolean(me.autosell_keep);
  const keepRow = el("label", "shop-auto-opt shop-auto-keep");
  keepRow.dataset.anchor = "keep";
  const keepBox = /** @type {HTMLInputElement} */ (el("input", ""));
  keepBox.type = "checkbox";
  keepBox.checked = keepOne;
  keepBox.disabled = busy;
  keepBox.addEventListener("change", () => act(() => api.setAutosell(auto, "none", keepBox.checked), () => {
    note = { text: keepBox.checked ? "auto-sell keeps the first copy of anything you don't own yet."
      : "auto-sell sells every copy again." };
  }));
  keepRow.append(keepBox, el("span", "shop-auto-mark", keepOne ? "[x]" : "[ ]"),
    " KEEP ONE OF EACH", el("span", "dim", " (auto-sell never sells the first copy of something new)"));
  parts.push(keepRow);
  if (pendingAuto) {
    const rid = pendingAuto;
    const label = rarityById(rid)?.label ?? rid.toUpperCase();
    const { n, v, dn, dv } = sellsNow(rid);
    const each = fmt(sell[rid] ?? 0);
    const ask = el("div", "bag-note shop-note", n > 0
      ? `> SURE? every ${label} you find from now on is sold${keepOne ? " (except the first copy of something new)" : ""}. `
        + `and the ${fmt(n)} ${label} you own now? `
      : `> SURE? every ${label} you find from now on is sold the moment it drops (+${each} shards each)`
        + `${keepOne ? ", except the first copy of something new" : ". you'll never see it or get to wear it"}. `);
    /** @param {string} text @param {"all" | "dupes" | "none"} now */
    const choice = (text, now) => {
      const b = el("button", "inline-btn", text);
      b.addEventListener("click", () => {
        pendingAuto = null;
        setAuto(rid, true, now);
      });
      return b;
    };
    if (n > 0) {
      ask.append(choice(`[ SELL THEM +${fmt(v)} ]`, "all"));
      if (dn > 0 && dn < n) ask.append(" ", choice(`[ SELL DUPLICATES +${fmt(dv)} ]`, "dupes"));
      ask.append(" ", choice("[ KEEP THEM ]", "none"));
    } else ask.append(choice("[ YES, AUTO-SELL ]", "all"));
    const no = el("button", "inline-btn", " [ CANCEL ]");
    no.addEventListener("click", () => {
      pendingAuto = null;
      renderShop();
    });
    ask.append(no);
    parts.push(ask);
  } else if (auto.length) {
    parts.push(el("div", "dim bag-note", `> ticked rarities are sold the moment they drop. your equipped gear is safe${
      keepOne ? ", and so is the first copy of anything new" : ""}.`));
  }

  if (dupeBy.size > 1) {
    // Which rarities' duplicates go: e.g. sell common + rare spares, keep epics for THE BLACKSMITH.
    const chips = el("div", "chips shop-dupe-chips");
    chips.dataset.anchor = "dupe-chips";
    chips.append(el("span", "dim", "DUPLICATES OF: "));
    for (const [rid] of [...dupeBy].sort((a, b) => (rarityById(a[0])?.rank ?? 0) - (rarityById(b[0])?.rank ?? 0))) {
      const on = !dupeSkip.has(rid);
      chips.append(chip(`[${on ? "x" : " "}] ${(rarityById(rid)?.label ?? rid).toUpperCase()}`, on, () => {
        if (on) dupeSkip.add(rid);
        else dupeSkip.delete(rid);
        try {
          localStorage.setItem(DUPE_SKIP_KEY, JSON.stringify([...dupeSkip]));
        } catch {
          /* only for this visit */
        }
        confirmDupes = false;
        renderShop();
      }));
    }
    parts.push(chips);
  }
  if (dupeValue > 0) {
    const some = [...dupeBy.keys()].some((rid) => dupeSkip.has(rid));
    const label = some ? "SELL TICKED DUPLICATES" : "SELL ALL DUPLICATES";
    const dupes = el("button", "shop-dupes", confirmDupes ? `[ SURE? KEEPS ONE OF EACH :: +${fmt(dupeValue)} ]` : `[ ${label} +${fmt(dupeValue)} ]`);
    dupes.dataset.anchor = "dupes";
    dupes.addEventListener("click", () => {
      if (!confirmDupes) {
        confirmDupes = true;
        renderShop();
        return;
      }
      confirmDupes = false;
      const only = some ? [...dupeBy.keys()].filter((rid) => !dupeSkip.has(rid)) : undefined;
      act(() => api.sellDuplicates(only), (res) => (note = { text: `sold ${fmt(res.sold)} duplicates for ${fmt(res.shards_gained)} shards.` }));
    });
    parts.push(dupes);
  }
  // Sold to the last copy this visit: a SOLD row where it was.
  const have = new Set(sellable.map((x) => x.item.id));
  const now = Date.now();
  for (const [id, at] of soldOut) {
    if (now - at > SOLD_ROW_MS) {
      soldOut.delete(id);
      continue;
    }
    const item = itemById(id);
    if (item && !have.has(id)) sellable.push({ inv: { item_id: id, count: 0, locked: false }, item });
  }
  sellable.sort(byRarityThenName);
  sellable.sort((a, b) => Number(Boolean(b.inv.marked)) - Number(Boolean(a.inv.marked))); // #76: marked first (stable)
  if (!sellable.length) parts.push(el("div", "dim bag-note", "> nothing to sell yet. attack to find loot."));
  const list = el("div", "shop-list");
  for (const { inv, item } of sellable) {
    const price = sell[item.rarity] ?? 0;
    const r = el("div", "shop-item");
    r.dataset.id = item.id;
    r.dataset.anchor = `item:${item.id}`;
    if (!inv.count) {
      r.classList.add("shop-sold");
      r.append(el("span", `shop-name r-${item.rarity}`, item.name), el("span", "dim", "x0"), el("span", "dim shop-act", "SOLD"));
      list.append(r);
      continue;
    }
    const tag = loadoutTag(item.id);
    // Click the name: its stats against what you wear in that slot (ticket #87).
    const name = el("button", `shop-name r-${item.rarity}`, item.name);
    name.title = "show its stats against what you're wearing";
    name.addEventListener("click", () => {
      if (statsOpen.has(item.id)) statsOpen.delete(item.id);
      else statsOpen.add(item.id);
      renderShop();
    });
    r.append(name, el("span", "dim", `x${inv.count}`));
    if (inv.marked) {
      r.classList.add("marked");
      r.append(el("span", "marked-sell shop-mark", "$ SELL"));
    }
    if (tag) r.append(el("span", "item-loadouts shop-loadouts", tag));
    if (item.city_only) {
      const city = el("span", "dim shop-city", "CITY");
      city.title = "a city reward: it can't be found again";
      r.append(city);
    }
    const onlyWorn = equipped.has(item.id) && inv.count <= 1;
    if (inv.locked) {
      r.append(el("span", "item-locked shop-act", "LOCKED"));
    } else if (onlyWorn || !price) {
      r.append(el("span", "dim shop-act", onlyWorn ? "EQUIPPED" : "--"));
    } else {
      // The last copy of something saved in a loadout: ask once more.
      // A city reward (it can't be found again): ask once more too.
      // Ticket #182: so does your last copy of anything (duplicates sell in one click).
      const lastOfLoadout = Boolean(tag) && inv.count - (equipped.has(item.id) ? 1 : 0) <= 1;
      const risky = lastOfLoadout || Boolean(item.city_only) || inv.count <= 1;
      const sure = armedSell === item.id;
      const b = el("button", `inline-btn shop-act${sure ? " armed" : ""}`,
        sure ? (lastOfLoadout ? `[ SURE? IN ${tag} ]` : item.city_only ? "[ SURE? ]" : "[ SURE? LAST ONE ]") : `[ SELL +${price} ]`);
      b.addEventListener("click", () => {
        if (risky && !sure) {
          armedSell = item.id;
          renderShop();
          setTimeout(() => {
            if (armedSell === item.id) {
              armedSell = "";
              renderShop();
            }
          }, 3000);
          return;
        }
        armedSell = "";
        if (inv.count <= 1) soldOut.set(item.id, Date.now());
        act(() => api.sellItem(item.id, 1), (res) => (note = { text: `sold ${item.name} for ${fmt(res.shards_gained)} shards.` }));
      });
      r.append(b);
    }
    // Lock / unlock right here too, so a keeper can't be sold by a stray click.
    const lock = el("button", "inline-btn shop-lock", inv.locked ? "[ UNLOCK ]" : "[ LOCK ]");
    lock.addEventListener("click", () =>
      act(() => api.lockItem(item.id, !inv.locked),
        () => (note = { text: inv.locked ? `${item.name} unlocked.` : `${item.name} locked: it won't be sold.` })),
    );
    r.append(lock);
    if (allStats || statsOpen.has(item.id)) {
      // Ticket #217: your refined copy's numbers (THE BLACKSMITH), on both sides.
      const mine = ownItemOf(item);
      const worn = ownItem(wornInSlot(item, me) ?? "");
      const line = effectLine(mine, worn ?? null);
      line.classList.add("shop-stats");
      if (!worn && equipped.has(item.id)) line.append(el("div", "dim fx-vs", "you're wearing this"));
      if (mine !== item) line.append(el("div", "dim fx-vs", "your refined copy stays: the copies you sell are plain ones"));
      list.append(r, line);
      continue;
    }
    list.append(r);
  }
  parts.push(list);
  host.replaceChildren(...parts);
  for (const [pre, art, max] of arts) setArt(pre, art, max); // now, not a frame later: no jump while it's blank
  if (keep) {
    const row = host.querySelector(`[data-anchor="${CSS.escape(keep.id)}"]`);
    if (row) scrollerOf(host).scrollTop += row.getBoundingClientRect().top - keep.top;
  }
}

/** @param {any} a @param {any} b */
function byRarityThenName(a, b) {
  return (rarityById(a.item.rarity)?.rank ?? 0) - (rarityById(b.item.rarity)?.rank ?? 0) ||
    a.item.name.localeCompare(b.item.name);
}

/** The first auto-sell / duplicates control or SELL LOOT row on screen and where it sits, to put it
 * back there after a redraw. Only what's really on screen: pinning a row below the fold made the
 * DUPLICATES OF controls jump whenever the lines above it changed height (ticket #322).
 * @param {HTMLElement} host @returns {{id: string, top: number} | null} */
function rowOnScreen(host) {
  if (host.hidden) return null;
  for (const node of host.querySelectorAll("[data-anchor]")) {
    const top = node.getBoundingClientRect().top;
    if (top >= window.innerHeight) return null;
    if (top >= 0) return { id: /** @type {HTMLElement} */ (node).dataset.anchor ?? "", top };
  }
  return null;
}

/** The box that scrolls the panel (the page itself on phones). @param {HTMLElement} node */
function scrollerOf(node) {
  for (let n = node.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === "auto" || y === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return /** @type {HTMLElement} */ (document.scrollingElement ?? document.documentElement);
}
