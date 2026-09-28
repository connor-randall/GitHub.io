// [ YOU ] panel: stats, rename, equipped weapon.

import { el, fmt, setArt } from "../ascii.js?v=fc1e041948";
import { itemById, state } from "../store.js?v=fc1e041948";
import { effectLine } from "./effects.js?v=fc1e041948";
import { itemLines } from "./fx.js?v=fc1e041948";
import { nameForm } from "./nameform.js?v=fc1e041948";

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
  const charm = me.equipped_charm ? itemById(me.equipped_charm) : null;
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
    ["CHARM", charm ? charm.name : "NONE"],
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
  nameRow.append(renameBtn);

  const parts = [head, table];
  if (renaming) parts.push(renameForm(me.name));
  const eq = el("div", "equipped-box eq-pair");
  for (const item of [equipped, charm]) {
    if (!item) continue;
    const cell = el("div", "eq-cell");
    const pre = el("pre", `art r-${item.rarity}`);
    cell.append(pre, effectLine(item));
    eq.append(cell);
    requestAnimationFrame(() => setArt(pre, itemLines(item, { width: 24, equipped: true }), 11));
  }
  if (!equipped && !charm) eq.append(el("div", "dim", "> nothing equipped. loot drops from attacks and boxes. check [ BAG ]."));
  parts.push(eq);
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
