// Saved loadouts: 3 snapshots of everything you wear. Saved and named in
// YOU -> INVENTORY; worn with one tap there or from the FIGHT box.

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { emit, ownItem, state } from "../store.js?v=b6664395f3";
import { effectParts } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { popup } from "./fx.js?v=b6664395f3";

let busy = false;
/** Which row is being renamed (-1 = none) and which save is armed (overwrite check). */
let renamingAt = -1;
let armedAt = -1;
/** Ticket #182: the loadout whose [ CLEAR ] was clicked once (a second click clears it). */
let clearArmedAt = -1;
/** What's typed in the rename box: kept here so a redraw (the profile redraws on
 * every update, e.g. each attack recharging) doesn't wipe it. Null = not started. */
let draft = /** @type {string | null} */ (null);
/** Ticket #131: which two saved loadouts are side by side (null: the comparison is closed). */
let compare = /** @type {[number, number] | null} */ (null);

/** Which saved loadouts (1-3) have this item in them. @param {string} itemId @returns {number[]} */
export function loadoutsWith(itemId) {
  return (state.me?.loadouts ?? []).flatMap((/** @type {any} */ lo, /** @type {number} */ i) =>
    (lo && Object.values(lo.worn ?? {}).includes(itemId) ? [i + 1] : []));
}

/** "L1 L3" for an item's tag, or "" if it's in no loadout. @param {string} itemId */
export const loadoutTag = (itemId) => loadoutsWith(itemId).map((n) => `L${n}`).join(" ");

/** Is this saved loadout exactly what you're wearing? @param {any} lo */
function isWearing(lo) {
  const worn = state.me?.worn ?? {};
  return Boolean(lo) && Object.entries(lo.worn ?? {}).every(([slot, id]) => (worn[slot] ?? null) === (id ?? null));
}

/** @param {"save" | "wear" | "rename" | "clear"} action @param {number} index @param {string} [name] */
async function act(action, index, name) {
  if (busy) return;
  busy = true;
  try {
    const res = await api.loadout(action, index, name);
    state.me = res.me;
    emit("me");
    const lo = res.me.loadouts?.[index];
    if (action === "wear") {
      sound.loot();
      popup(`WEARING ${lo?.name ?? "LOADOUT"}`, "proc");
      if (res.missing?.length) showError(`Not in your bag any more: ${res.missing.join(", ")}`);
    } else if (action === "save") popup(`SAVED ${lo?.name ?? "LOADOUT"}`, "proc");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    emit("me");
  }
}

/** Number keys (controls.js): wear saved loadout ``index`` unless it's empty
 * or already worn. @param {number} index */
export function wearLoadout(index) {
  const lo = state.me?.loadouts?.[index];
  if (!lo || isWearing(lo) || busy) return;
  act("wear", index);
}

/** One-tap swap buttons in the FIGHT box (only once something is saved). */
export function renderLoadoutQuick() {
  const host = document.getElementById("loadout-quick");
  if (!host) return;
  const saved = state.me?.loadouts ?? [];
  if (!saved.some(Boolean)) {
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const btns = saved.map((/** @type {any} */ lo, /** @type {number} */ i) => {
    if (!lo) return null;
    const on = isWearing(lo);
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn loadout-btn${on ? " on" : ""}`,
      `[${i + 1}:${lo.name}]`));
    b.type = "button";
    b.disabled = busy || on;
    b.title = on ? "wearing it" : `wear ${lo.name} (or press ${i + 1})`;
    b.addEventListener("click", () => act("wear", i));
    return b;
  }).filter((b) => b !== null);
  host.replaceChildren(el("span", "dim", "LOADOUT "), ...btns);
}

/** The LOADOUTS section of YOU -> INVENTORY. @param {() => void} rerender */
export function loadoutSection(rerender) {
  const me = state.me;
  const wrap = el("div", "loadouts");
  wrap.append(el("div", "panel-h", "LOADOUTS  ::  SAVE WHAT YOU WEAR, SWAP IN ONE TAP"));
  const saved = me?.loadouts ?? [null, null, null];
  // Ticket #117: every saved slot plus the first empty one, not a column of
  // "(empty)" rows. Slots keep their numbers (the number keys wear them).
  const next = saved.findIndex((/** @type {any} */ lo) => !lo);
  saved.forEach((/** @type {any} */ lo, /** @type {number} */ i) => {
    if (!lo && i !== next) return;
    const row = el("div", `loadout-row${isWearing(lo) ? " on" : ""}`);
    const label = el("div", "loadout-name");
    if (renamingAt === i) {
      const input = /** @type {HTMLInputElement} */ (el("input", "loadout-input"));
      input.maxLength = 16;
      input.placeholder = `LOADOUT ${i + 1}`;
      const fresh = draft === null;
      input.value = draft ?? lo?.name ?? "";
      input.addEventListener("input", () => {
        draft = input.value;
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveName(i, lo, input.value, rerender);
        else if (e.key === "Escape") stopRenaming(rerender);
      });
      label.append(el("span", "", `${i + 1}. `), input);
      setTimeout(() => {
        input.focus();
        // First time: the old name is selected, so typing replaces it. After a redraw: carry on typing.
        if (fresh) input.select();
        else input.setSelectionRange(input.value.length, input.value.length);
      }, 0);
    } else {
      label.append(el("b", "", `${i + 1}. ${lo ? lo.name : "(empty)"}`));
      if (isWearing(lo)) label.append(el("span", "loadout-wearing", "  < WEARING"));
    }
    const items = lo ? Object.values(lo.worn ?? {}).filter(Boolean).map((id) => ownItem(String(id))).filter(Boolean) : []; // your refined copies (#266)
    const sum = lo ? summarize(items) : "save what you're wearing now into this slot";
    const btns = el("div", "loadout-btns");
    /** @param {string} text @param {() => void} fn @param {boolean} [danger] */
    const btn = (text, fn, danger = false) => {
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${danger ? " danger" : ""}`, text));
      b.type = "button";
      b.disabled = busy;
      b.addEventListener("click", fn);
      btns.append(b);
    };
    if (renamingAt === i) {
      // Renaming: just save / cancel (Enter and Esc do the same).
      btn("[ SAVE NAME ]", () => {
        const input = /** @type {HTMLInputElement | null} */ (row.querySelector(".loadout-input"));
        saveName(i, lo, input?.value ?? draft ?? "", rerender);
      });
      btn("[ CANCEL ]", () => stopRenaming(rerender));
      row.append(label, el("div", "dim loadout-sum", sum), btns);
      wrap.append(row);
      return;
    }
    if (lo && !isWearing(lo)) btn("[ WEAR ]", () => act("wear", i).then(rerender));
    btn(armedAt === i ? "[ SURE? OVERWRITE ]" : lo ? "[ SAVE CURRENT HERE ]" : "[ SAVE CURRENT ]", () => {
      if (lo && armedAt !== i) {
        armedAt = i;
        rerender();
        setTimeout(() => {
          if (armedAt === i) {
            armedAt = -1;
            rerender();
          }
        }, 3000);
        return;
      }
      armedAt = -1;
      act("save", i).then(rerender);
    }, armedAt === i);
    if (lo) {
      btn("[ RENAME ]", () => {
        renamingAt = i;
        draft = null;
        rerender();
      });
      btn(clearArmedAt === i ? "[ SURE? CLEAR IT ]" : "[ CLEAR ]", () => {
        if (clearArmedAt !== i) {
          clearArmedAt = i;
          rerender();
          setTimeout(() => {
            if (clearArmedAt === i) {
              clearArmedAt = -1;
              rerender();
            }
          }, 3000);
          return;
        }
        clearArmedAt = -1;
        act("clear", i).then(rerender);
      }, clearArmedAt === i);
    }
    row.append(label, el("div", "dim loadout-sum", sum), btns);
    wrap.append(row);
  });
  if (saved.filter(Boolean).length >= 2) wrap.append(compareSection(saved, rerender));
  return wrap;
}

// Every stat, always listed (a dash where neither has it), in the order a player reads gear.
const COMPARE_STATS = /** @type {[string, string, (v: number) => string][]} */ ([
  ["min_dmg", "MIN DAMAGE", (v) => `+${v}`], ["max_dmg", "MAX DAMAGE", (v) => `+${v}`],
  ["dmg_pct", "DAMAGE", (v) => pct(v)], ["crit_chance", "CRIT CHANCE", (v) => pct(v)],
  ["crit_dmg", "CRIT DAMAGE", (v) => pct(v)], ["double_strike", "DOUBLE STRIKE", (v) => pct(v)],
  ["executioner", "FINAL PHASE", (v) => pct(v)], ["opener", "ABOVE HALF", (v) => pct(v)],
  ["surge", "DURING EVENTS", (v) => pct(v)], ["save_attack", "FREE ATTACK", (v) => pct(v)],
  ["ult_refund", "ULT REFUND", (v) => pct(v)], ["loot_mult", "LOOT", (v) => `x${v.toFixed(2)}`],
  ["box_find", "BOX FIND", (v) => pct(v)],
]);
const pct = (/** @type {number} */ v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** Two saved loadouts, stat by stat, with the difference. @param {any[]} saved @param {() => void} rerender */
function compareSection(saved, rerender) {
  const box = el("div", "loadout-compare");
  const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", compare ? "[ CLOSE COMPARE ]" : "[ COMPARE LOADOUTS ]"));
  open.type = "button";
  open.addEventListener("click", () => {
    const filled = saved.flatMap((lo, i) => (lo ? [i] : []));
    compare = compare ? null : [filled[0], filled[1]];
    rerender();
  });
  box.append(open);
  if (!compare) return box;
  const pair = compare;
  [0, 1].forEach((side) => {
    const line = el("div", "loadout-compare-pick");
    line.append(el("span", "dim", side ? "B: " : "A: "));
    saved.forEach((lo, i) => {
      if (!lo) return;
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${pair[side] === i ? " on" : ""}`, `[${i + 1}:${lo.name}]`));
      b.type = "button";
      b.addEventListener("click", () => {
        pair[side] = i;
        rerender();
      });
      line.append(b);
    });
    box.append(line);
  });
  const of = (/** @type {number} */ i) =>
    totals(Object.values(saved[i]?.worn ?? {}).filter(Boolean).map((id) => ownItem(String(id))).filter(Boolean));
  const [a, b] = [of(pair[0]), of(pair[1])];
  const table = el("pre", "loadout-compare-table");
  const cell = (/** @type {string} */ s, /** @type {number} */ w) => s.padStart(w);
  table.append(`${"".padEnd(14)}${cell("A", 9)}${cell("B", 9)}${cell("B-A", 9)}\n`);
  for (const [key, label, show] of COMPARE_STATS) {
    const none = key === "loot_mult" ? 1 : 0;
    const [x, y] = [a[key] ?? none, b[key] ?? none];
    const has = (/** @type {number} */ v) => (v === none ? "-" : show(v));
    const delta = y - x;
    const same = Math.abs(delta) < 1e-9;
    const diff = el("span", same ? "dim" : delta > 0 ? "fx-better" : "fx-worse",
      cell(same ? "-" : key === "loot_mult" ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}` : show(delta).replace(/^\+?-?/, delta > 0 ? "+" : "-"), 9));
    table.append(`${label.padEnd(14)}${cell(has(x), 9)}${cell(has(y), 9)}`, diff, "\n");
  }
  box.append(table);
  return box;
}

/** @param {(() => void)} rerender */
function stopRenaming(rerender) {
  renamingAt = -1;
  draft = null;
  rerender();
}

/** Save the typed name (blank or unchanged = nothing to do). @param {number} i @param {any} lo
 * @param {string} name @param {() => void} rerender */
function saveName(i, lo, name, rerender) {
  const typed = name.trim();
  renamingAt = -1;
  draft = null;
  if (!lo || !typed || typed.toUpperCase() === lo.name) {
    rerender();
    return;
  }
  act("rename", i, typed).then(() => {
    const now = state.me?.loadouts?.[i];
    if (now) popup(`RENAMED ${now.name}`, "proc");
    rerender();
  });
}

/** "8 ITEMS :: +25% DAMAGE :: +30% DMG IN FINAL PHASE ..." (the loadout's headline stats). @param {any[]} items */
function summarize(items) {
  if (!items.length) return "nothing worn";
  const total = totals(items);
  // Lead with what makes a set different (trade-offs, situational damage, luck), not the basics.
  const order = ["DAMAGE", "FINAL PHASE", "ABOVE HALF", "DURING EVENTS", "LOOT", "BOX FIND", "FREE ATTACK", "CRIT DMG"];
  const rank = (/** @type {string} */ part) => {
    const i = order.findIndex((k) => part.endsWith(k) || part.includes(k));
    return i < 0 ? order.length : i;
  };
  const parts = effectParts(total).sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  const charm = items.find((it) => it.ult); // ticket #318: the loadout's ult up front
  if (charm) parts.unshift(`ULT: ${charm.ult.name}`);
  return `${items.length} ITEM${items.length === 1 ? "" : "S"}${parts.length ? "  ::  " + parts.join("  ::  ") : ""}`;
}

/** What a set of items adds up to, worn. @param {any[]} items @returns {Record<string, number>} */
function totals(items) {
  /** @type {Record<string, number>} */
  const total = {};
  for (const it of items) {
    for (const [k, v] of Object.entries(it.mods ?? {})) {
      if (k === "loot_mult") total[k] = (total[k] ?? 1) * Number(v);
      else total[k] = (total[k] ?? 0) + Number(v);
    }
  }
  // The same limits the server puts on worn totals (content.cap_gear): damage, free attacks and
  // the loot floor. Loot and box find have no ceiling.
  if (total.dmg_pct) total.dmg_pct = Math.max(-0.5, Math.min(0.5, total.dmg_pct));
  if (total.loot_mult) total.loot_mult = Math.max(0.3, total.loot_mult);
  if (total.save_attack) total.save_attack = Math.min(0.25, total.save_attack);
  return total;
}
