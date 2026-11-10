// [ BAG ] panel: scrolls and loot boxes. [ COLLECTION ] (its own page since
// ticket #172): every item, undiscovered ones as dotted silhouettes (hidden
// by default: there are hundreds).

import * as api from "../api.js?v=b6664395f3";
import { autoStashKey, isAutoStash, setAutoStashBoxes, setAutoStashRarity } from "../autostash.js?v=b6664395f3";
import { el, fmt, holdHeight, setArt, setArts, ymd } from "../ascii.js?v=b6664395f3";
import { SCROLLS, bossDef, emit, ownItem, ownItemOf, rarityById, state } from "../store.js?v=b6664395f3";
import { preselect, refineBox } from "./blacksmith.js?v=b6664395f3";
import { withOdds } from "./boxodds.js?v=b6664395f3";
import { EFFECT_HELP, EQUIP_SLOTS, effectLine, effectParts, themeLine, wornInSlot } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { itemLines, openAllBoxesReveal, openBoxSequence, showOverlay } from "./fx.js?v=b6664395f3";
import { loadoutTag, loadoutsWith } from "./loadouts.js?v=b6664395f3";
import { shareInChat } from "./chat.js?v=b6664395f3";
import { auctionable, findOnAuction } from "./auction.js?v=b6664395f3";
import { tabOpen } from "./tutorial.js?v=b6664395f3";
import { scrollReveal } from "./scrolls.js?v=b6664395f3";

/** City building ids -> names (city_only items say which building paid them out). */
const CITY_BUILDINGS = /** @type {Record<string, string>} */ ({
  wall: "THE WALL", well: "THE WELL", market: "THE MARKET", forge: "THE FORGE", temple: "THE TEMPLE",
  tower: "THE TOWER", castle: "THE CASTLE", beacon: "THE GREAT BEACON",
});

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** Guaranteed-crit charges a player can hold (Game.MAX_NEXT_CRITS on the server). */
const CRIT_CHARGE_MAX = 10;

/** "all" or a slot id */
let slotFilter = "all";
let showUnknown = false;
/** What the bag and the collection last drew, to skip identical redraws. */
let drawn = "";
let drawnCollection = "";

/** Everything the bag shows. Most attacks change none of it (only damage
 * and attack counts), so it isn't rebuilt each hit. */
function bagKey(/** @type {any} */ me) {
  return JSON.stringify([state.content?.version, me.scrolls, me.boxes, me.next_crits, autoStashKey()]);
}

/** Everything the collection shows: hundreds of item cards, so only redrawn when it changed. */
function collectionKey(/** @type {any} */ me) {
  return JSON.stringify([state.content?.version, me.worn, me.inventory, slotFilter, showUnknown, me.loadouts]);
}

/** @param {any} def @param {number} count */
function scrollBagButton(def, count) {
  const width = 46;
  const inside = width - 2;
  const label = `${def.name}  x${fmt(count)}  ${def.name === "RUINED SCROLL" ? "(junk: SHOP / CITY)" : "[ DEPLOY ]"}`;
  const body = ` ${label.slice(0, inside - 2).padEnd(inside - 2)} `;
  return `+${"-".repeat(inside)}+\n|${body}|\n+${"-".repeat(inside)}+`;
}

/** @param {string} label @param {boolean} on @param {() => void} fn */
export function chip(label, on, fn) {
  const b = el("button", "chip", label);
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", fn);
  return b;
}

/** The tab was just opened: redraw even if nothing changed (art sized while
 * hidden, e.g. after a window resize, needs the real width). */
export function bagOpened() {
  drawn = "";
  drawnCollection = "";
}

/** The chest + count whose multi-open button was clicked once ("" = none). */
let armedOpen = "";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let disarmOpen;

export function renderBag() {
  const host = $("panel-bag");
  const content = state.content;
  const me = state.me;
  if (!content || !me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    drawn = "";
    return;
  }
  const key = `${bagKey(me)}|${armedOpen}`;
  if (key === drawn && host.childElementCount) return;
  drawn = key;
  holdHeight(host);
  const parts = [];

  // ---- consumable scrolls
  parts.push(el("div", "panel-h", "SCROLLS"));
  const scrolls = me.scrolls ?? [];
  if (!scrolls.length) parts.push(el("div", "dim bag-note", "> none yet. buy them in the SHOP (or find them in chests)."));
  else {
    const row = el("div", "scroll-bag");
    for (const s of scrolls) {
      const def = SCROLLS[s.scroll_id];
      if (!def) continue;
      const b = el("button", "scroll-bag-item");
      const art = el("pre", "art", scrollBagButton(def, s.count));
      b.append(art);
      b.setAttribute("aria-label", `${def.name}, owned ${s.count}, deploy`);
      b.style.setProperty("--scroll-color", def.color);
      b.addEventListener("click", () => scrollReveal(s.scroll_id));
      row.append(b);
    }
    parts.push(row);
  }

  // ---- loot boxes
  const boxes = me.boxes ?? [];
  const boxHead = el("div", "panel-h", "LOOT BOXES");
  parts.push(boxHead);
  // Ticket #346: chests give attacks + crit charges up to a daily limit, then other loot.
  const cc = me.chest_combat;
  if (cc?.limit) {
    const left = Math.max(0, cc.limit - cc.used);
    parts.push(el("div", `bag-note chest-combat${left ? " dim" : ""}`,
      `> attacks + crits from chests today: ${fmt(Math.min(cc.used, cc.limit))} / ${fmt(cc.limit)}`
      + (left ? "" : `. limit hit: those pay <> 1 each instead for the next ${untilUtcMidnight()}`)));
  }
  if (!boxes.length) {
    parts.push(el("div", "dim bag-note", "> none yet. every attack has a small chance to drop one."));
  } else {
    const row = el("div", "box-row");
    // Every chest type, commonest first, even the ones you have none of (greyed),
    // so getting a new kind never shifts the cards under your finger (ticket #283).
    const counts = new Map(boxes.map((/** @type {any} */ b) => [b.box_id, b.count]));
    for (const def of state.content?.boxes ?? []) {
      const b = { box_id: def.id, count: counts.get(def.id) ?? 0 };
      const card = el("div", `box-card${b.count ? "" : " empty"}`);
      const pre = withOdds(el("pre", "art"), def.id);
      const actions = el("div", "box-card-actions");
      const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ OPEN ONE ]"));
      open.disabled = !b.count;
      open.addEventListener("click", () => openBox(def));
      /** Open n of this chest in one go (the CHEST HAUL ledger shows what came out).
       * ``short``: the OPEN 5/10/25 row's narrow labels, so three fit a phone-width card.
       * @param {number} n @param {string} label @param {boolean} [short] */
      const openMany = (n, label, short = false) => {
        // Two clicks, like selling: the first arms it ("[ SURE? OPEN 50 ]"), the second opens.
        const key = `${b.box_id}:${n}`;
        const sure = armedOpen === key;
        const btn = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${sure ? " armed" : ""}`));
        // Sized for every label it can show, so arming never moves the layout (ticket #118).
        const labels = short ? [label, "[ SURE? ]", "[ ... ]"] : [label, `[ SURE? OPEN ${fmt(n)} ]`, "[ OPENING... ]"];
        steadyLabel(btn, labels, sure ? 1 : 0);
        btn.disabled = b.count < n || !n;
        btn.addEventListener("click", async () => {
          if (armedOpen !== key) {
            armedOpen = key;
            clearTimeout(disarmOpen);
            disarmOpen = setTimeout(() => {
              armedOpen = "";
              renderBag();
            }, 4000);
            renderBag();
            return;
          }
          armedOpen = "";
          clearTimeout(disarmOpen);
          for (const button of actions.querySelectorAll("button")) button.disabled = true;
          steadyLabel(btn, labels, 2);
          try {
            const res = await api.openAllBoxes([{ box_id: b.box_id, count: n }]);
            state.me = res.me;
            emit("me");
            await openAllBoxesReveal(res.results, def);
          } catch (e) {
            showError(/** @type {Error} */ (e).message);
            renderBag(); // back to the buttons this chest's count allows
          }
        });
        return btn;
      };
      // Some, not all: e.g. spend 10 wooden crates on an event and keep the rest.
      // 5 keeps caskets' 3-crit charges under the 10-charge cap (ticket #267).
      // Always there (greyed when you have too few) so the buttons never move.
      const someRow = el("div", "box-card-some");
      someRow.append(el("span", "dim", "OPEN"), ...[5, 10, 25].map((n) => openMany(n, `[ ${n} ]`, true)));
      actions.append(open, someRow, openMany(b.count, `[ AUTO OPEN ALL x${fmt(b.count)} ]`));
      card.append(pre, el("div", "box-name", `${def.name}  x${fmt(b.count)}`), actions);
      row.append(card);
      requestAnimationFrame(() => setArt(pre, def.art, 11));
    }
    parts.push(row);
  }
  if (me.next_crits > 0) parts.push(el("div", "bag-note crit-charge", `> NEXT ${me.next_crits} ATTACK(S) WILL CRIT (MAX ${CRIT_CHARGE_MAX}; extra charges pay 1 shard)`));

  const boxesOn = isAutoStash("boxes");
  const stash = el("div", "bag-note auto-stash-line");
  const flip = el("button", "inline-btn", boxesOn ? "[ TURN OFF ]" : "[ TURN ON ]");
  flip.addEventListener("click", () => {
    setAutoStashBoxes(!boxesOn);
    renderBag();
  });
  stash.append(el("span", boxesOn ? "" : "dim", boxesOn ? "AUTO STASH CHESTS: ON :: found chests go straight here "
    : "AUTO STASH CHESTS: OFF "), flip);
  parts.push(stash);

  host.replaceChildren(...parts);
}

/** "7h 12m": time left until 00:00 UTC (the attack day), in local terms. */
function untilUtcMidnight() {
  const now = Date.now();
  const mins = Math.max(1, Math.ceil((Math.ceil(now / 86400000) * 86400000 - now) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** How many pieces of a forge set someone wears. @param {any} me @param {string} set */
export function setPiecesWorn(me, set) {
  return Object.values(me?.worn ?? {}).filter((id) => id && ownItem(/** @type {string} */ (id))?.gear_set === set).length;
}

/** A forge piece's SET BONUS lines (ticket #341): every step, lit once you
 * wear that many pieces of the set. @param {any} item @param {any} me */
export function setBonusLines(item, me) {
  const steps = item?.gear_set ? state.content?.set_bonuses?.[item.gear_set] : null;
  if (!steps?.length) return [];
  const worn = setPiecesWorn(me, item.gear_set);
  const most = Math.max(...steps.map((/** @type {any} */ st) => st.pieces));
  // One left-aligned block (centred lines made the [x] boxes zig-zag).
  const block = el("div", "set-bonus-box");
  block.append(
    el("div", `set-bonus-h set-${item.gear_set}`, `${item.gear_set.toUpperCase()} SET BONUS :: ${worn} / ${most} WORN`),
    ...steps.map((/** @type {any} */ st) => el("div", `set-bonus${worn >= st.pieces ? " on" : " dim"}`,
      `${worn >= st.pieces ? "[x]" : "[ ]"} ${st.pieces} PIECES: ${st.text}`)),
  );
  return [block];
}

export function renderCollection() {
  const host = $("panel-collection");
  const content = state.content;
  const me = state.me;
  if (!content || !me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    drawnCollection = "";
    return;
  }
  const key = collectionKey(me);
  if (key === drawnCollection && host.childElementCount) return;
  drawnCollection = key;
  holdHeight(host);
  const parts = [];
  const slotsInGame = EQUIP_SLOTS.filter(([id]) => content.items.some((/** @type {any} */ i) => i.slot === id));
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
    chip("[ ALL ]", slotFilter === "all", () => ((slotFilter = "all"), renderCollection())),
    ...slotsInGame.map(([id, label]) => chip(`[ ${label.endsWith("S") ? label : `${label}S`} ]`, slotFilter === id, () => ((slotFilter = id), renderCollection()))),
    chip(showUnknown ? "[ HIDE UNFOUND ]" : "[ SHOW UNFOUND ]", showUnknown, () => ((showUnknown = !showUnknown), renderCollection())),
  );
  parts.push(chips);
  if (!shown.length) {
    parts.push(el("div", "dim bag-note", "> nothing here yet. attack to find loot."));
  }
  const grid = el("div", "bag-grid");
  /** @type {[HTMLElement, string[]][]} */
  const arts = [];
  for (const item of shown) {
    const inv = owned.get(item.id);
    const card = /** @type {HTMLButtonElement} */ (el("button", "card" + (inv ? ` r-${item.rarity}` : " unknown")));
    card.type = "button";
    const isEq = isWorn(me, item.id);
    if (inv && isEq) card.classList.add("equipped");
    const pre = el("pre", "art");
    card.append(pre);
    card.setAttribute("aria-label", inv ? `${item.name}, ${item.rarity}` : "Undiscovered item");
    if (inv) card.addEventListener("click", () => itemDetail(item));
    else card.tabIndex = -1;
    grid.append(card);
    arts.push([pre, itemLines(item, { unknown: !inv, count: inv?.count, equipped: isEq,
      locked: Boolean(inv?.locked), loadouts: inv ? loadoutTag(item.id) : "" })]);
  }
  parts.push(grid);
  host.replaceChildren(...parts);
  requestAnimationFrame(() => setArts(arts, 11));
}

/** AUTO STASH by rarity (on the INVENTORY page): ticked rarities skip the
 * found-item pop-up (relics always show). @param {() => void} redraw */
export function autoStashItems(redraw) {
  const content = state.content;
  if (!content) return [];
  const parts = [el("div", "panel-h", "AUTO STASH")];
  const stashRow = el("div", "bag-note auto-stash-line shop-auto");
  stashRow.append(el("span", "dim", "FOUND ITEMS (no pop-up): "));
  const allRarities = content.rarities.map((/** @type {any} */ r) => r.id).filter((/** @type {string} */ r) => r !== "boss_unique");
  for (const rid of allRarities) {
    const on = isAutoStash("items", rid);
    const lab = el("label", `shop-auto-opt r-${rid}`);
    const tick = /** @type {HTMLInputElement} */ (el("input", ""));
    tick.type = "checkbox";
    tick.checked = on;
    tick.addEventListener("change", () => {
      setAutoStashRarity(rid, tick.checked, allRarities);
      redraw();
    });
    lab.append(tick, el("span", "shop-auto-mark", on ? "[x]" : "[ ]"), ` ${rarityById(rid)?.label ?? rid}`);
    stashRow.append(lab);
  }
  parts.push(stashRow);
  parts.push(el("div", "dim bag-note", "> ticked rarities go straight to your inventory with a coloured callout; the rest pop up so you can equip them."));
  return parts;
}

/** Open a box and play its animation (also used when one drops). @param {any} box */
/** A chest open in flight: a double click must not open two (each click is a new request id). */
let opening = false;

export async function openBox(box) {
  if (opening) return;
  opening = true;
  try {
    let res;
    try {
      res = await api.openBox(box.id);
    } finally {
      opening = false;
    }
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

/** Is this item worn in any slot? @param {any} me @param {string} id */
export const isWorn = (me, id) => Object.values(me.worn ?? {}).includes(id);

/** Refinable at THE BLACKSMITH (the server has the final say). @param {any} item */
const refinable = (item) => !item.city_only && !item.shop_price
  && ["common", "uncommon", "rare", "epic", "legendary", "mythic", "godly", "ascended"].includes(item.rarity)
  && Object.entries(item.mods ?? {}).some(([k, v]) => (k === "loot_mult" ? v > 1 : k !== "dmg_pct" && v > 0));

/** ``asIs``: show exactly this copy (an auction listing's refined one), not yours.
 * @param {any} catalog @param {boolean} [asIs] */
export function itemDetail(catalog, asIs = false) {
  const item = asIs ? catalog : ownItemOf(catalog); // your refined copy's numbers, if you have one
  const me = state.me;
  const inv = me?.inventory.find((/** @type {any} */ i) => i.item_id === item.id);
  const isEquipped = isWorn(me, item.id);
  showOverlay((inner, close) => {
    const wrap = el("div", "item-detail");
    const pre = el("pre", `art r-${item.rarity}${item.gear_set ? ` set-${item.gear_set}` : ""}`);
    wrap.append(pre);
    wrap.append(el("div", "flavor", `"${item.flavor}"`));
    const stats = el("div", "stats");
    const wornId = wornInSlot(item, me);
    stats.append(effectLine(item, wornId ? ownItem(wornId) : null));
    stats.append(...refineBox(item)); // a refined copy: what was done to it, stat by stat
    if ((item.refine_rank || item.refine_respecced) && !asIs) stats.append(el("div", "bs-rank", "only the AUCTION HOUSE takes this copy; extra copies can go anywhere"));
    const help = Object.entries(EFFECT_HELP)
      .filter(([k]) => effectParts(item.mods).some((p) => p.endsWith(k)))
      .map(([k, v]) => `${k}: ${v}`);
    for (const h of help) stats.append(el("div", "dim", h));
    const building = item.city_only ? CITY_BUILDINGS[item.city_only] ?? item.city_only.toUpperCase() : "";
    const chance = item.shop_price ? `${(item.gear_set ?? "sovereign").toUpperCase()} SET :: THE FORGE :: <> ${fmt(item.shop_price)}` : item.city_only ? `CITY REWARD :: ${building} :: ${item.id === `city_${item.city_only}_${item.rarity}`
      ? "the shop buys it; can't be donated or traded" : "only the #1 donor of each city's building gets one: can't be sold, donated or traded"}`
      : item.drop_chance > 0 ? `DROP RATE ~1 in ${fmt(1 / item.drop_chance)} attacks` : "DROP RATE does not drop here";
    const only = item.boss_only
      ? "  ::  " + item.boss_only.map((/** @type {string} */ b) => bossDef(b)?.name ?? b).join(", ") + " ONLY"
      : "";
    stats.append(el("div", "dim", `${item.slot.toUpperCase()}${item.theme ? ` (${themeLine(item)})` : ""}  ::  ${chance}${only}`));
    stats.append(...setBonusLines(item, me));
    if (inv) stats.append(el("div", "dim", `OWNED x${inv.count}  ::  FIRST FOUND ${ymd(inv.first_found_at)}`));
    const inLoadouts = loadoutsWith(item.id);
    if (inv && inLoadouts.length) {
      stats.append(el("div", "item-loadouts", `IN LOADOUT ${inLoadouts.join(" + ")} :: bulk sell / donate keeps one`));
    }
    if (inv?.locked) stats.append(el("div", "item-locked", "LOCKED :: can't be sold, and auto-sell keeps new copies"));
    if (inv?.marked) stats.append(el("div", "marked-sell", "$ MARKED TO SELL :: shows first in SELL LOOT and the auction house"));
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
      // Lock: no selling it by accident (shop, SELL ALL DUPLICATES, auto-sell).
      const lock = /** @type {HTMLButtonElement} */ (el("button", "", inv.locked ? "[ UNLOCK ]" : "[ LOCK ]"));
      lock.title = inv.locked ? "allow selling it again" : "stop it from being sold by accident";
      lock.addEventListener("click", async () => {
        if (lock.disabled) return;
        lock.disabled = true;
        lock.textContent = "[ ... ]";
        try {
          state.me = (await api.lockItem(item.id, !inv.locked)).me;
          emit("me");
          close();
        } catch (e) {
          lock.disabled = false;
          lock.textContent = inv.locked ? "[ UNLOCK ]" : "[ LOCK ]";
          showError(/** @type {Error} */ (e).message);
        }
      });
      actions.append(lock);
      // Ticket #76: mark it to sell later (highlighted + first in SELL LOOT and the AUCTION HOUSE).
      if (!inv.locked) {
        const mark = /** @type {HTMLButtonElement} */ (el("button", inv.marked ? "marked-sell" : "",
          inv.marked ? "[ UNMARK SELL ]" : "[ MARK TO SELL ]"));
        mark.title = inv.marked ? "stop highlighting it in the shop and auction house"
          : "highlight it (and list it first) in SELL LOOT and the auction house";
        mark.addEventListener("click", async () => {
          if (mark.disabled) return;
          mark.disabled = true;
          mark.textContent = "[ ... ]";
          try {
            state.me = (await api.markItem(item.id, !inv.marked)).me;
            emit("me");
            close();
          } catch (e) {
            mark.disabled = false;
            mark.textContent = inv.marked ? "[ UNMARK SELL ]" : "[ MARK TO SELL ]";
            showError(/** @type {Error} */ (e).message);
          }
        });
        actions.append(mark);
      }
    }
    if (inv && refinable(item)) { // merge duplicates / respec, at the BLACKSMITH
      const smith = el("button", "", "[ BLACKSMITH ]");
      smith.title = "merge duplicates into this one, or reroll its stats";
      smith.addEventListener("click", () => {
        close();
        preselect(item.id, inv.count > 1 ? "merge" : "respec");
        /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-tab="blacksmith"]'))?.click();
      });
      actions.append(smith);
    }
    if (inv && me?.name_chosen) { // only your own items link in chat
      const share = el("button", "", "[ SHOW IN CHAT ]");
      share.title = "put a link to this item in the chat box";
      share.addEventListener("click", () => {
        close();
        shareInChat(catalog); // the plain name: "[2]" is only on your side
      });
      actions.append(share);
    }
    if (tabOpen("auction") && auctionable(catalog)) { // ticket #254: who's selling one, cheapest first
      const ah = el("button", "", "[ FIND ON AH ]");
      ah.title = "open the AUCTION HOUSE on this item's listings";
      ah.addEventListener("click", () => {
        close();
        findOnAuction(catalog);
      });
      actions.append(ah);
    }
    const cl = el("button", "", "[ CLOSE ]");
    cl.addEventListener("click", close);
    actions.append(cl);
    wrap.append(actions);
    inner.append(wrap);
    setArt(pre, itemLines(item, { count: inv?.count, equipped: isEquipped, locked: Boolean(inv?.locked), width: 26 }), 16);
  });
}

/** Show labels[at] on a button that keeps the size of its widest label: all of
 * them share one grid cell, the others invisible.
 * @param {HTMLElement} btn @param {string[]} labels @param {number} at */
function steadyLabel(btn, labels, at) {
  btn.classList.add("steady");
  btn.replaceChildren(...labels.map((t, i) => el("span", i === at ? "" : "steady-ghost", t)));
  btn.setAttribute("aria-label", labels[at]);
}
