// [ AUCTION HOUSE ] in the WORLD menu (server/omhp/auction.py): players sell
// items to each other for shards. BROWSE filters by slot / rarity / name (and
// NOT OWNED: only items missing from your bag, tickets #86 / #108) and
// sorts by newest, price or rarity; SELL lists your items at a price each;
// MY LISTINGS takes them down again and shows recent sales. Listed copies
// leave your bag at once and come back if you take the listing down (or it
// runs out). Other players' listings / sales arrive as a WS "auction" ping.

import * as api from "../api.js?v=b6664395f3";
import { ago, duration, el, fmt, holdHeight } from "../ascii.js?v=b6664395f3";
import { emit, itemById, now, rarityById, refinedCopy, state } from "../store.js?v=b6664395f3";
import { isWorn, itemDetail, chip } from "./bag.js?v=b6664395f3";
import { EFFECT_FILTERS, EQUIP_SLOTS } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showNotice } from "./notice.js?v=b6664395f3";
import { loadoutTag } from "./loadouts.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const SORTS = /** @type {const} */ ([
  ["new", "NEWEST"], ["price_asc", "PRICE: LOW FIRST"], ["price_desc", "PRICE: HIGH FIRST"],
  ["rarity_desc", "RARITY: BEST FIRST"], ["rarity_asc", "RARITY: COMMON FIRST"],
  ["refine_desc", "MERGE RANK: HIGHEST FIRST"],
]);
/** THE BLACKSMITH's copies: merged (a rank), respecced (rerolled), or either. */
const REFINED = /** @type {const} */ ([["", "ANY"], ["any", "MERGED OR RESPECCED"], ["merged", "MERGED"],
  ["respecced", "RESPECCED [+/-]"]]);

/** @type {"browse" | "sell" | "mine"} */
let view = "browse";
const filter = { slot: "", rarity: "", sort: "new", q: "", seller: "", unowned: "", refined: "", effect: "" };
let page = 0;
/** The last /api/auction answer. @type {any} */
let data = null;
/** Bumped per fetch: only the newest answer is drawn (fast filter clicks). */
let fetchSeq = 0;
/** Which filter menu is open ("rarity" / "sort"), kept across redraws. @type {string | null} */
let openMenu = null;
let busy = false;
/** A listing waiting for its second BUY click (the price check). @type {{id: number, count: number} | null} */
let armed = null;
/** The SELL form that's open: which item, what's typed, and whether it's your
 * refined copy (always one). @type {{itemId: string, count: string, price: string, refined?: boolean} | null} */
let form = null;
/** A listing's "buy this many" box (ticket #257): listing id -> copies. @type {Map<number, number>} */
const buyQty = new Map();
let note = "";
/** Ticket #157: the listing whose [ LOWER PRICE ] box is open, and what's typed in it. */
let reprice = { id: 0, value: "" };
let pingTimer = 0;

const visible = () => !$("panel-auction").hidden;

/** Fetch the listings for the current filters, then draw. */
export async function loadAuction() {
  if (visible()) render();
  const seq = ++fetchSeq;
  try {
    let got = await api.getAuction({ ...filter, page });
    if (page && !got.listings.length && got.total) { // the last page emptied out: step back
      page = Math.max(0, Math.ceil(got.total / got.per_page) - 1);
      got = await api.getAuction({ ...filter, page });
    }
    if (seq !== fetchSeq) return; // a newer fetch (other filters) is on its way
    data = got;
    if (visible()) render();
  } catch (e) {
    if (seq === fetchSeq && visible()) showError(/** @type {Error} */ (e).message);
  }
}

/** Can this item go on the auction house (the SELL list's rule)? @param {any} item */
export function auctionable(item) {
  const sell = (state.me?.shop ?? state.content?.shop)?.sell ?? {};
  // Ticket #204: a building's city items can be traded; city-built pieces can't. Same rule as auction.tradable.
  return Boolean(item) && !String(item.id).startsWith("city_built") && !item.shop_price
    && ((sell[item.rarity] ?? 0) > 0 || AH_ONLY.has(item.rarity));
}

/** Ticket #254: open BROWSE on this item's listings, cheapest first. @param {any} item */
export function findOnAuction(item) {
  Object.assign(filter, { slot: "", rarity: "", sort: "price_asc", q: item.name, seller: "", unowned: "", refined: "",
    effect: "" });
  view = "browse";
  page = 0;
  armed = null;
  const tab = /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-tab="auction"]'));
  if (visible()) loadAuction();
  else tab?.click();
  tab?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Our profile changed (shards, bag): redraw without refetching the listings. */
export function redrawAuction() {
  if (!visible()) return;
  if (!data) loadAuction();
  else render();
}

/** Someone listed / bought / took something down: refresh soon if we're looking. */
export function auctionChanged() {
  if (!visible() || view === "sell" || pingTimer) return; // SELL is your own bag: nothing to refetch
  pingTimer = window.setTimeout(() => {
    pingTimer = 0;
    if (visible() && view !== "sell") loadAuction();
  }, 1500 + Math.random() * 1500); // spread the crowd's refetches out
}

/** Running sale totals per buyer + item while their pop-up is up. @type {Map<string, {count: number, earned: number, at: number}>} */
const soldRun = new Map();

/** One of your listings sold (sent only to you). @param {any} s */
export function auctionSold(s) {
  // One buyer picking up copies one at a time: one pop-up with running totals (ticket #256).
  const key = `sold:${s.buyer}:${s.item_id}`;
  const prev = soldRun.get(key);
  const run = prev && Date.now() - prev.at < 20000
    ? { count: prev.count + s.count, earned: prev.earned + s.earned, at: Date.now() }
    : { count: s.count, earned: s.earned, at: Date.now() };
  soldRun.set(key, run);
  const what = run.count > 1 ? `${fmt(run.count)}x ${s.item_name}` : s.item_name;
  showNotice(`AUCTION HOUSE :: ${s.buyer} bought your ${what} :: +${fmt(run.earned)} shards`, false, key);
  if (visible()) loadAuction();
}

/** Run a buy / list / cancel call, take the new profile, refetch. @param {() => Promise<any>} call @param {(res: any) => string} done */
async function act(call, done) {
  if (busy) return;
  busy = true;
  /** @type {HTMLElement | null} */ (document.activeElement)?.blur?.(); // Enter in a box: let the result draw
  render();
  try {
    const res = await call();
    state.me = res.me;
    note = done(res);
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    armed = null;
    loadAuction();
  }
}

const left = (/** @type {any} */ l) => duration(l.expires_at - now()).replace(/ \d+s$/, "");

/** An item name that opens its card. ``asIs``: a listing's own copy (its refined numbers).
 * @param {any} item @param {string} [extra] @param {boolean} [asIs] */
function nameBtn(item, extra = "", asIs = false) {
  const b = el("button", `auc-name r-${item.rarity}`, item.name + extra);
  b.title = "see the item";
  b.addEventListener("click", () => itemDetail(item, asIs));
  return b;
}

/** A listing's item as listed: a refined copy is "NAME [2] [+/-]" with its own
 * numbers ([+/-] = respecced; shown on the auction house only). @param {any} l */
function listedItem(l) {
  const copy = refinedCopy(itemById(l.item_id), l.refine);
  return copy && l.refine?.respecced ? { ...copy, name: `${copy.name} [+/-]` } : copy;
}

/** "MERGED +2 :: RESPECCED x3" under a refined listing. @param {any} l */
const refinedLine = (l) => (l.refine ? [l.refine.rank ? `MERGED +${l.refine.rank}` : "",
  l.refine.respecced ? `RESPECCED x${l.refine.respecs || 1}` : ""].filter(Boolean).join(" · ") + " :: " : "");

function render() {
  const host = $("panel-auction");
  const me = state.me;
  if (!state.content || !me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  // Typing (search box, SELL form): a redraw would wipe what's half typed.
  if (host.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
  holdHeight(host);
  const parts = [];
  const wallet = el("div", "shop-wallet");
  wallet.append(el("span", "dim", "YOUR SHARDS  "), el("b", "", `<> ${fmt(me.shards ?? 0)}`));
  parts.push(wallet);

  const mine = data?.mine ?? [];
  const tabs = el("div", "chips auc-views");
  tabs.append(
    chip("[ BROWSE ]", view === "browse", () => switchView("browse")),
    chip("[ SELL ]", view === "sell", () => switchView("sell")),
    chip(`[ MY LISTINGS${mine.length ? ` ${mine.length}` : ""} ]`, view === "mine", () => switchView("mine")),
  );
  parts.push(tabs);
  if (note) parts.push(el("div", "bag-note shop-note", `> ${note}`));

  if (view === "browse") parts.push(...browseView());
  else if (view === "sell") parts.push(...sellView());
  else parts.push(...mineView());
  host.replaceChildren(...parts);
}

/** @param {"browse" | "sell" | "mine"} v */
function switchView(v) {
  view = v;
  openMenu = null;
  note = "";
  armed = null;
  form = null;
  render();
  if (v !== "sell") loadAuction();
}

// ------------------------------------------------------------------ browse

function browseView() {
  const content = state.content;
  const out = [];
  out.push(el("div", "panel-h", "AUCTION HOUSE"));

  const slots = el("div", "chips own-chips");
  slots.append(chip("[ ALL ]", !filter.slot, () => setFilter({ slot: "" })));
  for (const [id, label] of EQUIP_SLOTS) {
    if (!content.items.some((/** @type {any} */ i) => i.slot === id)) continue;
    slots.append(chip(`[ ${label} ]`, filter.slot === id, () => setFilter({ slot: filter.slot === id ? "" : id })));
  }
  out.push(slots);

  const rarities = content.rarities
    .filter((/** @type {any} */ r) => (state.me?.shop ?? content.shop).sell[r.id] > 0 || AH_ONLY.has(r.id))
    .map((/** @type {any} */ r) => [r.id, r.label]);
  const picks = el("div", "own-picks");
  picks.append(
    menu("RARITY", "rarity", [["", "ANY"], ...rarities]),
    menu("SORT", "sort", SORTS.map(([k, v]) => [k, v])),
    menu("REFINED", "refined", REFINED.map(([k, v]) => [k, v])),
    menu("STAT", "effect", [["", "ANY"], ...EFFECT_FILTERS.map(([k, v]) => /** @type {[string, string]} */ ([k, v]))]),
  );
  const search = /** @type {HTMLInputElement} */ (el("input", "loadout-input auc-search"));
  search.placeholder = "search name";
  search.value = filter.q;
  search.maxLength = 40;
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    search.blur(); // let the results draw (a focused box holds redraws), and fires "change" once
  });
  search.addEventListener("change", () => {
    if (search.value.trim() !== filter.q) setFilter({ q: search.value.trim() });
  });
  // Ticket #116: listings by one seller (part of their name).
  const by = /** @type {HTMLInputElement} */ (el("input", "loadout-input auc-search"));
  by.placeholder = "seller";
  by.setAttribute("aria-label", "seller name");
  by.value = filter.seller;
  by.maxLength = 24;
  by.addEventListener("keydown", (e) => {
    if (e.key === "Enter") by.blur();
  });
  by.addEventListener("change", () => {
    if (by.value.trim() !== filter.seller) setFilter({ seller: by.value.trim() });
  });
  picks.append(search, by);
  if (state.me) {
    const missing = chip("[ NOT OWNED ]", Boolean(filter.unowned),
      () => setFilter({ unowned: filter.unowned ? "" : "1" }));
    missing.title = "only items you don't have yet";
    picks.append(missing);
  }
  if (filter.slot || filter.rarity || filter.q || filter.seller || filter.unowned || filter.refined || filter.effect) {
    const clear = el("button", "inline-btn", "[ CLEAR ]");
    clear.addEventListener("click", () => setFilter({ slot: "", rarity: "", q: "", seller: "", unowned: "", refined: "",
      effect: "" }));
    picks.append(clear);
  }
  out.push(picks);

  if (!data) {
    out.push(el("div", "dim bag-note", "> loading..."));
    return out;
  }
  out.push(el("div", "dim bag-note", `${fmt(data.total)} for sale :: listings last ${data.hours}h :: the house keeps ${data.fee_pct}%`));
  if (!data.listings.length) {
    out.push(el("div", "dim bag-note", filter.slot || filter.rarity || filter.q || filter.unowned || filter.refined || filter.effect
      ? "> nothing matches. try other filters." : "> nothing for sale yet. be the first: [ SELL ]."));
  }
  const list = el("div", "auc-list");
  for (const l of data.listings) list.append(listingRow(l));
  out.push(list);
  const pages = Math.ceil(data.total / data.per_page);
  if (pages > 1) {
    const pager = el("div", "auc-pager");
    const prev = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ < PREV ]"));
    prev.disabled = page <= 0;
    prev.addEventListener("click", () => ((page -= 1), loadAuction()));
    const next = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ NEXT > ]"));
    next.disabled = page >= pages - 1;
    next.addEventListener("click", () => ((page += 1), loadAuction()));
    pager.append(prev, el("span", "dim", ` PAGE ${page + 1} / ${pages} `), next);
    out.push(pager);
  }
  return out;
}

/** A filter menu built like the tab bar's (YOU ▾ / GAME ▾): a bracketed
 * button, and under it a panel of options with the chosen one lit.
 * @param {string} label @param {"rarity" | "sort" | "refined" | "effect"} key @param {[string, string][]} options */
function menu(label, key, options) {
  const wrap = el("div", "auc-dd");
  const chosen = options.find(([v]) => v === filter[key]) ?? options[0];
  const isOpen = openMenu === key;
  const btn = el("button", `auc-dd-btn${filter[key] && key !== "sort" ? " on" : ""}`, `[${label}: ${chosen[1]} \u25BE]`);
  btn.setAttribute("type", "button");
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", String(isOpen));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu = isOpen ? null : key;
    render();
    if (openMenu) /** @type {HTMLElement | null} */ (document.querySelector(`.auc-dd-menu[data-key="${key}"] [aria-checked="true"]`))?.focus({ preventScroll: true });
  });
  const list = el("div", "auc-dd-menu");
  list.dataset.key = key;
  list.setAttribute("role", "menu");
  list.hidden = !isOpen;
  for (const [value, text] of options) {
    const o = el("button", value && key === "rarity" ? `r-${value}` : "", `[ ${text} ]`);
    o.setAttribute("type", "button");
    o.setAttribute("role", "menuitemradio");
    o.setAttribute("aria-checked", String(value === filter[key]));
    o.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu = null;
      if (value === filter[key]) render();
      else setFilter({ [key]: value });
    });
    list.append(o);
  }
  wrap.append(btn, list);
  return wrap;
}

/** Close an open filter menu (click elsewhere / Escape). */
function closeMenu() {
  if (!openMenu) return;
  openMenu = null;
  if (visible()) render();
}
document.addEventListener("click", (e) => {
  if (openMenu && !(e.target instanceof Element && e.target.closest(".auc-dd"))) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

/** @param {Partial<typeof filter>} f */
function setFilter(f) {
  Object.assign(filter, f);
  page = 0;
  armed = null;
  loadAuction();
}

/** One listing in BROWSE. @param {any} l */
function listingRow(l) {
  const item = listedItem(l);
  const row = el("div", `auc-row${l.refine ? " auc-refined" : ""}`);
  if (!item) return row;
  const top = el("div", "auc-top");
  top.append(nameBtn(item, "", Boolean(l.refine)), el("span", "dim", l.count > 1 ? ` x${l.count}` : ""));
  top.append(el("span", "auc-price", `<> ${fmt(l.price)}${l.count > 1 ? " ea" : ""}`));
  const sub = el("div", "auc-sub dim");
  // The seller's name: tap it for everything they're selling (ticket #116).
  const who = el("button", "inline-btn auc-seller", l.seller);
  who.title = `everything ${l.seller} is selling`;
  who.addEventListener("click", () => setFilter({ seller: l.seller, q: "", slot: "", rarity: "", effect: "", refined: "" }));
  sub.append(`${refinedLine(l)}${rarityById(item.rarity)?.label ?? item.rarity.toUpperCase()} ${item.slot.toUpperCase()} :: by `,
    who, ` :: ${left(l)} left`);
  const acts = el("span", "auc-acts");
  if (l.seller_id === state.me?.id) {
    acts.append(el("span", "dim", "YOURS"));
  } else {
    /** @param {number} n @param {string} label */
    const buyBtn = (n, label) => {
      const cost = l.price * n;
      const sure = armed?.id === l.id && armed?.count === n;
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${sure ? " armed" : ""}`,
        sure ? `[ SURE? PAY ${fmt(cost)} ]` : label));
      b.disabled = busy || (state.me?.shards ?? 0) < cost;
      if (b.disabled && !busy) b.title = "not enough shards";
      b.addEventListener("click", () => {
        if (!sure) {
          armed = { id: l.id, count: n };
          render();
          setTimeout(() => {
            if (armed?.id === l.id && armed?.count === n) {
              armed = null;
              render();
            }
          }, 4000);
          return;
        }
        act(() => api.buyAuction(l.id, n), (res) =>
          `bought ${res.bought > 1 ? `${res.bought}x ` : ""}${item.name} for ${fmt(res.paid)} shards. it's in your bag.`);
      });
      return b;
    };
    acts.append(buyBtn(1, "[ BUY ]"));
    if (l.count > 2) { // any amount: type it, then BUY (Enter or leaving the box redraws the button)
      const n = Math.min(l.count, buyQty.get(l.id) ?? 2);
      const input = /** @type {HTMLInputElement} */ (el("input", "auc-qty"));
      input.type = "number";
      input.min = "1";
      input.max = String(l.count);
      input.inputMode = "numeric";
      input.value = String(n);
      input.setAttribute("aria-label", "how many to buy");
      input.addEventListener("change", () => {
        buyQty.set(l.id, Math.max(1, Math.min(l.count, Math.floor(Number(input.value)) || 1)));
        input.blur();
        render();
      });
      acts.append(input, buyBtn(n, `[ BUY ${n} ]`));
    }
    if (l.count > 1) acts.append(buyBtn(l.count, `[ BUY ALL ${l.count} ]`));
  }
  sub.append(acts);
  row.append(top, sub);
  return row;
}

// -------------------------------------------------------------------- sell

function sellView() {
  const me = state.me;
  const sell = (me.shop ?? state.content.shop).sell;
  const out = [];
  out.push(el("div", "panel-h", "SELL TO PLAYERS"));
  out.push(el("div", "dim bag-note", `> pick an item and a price per copy. it leaves your bag until it sells or you take it down. `
    + `the house keeps ${data?.fee_pct ?? 5}%. locked and worn items can't be listed.`));
  const items = me.inventory
    .map((/** @type {any} */ inv) => ({ inv, item: itemById(inv.item_id) }))
    .filter((/** @type {any} */ x) => x.item && !x.item.city_only
      && ((sell[x.item.rarity] ?? 0) > 0 || AH_ONLY.has(x.item.rarity)))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      Number(Boolean(b.inv.marked)) - Number(Boolean(a.inv.marked)) // #76: marked to sell first
      || (rarityById(b.item.rarity)?.rank ?? 0) - (rarityById(a.item.rarity)?.rank ?? 0) || a.item.name.localeCompare(b.item.name));
  if (!items.length) out.push(el("div", "dim bag-note", "> nothing to sell yet. attack to find loot."));
  const list = el("div", "shop-list");
  for (const { inv, item } of items) {
    // The worn copy and your refined copy (THE BLACKSMITH) are the same one: never a spare.
    const refined = me.refined?.[item.id];
    const spare = inv.count - (isWorn(me, item.id) || refined ? 1 : 0);
    if (refined) list.append(...refinedRow(me, inv, item, refined, sell[item.rarity] ?? 0));
    if (refined && spare < 1) continue;
    const r = el("div", `shop-item${inv.marked ? " marked" : ""}`);
    r.append(nameBtn(item), el("span", "dim", `x${inv.count}`));
    if (inv.marked) r.append(el("span", "marked-sell shop-mark", "$ SELL"));
    // Ticket #125: in a saved loadout? "L1 L3", like the shop's SELL LOOT.
    const tag = loadoutTag(item.id);
    if (tag) r.append(el("span", "item-loadouts shop-loadouts", tag));
    if (inv.locked) r.append(unlockBtn(item));
    else if (spare < 1) r.append(el("span", "dim shop-act", "EQUIPPED"));
    else {
      const b = el("button", "inline-btn shop-act", formFor(item.id, false) ? "[ CLOSE ]" : "[ LIST ]");
      b.addEventListener("click", () => {
        form = formFor(item.id, false) ? null : { itemId: item.id, count: "1", price: "" };
        render();
        /** @type {HTMLInputElement | null} */ (document.querySelector(".auc-form .auc-price-in"))?.focus();
      });
      r.append(b);
    }
    if (!inv.locked) r.append(lockBtn(item));
    list.append(r);
    if (formFor(item.id, false) && spare >= 1) list.append(sellForm(item, spare, sell[item.rarity] ?? 0));
  }
  out.push(list);
  return out;
}

/** Ticket #252: a locked item unlocks right here, then it can be listed. @param {any} item */
function unlockBtn(item) {
  const b = el("button", "inline-btn item-locked shop-act", "[ UNLOCK ]");
  b.title = "locked: unlock it to list it";
  b.addEventListener("click", () => act(() => api.lockItem(item.id, false), () => `${item.name} unlocked.`));
  return b;
}

/** Ticket #269: lock it again right here (after listing what you meant to). @param {any} item */
function lockBtn(item) {
  const b = el("button", "inline-btn shop-act auc-lock", "[ LOCK ]");
  b.title = "lock it: it can't be listed or sold until you unlock it";
  b.addEventListener("click", () => act(() => api.lockItem(item.id, true), () => `${item.name} locked.`));
  return b;
}

/** Is the open SELL form this item's (its spares, or its refined copy)? @param {string} id @param {boolean} refined */
const formFor = (id, refined) => Boolean(form && form.itemId === id && Boolean(form.refined) === refined);

/** Your refined copy of an item, listed on its own: "NAME [2] [+/-]", one copy,
 * its rank and roll going to the buyer. @param {any} me @param {any} inv @param {any} item
 * @param {{rank: number, mods: any}} refined @param {number} shopPays */
function refinedRow(me, inv, item, refined, shopPays) {
  const shown = refinedCopy(item, refined);
  const r = el("div", "shop-item auc-refined");
  r.append(nameBtn(shown, "", true), el("span", "dim", "REFINED"));
  const open = formFor(item.id, true);
  if (inv.locked) r.append(unlockBtn(item));
  else if (isWorn(me, item.id)) r.append(el("span", "dim shop-act", "EQUIPPED"));
  else {
    const b = el("button", "inline-btn shop-act", open ? "[ CLOSE ]" : "[ LIST REFINED ]");
    b.title = "sell this copy, its merge rank and respec roll with it";
    b.addEventListener("click", () => {
      form = open ? null : { itemId: item.id, count: "1", price: "", refined: true };
      render();
      /** @type {HTMLInputElement | null} */ (document.querySelector(".auc-form .auc-price-in"))?.focus();
    });
    r.append(b);
  }
  return open ? [r, sellForm(shown, 1, shopPays, true)] : [r];
}

/** Rarities only players buy: the shop pays nothing (server/omhp/auction.py AH_ONLY, ticket #134). */
const AH_ONLY = new Set(["boss_unique"]);

/** Ticket #324: what an item goes for on the AH now, per "item:refined", fetched when its form opens.
 * @type {Map<string, {at: number, data: any}>} */
const markets = new Map();
const MARKET_MS = 30_000;

/** "> on the AH now: 3 listed (12 copies) :: 140 - 900 each" (or none), filled in once it loads.
 * @param {any} item @param {boolean} refined */
function marketLine(item, refined) {
  const line = el("div", "dim auc-sum auc-market", "> on the AH now: ...");
  const key = `${item.id}:${refined ? 1 : 0}`;
  const paint = (/** @type {any} */ m) => {
    line.textContent = !m.listings ? "> on the AH now: none listed"
      : `> on the AH now: ${fmt(m.listings)} listed${m.copies > m.listings ? ` (${fmt(m.copies)} copies)` : ""} :: ${
        m.min === m.max ? fmt(m.min) : `${fmt(m.min)} - ${fmt(m.max)}`} each`;
  };
  const had = markets.get(key);
  if (had) paint(had.data);
  if (!had || Date.now() - had.at > MARKET_MS) {
    api.getAuctionMarket(item.id, refined).then((m) => {
      markets.set(key, { at: Date.now(), data: m });
      paint(m);
    }, () => {
      if (!had) line.textContent = "";
    });
  }
  return line;
}

/** The inline LIST form under an item (``refined``: your refined copy, always one).
 * @param {any} item @param {number} spare @param {number} shopPays @param {boolean} [refined] */
function sellForm(item, spare, shopPays, refined = false) {
  const f = /** @type {{itemId: string, count: string, price: string}} */ (form);
  const box = /** @type {HTMLFormElement} */ (el("form", "auc-form"));
  const num = (/** @type {string} */ cls, /** @type {string} */ v, /** @type {number} */ max) => {
    const i = /** @type {HTMLInputElement} */ (el("input", `loadout-input ${cls}`));
    i.type = "number";
    i.inputMode = "numeric";
    i.min = "1";
    i.max = String(max);
    i.value = v;
    return i;
  };
  const count = num("auc-count-in", f.count, spare);
  const price = num("auc-price-in", f.price, 100_000_000);
  price.placeholder = shopPays ? `shop pays ${shopPays}` : "your price";
  const sum = el("div", "dim auc-sum");
  const fee = data?.fee_pct ?? 5;
  const paint = () => {
    f.count = count.value;
    f.price = price.value;
    const n = Math.floor(Number(count.value)), p = Math.floor(Number(price.value));
    sum.textContent = n > 0 && p > 0
      ? `> you get ${fmt(n * p - Math.floor((n * p * fee) / 100))} shards if all ${n} sell (after the ${fee}% cut)`
      : shopPays ? `> the shop would pay ${shopPays} each` : "> the shop won't buy these: players only";
  };
  count.addEventListener("input", paint);
  price.addEventListener("input", paint);
  paint();
  const row = el("div", "auc-form-row");
  const c = el("label", "dim", "COPIES ");
  c.append(count, el("span", "dim", ` / ${spare}`));
  const p = el("label", "dim", "PRICE EACH <> ");
  p.append(price);
  const go = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ POST LISTING ]"));
  go.type = "submit";
  go.disabled = busy;
  row.append(c, p, go);
  box.append(row, sum, marketLine(item, refined));
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = Math.floor(Number(count.value)), each = Math.floor(Number(price.value));
    if (!(n >= 1 && n <= spare)) return showError(`List 1 to ${spare}.`);
    if (!(each >= 1)) return showError("Set a price (shards each).");
    form = null;
    markets.delete(`${item.id}:${refined ? 1 : 0}`);
    act(() => api.listAuction(item.id, n, each, refined), () =>
      `listed ${n > 1 ? `${n}x ` : ""}${item.name} at ${fmt(each)} each. see [ MY LISTINGS ].`);
  });
  return box;
}

// ------------------------------------------------------------- my listings

/** Lower a listing's price in place (it keeps its spot and its time left). @param {any} l @param {any} item */
function repriceForm(l, item) {
  const box = el("form", "auc-form auc-form-row");
  const input = /** @type {HTMLInputElement} */ (el("input", "auc-price-in"));
  input.type = "number";
  input.min = "1";
  input.max = String(l.price - 1);
  input.placeholder = `under ${l.price}`;
  input.value = reprice.value;
  input.addEventListener("input", () => (reprice.value = input.value));
  const label = el("label", "dim", "NEW PRICE EACH <> ");
  label.append(input);
  const go = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SET PRICE ]"));
  go.type = "submit";
  go.disabled = busy;
  box.append(label, go);
  box.addEventListener("submit", (e) => {
    e.preventDefault();
    const each = Math.floor(Number(input.value));
    if (!(each >= 1 && each < l.price)) return showError(`Pick a price from 1 to ${fmt(l.price - 1)}.`);
    reprice = { id: 0, value: "" };
    act(() => api.repriceAuction(l.id, each), () => `${item.name} is now ${fmt(each)} each.`);
  });
  requestAnimationFrame(() => {
    // Opening it, or a redraw while typing (the old box was replaced): keep the cursor in it.
    if (reprice.id === l.id && (!document.activeElement || document.activeElement === document.body)) input.focus();
  });
  return box;
}

function mineView() {
  const out = [];
  out.push(el("div", "panel-h", "MY LISTINGS"));
  if (!data) {
    out.push(el("div", "dim bag-note", "> loading..."));
    return out;
  }
  if (!data.mine.length) out.push(el("div", "dim bag-note", "> nothing up for sale. list something from [ SELL ]."));
  else out.push(el("div", "dim bag-note", `${data.mine.length} / ${data.max_listings} listings up`));
  const list = el("div", "auc-list");
  for (const l of data.mine) {
    const item = listedItem(l);
    if (!item) continue;
    const row = el("div", `auc-row${l.refine ? " auc-refined" : ""}`);
    const top = el("div", "auc-top");
    top.append(nameBtn(item, "", Boolean(l.refine)), el("span", "dim", l.count > 1 ? ` x${l.count}` : ""),
      el("span", "auc-price", `<> ${fmt(l.price)}${l.count > 1 ? " ea" : ""}`));
    const sub = el("div", "auc-sub dim", `${refinedLine(l)}${left(l)} left`);
    const acts = el("span", "auc-acts");
    const down = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ TAKE DOWN ]"));
    down.disabled = busy;
    down.addEventListener("click", () =>
      act(() => api.cancelAuction(l.id), (res) => `${item.name} is back in your bag${res.returned > 1 ? ` (x${res.returned})` : ""}.`));
    const lower = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", reprice.id === l.id ? "[ CLOSE ]" : "[ LOWER PRICE ]"));
    lower.disabled = busy || l.price <= 1;
    lower.addEventListener("click", () => {
      reprice = reprice.id === l.id ? { id: 0, value: "" } : { id: l.id, value: "" };
      render();
    });
    acts.append(lower, down);
    sub.append(acts);
    row.append(top, sub);
    if (reprice.id === l.id) row.append(repriceForm(l, item));
    list.append(row);
  }
  out.push(list);

  out.push(el("div", "panel-h", "RECENT TRADES"));
  if (!data.sales.length) out.push(el("div", "dim bag-note", "> no trades yet."));
  const log = el("div", "auc-log");
  for (const s of data.sales) {
    const item = itemById(s.item_id);
    const what = `${s.count > 1 ? `${s.count}x ` : ""}${item?.name ?? s.item_id}`;
    const line = el("div", "auc-log-line");
    line.append(el("span", "dim", `${ago(now() - s.at)} ago  `));
    if (s.sold) line.append(`SOLD ${what} to ${s.buyer} `, el("b", "auc-plus", `+${fmt(s.paid - s.fee)}`));
    else line.append(`BOUGHT ${what} from ${s.seller ?? "?"} `, el("b", "auc-minus", `-${fmt(s.paid)}`)); // #317
    log.append(line);
  }
  out.push(log);
  return out;
}
