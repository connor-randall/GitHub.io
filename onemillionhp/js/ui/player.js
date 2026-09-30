// [ YOU ] panel: stats, rename, equipped weapon.

import * as api from "../api.js?v=b7420735b5";
import { el, fmt, setArt } from "../ascii.js?v=b7420735b5";
import { emit, itemById, state } from "../store.js?v=b7420735b5";
import { badgeTag, forgetBadges } from "./badges.js?v=b7420735b5";
import { effectLine } from "./effects.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";
import { itemLines } from "./fx.js?v=b7420735b5";
import { nameForm } from "./nameform.js?v=b7420735b5";
import { saveSection } from "./save.js?v=b7420735b5";

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
    ["BADGES", ""],
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
  nameRow.append(renameBtn);
  // Your name as others see it, with the stars in front.
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
  parts.push(eq, saveSection(renderPlayer));
  host.replaceChildren(...parts);
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
      "> none yet. help kill a boss to earn its star. finish #1 on a leaderboard for a gold one. land the final blow for a rainbow one."));
    return box;
  }
  const shown = draftShown();
  const list = el("div", "badge-list");
  for (const b of badgeData.earned) {
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
    list.append(row);
  }
  const preview = el("div", "badge-preview");
  const tag = badgeTag(shown.join("."), null);
  preview.append(el("span", "dim", "PREVIEW  "), ...(tag ? [tag, " "] : [el("span", "dim", "(no badges) ")]), el("span", "", me.name));
  if (draft === null) preview.append(el("span", "dim", "  :: automatic"));
  const actions = el("div", "badge-actions");
  const save = el("button", "inline-btn", "[ SAVE ]");
  save.addEventListener("click", () => saveBadges(draft === null ? null : shown));
  const auto = el("button", "inline-btn", "[ AUTO ]");
  auto.title = "rainbow, then gold, then your newest bosses";
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
      renderPlayer();
    },
  });
  requestAnimationFrame(() => input.focus());
  return form;
}
