// [ YOU ] panel: stats, rename, equipped weapon.

import { el, fmt, setArt } from "../ascii.js";
import { itemById, state } from "../store.js";
import { itemLines } from "./fx.js";
import { nameForm } from "./nameform.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

// ----------------------------------------------------------------- player

let renaming = false;

export function renderPlayer() {
  const me = state.me;
  const host = $("panel-player");
  if (!me) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  const equipped = me.equipped ? itemById(me.equipped) : null;
  const rows = [
    ["NAME", me.name],
    ["LEVEL", String(me.level)],
    ["TOTAL DMG", fmt(me.total_damage)],
    ["HITS", fmt(me.total_attacks)],
    ["CRITS", fmt(me.total_crits)],
    ["ATTACKS", `${me.attacks_left} / ${me.attacks_per_day}`],
    ["ULTIMATE", me.ultimate_available ? "READY" : me.ultimate_used ? "SPENT" : "--"],
    ["ITEMS FOUND", fmt(me.items_found)],
    ["BOSSES", `${me.bosses_participated} fought / ${me.bosses_defeated} slain`],
    ["WEAPON", equipped ? equipped.name : "BARE HANDS"],
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
  nameRow.append(renameBtn);

  const parts = [head, table];
  if (renaming) parts.push(renameForm(me.name));
  const eq = el("div", "equipped-box");
  if (equipped) {
    const pre = el("pre", `art r-${equipped.rarity}`);
    eq.append(pre);
    parts.push(eq);
    requestAnimationFrame(() => setArt(pre, itemLines(equipped, { width: 26, equipped: true }), 12));
    eq.append(bonusLine(equipped));
  } else {
    eq.append(el("div", "dim", "> no weapon equipped. loot drops from attacks. check [ BAG ]."));
    parts.push(eq);
  }
  host.replaceChildren(...parts);
}

/** @param {string} current */
function renameForm(current) {
  const { form, input } = nameForm({
    value: current,
    submitLabel: "[ SAVE ]",
    withRoll: true,
    onSaved: () => {
      renaming = false;
      renderPlayer();
    },
  });
  requestAnimationFrame(() => input.focus());
  return form;
}

/** Weapon bonuses as text. @param {any} item */
export function bonusLine(item) {
  const m = item.mods;
  const parts = [];
  if (m.min_dmg) parts.push(`+${m.min_dmg} MIN`);
  if (m.max_dmg) parts.push(`+${m.max_dmg} MAX`);
  if (m.crit_chance) parts.push(`+${(m.crit_chance * 100).toFixed(2).replace(/\.?0+$/, "")}% CRIT`);
  if (m.loot_mult > 1) parts.push(`+${Math.round((m.loot_mult - 1) * 100)}% LOOT`);
  return el("div", "stats", parts.length ? parts.join("  ") : "NO BONUS. JUST VIBES.");
}
