// [ YOU ] > [ PROFILE ]: name, badges, stats, share code, account.
// [ YOU ] > [ INVENTORY ]: worn equipment, loadouts, your equipment (filterable).
// Split in two for ticket #172.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt, holdHeight } from "../ascii.js?v=b6664395f3";
import { emit, itemById, ownItem, ownItemOf, rarityById, state } from "../store.js?v=b6664395f3";
import { badgeTag, clanIn, forgetBadges, nameStar } from "./badges.js?v=b6664395f3";
import { autoStashItems, chip, isWorn, itemDetail } from "./bag.js?v=b6664395f3";
import { EFFECT_FILTERS, EQUIP_SLOTS, compareSpans, damageRanges, hasEffect, matchesFilter, wornInSlot } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";
import { gearDoll, gearTotal } from "./gear.js?v=b6664395f3";
import { loadoutSection } from "./loadouts.js?v=b6664395f3";
import { nameForm } from "./nameform.js?v=b6664395f3";
import { shareSection } from "./referral.js?v=b6664395f3";
import { saveSection } from "./save.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ----------------------------------------------------------------- player

let renaming = false;
/** The badge picker: open?, what the server said, and the unsaved choice (null = automatic). */
let editingBadges = false;
/** @type {any} */
let badgeData = null;
/** @type {string[] | null} */
let draft = null;
let savingBadges = false;
/** Is the picker's BOSSES section unfolded? (kept while the tab redraws) */
let bossesOpen = false;

/** @param {boolean} [force] redraw even while the player is typing in this panel */
export function renderPlayer(force = false) {
  const me = state.me;
  const host = $("panel-player");
  // Live updates redraw this panel often; don't wipe a half-typed rename.
  const typing = document.activeElement;
  if (!force && (typing?.tagName === "INPUT" || typing?.tagName === "SELECT") && host.contains(typing)) return;
  if (!me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  holdHeight(host);
  const rows = [
    ["NAME", me.name],
    ["BADGES", ""],
    ["LEVEL", String(me.level)],
    ["TOTAL DMG", fmt(me.total_damage)],
    ["HITS", fmt(me.total_attacks)],
    ["CRITS", fmt(me.total_crits)],
    ["ATTACKS", `${me.attacks_left} / ${me.attacks_per_day}`],
    ["ULTIMATE", me.ultimate_available ? "READY" : me.ultimate_used ? "SPENT" : "--"],
    ["ITEMS FOUND", fmt(me.items_found)],
    ["BOSSES", `${me.bosses_participated} fought / ${me.bosses_defeated} slain`],
    ["SHARDS", fmt(me.shards ?? 0)],
    ["LOOT BOXES", String((me.boxes ?? []).reduce((n, /** @type {any} */ b) => n + b.count, 0))],
    ...(me.next_crits > 0 ? [["CRIT CHARGES", String(me.next_crits)]] : []),
  ];
  const head = el("div", "panel-h", "PLAYER ");
  head.append(el("b", "", "------------------------"));
  const table = /** @type {HTMLTableElement} */ (el("table", "kv"));
  for (const [k, v] of rows) {
    const tr = el("tr");
    tr.append(el("td", "", k), el("td", "", v));
    table.append(tr);
  }
  const nameRow = table.rows[0].cells[1];
  const renameBtn = el("button", "inline-btn", " [rename]");
  renameBtn.addEventListener("click", () => {
    renaming = !renaming;
    renderPlayer();
  });
  nameRow.append(...nameStar(me.badges), renameBtn);
  // Your name as others see it, with the stars in front.
  nameRow.prepend(...nameStar(me.badges));
  const myTag = badgeTag(me.badges, me.id);
  if (myTag) nameRow.prepend(myTag, " ");
  const badgeRow = table.rows[1].cells[1];
  const shownTag = badgeTag(me.badges, me.id);
  badgeRow.append(shownTag ?? el("span", "dim", "none yet"));
  const editBtn = el("button", "inline-btn", editingBadges ? " [close]" : " [edit]");
  editBtn.addEventListener("click", () => {
    editingBadges = !editingBadges;
    if (editingBadges) openBadgePicker();
    renderPlayer();
  });
  badgeRow.append(editBtn);
  // The picker opens right under the BADGES row.
  if (editingBadges) {
    const tr = /** @type {HTMLTableRowElement} */ (table.insertRow(2));
    const cell = tr.insertCell();
    cell.colSpan = 2;
    cell.className = "badge-picker-cell";
    cell.append(badgePicker(me));
  }

  const parts = [head, table];
  if (renaming) parts.push(renameForm(me.name));
  parts.push(shareSection(() => renderPlayer(true)), saveSection(() => renderPlayer(true)));
  host.replaceChildren(...parts);
}

/** @param {boolean} [force] redraw even while the player is picking in a filter */
export function renderInventory(force = false) {
  const me = state.me;
  const host = $("panel-inventory");
  const typing = document.activeElement;
  if (!force && (typing?.tagName === "INPUT" || typing?.tagName === "SELECT") && host.contains(typing)) return;
  if (!me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  holdHeight(host);
  const redraw = () => renderInventory(true);
  host.replaceChildren(...wornEquipment(me), ultCharmRow(me), ...autoStashItems(redraw), keepOneRow(me), loadoutSection(redraw),
    ...ownedEquipment(me));
}

/** Ticket #305: ULT CHARM: any charm you own fires your ULTIMATE, so you can
 * wear a loot charm and still use another's ult (no swapping back and forth).
 * @param {any} me */
function ultCharmRow(me) {
  const row = el("label", "bag-note ult-charm-row");
  const pick = /** @type {HTMLSelectElement} */ (el("select", "ult-charm-pick"));
  const worn = itemById(me.worn?.charm);
  const opt = (/** @type {string} */ value, /** @type {string} */ text) => {
    const o = /** @type {HTMLOptionElement} */ (el("option", "", text));
    o.value = value;
    return o;
  };
  pick.append(opt("", `THE WORN CHARM${worn ? ` (${worn.name})` : ""}`));
  const charms = (me.inventory ?? []).map((/** @type {any} */ r) => itemById(r.item_id))
    .filter((/** @type {any} */ i) => i?.slot === "charm")
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (rarityById(b.rarity)?.rank ?? 0) - (rarityById(a.rarity)?.rank ?? 0));
  for (const c of charms) pick.append(opt(c.id, `${c.name}${c.ult ? `: ${c.ult.name}` : ""}`));
  pick.value = me.ult_charm ?? "";
  pick.addEventListener("change", async () => {
    pick.disabled = true;
    try {
      state.me = (await api.setUltCharm(pick.value || null)).me;
      emit("me");
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
    } finally {
      pick.disabled = false;
    }
  });
  row.append(el("span", "", "ULT CHARM: "), pick,
    el("span", "dim", me.ult ? `  ${me.ult.name}: ${me.ult.text}` : "  wear or pick a charm to get an ultimate"));
  return row;
}

/** KEEP ONE OF EACH (EVERYWHERE), ticket #110: the shop, auto-sell, the city,
 * the auction house and melting all leave your last copy of everything. @param {any} me */
function keepOneRow(me) {
  const on = Boolean(me.keep_one);
  const row = el("label", "bag-note shop-auto-opt shop-auto-keep");
  const box = /** @type {HTMLInputElement} */ (el("input", ""));
  box.type = "checkbox";
  box.checked = on;
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      state.me = await api.setKeepOne(box.checked);
      emit("me");
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
      box.checked = on;
      box.disabled = false;
    }
  });
  row.append(box, el("span", "shop-auto-mark", on ? "[x]" : "[ ]"), " KEEP ONE OF EACH (EVERYWHERE)",
    el("span", "dim", " (selling, auto-sell, the city, the auction house and melting never take your last copy)"));
  return row;
}

/** Your worn equipment: tap a box to choose what to wear there. @param {any} me */
function wornEquipment(me) {
  return [
    el("div", "panel-h", "WORN EQUIPMENT"),
    gearDoll(me.worn, (slot, label) => slotPicker(me, slot, label),
      (label, item) => `${label}: ${item ? item.name : "empty"}. Choose what to wear`, ownItem),
    gearTotal(me.mods, me.mods_raw, "no bonuses yet. loot drops from attacks and boxes."),
    ...[damageRanges(me.damage_ranges, "doll-total", me.ult)].filter((n) => n !== null),
  ];
}

/** Tap a worn-equipment box: everything you own for that slot; tap one to wear it.
 * @param {any} me @param {string} slot @param {string} label */
function slotPicker(me, slot, label) {
  const rank = (/** @type {any} */ i) => rarityById(i.rarity)?.rank ?? 0;
  /** @type {{item: any, count: number}[]} */
  const mine = me.inventory
    .map((/** @type {any} */ i) => ({ item: itemById(i.item_id), count: i.count }))
    .filter((/** @type {any} */ o) => o.item?.slot === slot)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => rank(b.item) - rank(a.item) || a.item.name.localeCompare(b.item.name));
  const inGame = (state.content?.items ?? []).some((/** @type {any} */ i) => i.slot === slot);
  showOverlay((inner, close) => {
    let busy = false;
    /** @param {string | null} id */
    const wear = async (id) => {
      if (busy) return;
      busy = true;
      try {
        state.me = await api.equip(id, slot);
        emit("me");
        close();
      } catch (e) {
        showError(/** @type {Error} */ (e).message);
        busy = false;
      }
    };
    const wrap = el("div", "slot-picker");
    wrap.append(el("div", "panel-h", `[ ${label} ]  ${mine.length ? "TAP ONE TO WEAR IT" : ""}`));
    const list = el("div", "own-list");
    if (!mine.length) {
      list.append(el("div", "dim bag-note", inGame
        ? `> you don't own a ${label.toLowerCase()} yet. they drop from attacks and boxes.`
        : `> no ${label.toLowerCase()} gear in the game yet. coming soon.`));
    }
    for (const { item, count } of mine) {
      const worn = isWorn(me, item.id);
      const row = /** @type {HTMLButtonElement} */ (el("button", `own-row${worn ? " worn" : ""}`));
      row.type = "button";
      row.append(
        el("span", `own-name r-${item.rarity}`, item.name + (count > 1 ? ` x${count}` : "")),
        el("span", "own-slot dim", worn ? "WORN" : "[ WEAR ]"),
        fxSpan(item, me),
      );
      row.addEventListener("click", () => (worn ? close() : wear(item.id)));
      list.append(row);
    }
    const actions = el("div", "actions");
    const current = mine.find((o) => isWorn(me, o.item.id));
    if (current) {
      const details = el("button", "", "[ DETAILS ]");
      details.addEventListener("click", () => {
        close();
        itemDetail(current.item);
      });
      const off = el("button", "", "[ TAKE OFF ]");
      off.addEventListener("click", () => wear(null));
      actions.append(details, off);
    }
    const cl = el("button", "", "[ CLOSE ]");
    cl.addEventListener("click", close);
    actions.append(cl);
    wrap.append(list, actions);
    inner.append(wrap);
  });
}

/** YOUR EQUIPMENT filters (blank = any); kept while the tab redraws. */
const ownFilter = { slot: "", rarity: "", effect: "" };
const SORT_KEY = "omhp.own.sort";
/** YOUR EQUIPMENT order: "" = worn, then rarest; "new" = newest find first
 * (ticket #214); else a stat (mods key), highest first. */
let ownSort = (() => {
  try {
    const saved = localStorage.getItem(SORT_KEY) ?? "";
    return saved === "new" || EFFECT_FILTERS.some(([k]) => k === saved) ? saved : "";
  } catch {
    return "";
  }
})();

/** Everything you own, filterable by slot, rarity and effect. Tap one to see / equip it. @param {any} me */
function ownedEquipment(me) {
  const content = state.content;
  if (!content) return [];
  /** @type {any[]} */
  const owned = me.inventory
    .map((/** @type {any} */ i) => ({ item: itemById(i.item_id), count: i.count, locked: Boolean(i.locked),
      found: Number(i.first_found_at ?? 0) }))
    .filter((/** @type {any} */ o) => o.item);
  const rank = (/** @type {any} */ i) => rarityById(i.rarity)?.rank ?? 0;
  const stat = (/** @type {any} */ i) => Number(i.mods?.[ownSort] ?? (ownSort === "loot_mult" ? 1 : 0));
  const shown = owned
    .filter((o) => matchesFilter(o.item, ownFilter))
    .sort((a, b) => (ownSort === "new" ? b.found - a.found : ownSort ? stat(b.item) - stat(a.item)
      : Number(isWorn(me, b.item.id)) - Number(isWorn(me, a.item.id)))
      || rank(b.item) - rank(a.item) || a.item.name.localeCompare(b.item.name));
  const redraw = () => renderInventory(true);

  const slots = el("div", "chips own-chips");
  const slotCount = (/** @type {string} */ s) => owned.filter((o) => o.item.slot === s).length;
  slots.append(chip(`[ ALL ${owned.length} ]`, !ownFilter.slot, () => ((ownFilter.slot = ""), redraw())));
  for (const [id, label] of EQUIP_SLOTS) {
    const n = slotCount(id);
    const c = chip(`[ ${label} ${n} ]`, ownFilter.slot === id, () => ((ownFilter.slot = ownFilter.slot === id ? "" : id), redraw()));
    if (!n) c.classList.add("dim");
    slots.append(c);
  }

  /** @param {string} label @param {"rarity" | "effect"} key @param {[string, string][]} options */
  const picker = (label, key, options) => {
    const sel = /** @type {HTMLSelectElement} */ (el("select", "own-select"));
    sel.append(Object.assign(el("option", "", "any"), { value: "" }));
    for (const [value, text] of options) sel.append(Object.assign(el("option", "", text), { value }));
    sel.value = ownFilter[key];
    sel.addEventListener("change", () => {
      ownFilter[key] = sel.value;
      sel.blur(); // let live updates redraw again
      redraw();
    });
    const wrap = el("label", "own-pick dim", `${label} `);
    wrap.append(sel);
    return wrap;
  };
  // SORT: highest first by one stat (the trade-off is a minus, so it isn't offered).
  const sorter = /** @type {HTMLSelectElement} */ (el("select", "own-select"));
  sorter.setAttribute("aria-label", "sort your equipment");
  sorter.append(Object.assign(el("option", "", "rarity"), { value: "" }),
    Object.assign(el("option", "", "newest first"), { value: "new" }));
  for (const [k, label] of EFFECT_FILTERS) {
    if (k !== "dmg_pct") sorter.append(Object.assign(el("option", "", `${label} high-low`), { value: k }));
  }
  sorter.value = ownSort;
  sorter.addEventListener("change", () => {
    ownSort = sorter.value;
    try {
      localStorage.setItem(SORT_KEY, ownSort);
    } catch {
      /* ignore */
    }
    sorter.blur();
    redraw();
  });
  const sortWrap = el("label", "own-pick dim", "SORT ");
  sortWrap.append(sorter);
  const selects = el("div", "own-picks");
  selects.append(
    picker("RARITY", "rarity", content.rarities.map((/** @type {any} */ r) => [r.id, r.label])),
    picker("EFFECT", "effect", EFFECT_FILTERS.filter(([k]) => owned.some((o) => hasEffect(o.item, k)))
      .map(([k, label]) => [k, label])),
    sortWrap,
  );
  if (ownFilter.slot || ownFilter.rarity || ownFilter.effect) {
    const clear = el("button", "inline-btn", "[ CLEAR ]");
    clear.addEventListener("click", () => {
      Object.assign(ownFilter, { slot: "", rarity: "", effect: "" });
      redraw();
    });
    selects.append(clear);
  }

  const list = el("div", "own-list");
  if (!owned.length) list.append(el("div", "dim bag-note", "> nothing yet. loot drops from attacks and boxes."));
  else if (!shown.length) list.append(el("div", "dim bag-note", "> none of yours match these filters."));
  for (const { item, count, locked } of shown) {
    const row = /** @type {HTMLButtonElement} */ (el("button", "own-row"));
    row.type = "button";
    const slot = el("span", "own-slot dim", isWorn(me, item.id) ? `${item.slot.toUpperCase()} :: WORN` : item.slot.toUpperCase());
    if (locked) {
      const tag = el("span", "own-locked", "[ LOCKED ] ");
      tag.title = "locked: can't be sold, and auto-sell keeps new copies";
      slot.prepend(tag);
    }
    // Your merged copy goes by "RUSTED SWORD [2]" (THE BLACKSMITH).
    row.append(el("span", `own-name r-${item.rarity}`, ownItemOf(item).name + (count > 1 ? ` x${count}` : "")),
      slot, fxSpan(item, me));
    if (isWorn(me, item.id)) row.classList.add("worn");
    row.addEventListener("click", () => itemDetail(item));
    list.append(row);
  }
  const head = el("div", "panel-h own-head", `YOUR EQUIPMENT  ${shown.length} / ${owned.length}`);
  return [head, slots, selects, list];
}

/** An equipment row's effects, green/red against what you wear in that slot.
 * @param {any} item @param {any} me */
function fxSpan(item, me) {
  const span = el("span", "own-fx dim");
  const wornId = wornInSlot(item, me);
  const nodes = compareSpans(ownItemOf(item), wornId ? ownItem(wornId) : null);
  if (nodes.length) span.append(...nodes);
  else span.textContent = "no bonus";
  if (item.ult) span.append(el("span", "own-ult", `  ULT: ${item.ult.name}`)); // tickets #301 #318
  return span;
}

async function openBadgePicker() {
  badgeData = null;
  try {
    badgeData = await api.getMyBadges();
    draft = badgeData.pick;
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    editingBadges = false;
  }
  renderPlayer();
}

/** Which tokens the draft would show (automatic = the first few earned). */
function draftShown() {
  const earned = (badgeData?.earned ?? []).map((/** @type {any} */ b) => b.token);
  return (draft ?? earned).filter((t) => earned.includes(t)).slice(0, badgeData?.max ?? 5);
}

/** @param {string[] | null} pick */
async function saveBadges(pick) {
  if (savingBadges) return;
  savingBadges = true;
  try {
    badgeData = await api.setMyBadges(pick);
    draft = badgeData.pick;
    if (state.me) state.me = { ...state.me, badges: badgeData.shown };
    forgetBadges(state.me?.id);
    editingBadges = false;
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    savingBadges = false;
    renderPlayer();
  }
}

/** Pick which badges show by your name, in order. @param {any} me */
function badgePicker(me) {
  const box = el("div", "badge-picker");
  if (!badgeData) {
    box.append(el("div", "dim", "> loading your badges..."));
    return box;
  }
  const max = badgeData.max ?? 5;
  box.append(el("div", "panel-h", `PICK UP TO ${max} TO SHOW, IN ORDER`));
  if (!badgeData.earned.length) {
    box.append(el("div", "dim bag-note",
      "> none yet. help kill a boss to earn its star. finish #1 on a leaderboard for a gold one. land the final blow for a rainbow one, or the first hit for a V. unlock achievements for a ^."));
    return box;
  }
  const shown = draftShown();
  /** @param {any} b one earned badge -> its pick row */
  const badgeRow = (b) => {
    const at = shown.indexOf(b.token);
    const row = /** @type {HTMLButtonElement} */ (el("button", `badge-row${at >= 0 ? " on" : ""}`));
    row.setAttribute("aria-pressed", String(at >= 0));
    const tag = badgeTag(b.token, null);
    row.append(el("span", "badge-slot", at >= 0 ? `[${at + 1}]` : "[ ]"), " ", ...(tag ? [tag] : []), " ",
      el("span", "badge-title", b.title), el("span", "dim badge-why", `  ${b.lines[0] ?? ""}`));
    row.addEventListener("click", () => {
      const cur = draftShown();
      if (cur.includes(b.token)) draft = cur.filter((t) => t !== b.token);
      else if (cur.length < max) draft = [...cur, b.token];
      else {
        showError(`Up to ${max}. Take one off first.`);
        return;
      }
      renderPlayer();
    });
    return row;
  };
  // Sections, so a long list of bosses doesn't bury the rest.
  const earned = /** @type {any[]} */ (badgeData.earned);
  // Anything that isn't an admin badge or a boss badge is SPECIAL, so a new kind
  // (like the city's #, ticket #348) can't fall out of the picker again.
  const special = earned.filter((b) => b.kind !== "custom" && b.kind !== "boss");
  const given = earned.filter((b) => b.kind === "custom");
  const bosses = earned.filter((b) => b.kind === "boss");
  const list = el("div", "badge-list");
  /** @param {string} title @param {any[]} items */
  const section = (title, items) => {
    if (!items.length) return;
    list.append(el("div", "badge-section-h", title), ...items.map(badgeRow));
  };
  section("SPECIAL", special);
  section("FROM THE ADMIN", given);
  if (bosses.length) {
    const fold = /** @type {HTMLDetailsElement} */ (el("details", "badge-fold"));
    fold.open = bossesOpen;
    fold.addEventListener("toggle", () => (bossesOpen = fold.open));
    const picked = bosses.filter((b) => shown.includes(b.token)).length;
    fold.append(el("summary", "badge-section-h",
      `BOSSES YOU HELPED KILL (${bosses.length})${picked ? `  :: ${picked} picked` : ""}`), ...bosses.map(badgeRow));
    list.append(fold);
  }
  const preview = el("div", "badge-preview");
  // Your clan's brackets (if any) go around them, as everyone sees it.
  const clan = clanIn(me.badges);
  const tag = badgeTag([...shown, ...(clan ? [`C${clan}`] : [])].join("."), null);
  preview.append(el("span", "dim", "PREVIEW  "), ...(tag ? [tag, " "] : [el("span", "dim", "(no badges) ")]), el("span", "", me.name));
  if (draft === null) preview.append(el("span", "dim", "  :: automatic"));
  const actions = el("div", "badge-actions");
  const save = el("button", "inline-btn", "[ SAVE ]");
  save.addEventListener("click", () => saveBadges(draft === null ? null : shown));
  const auto = el("button", "inline-btn", "[ AUTO ]");
  auto.title = "rainbow, then gold, then your ^, then your newest bosses";
  auto.addEventListener("click", () => saveBadges(null));
  const cancel = el("button", "inline-btn", "[ CANCEL ]");
  cancel.addEventListener("click", () => {
    editingBadges = false;
    renderPlayer();
  });
  actions.append(save, auto, cancel);
  box.append(list, preview, actions);
  return box;
}

/** @param {string} current */
function renameForm(current) {
  const { form, input } = nameForm({
    value: current,
    submitLabel: "[ SAVE ]",
    withRoll: true,
    onSaved: () => {
      renaming = false;
      renderPlayer(true);
    },
  });
  requestAnimationFrame(() => input.focus());
  return form;
}
