// Admin panel. Every button is a <form data-action="..."> whose inputs become
// the action's parameters; the server validates everything.

import { API_BASE, getContent } from "./api.js?v=b6664395f3";
import { forwardToCanonical } from "./home.js?v=b6664395f3";
import { ago, duration, el, fmt, padR, setArt } from "./ascii.js?v=b6664395f3";
import { rarityById, SCROLLS, state } from "./store.js?v=b6664395f3";
import { EFFECT_FILTERS, EQUIP_SLOTS, effectParts, hasEffect, matchesFilter } from "./ui/effects.js?v=b6664395f3";
import { itemLines } from "./ui/fx.js?v=b6664395f3";
import { paintLook } from "./ui/badges.js?v=b6664395f3";
import { goTo, initNav, updateNeeds } from "./admin-nav.js?v=b6664395f3";
import { initGeo, loadGeo } from "./admin-geo.js?v=b6664395f3";
import { initPlayer, playerLink, refillPlayerBoxes } from "./admin-player.js?v=b6664395f3";

const KEY = "omhp.admin";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Whether actions should be announced in the public feed as ***ADMIN***. */
const announcing = () => /** @type {HTMLInputElement} */ ($("announce")).checked;

function session() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
/** @param {string} t */
function setSession(t) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** @param {string} path @param {unknown} [body] @returns {Promise<any>} */
async function call(path, body) {
  const res = await fetch(API_BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Session": session() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error("Server unreachable.");
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) showLogin();
  if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
  return data;
}

/** The control the admin last pressed, and when: a result lands next to it. */
let lastPressed = /** @type {{node: Element, at: number} | null} */ (null);
let toastTimer = 0;

/** Where a result goes: the form (or row) around the control that was pressed. @param {Element} node */
function resultHost(node) {
  return node.closest("form, .ticket-admin, .appeal, .report-group, .boss-design-card, tr, .gal-row, li, .suspect-bar")
    ?? node.parentElement;
}

/** A result: next to what was clicked (when it's still on screen), in the bar
 * at the bottom, and in the ACTION LOG. Every result used to go only to the
 * log at the very bottom of the page, thousands of px from the button.
 * @param {string} msg @param {boolean} ok */
function log(msg, ok) {
  const li = el("li", ok ? "ok" : "bad", `${new Date().toLocaleTimeString()}  > ${msg}`);
  $("log").prepend(li);
  const toast = $("adm-toast");
  toast.className = `adm-toast ${ok ? "ok" : "bad"}`;
  toast.textContent = `> ${msg}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), ok ? 6000 : 10000);
  const p = lastPressed;
  if (!p || Date.now() - p.at > 15000 || !p.node.isConnected) return;
  const host = resultHost(p.node);
  if (!host) return;
  if (host.tagName === "TR") { // a table row: under it, across the table
    let next = /** @type {HTMLElement | null} */ (host.nextElementSibling);
    if (!next?.classList.contains("adm-result-row")) {
      next = el("tr", "adm-result-row");
      const td = /** @type {HTMLTableCellElement} */ (el("td"));
      td.colSpan = 40;
      next.append(td);
      host.after(next);
    }
    /** @type {HTMLElement} */ (next.firstChild).className = `adm-result ${ok ? "ok" : "bad"}`;
    /** @type {HTMLElement} */ (next.firstChild).textContent = `> ${msg}`;
    return;
  }
  let r = /** @type {HTMLElement | null} */ (host.querySelector(":scope > .adm-result"));
  if (!r) {
    r = el("div", "adm-result");
    host.append(r);
  }
  r.className = `adm-result ${ok ? "ok" : "bad"}`;
  r.textContent = `> ${msg}`;
}

// Remember what was pressed (buttons, toggles, selects), for log() above.
document.addEventListener("click", (e) => {
  const node = /** @type {Element} */ (e.target).closest?.("button, input[type=checkbox], select, summary");
  if (node && !node.closest("#admin-tabs, .admin-tools, #adm-toast")) lastPressed = { node, at: Date.now() };
}, true);
document.addEventListener("submit", (e) => {
  lastPressed = { node: /** @type {Element} */ (e.target), at: Date.now() };
}, true);

/** @param {number} p */
const pct = (p) => `${(p * 100).toFixed(p >= 0.01 ? 2 : p >= 0.0001 ? 4 : 5)}%`;

/** A number input for the odds table. @param {number} value @param {string} step */
function oddsInput(value, step) {
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "number";
  input.min = "0";
  input.step = step;
  input.value = String(value);
  input.dataset.orig = input.value;
  input.addEventListener("input", () => input.classList.toggle("changed", input.value !== input.dataset.orig));
  return input;
}

/** @param {string} label @param {string} now @param {Node[]} [edit] */
function oddsRow(label, now, edit = []) {
  const row = el("div", "odds-row");
  row.append(el("span", "odds-what", label), el("span", "odds-now", now), el("span", "odds-set"));
  /** @type {HTMLElement} */ (row.lastChild).append(...edit);
  return row;
}

/** [x] / [ ] in front of a loot box reward: switch it off or on right away
 * (the others share its chance in proportion). @param {any} b @param {any} r */
function boxRowToggle(b, r) {
  const t = /** @type {HTMLButtonElement} */ (el("button", "odds-toggle", r.off ? "[ ]" : "[x]"));
  if (r.locked) {
    t.disabled = true;
    t.title = "No scroll is switched on (SCROLLS above), so chests can't give one.";
    return t;
  }
  t.type = "button";
  t.setAttribute("aria-pressed", String(!r.off));
  t.title = r.off ? "switched off: never rolled. click to switch back on" : "click to stop this being rolled";
  t.addEventListener("click", async () => {
    t.disabled = true;
    try {
      const res = await call("/api/admin/action",
        { action: "set_box_row", box_id: b.id, row: r.row, on: Boolean(r.off), announce: announcing() });
      log(res.message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
      t.disabled = false;
    }
  });
  return t;
}

/** [x] / [ ] in front of a scroll: can it drop (and come out of chests)?
 * @param {{id: string, on: boolean}} sc */
function scrollToggle(sc) {
  const t = /** @type {HTMLButtonElement} */ (el("button", "odds-toggle", sc.on ? "[x]" : "[ ]"));
  t.type = "button";
  t.setAttribute("aria-pressed", String(sc.on));
  t.title = sc.on ? "click to stop this scroll dropping" : "click to let this scroll drop";
  t.addEventListener("click", async () => {
    t.disabled = true;
    try {
      log((await call("/api/admin/action",
        { action: "set_scrolls", scroll_id: sc.id, on: !sc.on, announce: announcing() })).message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
      t.disabled = false;
    }
  });
  return t;
}

/** [x] / [ ] in front of an EVERY ATTACK row: off = never from an attack
 * (its 1 in N is kept for when it comes back). @param {any} r */
function attackRowToggle(r) {
  const t = /** @type {HTMLButtonElement} */ (el("button", "odds-toggle", r.off ? "[ ]" : "[x]"));
  t.type = "button";
  t.setAttribute("aria-pressed", String(!r.off));
  t.title = r.off ? "switched off: attacks never roll this. click to switch back on" : "click to stop attacks rolling this";
  t.addEventListener("click", async () => {
    t.disabled = true;
    try {
      log((await call("/api/admin/action",
        { action: "set_attack_row", key: r.key, on: Boolean(r.off), announce: announcing() })).message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
      t.disabled = false;
    }
  });
  return t;
}

/** Which loot boxes are unfolded in [ ODDS ], kept across redraws. */
const openOddsBoxes = new Set();

/** The editable [ ODDS ] table. @param {any} o */
function renderOdds(o) {
  const host = $("odds");
  /** @type {Array<() => void>} */
  const collect = [];
  /** @type {Record<string, any>} */
  let changes = {};
  const parts = [el("div", "odds-h", "EVERY ATTACK (each rolled separately)")];
  for (const r of o.per_attack) {
    const now = `${pct(r.chance)}  ${r.one_in}`;
    if (!r.key) {
      parts.push(oddsRow(r.what.toUpperCase(), now, [el("span", "dim", "(adds up the rarities below)")]));
      continue;
    }
    const input = oddsInput(r.base, "any");
    collect.push(() => {
      if (input.value === input.dataset.orig) return;
      const n = Number(input.value);
      if (r.key === "crit") changes.crit_one_in = n;
      else if (r.key === "box") changes.box_one_in = n;
      else if (r.key === "scroll") changes.scroll_one_in = n;
      else (changes.rarity_one_in ??= {})[r.key.slice(7)] = n;
    });
    const row = oddsRow(r.what.toUpperCase(), r.off ? "off" : now,
      [el("span", "dim", "1 in "), input, ...(r.note ? [el("span", "dim", `  (${r.note})`)] : [])]);
    row.classList.toggle("odds-off", Boolean(r.off));
    row.firstElementChild?.prepend(attackRowToggle(r), " ");
    parts.push(row);
  }
  parts.push(el("div", "hint", "[ ] = attacks never roll it (chests still can). the 1 in N is kept for when you " +
    "tick it again. crit off also stops gear crit; loot-box crit charges still work."));
  const m = o.mults;
  if (m.loot !== 1 || m.box !== 1)
    parts.push(el("div", "hint", `"now" includes ITEM DROPS x${m.loot} and LOOT BOXES x${m.box} from RULES; the 1 in N you type is before those.`));

  // Scrolls: one switch each. All off = no scroll drops and chests skip them.
  const sc = o.scrolls;
  const onCount = sc.list.filter((/** @type {any} */ s) => s.on).length;
  parts.push(el("div", "odds-h", `SCROLLS  ${onCount ? `${onCount} of ${sc.list.length} on` : "all off"}` +
    (onCount && !sc.attacks ? "  (chests only: ANY SCROLL is off above)" : "")));
  for (const s of sc.list) {
    const now = !s.on ? "off" : sc.attacks ? `${pct(s.chance)}  ${s.one_in}` : "chests only";
    const row = oddsRow(SCROLLS[s.id]?.name ?? s.id.toUpperCase(), now);
    row.classList.toggle("odds-off", !s.on);
    row.firstElementChild?.prepend(scrollToggle(s), " ");
    parts.push(row);
  }
  parts.push(el("div", "hint", "tick a scroll to let it come out of chests, and drop from attacks while ANY SCROLL " +
    "is ticked above (that chance is shared between the ticked scrolls). gifting from ITEMS & BOXES works either way."));

  parts.push(el("div", "odds-h", "LOOT BOXES (click one to see and edit what's inside)"));
  for (const b of o.boxes) {
    const fold = /** @type {HTMLDetailsElement} */ (el("details", "odds-box"));
    fold.open = openOddsBoxes.has(b.id);
    fold.addEventListener("toggle", () => (fold.open ? openOddsBoxes.add(b.id) : openOddsBoxes.delete(b.id)));
    const sum = el("summary", "odds-h");
    sum.append(`${b.name}  `, el("span", "dim",
      `${pct(b.chance)} of attacks (${b.one_in})  ::  ${Math.round(b.share * 1000) / 10}% of boxes`));
    fold.append(sum);
    const share = oddsInput(Math.round(b.share * 10000) / 100, "any");
    collect.push(() => {
      if (share.value !== share.dataset.orig) (changes.box_pick ??= {})[b.id] = Number(share.value);
    });
    fold.append(oddsRow("SHARE OF BOXES", "", [share, el("span", "dim", " %")]));
    const rows = b.rewards.map((/** @type {any} */ r) => {
      // The % box edits this reward's share with nothing switched off, so a
      // switched-off one keeps its number for when it comes back on.
      const input = oddsInput(Number(((r.base ?? r.chance) * 100).toFixed(6)), "any");
      input.disabled = Boolean(r.off);
      const row = oddsRow(r.what.toUpperCase(), r.off ? "off" : pct(r.chance), [input, el("span", "dim", " %")]);
      row.classList.toggle("odds-off", Boolean(r.off));
      row.firstElementChild?.prepend(boxRowToggle(b, r), " ");
      if (r.locked) row.lastElementChild?.append(el("span", "dim", "  (tick a scroll in SCROLLS above to unlock)"));
      fold.append(row);
      return input;
    });
    collect.push(() => {
      if (rows.some((i) => i.value !== i.dataset.orig)) (changes.box_rewards ??= {})[b.id] = rows.map((i) => Number(i.value));
    });
    parts.push(fold);
  }
  const actions = el("div", "odds-actions");
  const save = el("button", "inline-btn", "[ SAVE ODDS ]");
  save.addEventListener("click", async () => {
    changes = {};
    collect.forEach((f) => f());
    if (!Object.keys(changes).length) {
      log("Nothing changed: edit a number first.", false);
      return;
    }
    try {
      log((await call("/api/admin/action", { action: "set_odds", ...changes, announce: announcing() })).message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
  const reset = el("button", "inline-btn danger", "[ RESET TO DEFAULTS ]");
  reset.addEventListener("click", () => {
    const form = /** @type {HTMLFormElement} */ (el("form"));
    submit(form, "reset_odds", reset);
  });
  actions.append(save, reset, el("span", "hint", o.edited ? " odds are CUSTOM right now" : " odds are the defaults"));
  const d = o.damage;
  parts.push(actions, el("div", "hint",
    `DAMAGE  hit ${d.hit[0]}-${d.hit[1]}  crit ${d.crit[0]}-${d.crit[1]}  ultimate ${d.ultimate[0]}-${d.ultimate[1]}  ::  ` +
    `SHOP PAYS ${Object.entries(o.shop.sell).map(([k, v]) => `${k} ${v}`).join(", ")}  ::  ` +
    `BOXES COST ${o.boxes.map((/** @type {any} */ b) => `${b.name.toLowerCase()} ${o.shop.boxes[b.id] ?? "-"}`).join(", ")}`));
  host.replaceChildren(...parts);
}

function showLogin() {
  $("login").hidden = false;
  $("panel").hidden = true;
  $("logout").hidden = true;
  setSession("");
  $("passcode").focus();
}

/** @type {any} */
let ov = null;

const DESIGN_TINTS = {
  amber: "#ffb000", red: "#ff6e62", green: "#75e36d",
  cyan: "#8bdcff", purple: "#dc8cff", white: "#f0eadc",
};

/** @param {string} submissionId @param {string} decision */
function reviewDesignForm(submissionId, decision) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const submission = /** @type {HTMLInputElement} */ (el("input"));
  submission.type = "hidden";
  submission.name = "submission_id";
  submission.value = submissionId;
  const choice = /** @type {HTMLInputElement} */ (el("input"));
  choice.type = "hidden";
  choice.name = "decision";
  choice.value = decision;
  const button = el("button", `inline-btn${decision === "deny" ? " danger" : ""}`,
    decision === "approve" ? "[ APPROVE + QUEUE ]" : "[ DENY ]");
  form.append(submission, choice, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "review_boss_design", button);
  });
  return form;
}

/** [ GO TO VOTE ]: the players decide this one (24 h, designvote.py). @param {string} submissionId */
function sendToVoteForm(submissionId) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const submission = /** @type {HTMLInputElement} */ (el("input"));
  submission.type = "hidden";
  submission.name = "submission_id";
  submission.value = submissionId;
  const button = el("button", "inline-btn", "[ GO TO VOTE ]");
  form.append(submission, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "send_design_to_vote", button);
  });
  return form;
}

/** @param {string} bossId */
function reuseBossForm(bossId) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "hidden";
  input.name = "boss_id";
  input.value = bossId;
  const button = el("button", "inline-btn", "[ QUEUE AGAIN ]");
  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "reuse_community_boss", button);
  });
  return form;
}

/** @param {string} entryId @param {string} direction @param {boolean} disabled */
function moveBossForm(entryId, direction, disabled) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const id = /** @type {HTMLInputElement} */ (el("input"));
  id.type = "hidden";
  id.name = "entry_id";
  id.value = entryId;
  const move = /** @type {HTMLInputElement} */ (el("input"));
  move.type = "hidden";
  move.name = "direction";
  move.value = direction;
  const button = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
    direction === "up" ? "[ UP ]" : "[ DOWN ]"));
  button.disabled = disabled;
  form.append(id, move, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "move_boss_queue_entry", button);
  });
  return form;
}

/** @param {any[]} choices */
function addBossForm(choices) {
  const form = /** @type {HTMLFormElement} */ (el("form", "boss-queue-add"));
  const boss = /** @type {HTMLSelectElement} */ (el("select"));
  boss.name = "boss_id";
  for (const choice of choices) {
    const label = choice.community
      ? `${choice.name} :: COMMUNITY BY ${choice.creator_name}` : `${choice.name} :: BUILT-IN`;
    const option = /** @type {HTMLOptionElement} */ (el("option", "", label));
    option.value = choice.id;
    boss.append(option);
  }
  const position = /** @type {HTMLSelectElement} */ (el("select"));
  position.name = "position";
  for (let i = 1; i <= 10; i += 1) {
    const option = /** @type {HTMLOptionElement} */ (el("option", "", `POSITION ${i}`));
    option.value = String(i);
    position.append(option);
  }
  const button = el("button", "inline-btn", "[ ADD BOSS ]");
  form.append(el("b", "", "ADD BOSS TO QUEUE"), boss, position, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "add_boss_to_queue", button);
  });
  return form;
}

/** The designer's taunts and death line (older designs have none). @param {any} design */
function designWords(design) {
  let words = { taunts: [[], [], []], death_line: "" };
  try {
    words = { ...words, ...JSON.parse(design.extras || "{}") };
  } catch {
    /* older design */
  }
  const lines = words.taunts.map((/** @type {string[]} */ t, /** @type {number} */ i) =>
    `PHASE ${"I".repeat(i + 1)} TAUNTS: ${t.length ? t.map((x) => `"${x}"`).join("  ") : "(none)"}`);
  if (words.death_line) lines.push(`DEATH LINE: "${words.death_line}"`);
  return lines.map((line) => el("div", "boss-design-flavor", line));
}

/** @param {any[]} designs @param {any[]} queue @param {boolean} randomEnabled
 * @param {any[]} preview @param {any[]} choices @param {any} current */
/** Ticket #315: uniques designers sent for live bosses that have none. @param {any[]} proposals */
function renderUniqueProposals(proposals) {
  const host = $("unique-proposals");
  host.replaceChildren();
  if (!proposals.length) return;
  host.append(el("h3", "", `UNIQUES FOR OLD BOSSES :: ${proposals.length}`));
  for (const p of proposals) {
    const card = el("div", "boss-design-card");
    card.append(el("b", "", `${p.unique.name} (${p.unique.slot}, ${p.unique.theme})  ::  ${p.boss} BY ${p.artist}`),
      el("div", "hint", p.unique.flavor), el("pre", "", (p.unique.art ?? []).join("\n")));
    for (const decision of ["approve", "deny"]) {
      const form = /** @type {HTMLFormElement} */ (el("form"));
      for (const [name, value] of [["boss_id", p.boss_id], ["decision", decision]]) {
        const hidden = /** @type {HTMLInputElement} */ (el("input"));
        hidden.type = "hidden";
        hidden.name = name;
        hidden.value = value;
        form.append(hidden);
      }
      const go = el("button", `inline-btn${decision === "deny" ? " danger" : ""}`, decision === "approve" ? "[ APPROVE ]" : "[ DENY ]");
      form.append(go);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit(form, "review_unique", go);
      });
      card.append(form);
    }
    host.append(card);
  }
}

function renderBossDesigns(designs, queue, randomEnabled = false, preview = [], choices = [], current = {}) {
  const queueHost = $("boss-queue");
  const libraryHost = $("boss-design-library");
  const used = queue.filter((/** @type {any} */ b) => b.status === "used");
  const mode = /** @type {HTMLFormElement} */ (el("form", "boss-queue-mode"));
  const random = /** @type {HTMLInputElement} */ (el("input"));
  random.type = "checkbox";
  random.name = "enabled";
  random.checked = randomEnabled;
  const randomLabel = el("label", "boss-random-label");
  randomLabel.append(random, " RANDOMIZE BOSS IF NONE IN MANUAL QUEUE");
  const saveMode = el("button", "inline-btn", "[ SAVE MODE ]");
  mode.append(randomLabel, saveMode);
  mode.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(mode, "set_community_queue_random", saveMode);
  });
  const queueList = el("div", "boss-queue-list");
  queueList.append(el("b", "", `CURRENT BOSS :: ${current.name ?? "UNKNOWN"}`),
    el("b", "", "NEXT 10 BOSSES"));
  preview.slice(0, 10).forEach((boss, index) => {
    const row = el("div", "boss-queue-row");
    const slot = index === 0 ? "NEXT BOSS" : String(index + 1);
    row.append(el("span", "", `${slot}: ${boss.name}${boss.community
      ? `  ::  BY ${boss.creator_name}` : "  ::  [ BUILT-IN ]"}${boss.fallback
      ? `  ::  [ ${randomEnabled ? "RANDOM FALLBACK" : "ROTATION FALLBACK"} ]` : ""}`));
    if (boss.queue_entry_id) {
      if (index > 0) row.append(moveBossForm(boss.queue_entry_id, "up", false));
      if (index < 9 && preview[index + 1]?.queue_entry_id) {
        row.append(moveBossForm(boss.queue_entry_id, "down", false));
      }
    }
    queueList.append(row);
  });
  if (!preview.length) queueList.append(el("div", "dim", "NO MORE BOSSES DEFINED"));
  const library = el("div", "boss-library-content");
  if (used.length) {
    library.append(el("b", "", "APPROVED BOSS LIBRARY"));
    for (const boss of used) {
      const row = el("div", "boss-library-row");
      row.append(el("span", "", `${boss.name} :: BY ${boss.creator_name}`), reuseBossForm(boss.id));
      library.append(row);
    }
  }
  queueHost.replaceChildren(queueList, addBossForm(choices), mode);
  libraryHost.hidden = !used.length;
  libraryHost.replaceChildren(library);
  const cards = designs.map((/** @type {any} */ design) => {
    const card = el("article", `boss-design-card ${design.status}`);
    const head = el("div", "boss-design-head");
    head.append(el("b", "", design.name), el("span", "", `[ ${design.status.toUpperCase()} ]`));
    const frames = el("div", "boss-design-frames");
    for (const [label, key] of [
      ["PHASE I", "phase1_art"], ["PHASE I HURT", "phase1_hurt_art"],
      ["PHASE II", "phase2_art"], ["PHASE II HURT", "phase2_hurt_art"],
      ["PHASE III", "phase3_art"], ["PHASE III HURT", "phase3_hurt_art"], ["DEATH", "death_art"],
    ]) {
      const frame = el("div", "boss-design-frame");
      if (key === "death_art") frame.classList.add("boss-design-death");
      frame.style.setProperty("--boss-design-color", DESIGN_TINTS[design.color] ?? DESIGN_TINTS.amber);
      frame.append(el("b", "", label), el("pre", "art", design[key]));
      frames.append(frame);
    }
    // Its boss unique: the item card it will be, with the stats it gets.
    const u = design.unique;
    const relic = el("div", "boss-design-flavor");
    if (u) {
      const art = el("pre", "art r-boss_unique");
      setArt(art, itemLines({ ...u, id: "design_unique", rarity: "boss_unique" }, { width: 26 }), 12);
      relic.append(el("b", "", `BOSS UNIQUE: ${u.name}  ::  ${u.slot.toUpperCase()} :: ${u.theme}`),
        art, el("div", "", effectParts(u.mods).join("  ::  ")), ...(u.flavor ? [el("div", "", `"${u.flavor}"`)] : []));
    } else {
      relic.textContent = "BOSS UNIQUE: none (sent before the designer had one)";
    }
    card.append(head,
      el("div", "boss-design-meta", `BY ${design.creator_name}  ::  COLOR ${design.color.toUpperCase()}`),
      ...(design.vote ? [el("div", "boss-design-meta", voteLine(design.vote))] : []),
      el("div", "boss-design-flavor", `ENTRANCE: "${design.flavor}"`), ...designWords(design), frames, relic);
    if (design.status === "pending") {
      const actions = el("div", "boss-design-actions");
      actions.append(reviewDesignForm(design.submission_id, "approve"),
        reviewDesignForm(design.submission_id, "deny"));
      if (!design.vote || design.vote.closed_at !== null) actions.append(sendToVoteForm(design.submission_id));
      else actions.append(el("span", "hint", "[ IN PLAYER VOTE ]"));
      card.append(actions);
    }
    return card;
  });
  $("boss-design-list").replaceChildren(...(cards.length ? cards : [el("p", "hint", "no boss submissions yet.")]));
}

/** A design's players' vote: running count and time left, or how it ended. @param {any} v */
function voteLine(v) {
  const count = `${fmt(v.yes)} YES / ${fmt(v.no)} NO`;
  if (v.closed_at === null) return `PLAYER VOTE :: ${count}  ::  ENDS IN ${duration(v.ends_at - Date.now() / 1000)}`;
  const word = { approved: "APPROVED BY VOTE", denied: "DENIED BY VOTE", few: "NOT ENOUGH VOTES (your call)",
    reviewed: "YOU REVIEWED IT FIRST" }[/** @type {string} */ (v.result)] ?? v.result;
  return `PLAYER VOTE :: ${count}  ::  ${word}`;
}

async function refresh() {
  ov = await call("/api/admin/overview");
  $("login").hidden = true;
  $("panel").hidden = false;
  void loadGeo(); // throttled inside (every 5 min)
  $("logout").hidden = false;
  const b = ov.boss;
  const t = ov.tuning;
  const c = ov.counts;
  renderStatus(ov, b, c, t);
  refillPlayerBoxes();
  noteSuspects(ov.suspects);
  updateNeeds(ov);

  $("pin-now").textContent = ov.pinned ? `PINNED NOW: ${ov.pinned.text}` : "nothing pinned.";
  $("unpin-btn").hidden = !ov.pinned;

  renderEvents(ov.world_events);
  renderForge(ov.forge);
  renderBoxPrices(ov.box_prices ?? []);
  renderScrollPrices(ov.scroll_prices ?? []);
  renderDaily(ov.daily).catch(() => {});
  renderChatAdmin(ov.chat ?? []);
  renderDmsAdmin(ov.dms ?? []);
  renderClansAdmin(ov.clans ?? []);
  if (/** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="banned"]')).open) void loadBanned();
  if (!$("health-badge").textContent) void loadHealth(); // the badge, once per visit (the fold refreshes itself)
  renderPolls(ov.polls ?? []);
  renderTickets(ov.tickets ?? []);
  renderBadgeAdmin(ov.badges ?? []);
  if (ov.badge_symbols) renderSymbolPicker(ov.badge_symbols);
  const discordMode = /** @type {HTMLSelectElement} */ ($("discord-boss-mode"));
  if (ov.discord && document.activeElement !== discordMode) discordMode.value = ov.discord.mode;
  if (ov.design_vote) {
    /** @type {HTMLInputElement} */ ($("design-vote-on")).checked = ov.design_vote.enabled;
    const min = /** @type {HTMLInputElement} */ ($("design-vote-min"));
    if (document.activeElement !== min) min.value = String(ov.design_vote.min_votes);
  }
  renderUniqueProposals(ov.unique_proposals ?? []);
  renderBossDesigns(ov.boss_designs ?? [], ov.community_queue ?? [],
    ov.community_queue_random === true, ov.boss_queue_preview ?? [],
    ov.boss_queue_choices ?? [], ov.boss ?? {});

  // Rotation: fill the box with what's saved, unless you're mid-edit.
  const rot = ov.rotating?.messages ?? [];
  const box = /** @type {HTMLTextAreaElement} */ ($("rotate-text"));
  const saved = rot.join("\n");
  if (document.activeElement !== box && (box.value === "" || box.value === box.dataset.saved)) box.value = saved;
  box.dataset.saved = saved;
  $("rotate-stop").hidden = !rot.length;
  $("rotate-now").textContent = rot.length
    ? `ROTATING NOW (${rot.length}, 1 min each):\n` + rot.map((m, i) => `${i + 1}. ${m}`).join("\n")
    : "nothing rotating.";

  const hp = /** @type {HTMLInputElement} */ (document.querySelector('[data-action="set_hp"] [name="hp"]'));
  hp.max = String(b.max_hp);
  // Pre-fill with the current name so editing one field keeps the other.
  const rename = /** @type {HTMLFormElement} */ (document.querySelector('[data-action="rename_boss"]'));
  for (const [field, current, fallback] of [
    ["name", b.name, ov.boss_defaults.name],
    ["subtitle", b.subtitle, ov.boss_defaults.subtitle],
  ]) {
    const input = /** @type {HTMLInputElement} */ (rename.elements.namedItem(field));
    input.placeholder = `${fallback} (default)`;
    if (document.activeElement !== input) input.value = input.defaultValue = current ?? "";
  }

  // Show the current value of every rule as its placeholder.
  document.querySelectorAll('[data-action="set_tuning"] input').forEach((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    input.placeholder = input.name === "crit_pct" ? (t.crit_chance * 100).toFixed(2) : String(t[input.name] ?? "");
  });
  renderOdds(ov.odds);
  renderRelics(ov.relics ?? []);

  await renderGallery();
  fillPreviewBosses(state.content, b.def_id);
  $("players").replaceChildren(
    ...(ov.player_names ?? ov.recent_players.map((/** @type {any} */ p) => p.name)).map((/** @type {string} */ name) => {
      const o = /** @type {HTMLOptionElement} */ (el("option"));
      o.value = name;
      return o;
    }),
  );
  $("recent").textContent = [
    "RECENT PLAYERS",
    ...ov.recent_players.map(
      (/** @type {any} */ p) =>
        `${padR(p.name, 17)} ${padR(fmt(p.total_damage), 9)} ${padR(String(p.total_attacks), 5)} ${p.banned ? "BANNED " : ""}${p.id}`,
    ),
  ].join("\n");
  await loadShards();
}

let shardPage = 0;
let shardQuery = "";
let shardRequest = 0;

async function loadShards() {
  const request = ++shardRequest;
  try {
    const data = await call(`/api/admin/shards?page=${shardPage}&q=${encodeURIComponent(shardQuery)}`);
    if (request !== shardRequest || $("panel").hidden) return;
    shardPage = data.page;
    $("shard-rows").replaceChildren(...data.players.map((/** @type {any} */ p) => {
      const row = el("tr", "");
      const name = el("td", "", p.name);
      name.title = p.id;
      row.append(name, el("td", "shard-balance", fmt(p.shards)), el("td", "dim", p.banned ? "BANNED" : "ACTIVE"));
      return row;
    }));
    const start = data.total ? data.page * data.page_size + 1 : 0;
    $("shard-summary").textContent = `${start}–${Math.min((data.page + 1) * data.page_size, data.total)} of ${fmt(data.total)} players :: ${fmt(data.total_shards)} shards${shardQuery ? " matching search" : " total"}`;
    /** @type {HTMLButtonElement} */ ($("shard-prev")).disabled = data.page === 0;
    /** @type {HTMLButtonElement} */ ($("shard-next")).disabled = (data.page + 1) * data.page_size >= data.total;
  } catch (e) {
    if (request === shardRequest) $("shard-summary").textContent = /** @type {Error} */ (e).message;
  }
}

// ------------------------------------------------------------ accounts

let acctPage = 0;
let acctQuery = "";
let acctRequest = 0;

/** @param {number | null} t unix seconds */
const day = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "--");

async function loadAccounts() {
  const request = ++acctRequest;
  try {
    const data = await call(`/api/admin/accounts?page=${acctPage}&q=${encodeURIComponent(acctQuery)}`);
    if (request !== acctRequest || $("panel").hidden) return;
    acctPage = data.page;
    $("acct-rows").replaceChildren(...data.players.map((/** @type {any} */ p) => {
      const row = el("tr", "");
      const name = el("td", "", p.name + (p.banned ? "  (BANNED)" : ""));
      name.title = p.id;
      const pw = el("td", p.has_password ? "shard-balance" : "dim", p.has_password ? `SET ${day(p.pw_set_at)}` : "none yet");
      const reset = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ RESET ]"));
      reset.type = "button";
      reset.title = "give them a random temporary password";
      reset.addEventListener("click", async () => {
        try {
          const res = await call("/api/admin/action", { action: "reset_password", player: p.id });
          $("acct-result").textContent = res.message;
          log(res.message, true);
          void loadAccounts();
        } catch (e) {
          log(/** @type {Error} */ (e).message, false);
        }
      });
      const cell = el("td", "");
      cell.append(reset);
      row.append(name, pw, el("td", "dim", day(p.created_at)), cell);
      return row;
    }));
    const start = data.total ? data.page * data.page_size + 1 : 0;
    $("acct-summary").textContent = `${start}–${Math.min((data.page + 1) * data.page_size, data.total)} of ${fmt(data.total)} named players :: ${fmt(data.with_password)} with a password${acctQuery ? " (matching search)" : ""}`;
    /** @type {HTMLButtonElement} */ ($("acct-prev")).disabled = data.page === 0;
    /** @type {HTMLButtonElement} */ ($("acct-next")).disabled = (data.page + 1) * data.page_size >= data.total;
  } catch (e) {
    if (request === acctRequest) $("acct-summary").textContent = /** @type {Error} */ (e).message;
  }
}

// ------------------------------------------------------------ achievements

let achPage = 0;
let achQuery = "";
let achRequest = 0;
/** @type {any[]} per-achievement counts from the last load */
let achList = [];
let achTracked = 0;

/** @param {number} n @param {number} of */
const shareOf = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "--");

async function loadAchievements() {
  const request = ++achRequest;
  const sort = /** @type {HTMLSelectElement} */ ($("ach-sort")).value;
  try {
    const data = await call(`/api/admin/achievements?page=${achPage}&q=${encodeURIComponent(achQuery)}&sort=${sort}`);
    if (request !== achRequest || $("panel").hidden) return;
    achPage = data.page;
    const t = data.totals;
    achTracked = t.tracked;
    const b = (/** @type {string | number} */ v) => Object.assign(el("b", "", typeof v === "number" ? fmt(v) : v));
    $("ach-totals").replaceChildren(
      b(t.with_unlock), ` of ${fmt(t.named_players)} named players have unlocked something  ::  `,
      b(t.unlocked), " unlocks, ", b(t.claimed), " claimed", el("br"),
      b(t.shards_paid), " shards paid out  ::  ", b(t.shards_waiting), " unlocked but not claimed yet  ::  ",
      `one player can earn ${fmt(t.catalogue_shards)} from all ${t.achievement_count}`,
    );
    $("ach-rows").replaceChildren(...data.players.map((/** @type {any} */ p) => {
      const row = el("tr", "");
      const name = el("td", "", p.name + (p.banned ? "  (BANNED)" : ""));
      name.title = p.player_id;
      const view = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ VIEW ]"));
      view.type = "button";
      view.addEventListener("click", () => void viewPlayerAchievements(p.player_id));
      const cell = el("td", "");
      cell.append(view);
      row.append(name, el("td", "shard-balance", `${p.unlocked} / ${t.achievement_count}`), el("td", "", String(p.claimed)),
        el("td", "shard-balance", fmt(p.claimed_shards)), el("td", p.waiting_shards ? "ach-ready" : "dim", fmt(p.waiting_shards)),
        el("td", "dim", day(p.last_unlock)), cell);
      return row;
    }));
    if (!data.players.length) $("ach-rows").append(Object.assign(el("tr", ""), { innerHTML: '<td colspan="7" class="dim">nobody yet</td>' }));
    const start = data.total ? data.page * data.page_size + 1 : 0;
    $("ach-summary").textContent = `${start}–${Math.min((data.page + 1) * data.page_size, data.total)} of ${fmt(data.total)} players with an unlock${achQuery ? " (matching search)" : ""}`;
    /** @type {HTMLButtonElement} */ ($("ach-prev")).disabled = data.page === 0;
    /** @type {HTMLButtonElement} */ ($("ach-next")).disabled = (data.page + 1) * data.page_size >= data.total;
    achList = data.per_achievement;
    const cat = /** @type {HTMLSelectElement} */ ($("ach-cat"));
    if (cat.options.length === 1) {
      for (const c of [...new Set(achList.map((a) => a.category))]) cat.append(Object.assign(el("option", "", c.toLowerCase()), { value: c }));
    }
    drawAchievementList();
  } catch (e) {
    if (request === achRequest) $("ach-summary").textContent = /** @type {Error} */ (e).message;
  }
}

/** Every achievement with how many players have it (of those tracked). */
function drawAchievementList() {
  const cat = /** @type {HTMLSelectElement} */ ($("ach-cat")).value;
  const sort = /** @type {HTMLSelectElement} */ ($("ach-list-sort")).value;
  const list = achList.filter((a) => !cat || a.category === cat);
  if (sort === "most") list.sort((a, b) => b.unlocked - a.unlocked);
  else if (sort === "fewest") list.sort((a, b) => a.unlocked - b.unlocked);
  else if (sort === "shards") list.sort((a, b) => b.shards - a.shards);
  $("ach-list").replaceChildren(...list.map((a) => {
    const row = el("tr", "");
    const name = el("td", "");
    name.append(el("div", "", a.title), el("div", "dim", a.category.toUpperCase()));
    row.append(name, el("td", "dim", a.description), el("td", "", fmt(a.shards)),
      el("td", a.unlocked ? "shard-balance" : "dim", `${fmt(a.unlocked)}  (${shareOf(a.unlocked, achTracked)})`),
      el("td", "", fmt(a.claimed)));
    return row;
  }));
}

/** One player's 60, brought up to date. @param {string} id */
async function viewPlayerAchievements(id) {
  const box = $("ach-player");
  box.replaceChildren(el("div", "dim", "> loading..."));
  try {
    const d = await call(`/api/admin/achievements?player=${encodeURIComponent(id)}`);
    const close = el("button", "inline-btn", "[ CLOSE ]");
    close.addEventListener("click", () => box.replaceChildren());
    const head = el("div", "ach-head", `${d.player.name}${d.player.banned ? " (BANNED)" : ""} :: ${d.unlocked} / ${d.total} unlocked :: ${fmt(d.claimed_shards)} shards claimed :: ${fmt(d.available_shards)} waiting  `);
    head.append(close);
    const order = { ready: 0, claimed: 1, locked: 2 };
    const rows = [...d.achievements].sort((a, b) =>
      order[/** @type {"ready"} */ (a.status)] - order[/** @type {"ready"} */ (b.status)] || b.progress / b.target - a.progress / a.target);
    const table = el("table", "shard-table");
    table.append(Object.assign(el("thead", ""), { innerHTML: '<tr><th scope="col">ACHIEVEMENT</th><th scope="col">PROGRESS</th><th scope="col">SHARDS</th><th scope="col">STATUS</th></tr>' }));
    const body = el("tbody", "");
    for (const a of rows) {
      const tr = el("tr", "");
      const cells = 12;
      const filled = Math.round(Math.min(1, a.progress / a.target) * cells);
      const prog = el("td", "");
      prog.append(el("span", "ach-bar", `[${"#".repeat(filled)}${".".repeat(cells - filled)}] `), `${fmt(a.progress)} / ${fmt(a.target)}`);
      const status = a.status === "claimed" ? `CLAIMED ${day(a.claimed_at)}` : a.status === "ready" ? "READY TO CLAIM" : "locked";
      tr.append(el("td", "", a.title), prog, el("td", "", fmt(a.shards)),
        el("td", a.status === "claimed" ? "ach-done" : a.status === "ready" ? "ach-ready" : "dim", status));
      body.append(tr);
    }
    table.append(body);
    const scroll = el("div", "shard-scroll");
    scroll.append(table);
    box.replaceChildren(head, scroll);
    box.scrollIntoView({ block: "nearest" });
  } catch (e) {
    box.replaceChildren(el("div", "dim", /** @type {Error} */ (e).message));
  }
}

// ------------------------------------------------------------ boss relics

/** [ BOSS RELICS ]: each boss's Boss Unique and who has one. @param {any[]} relics */
function renderRelics(relics) {
  const found = relics.filter((r) => r.holders.length);
  $("relic-hint").textContent = `${found.length} of ${relics.length} found`;
  const only = /** @type {HTMLInputElement} */ ($("relic-found-only"));
  if (!only.dataset.ready) {
    only.dataset.ready = "1";
    only.addEventListener("change", () => renderRelics(ov?.relics ?? []));
  }
  const rows = (only.checked ? found : relics).map((r) => {
    const row = el("div", "relic-row");
    const who = r.holders.length
      ? r.holders.map((/** @type {any} */ h) =>
        `${h.name}${h.count > 1 ? ` x${h.count}` : ""} (${new Date(h.found_at * 1000).toLocaleDateString()})`).join(", ")
      : "nobody yet";
    const preview = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ PREVIEW ]"));
    preview.type = "button";
    preview.title = "play the drop animation on your screen only (nothing is given)";
    preview.addEventListener("click", () =>
      window.open(new URL(`./#preview-relic=${r.item_id}`, location.href).href, "_blank", "noopener"));
    row.append(el("span", "relic-boss", `#${String(r.number ?? "?").padStart(3, "0")} ${r.boss}`),
      el("span", "r-boss_unique", r.name), el("span", "dim", r.slot),
      el("span", r.holders.length ? "relic-who" : "dim", who), preview);
    return row;
  });
  $("relic-list").replaceChildren(...(rows.length ? rows : [el("p", "hint", "none found yet.")]));
}

// ------------------------------------------------------------ item gallery

let galleryReady = false;
/** How many item rows are shown (SHOW MORE adds a page). */
const GAL_PAGE = 40;
let galLimit = GAL_PAGE;

/** Show one gallery tab (boxes / scrolls / items). @param {string} tab */
function galTab(tab) {
  for (const b of document.querySelectorAll("[data-gal-tab]"))
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.galTab === tab));
  for (const p of document.querySelectorAll("[data-gal-pane]"))
    /** @type {HTMLElement} */ (p).hidden = /** @type {HTMLElement} */ (p).dataset.galPane !== tab;
  try { localStorage.setItem("omhp.admin.galtab", tab); } catch { /* private mode */ }
}

const giveEveryone = () => /** @type {HTMLInputElement} */ ($("gal-everyone")).checked;

/** Every GIVE button says where it goes. */
function labelGiveButtons() {
  const all = giveEveryone();
  /** @type {HTMLInputElement} */ ($("gal-player")).disabled = all;
  for (const b of document.querySelectorAll(".gal-give")) {
    disarm(/** @type {HTMLElement} */ (b));
    b.textContent = all ? "[ GIVE ALL ONLINE ]" : "[ GIVE ]";
    b.classList.toggle("gift-all", all);
  }
}

/** A GIVE button for a box, scroll or item. @param {Record<string, string>} ref @param {string} name */
function giveButton(ref, name) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn gal-give", "[ GIVE ]"));
  b.type = "button";
  b.addEventListener("click", () => giveTo(ref, name, b));
  return b;
}

async function renderGallery() {
  if (!state.content) state.content = await getContent();
  const content = state.content;
  if (!galleryReady) {
    galleryReady = true;
    const rsel = $("gal-rarity");
    for (const r of content.rarities) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", r.label.toLowerCase()));
      o.value = r.id;
      rsel.append(o);
    }
    // Every slot and effect, with how many items in the game have it.
    const count = (/** @type {(i: any) => boolean} */ f) => content.items.filter(f).length;
    for (const [id, label] of EQUIP_SLOTS) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", `${label.toLowerCase()} (${count((i) => i.slot === id)})`));
      o.value = id;
      $("gal-slot").append(o);
    }
    for (const [key, label] of EFFECT_FILTERS) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", `${label.toLowerCase()} (${count((i) => hasEffect(i, key))})`));
      o.value = key;
      $("gal-effect").append(o);
      if (key === "dmg_pct") continue; // a minus: "highest first" means nothing
      const s = /** @type {HTMLOptionElement} */ (el("option", "", `${label.toLowerCase()} high-low`));
      s.value = `stat:${key}`;
      $("gal-sort").append(s);
    }
    for (const id of ["gal-rarity", "gal-slot", "gal-effect", "gal-search", "gal-sort"]) {
      $(id).addEventListener("input", () => {
        galLimit = GAL_PAGE;
        drawGallery();
      });
    }
    $("gal-more").addEventListener("click", () => {
      galLimit += GAL_PAGE;
      drawGallery();
    });
    $("gal-everyone").addEventListener("change", labelGiveButtons);
    for (const b of document.querySelectorAll("[data-gal-tab]"))
      b.addEventListener("click", () => galTab(/** @type {HTMLElement} */ (b).dataset.galTab ?? "boxes"));
    let tab = "boxes";
    try { tab = localStorage.getItem("omhp.admin.galtab") ?? tab; } catch { /* private mode */ }
    galTab(tab);
    // Boxes and scrolls: one card each with a give button.
    $("gal-boxes").replaceChildren(
      ...content.boxes.map((/** @type {any} */ b) => {
        const card = el("div", "gal-card gal-box");
        const pre = el("pre", "art");
        const held = el("div", "gal-held");
        held.id = `held-${b.id}`;
        card.append(pre, el("div", "gal-name", b.name), held, giveButton({ box_id: b.id }, b.name));
        requestAnimationFrame(() => setArt(pre, b.art, 10));
        return card;
      }),
    );
    $("gal-scrolls").replaceChildren(
      ...Object.entries(SCROLLS).map(([id, def]) => {
        const card = el("div", "gal-card gal-scroll");
        const held = el("div", "gal-held");
        held.id = `held-scroll-${id}`;
        const name = el("div", "gal-name", `${def.mini}  ${def.name}`);
        name.style.setProperty("color", def.color);
        card.append(name, el("div", "gal-fx", def.description), el("div", "gal-fx dim", def.limits.join(" ")),
          held, giveButton({ scroll_id: id }, def.name));
        return card;
      }),
    );
    labelGiveButtons();
  }
  drawGallery();
}

function drawGallery() {
  const content = state.content;
  if (!content) return;
  const filter = {
    rarity: /** @type {HTMLSelectElement} */ ($("gal-rarity")).value,
    slot: /** @type {HTMLSelectElement} */ ($("gal-slot")).value,
    effect: /** @type {HTMLSelectElement} */ ($("gal-effect")).value,
    q: /** @type {HTMLInputElement} */ ($("gal-search")).value,
  };
  const sort = /** @type {HTMLSelectElement} */ ($("gal-sort")).value;
  /** @type {Record<string, {players: number, copies: number}>} */
  const owned = ov?.ownership ?? {};
  const on = (ov?.odds?.scrolls?.list ?? []).filter((/** @type {any} */ s) => s.on).map((/** @type {any} */ s) => SCROLLS[s.id]?.name ?? s.id);
  $("gal-scroll-note").textContent = on.length
    ? `switched on: ${on.join(", ").toLowerCase()}${ov.odds.scrolls.attacks ? "" : " (chests only)"}. change it in [ ODDS ].`
    : "no scroll drops for players right now (switch them on in [ ODDS ]). gifting works anyway.";
  const held = (/** @type {any} */ i) => owned[i.id]?.players ?? 0;
  /** One stat's value (sort "stat:<key>", highest first). @param {any} i @param {string} key */
  const stat = (i, key) => Number(i.mods?.[key] ?? (key === "loot_mult" ? 1 : 0));
  const items = content.items
    .filter((/** @type {any} */ i) => matchesFilter(i, filter))
    .filter((/** @type {any} */ i) => sort !== "unowned" || !held(i))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      (sort === "owned" ? held(b) - held(a) : 0) ||
      (sort.startsWith("stat:") ? stat(b, sort.slice(5)) - stat(a, sort.slice(5)) : 0) ||
      (rarityById(b.rarity)?.rank ?? 0) - (rarityById(a.rarity)?.rank ?? 0) || a.name.localeCompare(b.name));
  const found = content.items.filter((/** @type {any} */ i) => held(i)).length;
  const shown = items.slice(0, galLimit);
  $("gal-count").textContent =
    `${shown.length} of ${items.length} matching items shown  ::  ${found} of ${content.items.length} owned by someone`;
  $("gal-more").hidden = shown.length >= items.length;
  for (const b of content.boxes) {
    const o = ov?.box_ownership?.[b.id];
    const line = document.getElementById(`held-${b.id}`);
    if (line) line.replaceChildren(heldLine(o, { box_id: b.id }));
  }
  for (const id of Object.keys(SCROLLS)) {
    const o = ov?.scroll_ownership?.[id];
    const line = document.getElementById(`held-scroll-${id}`);
    if (line) line.replaceChildren(heldLine(o, { scroll_id: id }));
  }
  // One line per item; its name shows the card art.
  $("gal-grid").replaceChildren(
    ...shown.map((/** @type {any} */ item) => {
      const row = el("div", "gal-row");
      const fx = effectParts(item.mods);
      const name = /** @type {HTMLButtonElement} */ (el("button", `gal-iname r-${item.rarity}`, item.name));
      name.type = "button";
      name.title = "show the card";
      const art = el("pre", "art gal-art");
      art.hidden = true;
      name.addEventListener("click", () => {
        art.hidden = !art.hidden;
        if (!art.hidden && !art.textContent) setArt(art, itemLines(item, {}), 10);
      });
      const from = (item.boss_only ?? []).map((/** @type {string} */ b) =>
        content.bosses.find((/** @type {any} */ x) => x.id === b)?.name ?? b).join(", ");
      const meta = el("span", "gal-meta dim", `${rarityById(item.rarity)?.label ?? item.rarity} ${item.slot}`.toLowerCase());
      if (from) meta.append(el("span", "gal-boss", ` :: ${from}`));
      const heldEl = el("span", "gal-held");
      heldEl.append(heldLine(owned[item.id], { item_id: item.id }));
      row.append(name, meta, el("span", "gal-fx", fx.length ? fx.join(" :: ") : "no bonus"), heldEl,
        giveButton({ item_id: item.id }, item.name), art);
      return row;
    }),
  );
  labelGiveButtons();
}

/** "HELD BY 3 (5 copies) [ WHO? ]" for a gallery card.
 * @param {{players: number, copies: number} | undefined} o @param {Record<string, string>} ref */
function heldLine(o, ref) {
  const wrap = el("span", o ? "" : "dim", o ? `HELD BY ${fmt(o.players)}${o.copies > o.players ? ` (${fmt(o.copies)} copies)` : ""} ` : "nobody has one");
  if (o) {
    const who = el("button", "inline-btn", "[ WHO? ]");
    who.addEventListener("click", async () => {
      try {
        log((await call("/api/admin/action", { action: "who_has", ...ref })).message, true);
      } catch (e) {
        log(/** @type {Error} */ (e).message, false);
      }
    });
    wrap.append(who);
  }
  return wrap;
}

/** Give a box / scroll / item to the GIVE TO player, or (two clicks) to
 * everyone online. @param {Record<string, string>} ref @param {string} what @param {HTMLElement} btn */
async function giveTo(ref, what, btn) {
  const everyone = giveEveryone();
  const player = /** @type {HTMLInputElement} */ ($("gal-player")).value.trim();
  if (!everyone && !player) {
    log(`Type a player name in GIVE TO first (for ${what}), or tick EVERYONE ONLINE.`, false);
    $("gal-player").focus();
    return;
  }
  if (everyone) {
    if (!armed.has(btn)) {
      armArm(/** @type {HTMLButtonElement} */ (btn));
      return;
    }
    disarm(btn);
  }
  const action = everyone ? "gift_online"
    : ref.box_id ? "grant_box" : ref.scroll_id ? "grant_scroll" : "grant_item";
  try {
    const res = await call("/api/admin/action", { action, ...(everyone ? {} : { player }), ...ref, announce: announcing() });
    log(res.message, true);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** Turn a form's inputs into action params (blank fields are omitted).
 * @param {HTMLFormElement} form */
function params(form) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const node of Array.from(form.elements)) {
    const input = /** @type {HTMLInputElement} */ (node);
    if (!input.name) continue;
    const v = input.value.trim();
    if (v === "" && input.name !== "name" && input.name !== "subtitle") continue;
    if (input.type === "checkbox") out[input.name] = input.checked;
    else if (input.name === "crit_pct") out.crit_chance = Number(v) / 100;
    else out[input.name] = input.type === "number" ? Number(v) : v;
  }
  return out;
}

/** One badge star as it looks by names. @param {any} b */
function badgeStar(b) {
  const s = el("span", "badge");
  paintLook(s, b);
  return s;
}

/** The admin's badges: the GIVE dropdown and the list (holders, [ DELETE ]). @param {any[]} badges */
function renderBadgeAdmin(badges) {
  for (const id of ["badge-pick", "badge-pick-all"]) { // GIVE (one player) and GIVE TO EVERYONE
    const pick = /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
    if (!pick) continue;
    const was = pick.value;
    pick.replaceChildren(...badges.map((b) => {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", `${b.symbol} ${b.title}`));
      o.value = String(b.id);
      return o;
    }));
    if (badges.some((b) => String(b.id) === was)) pick.value = was;
  }
  const host = $("badge-list");
  if (host.querySelector(".armed")) return; // mid-confirm: don't redraw under the click
  host.replaceChildren(...(badges.length ? badges.map((b) => {
    const form = /** @type {HTMLFormElement} */ (el("form", "badge-admin"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "badge_id";
    id.value = String(b.id);
    const tag = el("span", "badges");
    tag.append("[", badgeStar(b), "]");
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    form.append(id, tag, el("span", "badge-admin-title", b.title), el("span", "hint", b.description || "--"),
      el("span", "hint", `${fmt(b.holders)} player${b.holders === 1 ? " has" : "s have"} it`), del);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(form, "delete_badge", del);
    });
    return form;
  }) : [el("p", "hint", "no badges made yet.")]));
}

/** The symbol grid under the make-a-badge form (drawn once): a click adds that
 * character as the next frame; an ANIMATION sets all the frames.
 * @param {{groups: Record<string, string>, presets: [string, string][], max_frames: number}} cfg */
function renderSymbolPicker(cfg) {
  const host = $("badge-symbols");
  if (host.childElementCount) return;
  const form = /** @type {HTMLFormElement} */ (document.querySelector('form[data-action="create_badge"]'));
  const input = /** @type {HTMLInputElement} */ (form.elements.namedItem("symbol"));
  const set = (/** @type {string} */ v) => {
    input.value = v;
    drawBadgePreview();
  };
  /** @param {string} label @param {HTMLElement[]} buttons */
  const row = (label, buttons) => {
    const r = el("div", "sym-row");
    r.append(el("span", "sym-group", label), ...buttons);
    return r;
  };
  /** @param {string} text @param {string} title @param {() => void} onClick @param {string} [cls] */
  const btn = (text, title, onClick, cls = "") => {
    const b = /** @type {HTMLButtonElement} */ (el("button", cls, text));
    b.type = "button";
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const add = (/** @type {string} */ ch) => {
    const frames = Array.from(input.value);
    // The default * is a placeholder: the first click replaces it.
    set(frames.length === 1 && frames[0] === "*" ? ch : [...frames, ch].slice(-cfg.max_frames).join(""));
  };
  host.replaceChildren(
    row("ANIMATION", [
      ...cfg.presets.map(([name, frames]) => btn(frames, name, () => set(frames), "sym-preset")),
      btn("[ CLEAR ]", "back to *", () => set("*"), "sym-preset"),
    ]),
    ...Object.entries(cfg.groups).map(([group, chars]) =>
      row(group, Array.from(chars).map((ch) => btn(ch, `add ${ch}`, () => add(ch))))),
  );
}

/** The make-a-badge form's live preview: the star by a name, and its hover box. */
function drawBadgePreview() {
  const form = /** @type {HTMLFormElement} */ (document.querySelector('form[data-action="create_badge"]'));
  const val = (/** @type {string} */ n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value;
  const b = {
    symbol: val("symbol").trim() || "*",
    color: val("color"),
    rainbow: /** @type {HTMLInputElement} */ (form.elements.namedItem("rainbow")).checked,
    color2: /** @type {HTMLInputElement} */ (form.elements.namedItem("flash")).checked ? val("color2") : "",
  };
  const title = val("title").trim().toUpperCase() || "BADGE NAME";
  const says = val("description").trim();
  const lines = [title, ...(says ? [`  ${says}`] : []), "  given by the admin <date>"];
  const w = Math.max(...lines.map((l, i) => l.length + (i === 0 ? 2 : 0)));
  const pre = $("badge-preview");
  const tag = el("span", "badges");
  tag.append("[", badgeStar(b), "]");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.replaceChildren("PREVIEW  ", tag, " SOMEONE\n\n", edge);
  lines.forEach((l, i) => {
    const row = el("span", i === 0 ? "tip-title" : "");
    row.append("| ", ...(i === 0 ? [badgeStar(b), " "] : []), l.padEnd(w - (i === 0 ? 2 : 0)), " |\n");
    pre.append(row);
  });
  pre.append(edge.trimEnd());
}

/** The top of the panel: the boss, the players, what's switched on (each one
 * jumps to its section) and, folded, the rules and suspects lines.
 * @param {any} ov @param {any} b @param {any} c @param {any} t */
function renderStatus(ov, b, c, t) {
  const host = $("status");
  const chip = (/** @type {string} */ text, /** @type {string} */ cls, /** @type {string} */ to) => {
    const x = el("button", `inline-btn st-chip ${cls}`, text);
    /** @type {HTMLButtonElement} */ (x).type = "button";
    x.addEventListener("click", () => goTo(to));
    return x;
  };
  const pctHp = (100 * b.hp) / b.max_hp;
  const boss = el("div", "st-line st-boss");
  boss.append(el("b", "", `BOSS #${String(b.seq).padStart(3, "0")} ${b.name}`),
    el("span", `st-state st-${b.status}`, ` [${b.status.toUpperCase()}]`),
    el("span", "", `  HP ${fmt(b.hp)} / ${fmt(b.max_hp)} (${pctHp.toFixed(1)}%)  PHASE ${b.phase}`),
    el("span", "dim", `  ::  ${fmt(b.unique_players)} fighters, ${fmt(b.total_attacks)} hits`));
  const people = el("div", "st-line");
  people.append(el("span", "", `ONLINE ${fmt(ov.online)}`), el("span", "dim", "  ::  "),
    el("span", "", `ACTIVE TODAY ${fmt(c.active_today)}`), el("span", "dim", "  ::  "),
    el("span", "", `PLAYERS ${fmt(c.players)}`), el("span", "dim", ` (${fmt(c.banned)} banned)`));
  const sw = ov.switches ?? {};
  const ev = ov.world_events?.current;
  const live = el("div", "st-line st-live");
  live.append(el("span", "dim", "LIVE NOW  "),
    chip(sw.double_damage ? "[ 2X: ON ]" : "[ 2X: off ]", sw.double_damage ? "on" : "", "double-damage"),
    chip(sw.meow_mode ? "[ MEOW: ON ]" : "[ MEOW: off ]", sw.meow_mode ? "on" : "", "meow-mode"),
    chip(ev ? `[ EVENT: ${ev.name} ]` : "[ EVENT: none ]", ev ? "on" : "", "events"),
    chip(ov.forge?.open ? "[ FORGE: open ]" : "[ FORGE: closed ]", "", "forge"),
    chip(`[ CHEST LIMIT: ${t.chest_combat_per_day || "none"} ]`, "", "rules"));
  const more = /** @type {HTMLDetailsElement} */ (el("details", "st-more"));
  more.append(el("summary", "dim", "[ more ]"),
    el("div", "st-line", `RULES  max ${t.attacks_per_day} attacks, +1 every ${t.recharge_seconds}s  ::  ult every ${t.ult_recharge}s  ::  crit ${(t.crit_chance * 100).toFixed(2)}%  ::  drops x${t.loot_mult}`),
    el("div", "st-line", `SUSPECTS  ${suspectLine(ov.suspects)}`),
    el("div", "st-line dim", `ITEMS HELD ${fmt(c.items_owned)}  ::  DAMAGE ${fmt(b.total_damage)}`));
  more.open = host.querySelector(".st-more")?.hasAttribute("open") ?? false;
  host.replaceChildren(boss, people, live, more);
}

// ------------------------------------------------------------ suspects

/** A suspect row's captcha status (none yet = all zero). @param {any} p */
const c0 = (p) => p.captcha ?? { pending: false, passed: 0, failed: 0, strikes: 0 };

/** "3 flagged (checked 14:20)". @param {any} s */
function suspectLine(s) {
  const n = s?.flagged?.length ?? 0;
  const when = s?.at ? ` (checked ${new Date(s.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : " (first check ~1 min after a restart)";
  return `${n ? `${n} flagged` : "none flagged"}${when}  -> see [ SUSPECTS ]`;
}

/** Newly flagged accounts get a line in the log (remembered per browser). @param {any} s */
function noteSuspects(s) {
  const flagged = s?.flagged ?? [];
  $("suspect-count").textContent = flagged.length ? `:: ${flagged.length} FLAGGED` : "";
  let seen = new Set();
  try {
    seen = new Set(JSON.parse(localStorage.getItem("omhp.admin.suspectsSeen") ?? "[]"));
  } catch {
    /* ignore */
  }
  for (const f of flagged) if (!seen.has(f.player_id)) log(`SUSPECT: ${f.name} :: ${f.reasons.join(" :: ")}`, false);
  try {
    localStorage.setItem("omhp.admin.suspectsSeen", JSON.stringify(flagged.map((/** @type {any} */ f) => f.player_id)));
  } catch {
    /* ignore */
  }
}

/** Load (or with ``fresh`` re-run) the scan and draw the table. @param {boolean} fresh */
async function loadSuspects(fresh) {
  const btn = /** @type {HTMLButtonElement} */ ($("suspect-scan"));
  btn.disabled = true;
  btn.textContent = "[ SCANNING... ]";
  try {
    const s = await call(`/api/admin/suspects${fresh ? "?fresh=1" : ""}`);
    renderSuspects(s);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = "[ SCAN NOW ]";
  }
}

const MODE_NAMES = ["off", "watch", "captcha", "ban"];
const share = (/** @type {number | null | undefined} */ v) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);

/** @param {any} s */
function renderSuspects(s) {
  $("suspect-when").textContent = s.at
    ? ` last 24h :: ${fmt(s.attacks)} attacks :: checked ${new Date(s.at * 1000).toLocaleTimeString()}`
    : " no scan since the server started: the automatic one runs every 10 min, or click SCAN NOW";
  renderBotStats(s);
  renderBotSettings(s);
  renderWhitelist(s.whitelist ?? []);
  const modes = s.settings?.modes ?? {};
  const strikesTo = s.settings?.captcha_ban ? s.settings.captcha_ban_strikes : 0;
  const hours = (/** @type {number} */ secs) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : `${Math.round(secs / 60)}m`);
  const rows = s.players.map((/** @type {any} */ p) => {
    const tr = el("tr", p.act === "captcha" || p.act === "ban" ? "flagged" : p.act === "watch" ? "watch" : "");
    if (p.banned) tr.classList.add("banned");
    if (p.whitelisted) tr.classList.add("whitelisted");
    const flags = el("td", "suspect-flags");
    if (p.banned) flags.append("BANNED");
    else if (!p.reasons.length) flags.append("--");
    else {
      (p.flags ?? []).forEach((/** @type {string} */ k, /** @type {number} */ i) => {
        const mode = modes[k] ?? "watch";
        if (i) flags.append(" :: ");
        flags.append(el("span", `mode-tag mode-${mode}`, `[${mode.toUpperCase()}] `), p.reasons[i]);
      });
      if (p.whitelisted) flags.append(el("span", "mode-tag", " (WHITELISTED)"));
    }
    const timing = p.regularity === null ? "--" : `${p.median_gap}s / ${p.regularity.toFixed(2)}`;
    const acts = el("td", "suspect-acts");
    const form = /** @type {HTMLFormElement} */ (el("form"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "player";
    id.value = p.player_id;
    const look = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ LOOK UP ]"));
    look.type = "button";
    look.addEventListener("click", () => submit(form, "lookup_player", look));
    const ban = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${p.banned ? "" : " danger"}`, p.banned ? "[ UNBAN ]" : "[ BAN ]"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submit(form, p.banned ? "unban" : "ban", ban);
      if (!ban.classList.contains("armed")) loadSuspects(true);
    });
    const pending = Boolean(p.captcha?.pending);
    const check = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", pending ? "[ CLEAR CAPTCHA ]" : "[ CAPTCHA ]"));
    check.type = "button";
    check.addEventListener("click", async () => {
      await submit(form, pending ? "clear_captcha" : "push_captcha", check);
      loadSuspects(true);
    });
    const wl = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", p.whitelisted ? "[ UN-WHITELIST ]" : "[ WHITELIST ]"));
    wl.type = "button";
    wl.addEventListener("click", async () => {
      await submit(form, p.whitelisted ? "whitelist_remove" : "whitelist_add", wl);
      loadSuspects(true);
    });
    form.append(id, look, " ", check, " ", wl, " ", ban);
    acts.append(form);
    // A clean slate: the scan ignores what they did before now (asks twice).
    if (p.reasons.length || c0(p).strikes || pending) {
      const resetForm = /** @type {HTMLFormElement} */ (el("form"));
      resetForm.dataset.confirm = "";
      const rid = /** @type {HTMLInputElement} */ (el("input"));
      rid.type = "hidden";
      rid.name = "player";
      rid.value = p.player_id;
      const reset = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ RESET FLAGS ]"));
      reset.type = "button";
      reset.title = "clear this player's flags, captcha strikes and pending captcha: the scan only counts what they do from now on";
      reset.addEventListener("click", async () => {
        await submit(resetForm, "reset_bot_flags", reset);
        if (!reset.classList.contains("armed")) loadSuspects(false);
      });
      resetForm.append(rid, reset);
      acts.append(resetForm);
    }
    const c = c0(p);
    const strikes = c.strikes ? (strikesTo ? ` (${c.strikes}/${strikesTo} to ban)` : ` (${c.strikes} missed)`) : "";
    const human = (pending ? "PENDING" : c.passed || c.failed ? `${c.passed} ok / ${c.failed} miss` : "--") + strikes;
    const inp = p.input ?? {};
    const total = Object.values(inp.sources ?? {}).reduce((/** @type {number} */ n, /** @type {any} */ v) => n + v, 0);
    const kinds = total ? Object.entries(inp.sources).sort((x, y) => Number(y[1]) - Number(x[1]))
      .map(([k, v]) => `${k} ${Math.round((Number(v) / total) * 100)}%`).join(" ") : "--";
    const clicks = inp.missing ? `${kinds} :: ${inp.missing} no page` : kinds;
    const links = (p.links ?? []).map((/** @type {any} */ l) => l.kind === "lockstep"
      ? `lockstep ${l.with} ${share(l.share)}` : `funnel ${l.with} ${l.sales}x ${fmt(l.shards)}`).join("\n") || "--";
    const who = el("td", "suspect-name");
    who.append(playerLink(p.name, p.player_id));
    tr.append(flags, who, el("td", "", fmt(p.attacks)), el("td", "", String(p.hours)),
      el("td", "", hours(p.longest_session)), el("td", "", timing), el("td", "", String(p.shared_network)),
      el("td", "", fmt(p.refused ?? 0)), el("td", "", fmt(p.instant ?? 0)), el("td", "", clicks),
      el("td", "", share(inp.spot)), el("td", "", share(inp.moved)), el("td", "", fmt(inp.fake ?? 0)),
      el("td", "", String(p.shared_device ?? 1)), el("td", "banned-net", links),
      el("td", pending ? "suspect-pending" : "", human), acts);
    return tr;
  });
  if (!rows.length) {
    const td = /** @type {HTMLTableCellElement} */ (el("td", "hint", s.at ? "nobody with 100+ attacks, a flag or a pending check today."
      : "no scan yet: click SCAN NOW (or wait for the automatic one)."));
    td.colSpan = 17;
    const tr = el("tr");
    tr.append(td);
    rows.push(tr);
  }
  $("suspect-rows").replaceChildren(...rows);
}

/** The totals above the table: flags, click data, shared browsers, links. @param {any} s */
function renderBotStats(s) {
  const st = s.stats;
  const host = $("bot-stats");
  if (!st) {
    host.textContent = "";
    return;
  }
  const label = Object.fromEntries((s.flag_list ?? []).map((/** @type {any} */ f) => [f.key, f.label]));
  const flagLine = Object.entries(st.flags ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([k, n]) => `${n} ${label[k] ?? k}`).join(" :: ") || "none";
  const src = st.input?.sources ?? {};
  const clicks = st.input?.clicks ?? 0;
  const mix = clicks ? Object.entries(src).map(([k, n]) => `${k} ${Math.round((Number(n) / clicks) * 100)}%`).join(" ") : "";
  const lines = [
    `FLAGS TODAY   ${flagLine}`,
    `CLICK DATA    ${fmt(clicks)} attacks with click info${mix ? ` (${mix})` : ""} :: ${fmt(st.input?.fake ?? 0)} fake :: `
      + `${fmt(st.input?.missing ?? 0)} of ${fmt(st.input?.judged ?? 0)} sent without the page`,
    `BROWSERS      ${fmt(st.with_device ?? 0)} of ${fmt(st.accounts ?? 0)} accounts sent a browser id :: `
      + `${(st.devices ?? []).length} browsers with 2+ accounts`,
  ];
  for (const d of (st.devices ?? []).slice(0, 10)) lines.push(`  ${d.length} in one browser: ${d.join(", ")}`);
  lines.push(`LOCKSTEP      ${(st.lockstep ?? []).length ? "" : "none"}`);
  for (const l of st.lockstep ?? []) lines.push(`  ${l.a} + ${l.b}: ${share(l.share)} of ${l.bursts} bursts started together`);
  lines.push(`FUNNELS (7d)  ${(st.funnels ?? []).length ? "" : "none"}`);
  for (const f of st.funnels ?? []) lines.push(`  ${f.buyer} paid ${f.seller} ${fmt(f.shards)} shards in ${f.sales} sale(s)`);
  host.textContent = lines.join("\n");
}

let botSettingsDrawn = false;
/** Each flag's mode, AUTO-BAN, the captcha ban and new accounts per network. @param {any} s */
function renderBotSettings(s) {
  const host = $("bot-settings");
  const cfg = s.settings;
  if (!cfg || (botSettingsDrawn && host.contains(document.activeElement))) return; // don't redraw under the admin's hands
  botSettingsDrawn = true;
  /** @type {Record<string, HTMLSelectElement>} */
  const selects = {};
  const parts = [];
  for (const f of s.flag_list ?? []) {
    const sel = /** @type {HTMLSelectElement} */ (el("select"));
    for (const m of MODE_NAMES) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", m.toUpperCase()));
      o.value = m;
      sel.append(o);
    }
    sel.value = cfg.modes[f.key] ?? f.default;
    selects[f.key] = sel;
    const name = el("span", "", f.label);
    if (sel.value !== f.default) name.append(el("span", "bot-default", ` (default ${f.default.toUpperCase()})`));
    parts.push(name, sel);
  }
  const box = (/** @type {boolean} */ on) => {
    const i = /** @type {HTMLInputElement} */ (el("input"));
    i.type = "checkbox";
    i.checked = on;
    return i;
  };
  const num = (/** @type {number | null} */ v, /** @type {string} */ ph) => {
    const i = /** @type {HTMLInputElement} */ (el("input"));
    i.type = "number";
    i.min = "0";
    i.style.width = "9ch";
    i.placeholder = ph;
    i.value = v === null || v === undefined ? "" : String(v);
    return i;
  };
  const autoBan = box(cfg.auto_ban);
  const capBan = box(cfg.captcha_ban);
  const strikes = num(cfg.captcha_ban_strikes, "10");
  strikes.min = "1";
  const signup = num(cfg.signup_cap, String(s.signup_cap_default));
  const networkCap = num(cfg.network_cap, "5");
  parts.push(el("span", "", "AUTO-BAN (flags set to BAN ban for real)"), autoBan,
    el("span", "", "CAPTCHA BAN (missed captchas ban)"), capBan,
    el("span", "", "...after this many misses in total"), strikes,
    el("span", "", `new accounts per network per day (empty = server default ${s.signup_cap_default}, 0 = no limit)`), signup,
    el("span", "", "named accounts per network, ever (0 = no limit; existing accounts stay)"), networkCap);
  const save = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SAVE SETTINGS ]"));
  save.type = "button";
  save.addEventListener("click", async () => {
    const settings = {
      modes: Object.fromEntries(Object.entries(selects).map(([k, sel]) => [k, sel.value])),
      auto_ban: autoBan.checked, captcha_ban: capBan.checked,
      captcha_ban_strikes: Number(strikes.value) || 10,
      signup_cap: signup.value.trim() === "" ? null : Number(signup.value),
      network_cap: networkCap.value.trim() === "" ? 5 : Number(networkCap.value),
    };
    try {
      const res = await call("/api/admin/action", { action: "bot_settings", settings });
      log(res.message, true);
      botSettingsDrawn = false;
      loadSuspects(true);
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
  const warn = el("span", "hint bot-wide", "BAN modes do nothing until AUTO-BAN is ticked. a ban can always be undone under [ BANNED ].");
  const wrap = el("span", "bot-wide");
  wrap.append(save);
  host.replaceChildren(...parts, warn, wrap);
}

/** @param {{player_id: string, name: string}[]} list */
function renderWhitelist(list) {
  $("bot-wl-count").textContent = list.length ? `:: ${list.length}` : "";
  const rows = list.map((w) => {
    const line = el("div", "");
    const btn = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ REMOVE ]"));
    btn.type = "button";
    btn.addEventListener("click", async () => {
      try {
        log((await call("/api/admin/action", { action: "whitelist_remove", player: w.player_id })).message, true);
        loadSuspects(true);
      } catch (e) {
        log(/** @type {Error} */ (e).message, false);
      }
    });
    line.append(`${w.name} `, btn);
    return line;
  });
  $("bot-whitelist").replaceChildren(...(rows.length ? rows : [el("span", "hint", "nobody yet.")]));
}

// ------------------------------------------------------------ reports

async function loadReports() {
  try {
    renderReports(await call("/api/admin/reports"));
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** One block per reported player: their open reports and what to do about them. @param {any} data */
function renderReports(data) {
  /** @type {any[]} */
  const list = data.reports;
  const open = list.filter((r) => r.status === "open");
  const people = new Set(open.map((r) => r.target_id)).size;
  $("report-count").textContent = people ? `:: ${people} PLAYER${people === 1 ? "" : "S"}` : "";
  const now = Date.now() / 1000;
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const r of open) groups.set(r.target_id, [...(groups.get(r.target_id) ?? []), r]);
  const blocks = [...groups.values()].map((rs) => {
    const first = rs[0];
    const box = el("div", "report-group");
    const who = el("div", "appeal-who");
    who.append(playerLink(first.target, first.target_id), `${first.target_banned ? " (BANNED)" : ""}  `);
    who.append(el("span", "appeal-meta", `${rs.length} open report${rs.length === 1 ? "" : "s"}`));
    box.append(who);
    for (const r of rs) {
      const item = el("div", "report-item");
      item.append(el("span", "appeal-meta", `${ago(now - r.at)} ago :: ${r.reporter} :: `), r.reason_label,
        ...(r.note ? [el("span", "appeal-meta", ` :: "${r.note}"`)] : []));
      if (r.chat_text) item.append(el("div", "report-quote", `chat: "${r.chat_text}"`));
      box.append(item);
    }
    const form = /** @type {HTMLFormElement} */ (el("form", "appeal-acts"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "player";
    id.value = first.target_id;
    const btn = (/** @type {string} */ label, /** @type {string} */ cls = "") => {
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${cls}`, label));
      b.type = "button";
      return b;
    };
    const look = btn("[ LOOK UP ]");
    look.addEventListener("click", () => submit(form, "lookup_player", look));
    const check = btn("[ CAPTCHA ]");
    check.addEventListener("click", () => submit(form, "push_captcha", check));
    const ban = btn("[ BAN ]", " danger");
    ban.addEventListener("click", async () => {
      await submit(form, "ban", ban);
      if (!ban.classList.contains("armed")) loadReports();
    });
    const settle = (/** @type {string} */ status, /** @type {HTMLButtonElement} */ b) => async () => {
      b.disabled = true;
      try {
        log((await call("/api/admin/action", { action: "resolve_reports", player: first.target_id, status })).message, true);
        loadReports();
        refresh();
      } catch (e) {
        log(/** @type {Error} */ (e).message, false);
        b.disabled = false;
      }
    };
    const done = btn("[ DONE ]");
    done.addEventListener("click", settle("done", done));
    const dismiss = btn("[ DISMISS ]");
    dismiss.addEventListener("click", settle("dismissed", dismiss));
    form.append(id, look, check, ...(first.target_banned ? [] : [ban]), done, dismiss);
    box.append(form);
    return box;
  });
  const handled = list.filter((r) => r.status !== "open").map((r) => {
    const box = el("div", "report-group handled");
    box.append(el("div", "appeal-who", `${r.target}  `), el("div", "appeal-meta",
      `  ${r.status.toUpperCase()} ${ago(now - (r.resolved_at ?? r.at))} ago :: from ${r.reporter} :: ${r.reason_label}`
      + (r.note ? ` :: "${r.note}"` : "") + (r.chat_text ? ` :: chat: "${r.chat_text}"` : "")));
    return box;
  });
  const parts = [...blocks];
  if (handled.length) parts.push(el("div", "hint", "HANDLED (latest)"), ...handled);
  $("report-list").replaceChildren(...(parts.length ? parts : [el("span", "hint", "no reports yet.")]));
}

// ------------------------------------------------------------ bounties

async function loadBounties() {
  try {
    renderBounties(await call("/api/admin/bounties"));
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** One admin action on a bounty post, then the list again. @param {string} action @param {any} body
 * @param {HTMLButtonElement} b */
async function bountyAct(action, body, b) {
  b.disabled = true;
  try {
    log((await call("/api/admin/action", { action, ...body })).message, true);
    loadBounties();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
    b.disabled = false;
  }
}

/** GAME > SPREAD THE WORD posts: the link, its upvotes, what it's owed. @param {any} data */
function renderBounties(data) {
  /** @type {any[]} */
  const list = data.posts;
  const open = list.filter((p) => p.status === "new").length;
  $("bounty-count").textContent = open ? `:: ${open} NEW` : "";
  const rateIn = /** @type {HTMLInputElement} */ ($("bounty-rate-form").querySelector("input[name=rate]"));
  if (document.activeElement !== rateIn) rateIn.value = String(data.rate);
  const now = Date.now() / 1000;
  const rows = list.map((p) => {
    const box = el("div", `report-group${p.status === "new" ? "" : " handled"}`);
    const who = el("div", "appeal-who", `${p.player}  `);
    who.append(el("span", "appeal-meta", `${p.status.toUpperCase()} :: posted ${ago(now - p.at)} ago`
      + (p.paid ? ` :: paid ${fmt(p.paid)} so far` : "")));
    const link = /** @type {HTMLAnchorElement} */ (el("a", "", p.title || p.url));
    link.href = p.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const unit = p.reddit ? "upvotes" : "likes";
    const facts = `${p.site} :: ` + (p.score === null || p.score === undefined
      ? (p.reddit ? "upvotes not checked yet" : "type its likes in")
      : `${fmt(p.score)} ${unit} (checked ${ago(now - p.checked_at)} ago)`
        + (p.subreddit ? ` :: r/${p.subreddit}` : "") + (p.author ? ` :: by u/${p.author}` : ""))
        + (p.gone ? " :: REMOVED / DELETED ON REDDIT" : "");
    const line = el("div", "report-item");
    line.append(link);
    box.append(who, line, el("div", "appeal-meta", facts));
    if (p.note) box.append(el("div", "appeal-meta", `your note: "${p.note}"`));
    if (p.status !== "rejected") {
      const acts = el("div", "appeal-acts");
      const note = /** @type {HTMLInputElement} */ (el("input", "appeal-reply"));
      note.placeholder = "note (optional, they see it)";
      note.maxLength = 200;
      // A new post with nothing owed can still be approved: that's what unlocks WORD OF MOUTH.
      const approve = !p.owed && p.status === "new";
      const pay = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
        p.owed ? `[ PAY ${fmt(p.owed)} ]` : approve ? "[ APPROVE ]" : "[ PAY ]"));
      pay.type = "button";
      pay.disabled = !p.owed && !approve;
      pay.title = p.owed ? "" : approve ? "a real post: approve it (unlocks WORD OF MOUTH, 1,000 <>) with nothing to pay yet"
        : "nothing new since the last payment";
      pay.addEventListener("click", () => bountyAct("bounty_pay", { bounty_id: p.id, note: note.value }, pay));
      const no = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ REJECT ]"));
      no.type = "button";
      no.addEventListener("click", () => bountyAct("bounty_reject", { bounty_id: p.id, note: note.value }, no));
      const votes = /** @type {HTMLInputElement} */ (el("input", "appeal-reply bounty-votes"));
      votes.type = "number";
      votes.min = "0";
      votes.placeholder = p.reddit ? "upvotes" : "likes";
      votes.title = "type the count yourself (any site but Reddit, or no Reddit app key)";
      const setVotes = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", p.reddit ? "[ SET UPVOTES ]" : "[ SET LIKES ]"));
      setVotes.type = "button";
      setVotes.addEventListener("click", () => bountyAct("bounty_score", { bounty_id: p.id, score: votes.value }, setVotes));
      acts.append(votes, setVotes, note, pay, no);
      box.append(acts);
    }
    return box;
  });
  $("bounty-list").replaceChildren(...(rows.length ? rows : [el("span", "hint", "no posts yet.")]));
}

// ------------------------------------------------------------ appeals

async function loadAppeals() {
  try {
    renderAppeals((await call("/api/admin/appeals")).appeals);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** @param {any[]} list */
function renderAppeals(list) {
  const open = list.filter((a) => a.status === "open").length;
  $("appeal-count").textContent = open ? `:: ${open} OPEN` : "";
  const now = Date.now() / 1000;
  const rows = list.map((a) => {
    const box = el("div", `appeal ${a.status}`);
    const why = a.ban_reason === "admin" ? "banned by hand" : a.ban_reason === "auto" ? "missed captchas"
      : a.ban_reason?.startsWith("auto: ") ? `bot scan: ${a.ban_reason.slice(6)}` : "ban reason unknown";
    const who = el("div", "appeal-who");
    who.append(playerLink(a.name, a.player_id), "  ");
    who.append(el("span", "appeal-meta", `${a.status.toUpperCase()} :: sent ${ago(now - a.at)} ago :: ${why}`
      + (a.banned_at ? ` :: banned ${ago(now - a.banned_at)} ago` : "")
      + ` :: captchas ${a.captcha.passed} ok / ${a.captcha.failed} miss`
      + (a.appeals > 1 ? ` :: appeal #${a.appeals}` : "")));
    box.append(who, el("div", "appeal-text", a.text));
    if (a.status === "open") {
      const acts = el("div", "appeal-acts");
      const reply = /** @type {HTMLInputElement} */ (el("input"));
      reply.placeholder = "reply (optional, they see it)";
      reply.maxLength = 300;
      const decide = (/** @type {string} */ action, /** @type {HTMLButtonElement} */ btn) => async () => {
        btn.disabled = true;
        try {
          log((await call("/api/admin/action", { action, appeal: a.id, reply: reply.value })).message, true);
          await loadAppeals();
          refresh();
        } catch (e) {
          log(/** @type {Error} */ (e).message, false);
          btn.disabled = false;
        }
      };
      const ok = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ ACCEPT + UNBAN ]"));
      const no = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DENY ]"));
      ok.type = no.type = "button";
      ok.addEventListener("click", decide("appeal_accept", ok));
      no.addEventListener("click", decide("appeal_deny", no));
      acts.append(reply, ok, no);
      box.append(acts);
    } else if (a.reply) {
      box.append(el("div", "appeal-meta", `  your reply: ${a.reply}`));
    }
    return box;
  });
  $("appeal-list").replaceChildren(...(rows.length ? rows : [el("span", "hint", "no appeals yet.")]));
}

const TICKET_STATUSES = ["new", "in_progress", "completed", "skipped"];
const TICKET_KINDS = ["issue", "feature"];
/** @type {any[]} */
let adminTickets = [];

/** Players' tickets: set the status + public note, or delete (two clicks).
 * @param {any[]} tickets */
/** [ TICKETS ] SORT: most wanted first, or by ticket number. @type {Record<string, (a: any, b: any) => number>} */
const TICKET_SORTS = {
  votes: (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || b.id - a.id,
  num_asc: (a, b) => a.id - b.id,
  num_desc: (a, b) => b.id - a.id,
};
const TICKET_SORT_KEY = "omhp.admin.ticket_sort";

function renderTickets(tickets) {
  adminTickets = tickets;
  const host = $("ticket-list");
  // Mid-edit or mid-confirm: don't redraw under the cursor.
  if (host.querySelector(".armed") || host.contains(document.activeElement)) return;
  const show = /** @type {HTMLSelectElement} */ ($("ticket-filter")).value;
  const showKind = /** @type {HTMLSelectElement} */ ($("ticket-kind-filter")).value;
  const t = Date.now() / 1000;
  const rows = tickets.filter((k) => show === "all" || (show === "open"
    ? k.status === "new" || k.status === "in_progress" : k.status === show))
    .filter((k) => showKind === "all" || k.kind === showKind)
    .sort(TICKET_SORTS[/** @type {HTMLSelectElement} */ ($("ticket-sort")).value] ?? TICKET_SORTS.votes)
    .map((k) => {
    const row = el("div", `ticket-admin st-${k.status}`);
    const head = el("div", "ticket-admin-head");
    head.append(
      el("span", `poll-admin-state ticket-admin-state`, `#${k.id} ${k.status.replace("_", " ").toUpperCase()}`),
      el("span", `ticket-admin-kind tk-${k.kind}`, (k.kind ?? "issue").toUpperCase()),
      el("span", "ticket-admin-title", k.title),
      el("span", "ticket-admin-votes", `+${fmt(k.votes ?? 0)}${k.downs ? ` -${fmt(k.downs)}` : ""}`),
      playerLink(k.name, k.player_id),
      el("span", "hint", ` · ${ago(t - k.created_at)} ago`),
    );
    row.append(head);
    if (k.body) row.append(el("div", "ticket-admin-body hint", k.body));

    const form = /** @type {HTMLFormElement} */ (el("form", "ticket-admin-form"));
    const status = /** @type {HTMLSelectElement} */ (el("select"));
    status.setAttribute("aria-label", `status of ticket ${k.id}`);
    for (const s of TICKET_STATUSES) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", s.replace("_", " ")));
      o.value = s;
      o.selected = s === k.status;
      status.append(o);
    }
    const kind = /** @type {HTMLSelectElement} */ (el("select"));
    kind.setAttribute("aria-label", `type of ticket ${k.id}`);
    for (const s of TICKET_KINDS) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", s));
      o.value = s;
      o.selected = s === k.kind;
      kind.append(o);
    }
    const note = /** @type {HTMLInputElement} */ (el("input", "ticket-admin-note"));
    note.maxLength = 300;
    note.placeholder = "note shown on the ticket (optional)";
    note.value = k.note ?? "";
    note.setAttribute("aria-label", `note on ticket ${k.id}`);
    const save = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SAVE ]"));
    // One click instead of dropdown + SAVE. DONE pays the author 100 shards (once per ticket).
    /** @param {string} label @param {string} to @param {string} title */
    const quick = (label, to, title) => {
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn tk-quick tk-to-${to}`, label));
      b.type = "button";
      b.title = title;
      b.disabled = k.status === to;
      b.addEventListener("click", () => {
        status.value = to;
        if (to === "completed" && !note.value.trim()) note.value = k.kind === "feature" ? "added" : "fixed";
        form.requestSubmit(save);
      });
      return b;
    };
    form.append(quick("[ DONE ]", "completed", "completed: the author gets 100 shards (once). an empty note becomes fixed / added"),
      quick("[ WORKING ]", "in_progress", "mark it in progress"),
      quick("[ SKIP ]", "skipped", "skipped: no reward"),
      el("span", "tk-sep", " "), kind, status, note, save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        // Sent by hand (not params()) so an emptied note clears it.
        const res = await call("/api/admin/action", {
          action: "set_ticket", ticket_id: k.id, kind: kind.value, status: status.value, note: note.value,
        });
        log(res.message, true);
        save.blur();
        await refresh();
      } catch (err) {
        log(/** @type {Error} */ (err).message, false);
      }
    });

    const delForm = /** @type {HTMLFormElement} */ (el("form", "ticket-admin-del"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "ticket_id";
    id.value = String(k.id);
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    delForm.append(id, del);
    delForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(delForm, "delete_ticket", del);
    });
    const actions = el("div", "ticket-admin-actions");
    actions.append(form, delForm);
    row.append(actions);
    // Players' comments (ticket #107), each with its own delete.
    for (const cm of k.comments ?? []) {
      const line = el("div", "ticket-admin-comment");
      const drop = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ X ]"));
      drop.title = "delete this comment";
      drop.addEventListener("click", async () => {
        try {
          const res = await call("/api/admin/action", { action: "delete_ticket_comment", comment_id: cm.id });
          log(res.message, true);
          await refresh();
        } catch (err) {
          log(/** @type {Error} */ (err).message, false);
        }
      });
      line.append(drop, " ", el("b", "", cm.name), `: ${cm.body}`);
      row.append(line);
    }
    return row;
  });
  const counts = [...TICKET_KINDS.map((s) => `${s}s ${tickets.filter((k) => k.kind === s).length}`),
    ...TICKET_STATUSES.map((s) => `${s.replace("_", " ")} ${tickets.filter((k) => k.status === s).length}`)];
  host.replaceChildren(el("p", "hint", counts.join("  ·  ")),
    ...(rows.length ? rows : [el("p", "hint", "no tickets here.")]));
}

/** Every poll with its counts and a [ DELETE ] (two clicks). @param {any[]} polls */
function renderPolls(polls) {
  const host = $("poll-list");
  if (host.querySelector(".armed")) return; // mid-confirm: don't redraw under the click
  const t = Date.now() / 1000;
  const rows = polls.map((p) => {
    const closed = p.closed || p.ends_at <= t;
    const total = p.yes + p.no;
    const pct = total ? Math.round((100 * p.yes) / total) : 0;
    const form = /** @type {HTMLFormElement} */ (el("form", "poll-admin"));
    form.dataset.action = "delete_poll";
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "poll_id";
    id.value = String(p.id);
    const status = closed ? (p.passed ? "PASSED" : "FAILED") : `OPEN ${duration(p.ends_at - t)} left`;
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    form.append(
      id,
      el("span", `poll-admin-state ${closed ? (p.passed ? "ok" : "dim") : "live"}`, `#${p.id} ${status}`),
      el("span", "poll-admin-q", p.question),
      el("span", "hint", `YES ${fmt(p.yes)} / NO ${fmt(p.no)} (${pct}% yes)`),
      del,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(form, "delete_poll", del);
    });
    const comments = (p.comments ?? []).map((/** @type {any} */ cm) => { // ticket #308
      const line = el("div", "ticket-admin-comment");
      const drop = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ X ]"));
      drop.type = "button";
      drop.title = "delete this comment";
      drop.addEventListener("click", async () => {
        try {
          const res = await call("/api/admin/action", { action: "delete_poll_comment", comment_id: cm.id });
          log(res.message, true);
          await refresh();
        } catch (err) {
          log(/** @type {Error} */ (err).message, false);
        }
      });
      line.append(drop, " ", el("b", "", cm.name), `: ${cm.body}`);
      return line;
    });
    if (!comments.length) return form;
    const wrap = el("div", "");
    wrap.append(form, ...comments);
    return wrap;
  });
  host.replaceChildren(...(rows.length ? rows : [el("p", "hint", "no polls yet.")]));
}

/** Two-click confirm for destructive buttons: first click arms for 3 s.
 * @type {WeakMap<HTMLElement, {label: string, timer: number}>} */
const armed = new WeakMap();

/** @param {HTMLElement} btn */
function disarm(btn) {
  const a = armed.get(btn);
  if (!a) return;
  clearTimeout(a.timer);
  btn.classList.remove("armed");
  btn.textContent = a.label;
  armed.delete(btn);
}

/** @param {HTMLFormElement} form @param {string} action @param {HTMLButtonElement | HTMLElement | null} btnIn */
async function submit(form, action, btnIn) {
  const btn = /** @type {HTMLButtonElement | null} */ (btnIn);
  // data-confirm-empty="field": ask twice only when that field is left empty (e.g. "everyone").
  const emptyField = form.dataset.confirmEmpty;
  const risky = emptyField
    ? !(/** @type {HTMLInputElement | null} */ (form.elements.namedItem(emptyField))?.value.trim())
    : false;
  // Setting HP to 0 kills the boss: that asks twice too.
  const killing = action === "set_hp"
    && /** @type {HTMLInputElement | null} */ (form.elements.namedItem("hp"))?.value.trim() === "0";
  // data-safe: a switch you can flip straight back (2X, MEOW, the forge): no second click.
  const safe = btn?.hasAttribute("data-safe");
  if (btn && !safe && (form.hasAttribute("data-confirm") || btn.classList.contains("danger") || risky || killing)) {
    if (!armed.has(btn)) {
      armArm(btn);
      return;
    }
    disarm(btn);
  }
  // data-type-confirm="WIPE": the truly destructive ones want the word typed.
  const word = form.dataset.typeConfirm;
  if (word && window.prompt(`This can't be undone. Type ${word} to go ahead.`)?.trim().toUpperCase() !== word) {
    log("Cancelled: nothing changed.", false);
    return;
  }
  if (btn?.disabled) return; // already sent: a double click doesn't send it twice
  if (btn) btn.disabled = true;
  try {
    const res = await call("/api/admin/action", { action, ...params(form), announce: announcing() });
    log(res.message, true);
    if (action === "set_passcode") {
      showLogin();
      return;
    }
    // Clear the form, but keep who it was for: the next action is usually on the same player.
    const keep = [...form.querySelectorAll("input[name=player]")].map((i) => /** @type {HTMLInputElement} */ (i).value);
    form.reset();
    form.querySelectorAll("input[name=player]").forEach((i, n) => (/** @type {HTMLInputElement} */ (i).value = keep[n] ?? ""));
    await refresh();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** The first click on a risky button: it says which action it's about to do. @param {HTMLButtonElement} btn */
function armArm(btn) {
  const label = btn.textContent ?? "";
  const what = label.replace(/^\[\s*|\s*\]$/g, "");
  armed.set(btn, { label, timer: window.setTimeout(() => disarm(btn), 5000) });
  btn.classList.add("armed");
  btn.textContent = `[ SURE? ${what} ]`;
}

/* -------------------------------------------------------- [ SERVER HEALTH ] */

/** @type {ReturnType<typeof setInterval> | undefined} */
let healthTimer;

/** @param {number} n */
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const LEVEL = /** @type {Record<string, string>} */ ({ ok: "OK", watch: "WATCH", bad: "BAD" });

async function loadHealth() {
  try {
    renderHealth(await call("/api/admin/health"));
  } catch (e) {
    $("health-badge").textContent = "[ ? ]";
    $("health-report").textContent = `couldn't check: ${/** @type {Error} */ (e).message}`;
  }
}

/** @param {any} h */
function renderHealth(h) {
  const badge = $("health-badge");
  badge.textContent = `[ ${LEVEL[h.status] ?? h.status} ]`;
  badge.className = `health-badge h-${h.status}`;
  $("health-when").textContent = `checked ${new Date(h.at * 1000).toLocaleTimeString()} :: up ${duration(h.uptime_s)}`;
  const r = h.requests, l = h.lag, s = h.system, d = h.database, g = h.game, c = h.checks;
  const pre = $("health-report");
  pre.replaceChildren();
  /** One row: label, text, and the check it belongs to (coloured [ok]/[watch]/[bad]). @param {string} label @param {string} text @param {string} [check] */
  const line = (label, text, check) => {
    pre.append(padR(label, 14), text);
    if (check) {
      const lv = c[check];
      pre.append("  ", el("span", `h-${lv}`, `[${(LEVEL[lv] ?? lv).toLowerCase()}]`));
    }
    pre.append("\n");
  };
  const ms = (/** @type {number} */ v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}ms`;
  const clock = (/** @type {number} */ t) => new Date(t * 1000).toLocaleTimeString();
  const sinceStart = (/** @type {number} */ t) => {
    const s = t - h.started_at;
    return s < 600 ? `, ${Math.round(s)}s after the restart` : "";
  };
  if (h.warming) {
    pre.append(el("span", "h-watch", `> the server restarted ${duration(h.uptime_s)} ago. everyone reconnects at once,\n`
      + "  so a short stall is normal: BAD shows as WATCH for the first 3 minutes.\n\n"));
  }
  line("LOOP LAG", `now ${ms(l.now_ms)} :: worst 1m ${ms(l.max_1m_ms)} :: worst 5m ${ms(l.max_5m_ms)}`
    + (l.worst_at && l.max_5m_ms >= 100 ? ` (at ${clock(l.worst_at)}${sinceStart(l.worst_at)})` : ""), "loop lag");
  line("REQUESTS", `${fmt(Math.round(r.per_min))}/min (last ${r.minutes} min) :: ${r.slow} slow (250ms+)`);
  line("RESPONSE", `avg ${ms(r.avg_ms)} :: p95 ${ms(r.p95_ms)} :: p99 ${ms(r.p99_ms)} :: max ${ms(r.max_ms)}`,
    "response time");
  line("ERRORS", `${r.errors} server error${r.errors === 1 ? "" : "s"} (5xx) in ${r.minutes} min`, "errors");
  line("CPU", `game ${h.process.cpu_pct}% of a core :: load ${s.load.join(" ")} (${s.cpus} cores)`, "cpu load");
  line("MEMORY", `game ${mb(h.process.rss_bytes)} :: machine `
    + (s.mem_total ? `${mb(s.mem_available)} free of ${mb(s.mem_total)}` : "n/a"), "memory");
  line("DISK", `${mb(s.disk_free)} free of ${mb(s.disk_total)} (${Math.round((100 * s.disk_free) / s.disk_total)}%)`,
    "disk");
  line("DATABASE", `${mb(d.bytes)} :: ${d.backups} backup${d.backups === 1 ? "" : "s"}`
    + (d.newest_backup_at ? `, newest ${ago(Date.now() / 1000 - d.newest_backup_at)} ago (${mb(d.newest_backup_bytes)})` : ""));
  line("PLAYERS", `${fmt(g.online)} online (${fmt(g.sockets)} live connections) :: ${fmt(g.players)} named`);
  line("BOSS", `#${g.boss_seq} ${g.boss_status} :: ${fmt(g.boss_hp)} HP`);
  // Requests per minute, last 15 minutes, as a row of ASCII bars.
  const top = Math.max(1, ...r.chart);
  const ramp = " .:-=+*#%@";
  pre.append("\n", padR("REQ/MIN 15m", 14), el("span", "health-chart",
    `[${r.chart.map((/** @type {number} */ n) => ramp[Math.min(9, Math.round((n / top) * 9))]).join("")}] peak ${fmt(top)}`), "\n");
  // The evidence for a red badge: when the game stalled, and what was slow around then.
  if (h.stalls.length) {
    pre.append("\n", el("span", "dim", "RECENT STALLS (the game froze for 100ms+)\n"));
    for (const st of h.stalls.slice(-8).reverse()) {
      pre.append(`${padR(clock(st.at), 14)}`, el("span", st.ms >= 500 ? "h-bad" : "h-watch", ms(st.ms)), `${sinceStart(st.at)}\n`);
    }
  }
  if (h.slow_requests.length) {
    pre.append("\n", el("span", "dim", "SLOW REQUESTS (250ms+)\n"));
    for (const q of h.slow_requests.slice(-8).reverse()) {
      pre.append(`${padR(clock(q.at), 14)}${padR(q.route.slice(0, 33), 34)}${padR(ms(q.ms), 9)}${q.status}${sinceStart(q.at)}\n`);
    }
  }
  if (r.busiest.length) {
    pre.append("\n", el("span", "dim", "WHERE THE TIME WENT (last 5 min)\n"));
    pre.append(el("span", "dim", `${padR("ROUTE", 34)}${padR("COUNT", 8)}${padR("AVG", 9)}${padR("MAX", 9)}TOTAL\n`));
    for (const b of r.busiest) {
      const total = b.total_ms >= 1000 ? `${(b.total_ms / 1000).toFixed(1)}s` : ms(b.total_ms);
      pre.append(`${padR(b.route.slice(0, 33), 34)}${padR(fmt(b.count), 8)}${padR(ms(b.avg_ms), 9)}${padR(ms(b.max_ms), 9)}${total}\n`);
    }
  }
}

/* ------------------------------------------- [ AUCTION ] [ CITY ] [ REFERRALS ] */

/** [ LOOK UP ] for one player (the answer lands in the log). @param {string} playerId */
function lookupButton(playerId) {
  const form = /** @type {HTMLFormElement} */ (el("form", "inline-form"));
  const id = /** @type {HTMLInputElement} */ (el("input"));
  id.type = "hidden";
  id.name = "player";
  id.value = playerId;
  const look = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ LOOK UP ]"));
  look.type = "button";
  look.addEventListener("click", () => submit(form, "lookup_player", look));
  form.append(id, look);
  return form;
}

/** A table: header labels, then rows of cells (strings or nodes). @param {string[]} head @param {(string | Node)[][]} rows */
function table(head, rows) {
  const wrap = el("div", "suspect-scroll");
  const t = el("table", "suspect-table market-table");
  const hr = el("tr");
  for (const h of head) hr.append(el("th", "", h));
  const thead = el("thead");
  thead.append(hr);
  const tbody = el("tbody");
  for (const cells of rows) {
    const tr = el("tr");
    for (const c of cells) {
      const td = el("td");
      td.append(c);
      tr.append(td);
    }
    tbody.append(tr);
  }
  if (!rows.length) {
    const tr = el("tr");
    const td = /** @type {HTMLTableCellElement} */ (el("td", "hint", "nothing yet."));
    td.colSpan = head.length;
    tr.append(td);
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

/** An item's name in its rarity colour. @param {string} name @param {string} itemId */
function itemName(name, itemId) {
  const rarity = ov?.items?.find((/** @type {any} */ i) => i.id === itemId)?.rarity ?? "common";
  return el("span", `r-${rarity}`, name);
}

/** @type {any} */
let auctionData = null;

async function loadAuction() {
  try {
    auctionData = await call("/api/admin/auction");
    renderAuction();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

function renderAuction() {
  const a = auctionData;
  if (!a) return;
  const q = /** @type {HTMLInputElement} */ ($("auction-search")).value.trim().toUpperCase();
  const hit = (/** @type {string[]} */ ...texts) => !q || texts.some((t) => String(t).toUpperCase().includes(q));
  $("auction-count").textContent = `(${fmt(a.open)} open)`;
  $("auction-totals").textContent = `LAST 24H ${fmt(a.day.n)} sales · ${fmt(a.day.paid)} <> traded · ${fmt(a.day.fee)} <> fees   `
    + `ALL TIME ${fmt(a.ever.n)} sales · ${fmt(a.ever.paid)} <> · ${fmt(a.ever.fee)} <> fees (${a.fee_pct}%)`;
  const now = Date.now() / 1000;
  const listings = a.listings.filter((/** @type {any} */ l) => hit(l.name, l.seller)).map((/** @type {any} */ l) => {
    const cancel = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ CANCEL ]"));
    const form = /** @type {HTMLFormElement} */ (el("form", "inline-form"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "listing_id";
    id.value = String(l.id);
    form.append(id, cancel);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submit(form, "cancel_listing", cancel);
      if (!cancel.classList.contains("armed")) void loadAuction();
    });
    return [`#${l.id}`, itemName(l.name, l.item_id), fmt(l.count), `${fmt(l.price)} <>`, fmt(l.price * l.count),
      l.seller, `${ago(now - l.listed_at)} ago`, `in ${duration(Math.max(0, l.expires_at - now))}`, form];
  });
  const sales = a.sales.filter((/** @type {any} */ s) => hit(s.name, s.seller, s.buyer)).map((/** @type {any} */ s) =>
    [`${ago(now - s.at)} ago`, itemName(s.name, s.item_id), fmt(s.count), s.seller, s.buyer,
      `${fmt(s.paid)} <>`, `${fmt(s.fee)} <>`]);
  $("auction-body").replaceChildren(
    el("div", "market-h", "OPEN LISTINGS"),
    table(["#", "ITEM", "LEFT", "EACH", "TOTAL", "SELLER", "LISTED", "ENDS", ""], listings),
    el("div", "market-h", "LATEST SALES"),
    table(["WHEN", "ITEM", "COUNT", "SELLER", "BUYER", "PAID", "FEE"], sales),
  );
}

async function loadCity() {
  try {
    const { view: v, recent } = await call("/api/admin/city");
    const st = v.stage;
    const pctDone = st.goal ? Math.min(100, (100 * st.progress) / st.goal) : 0;
    $("city-count").textContent = `(${v.city.name} :: ${st.name} ${pctDone.toFixed(0)}%)`;
    const now = Date.now() / 1000;
    const perks = Object.entries(v.perks?.active ?? v.perks ?? {})
      .filter(([, x]) => x && typeof x === "object" && "text" in /** @type {any} */ (x))
      .map(([, x]) => /** @type {any} */ (x).text);
    const summary = el("pre", "health-report", [
      `CITY ${v.city.no + 1}  ${v.city.name}   STAGE ${st.stage_no + 1}  ${st.name}`,
      `PROGRESS ${fmt(st.progress)} / ${fmt(st.goal)} points  (${pctDone.toFixed(1)}%)  ${fmt(Math.max(0, st.goal - st.progress))} to go`,
      `DONORS THIS STAGE ${fmt(v.donors)}   THIS CITY ${fmt(v.city.donors)}   ALL-TIME POINTS ${fmt(v.total)}`,
      `BUILT ${v.built.map((/** @type {any} */ b) => b.name).join(", ") || "nothing yet"}`,
      ...(perks.length ? [`PERKS ${perks.join(" · ")}`] : []),
    ].join("\n"));
    const ranked = (/** @type {any[]} */ rows) => rows.map((r, i) => [`${i + 1}.`, r.name, `${fmt(r.points)} pts`, lookupButton(r.player_id)]);
    const gifts = recent.map((/** @type {any} */ d) => [`${ago(now - d.at)} ago`, d.name,
      d.kind === "shards" ? `${fmt(d.count)} <>` : `${fmt(d.count)}x ${d.ref || d.kind}`, d.kind, `${fmt(d.points)} pts`]);
    $("city-body").replaceChildren(summary,
      el("div", "market-h", "THIS STAGE'S TOP DONORS"), table(["#", "PLAYER", "POINTS", ""], ranked(v.ranking ?? [])),
      el("div", "market-h", "THIS CITY'S TOP DONORS"), table(["#", "PLAYER", "POINTS", ""], ranked((v.city.ranking ?? []).slice(0, 10))),
      el("div", "market-h", "LATEST DONATIONS"), table(["WHEN", "PLAYER", "GAVE", "KIND", "WORTH"], gifts));
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** @type {any} */
let referralData = null;

async function loadReferrals() {
  try {
    referralData = await call("/api/admin/referrals");
    renderReferrals();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

function renderReferrals() {
  const r = referralData;
  if (!r) return;
  const onlyFlagged = /** @type {HTMLInputElement} */ ($("referral-flagged")).checked;
  $("referral-count").textContent = `(${fmt(r.total)} used${r.flagged ? ` · ${fmt(r.flagged)} flagged` : ""})`;
  const now = Date.now() / 1000;
  const owners = r.owners.map((/** @type {any} */ o) => [o.name, `${fmt(o.uses)} / ${fmt(r.max_uses)}`, fmt(o.paid),
    o.flagged ? el("span", "flag", fmt(o.flagged)) : "0", lookupButton(o.player_id)]);
  const recent = r.recent.filter((/** @type {any} */ x) => !onlyFlagged || x.flags.length).map((/** @type {any} */ x) => [
    `${ago(now - x.at)} ago`, x.redeemer, x.referrer, fmt(x.attacks), x.paid ? "yes" : "not yet",
    x.flags.length ? el("span", "flag", x.flags.join(" · ")) : "", lookupButton(x.redeemer_id)]);
  $("referral-body").replaceChildren(
    el("p", "hint", `${fmt(r.total)} codes used, ${fmt(r.paid)} owners paid (${fmt(r.shards)} <> each side; up to ${fmt(r.max_uses)} friends per code).`),
    el("div", "market-h", "TOP CODE OWNERS"), table(["OWNER", "USED", "PAID", "FLAGGED", ""], owners),
    el("div", "market-h", "LATEST"), table(["WHEN", "FRIEND", "CODE OF", "FRIEND'S ATTACKS", "OWNER PAID", "FLAGS", ""], recent));
}

/* -------------------------------------------------------------- [ BANNED ] */

async function loadBanned() {
  try {
    renderBanned((await call("/api/admin/banned")).players);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** @param {any[]} players */
function renderBanned(players) {
  $("banned-count").textContent = `(${players.length})`;
  const now = Date.now() / 1000;
  const rows = players.map((p) => {
    const tr = el("tr", "");
    const form = /** @type {HTMLFormElement} */ (el("form"));
    form.dataset.confirm = ""; // unbanning asks twice
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "player";
    id.value = p.id;
    const look = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ LOOK UP ]"));
    look.type = "button";
    look.addEventListener("click", () => submit(form, "lookup_player", look));
    const unban = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ UNBAN ]"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await submit(form, "unban", unban);
      if (!unban.classList.contains("armed")) void loadBanned();
    });
    form.append(id, look, " ", unban);
    const name = el("td", "suspect-name");
    name.append(playerLink(p.name, p.id));
    const net = p.network.length
      ? p.network.map((/** @type {any} */ o) => `${o.name}${o.banned ? " (BANNED)" : ""} ${fmt(o.total_attacks)} att, made ${ago(now - o.created_at)} ago`).join("\n")
      : "--";
    const netCell = el("td", "banned-net", net);
    const why = p.reason === "auto" ? "AUTO (captcha)" : p.reason === "admin" ? "ADMIN"
      : p.reason?.startsWith("auto: ") ? `AUTO (bot scan): ${p.reason.slice(6)}` : "--";
    const captcha = p.captcha.passed || p.captcha.failed ? `${p.captcha.passed} ok / ${p.captcha.failed} miss` : "--";
    const acts = el("td", "suspect-acts");
    acts.append(form);
    tr.append(name, el("td", "", p.banned_at ? `${ago(now - p.banned_at)} ago` : "--"), el("td", "", why),
      el("td", "", fmt(p.total_attacks)), el("td", "", fmt(p.total_damage)), el("td", "", captcha), netCell, acts);
    return tr;
  });
  if (!rows.length) {
    const td = /** @type {HTMLTableCellElement} */ (el("td", "hint", "nobody is banned."));
    td.colSpan = 8;
    const tr = el("tr", "");
    tr.append(td);
    rows.push(tr);
  }
  $("banned-rows").replaceChildren(...rows);
}

/* ---------------------------------------------------------------- [ CHAT ] */

/** @param {string} action @param {Record<string, unknown>} body */
async function chatAction(action, body) {
  try {
    const res = await call("/api/admin/action", { action, ...body, announce: false });
    log(res.message, true);
    await refresh();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** The newest 100 messages, newest first, each with [ DELETE ]. @param {any[]} msgs */
function renderChatAdmin(msgs) {
  const host = $("chat-admin-list");
  $("chat-hint").textContent = `${fmt(msgs.length)}${msgs.length >= 100 ? "+" : ""} messages`;
  if (host.querySelector(".armed")) return;
  const t = Date.now() / 1000;
  host.replaceChildren(...(msgs.length ? [...msgs].reverse().map((m) => {
    const row = el("div", "chat-admin-row");
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    del.type = "button";
    del.addEventListener("click", () => chatAction("delete_chat", { id: m.id }));
    row.append(el("span", "hint", `${ago(t - m.t)} ago `), el("b", "", m.name), el("span", "", `: ${m.text} `), del);
    return row;
  }) : [el("p", "hint", "nobody has chatted yet.")]));
}

/** The player [ MESSAGES ] is looking at, and the open conversation. */
const dmView = { player: "", a: "", b: "" };

/** Everyone a player has messaged with; click one to read it. */
async function loadDmPlayer() {
  const host = $("dms-player");
  if (!dmView.player) {
    host.replaceChildren();
    return;
  }
  try {
    const r = await call(`/api/admin/dms?player=${encodeURIComponent(dmView.player)}`);
    const t = Date.now() / 1000;
    const rows = r.conversations.map((/** @type {any} */ c) => {
      const row = el("div", "chat-admin-row");
      const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ OPEN ]"));
      open.type = "button";
      open.addEventListener("click", () => openDmThread(r.player_id, c.player_id));
      row.append(el("b", "", `${r.name} <-> ${c.name} `), el("span", "hint", `${ago(t - c.last.t)} ago: `),
        el("span", "", `${c.last.text} `), open);
      return row;
    });
    host.replaceChildren(el("div", "market-h", `${r.name}'S CONVERSATIONS (${r.conversations.length})`),
      ...(rows.length ? rows : [el("p", "hint", `${r.name} hasn't messaged anyone.`)]),
      ...(r.blocked.length ? [el("p", "hint", `${r.name} blocked: ${r.blocked.map((/** @type {any} */ b) => b.name).join(", ")}`)] : []));
  } catch (e) {
    host.replaceChildren(el("p", "hint", /** @type {Error} */ (e).message));
  }
}

/** Every stored message between two players. @param {string} a @param {string} b */
async function openDmThread(a, b) {
  dmView.a = a;
  dmView.b = b;
  const host = $("dms-thread");
  try {
    const r = await call(`/api/admin/dms?player=${encodeURIComponent(a)}&with=${encodeURIComponent(b)}`);
    const t = Date.now() / 1000;
    const close = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ CLOSE ]"));
    close.type = "button";
    close.addEventListener("click", () => {
      dmView.a = dmView.b = "";
      host.replaceChildren();
    });
    const head = el("div", "market-h", `${r.a.name} <-> ${r.b.name} (${r.messages.length} messages) `);
    head.append(close);
    host.replaceChildren(head, ...(r.messages.length ? r.messages.map((/** @type {any} */ m) => {
      const row = el("div", "chat-admin-row");
      const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
      del.type = "button";
      del.addEventListener("click", async () => {
        await chatAction("delete_dm", { id: m.id });
        openDmThread(a, b);
      });
      row.append(el("span", "hint", `${ago(t - m.t)} ago `), el("b", "", m.from_name ?? "?"),
        el("span", "", `: ${m.text} `), el("span", "hint", m.read ? "(read) " : "(unread) "), del);
      return row;
    }) : [el("p", "hint", "no messages left between them.")]));
    host.scrollIntoView({ block: "nearest" });
  } catch (e) {
    host.replaceChildren(el("p", "hint", /** @type {Error} */ (e).message));
  }
}

/** Private messages, newest first, each with [ DELETE ]. @param {any[]} msgs */
function renderDmsAdmin(msgs) {
  const host = $("dms-admin-list");
  $("dms-hint").textContent = `${fmt(msgs.length)}${msgs.length >= 100 ? "+" : ""} messages`;
  const t = Date.now() / 1000;
  host.replaceChildren(...(msgs.length ? msgs.map((m) => {
    const row = el("div", "chat-admin-row");
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    del.type = "button";
    del.addEventListener("click", () => chatAction("delete_dm", { id: m.id }));
    const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ OPEN ]"));
    open.type = "button";
    open.title = "read their whole conversation";
    open.addEventListener("click", () => openDmThread(m.from_id, m.to_id));
    row.append(el("span", "hint", `${ago(t - m.t)} ago `), el("b", "", m.from_name ?? "?"), el("span", "hint", " -> "),
      el("b", "", m.to_name ?? "?"), el("span", "", `: ${m.text} `), open, del);
    return row;
  }) : [el("p", "hint", "no private messages yet.")]));
}

/** Clans folded open in [ CLANS ] (kept across refreshes). @type {Set<number>} */
const openClans = new Set();
/** The clans last listed, so a refresh with nothing new leaves the folds alone. */
let clanListKey = "";

/** "{ } NAME" in the clan's colour. @param {any} k */
function clanLabel(k) {
  const [o, c] = Array.from(/** @type {string} */ (k.brackets));
  const s = el("span", "");
  const look = el("b", "", `${o} ${c} `);
  look.style.color = k.color;
  s.append(look, el("b", "", k.name));
  return s;
}

/** One clan on its own: who's in it, who was kicked, its CLAN CHAT, [ BREAK UP ].
 * @param {number} id @param {HTMLElement} host */
async function showClanAdmin(id, host) {
  try {
    const k = await call(`/api/admin/clans/${id}`);
    if (!openClans.has(id)) return; // folded shut while it loaded
    const t = Date.now() / 1000;
    const members = k.members.map((/** @type {any} */ m) => el("div", "",
      `  ${m.name}${m.leader ? " (leader)" : ""}${m.banned ? " (BANNED)" : ""} :: joined ${ago(t - m.joined_at)} ago`));
    const chat = k.messages.map((/** @type {any} */ m) => {
      const row = el("div", "chat-admin-row");
      const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
      del.type = "button";
      del.addEventListener("click", async () => {
        await chatAction("delete_clan_message", { id: m.id });
        showClanAdmin(id, host);
      });
      row.append(el("span", "hint", `${ago(t - m.t)} ago `), el("b", "", m.name), el("span", "", `: ${m.text} `), del);
      return row;
    });
    const brk = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ BREAK UP THIS CLAN ]"));
    brk.type = "button";
    brk.title = "deletes the clan and its clan chat; members go back to [ ]. no refund";
    brk.addEventListener("click", async () => {
      if (!brk.classList.contains("armed")) {
        brk.classList.add("armed");
        brk.textContent = "[ SURE? BREAK UP + DELETE ITS CHAT ]";
        return;
      }
      openClans.delete(id);
      await chatAction("delete_clan", { id });
    });
    const head = el("div", "clan-admin-head");
    head.append(el("span", "hint", `founded by ${k.founder ?? "?"} ${ago(t - k.created_at)} ago, led by ${k.leader ?? "?"} `), brk);
    host.replaceChildren(head,
      el("div", "market-h", `MEMBERS (${k.members.length})`), ...members,
      ...(k.kicked.length ? [el("p", "hint", `kicked (can't rejoin): ${k.kicked.join(", ")}`)] : []),
      el("div", "market-h", `${k.name}'S CLAN CHAT (${k.messages.length}, newest last)`),
      ...(chat.length ? chat : [el("p", "hint", "nobody has said anything in this clan yet.")]));
  } catch (e) {
    host.replaceChildren(el("p", "hint", /** @type {Error} */ (e).message));
  }
}

/** Every clan (biggest first), each folded shut: click its name to open it
 * (members, kicked, its CLAN CHAT, BREAK UP), again to fold it up. @param {any[]} list */
function renderClansAdmin(list) {
  const host = $("clans-admin-list");
  $("clans-hint").textContent = `${fmt(list.length)} clan${list.length === 1 ? "" : "s"}`;
  if (host.querySelector(".armed")) return;
  const key = JSON.stringify(list);
  if (key === clanListKey && host.childElementCount) return; // nothing new: leave the folds as they are
  clanListKey = key;
  for (const id of [...openClans]) if (!list.some((k) => k.id === id)) openClans.delete(id);
  if (!list.length) {
    host.replaceChildren(el("p", "hint", "no clans yet."));
    return;
  }
  host.replaceChildren(...list.map((k) => {
    const fold = /** @type {HTMLDetailsElement} */ (el("details", "clan-admin-fold"));
    const sum = el("summary", "");
    sum.append(clanLabel(k), el("span", "hint", ` ${k.members} member${k.members === 1 ? "" : "s"}, led by ${k.leader ?? "?"}`));
    const detail = el("div", "clan-admin-detail");
    fold.append(sum, detail);
    fold.open = openClans.has(k.id);
    fold.addEventListener("toggle", () => {
      if (fold.open) {
        openClans.add(k.id);
        detail.replaceChildren(el("p", "hint", "loading..."));
        showClanAdmin(k.id, detail);
      } else openClans.delete(k.id);
    });
    if (fold.open) showClanAdmin(k.id, detail);
    return fold;
  }));
}

/* ---------------------------------------------------------------- [ DAILY REWARDS ] */

/** The 30 days being edited (saved with [ SAVE 30 DAYS ]). @type {any[][] | null} */
let dailyDraft = null;
let dailySaved = "";
let dailySel = 0;
let dailyReady = false;
const DAILY_MILESTONES = new Set([7, 14, 21, 30]);

/** @param {any} g */
function dailyGiftText(g) {
  const content = state.content;
  if (g.shards) return `<> ${fmt(g.shards)} shards`;
  if (g.box) return `${g.count > 1 ? `${g.count} x ` : ""}${content?.boxes.find((/** @type {any} */ b) => b.id === g.box)?.name ?? g.box}`;
  if (g.item) {
    const item = content?.items.find((/** @type {any} */ i) => i.id === g.item);
    return item ? `${item.name} (${rarityById(item.rarity)?.label ?? item.rarity})` : g.item;
  }
  return `${g.count > 1 ? `${g.count} x ` : ""}${/** @type {any} */ (SCROLLS)[g.scroll]?.name ?? g.scroll}`;
}

/** @param {any} g */
function dailyGiftClass(g) {
  if (g.item) {
    const item = state.content?.items.find((/** @type {any} */ i) => i.id === g.item);
    return `r-${item?.rarity ?? "common"}`;
  }
  return g.shards ? "shard-tag" : "";
}

function paintDaily() {
  if (!dailyDraft) return;
  const days = dailyDraft;
  $("daily-days").replaceChildren(...days.map((gives, i) => {
    const row = el("div", `daily-day${i === dailySel ? " sel" : ""}${DAILY_MILESTONES.has(i + 1) ? " milestone" : ""}${gives.length ? "" : " empty"}`);
    row.append(el("span", "daily-n", `DAY ${String(i + 1).padStart(2, "0")}`));
    if (!gives.length) row.append(el("span", "hint", "nothing (add something)"));
    gives.forEach((g, j) => {
      const chip = el("span", "daily-gift");
      chip.append(el("span", dailyGiftClass(g), dailyGiftText(g)));
      const x = /** @type {HTMLButtonElement} */ (el("button", "", "[x]"));
      x.type = "button";
      x.title = "remove";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        gives.splice(j, 1);
        paintDaily();
      });
      chip.append(x);
      row.append(chip);
    });
    row.addEventListener("click", () => {
      dailySel = i;
      /** @type {HTMLSelectElement} */ ($("daily-day")).value = String(i);
      paintDaily();
    });
    return row;
  }));
  const dirty = JSON.stringify(days) !== dailySaved;
  $("daily-dirty").textContent = dirty ? "* unsaved changes" : "";
}

/** @param {any} d */
async function renderDaily(d) {
  if (!d) return;
  if (!state.content) state.content = await getContent();
  const content = state.content;
  $("daily-hint").textContent = `${fmt(d.claims_today)} opened today  ::  next ${d.peek} visible${d.custom ? "" : "  ::  default track"}`;
  const peek = /** @type {HTMLInputElement} */ ($("daily-peek"));
  if (document.activeElement !== peek) peek.value = String(d.peek);
  if (!dailyReady) {
    dailyReady = true;
    const opt = (/** @type {string} */ value, /** @type {string} */ text) => {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", text));
      o.value = value;
      return o;
    };
    $("daily-box").replaceChildren(...content.boxes.map((/** @type {any} */ b) => opt(b.id, b.name)));
    $("daily-scroll").replaceChildren(...Object.entries(SCROLLS).map(([id, s]) => opt(id, s.name)));
    $("daily-items").replaceChildren(...content.items.map((/** @type {any} */ i) =>
      opt(i.name, `${rarityById(i.rarity)?.label ?? i.rarity}  ${i.id}`)));
    $("daily-day").replaceChildren(...Array.from({ length: 30 }, (_, i) => opt(String(i), `DAY ${i + 1}`)));
  }
  const saved = JSON.stringify(d.days);
  // Keep your edits through the 15 s refresh; take the server's copy otherwise.
  if (!dailyDraft || JSON.stringify(dailyDraft) === dailySaved) dailyDraft = JSON.parse(saved);
  dailySaved = saved;
  paintDaily();
}

function wireDaily() {
  const kind = /** @type {HTMLSelectElement} */ ($("daily-kind"));
  const amount = /** @type {HTMLInputElement} */ ($("daily-amount"));
  const showWhat = () => {
    $("daily-what-box").hidden = kind.value !== "box";
    $("daily-what-scroll").hidden = kind.value !== "scroll";
    $("daily-what-item").hidden = kind.value !== "item";
    $("daily-amount-wrap").hidden = kind.value === "item";
    if (kind.value === "shards" && Number(amount.value) < 10) amount.value = "100";
    if (kind.value !== "shards" && Number(amount.value) > 50) amount.value = "1";
  };
  kind.addEventListener("change", showWhat);
  showWhat();
  /** @type {HTMLSelectElement} */ ($("daily-day")).addEventListener("change", (e) => {
    dailySel = Number(/** @type {HTMLSelectElement} */ (e.target).value);
    paintDaily();
  });
  $("daily-add-btn").addEventListener("click", () => {
    if (!dailyDraft) return;
    const day = dailyDraft[dailySel];
    if (day.length >= 4) return log(`DAY ${dailySel + 1} already has 4 gifts.`, false);
    const n = Math.floor(Number(amount.value));
    /** @type {any} */
    let g;
    if (kind.value === "shards") g = { shards: n };
    else if (kind.value === "box") g = { box: /** @type {HTMLSelectElement} */ ($("daily-box")).value, count: n };
    else if (kind.value === "scroll") g = { scroll: /** @type {HTMLSelectElement} */ ($("daily-scroll")).value, count: n };
    else {
      const typed = /** @type {HTMLInputElement} */ ($("daily-item")).value.trim().toUpperCase();
      const item = state.content?.items.find((/** @type {any} */ i) => i.name.toUpperCase() === typed || i.id === typed.toLowerCase());
      if (!item) return log(`No item called "${typed}".`, false);
      g = { item: item.id };
    }
    if (kind.value !== "item" && !(n >= 1)) return log("Amount must be 1 or more.", false);
    // Same chest / scroll / shards twice on one day: add them up.
    const same = day.find((x) => (g.shards && x.shards) || (g.box && x.box === g.box) || (g.scroll && x.scroll === g.scroll));
    if (same && g.shards) same.shards += g.shards;
    else if (same) same.count += g.count;
    else day.push(g);
    paintDaily();
  });
  $("daily-peek-save").addEventListener("click", async () => {
    try {
      const peek = Number(/** @type {HTMLInputElement} */ ($("daily-peek")).value);
      const res = await call("/api/admin/action", { action: "set_daily_rewards", peek, announce: false });
      log(res.message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
  $("daily-undo").addEventListener("click", () => {
    dailyDraft = JSON.parse(dailySaved || "null");
    paintDaily();
  });
  $("daily-save").addEventListener("click", async () => {
    try {
      const res = await call("/api/admin/action", { action: "set_daily_rewards", days: dailyDraft, announce: false });
      log(res.message, true);
      dailyDraft = null;
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
  const reset = $("daily-reset");
  reset.addEventListener("click", async () => {
    if (!armed.has(reset)) {
      armArm(/** @type {HTMLButtonElement} */ (reset));
      return;
    }
    disarm(reset);
    try {
      const res = await call("/api/admin/action", { action: "set_daily_rewards", reset: true, announce: false });
      log(res.message, true);
      dailyDraft = null;
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
}

/** [ CHEST PRICES ]: one box per chest, pre-filled (left alone while you're editing). @param {any[]} rows */
function renderBoxPrices(rows) {
  const host = $("box-price-rows");
  if (host.contains(document.activeElement)) return;
  host.replaceChildren(...rows.map((r) => {
    const label = el("label", "box-price-row");
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "number";
    input.min = "0";
    input.max = "10000000";
    input.step = "1";
    input.name = `price:${r.id}`;
    input.value = String(r.price);
    input.className = "num-sm";
    label.append(el("span", "", `${r.name} `), input,
      el("span", "hint", r.custom ? `  (custom; default ${r.default})` : "  (default)"));
    return label;
  }));
}

/** @param {{id: string, price: number, default: number, custom: boolean, on: boolean}[]} rows */
function renderScrollPrices(rows) {
  const host = $("scroll-price-rows");
  if (host.contains(document.activeElement)) return;
  host.replaceChildren(...rows.map((r) => {
    const label = el("label", "box-price-row");
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "number";
    input.min = "0";
    input.max = "10000000";
    input.step = "1";
    input.name = `scroll:${r.id}`;
    input.value = String(r.price);
    input.className = "num-sm";
    const note = (r.custom ? `  (custom; default ${r.default})` : "  (default)") + (r.on ? "" : "  :: switched off, not sold");
    label.append(el("span", "", `${r.id.replace("_", " ").toUpperCase()} SCROLL `), input, el("span", "hint", note));
    return label;
  }));
}

/** [ WORLD EVENTS ]: what's running, the START list and the director's settings. @param {any} w */
/** [ THE FORGE ]: open or closed, and what's been poured. @param {any} f */
function renderForge(f) {
  if (!f) return;
  $("forge-status").textContent = `${f.open ? "OPEN" : "CLOSED (hidden from everyone)"}  ::  ${f.pieces} pieces  ::  `
    + `${fmt(f.forged)} forged  ::  ${fmt(f.poured)} shards poured`;
  $("forge-hint").textContent = f.open ? "open" : "closed";
}

function renderEvents(w) {
  if (!w) return;
  const sel = /** @type {HTMLSelectElement} */ ($("event-kind"));
  if (!sel.options.length) {
    for (const [id, name] of w.kinds) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", name));
      o.value = id;
      sel.append(o);
    }
  }
  const cur = w.current;
  const nowS = Date.now() / 1000;
  const left = (/** @type {number | null | undefined} */ t) => (t ? `${Math.max(0, Math.round(t - nowS))}s` : "-");
  $("event-status").textContent = [
    `RUNNING   ${cur ? `${cur.name} (${cur.stage})  ends in ${left(cur.until)}` : "nothing"}`,
    `DIRECTOR  ${w.config.enabled ? "ON" : "OFF"}  every ${w.config.min_gap / 60}-${w.config.max_gap / 60} min`
      + (w.config.enabled && w.next_at ? `  ::  next in ${left(w.next_at)}` : ""),
    `SECOND WIND on this boss: ${w.second_wind === "armed" ? "ARMED" : w.second_wind === "used" ? "used" : w.second_wind === "no" ? "rolled no" : "not rolled yet"}`,
  ].join("\n");
  const on = /** @type {HTMLInputElement} */ ($("event-enabled"));
  const lo = /** @type {HTMLInputElement} */ ($("event-min"));
  const hi = /** @type {HTMLInputElement} */ ($("event-max"));
  if (![on, lo, hi].includes(/** @type {HTMLInputElement} */ (document.activeElement))) {
    on.checked = w.config.enabled;
    lo.value = String(w.config.min_gap / 60);
    hi.value = String(w.config.max_gap / 60);
  }
}

/** Every section folds open/closed; each remembers how you left it (POST starts open). */
function wireFold() {
  document.querySelectorAll("details.fold").forEach((node) => {
    const fold = /** @type {HTMLDetailsElement} */ (node);
    const key = `omhp.admin.fold.${fold.dataset.fold}`;
    try {
      const saved = localStorage.getItem(key) ?? (fold.dataset.fold === "items" ? localStorage.getItem("omhp.admin.gallery") : null);
      fold.open = saved ? saved === "open" : fold.dataset.fold === "post";
    } catch {
      fold.open = fold.dataset.fold === "post";
    }
    fold.addEventListener("toggle", () => {
      try {
        localStorage.setItem(key, fold.open ? "open" : "closed");
      } catch {
        /* ignore */
      }
    });
  });
}

function wirePreview() {
  $("preview-btn").addEventListener("click", () => {
    const id = /** @type {HTMLSelectElement} */ ($("preview-boss")).value;
    window.open(new URL(`./#preview-death=${id}`, location.href).href, "_blank", "noopener");
  });
}

/** Fill the preview boss list (current boss first selected). @param {any} content @param {string} current */
function fillPreviewBosses(content, current) {
  const sel = /** @type {HTMLSelectElement} */ ($("preview-boss"));
  if (sel.options.length) return;
  for (const b of content.bosses) {
    const community = String(b.id).startsWith("community_");
    const label = community
      ? `[COMMUNITY] ${b.name} · ${String(b.intro || "").replace("A COMMUNITY BOSS ", "")} · ${String(b.id).slice(-4).toUpperCase()}`
      : `#${String(b.number).padStart(2, "0")} ${b.name}`;
    const o = /** @type {HTMLOptionElement} */ (el("option", "", label));
    o.value = b.id;
    o.selected = b.id === current;
    sel.append(o);
  }
}

/** Load a section's data whenever its fold opens. @param {string} fold @param {() => void} load */
function onOpen(fold, load) {
  const d = /** @type {HTMLDetailsElement} */ (document.querySelector(`details[data-fold="${fold}"]`));
  d.addEventListener("toggle", () => {
    if (d.open) load();
  });
}

/** Long explanations fold to two lines with a [ more ]: most of the "crowded" look
 * was walls of hint text above the controls. */
function foldLongHints() {
  document.querySelectorAll("#panel section.adm p.hint").forEach((node) => {
    const p = /** @type {HTMLElement} */ (node);
    if (p.id || (p.textContent ?? "").trim().length < 170 || p.classList.contains("hint-long")) return;
    p.classList.add("hint-long");
    const more = /** @type {HTMLButtonElement} */ (el("button", "btn-text hint-more", "[ more ]"));
    more.type = "button";
    more.addEventListener("click", () => {
      const open = p.classList.toggle("open");
      more.textContent = open ? "[ less ]" : "[ more ]";
    });
    p.after(more);
  });
}

function wire() {
  wireFold();
  initGeo(call);
  initNav();
  foldLongHints();
  initPlayer({ call, log, goTo, refresh, announcing });
  onOpen("auction", () => void loadAuction());
  onOpen("city", () => void loadCity());
  onOpen("referrals", () => void loadReferrals());
  $("auction-refresh").addEventListener("click", () => void loadAuction());
  $("auction-search").addEventListener("input", renderAuction);
  $("city-refresh").addEventListener("click", () => void loadCity());
  $("referral-refresh").addEventListener("click", () => void loadReferrals());
  $("referral-flagged").addEventListener("change", renderReferrals);
  $("ticket-filter").addEventListener("change", () => renderTickets(adminTickets));
  $("ticket-kind-filter").addEventListener("change", () => renderTickets(adminTickets));
  const ticketSort = /** @type {HTMLSelectElement} */ ($("ticket-sort"));
  try {
    const saved = localStorage.getItem(TICKET_SORT_KEY);
    if (saved && saved in TICKET_SORTS) ticketSort.value = saved;
  } catch {
    /* just this visit */
  }
  ticketSort.addEventListener("change", () => {
    try {
      localStorage.setItem(TICKET_SORT_KEY, ticketSort.value);
    } catch {
      /* just this visit */
    }
    renderTickets(adminTickets);
  });
  $("suspect-scan").addEventListener("click", () => loadSuspects(true));
  $("appeal-refresh").addEventListener("click", loadAppeals);
  $("report-refresh").addEventListener("click", loadReports);
  $("bounty-refresh").addEventListener("click", loadBounties);
  $("bounty-check").addEventListener("click", (e) => bountyAct("bounty_check", {}, /** @type {HTMLButtonElement} */ (e.currentTarget))
    .then(() => (/** @type {HTMLButtonElement} */ ($("bounty-check")).disabled = false)));
  $("bounty-rate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const rate = Number(/** @type {HTMLInputElement} */ ($("bounty-rate-form").querySelector("input[name=rate]")).value);
    try {
      log((await call("/api/admin/action", { action: "set_bounty_rate", rate })).message, true);
      loadBounties();
    } catch (err) {
      log(/** @type {Error} */ (err).message, false);
    }
  });
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="bounties"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) loadBounties();
  });
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="reports"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) loadReports();
  });
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="appeals"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) loadAppeals();
  });
  $("bot-wl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = /** @type {HTMLFormElement} */ (e.target);
    try {
      log((await call("/api/admin/action", { action: "whitelist_add", ...params(form) })).message, true);
      form.reset();
      loadSuspects(true);
    } catch (err) {
      log(/** @type {Error} */ (err).message, false);
    }
  });
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="suspects"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) loadSuspects(false);
  });
  $("shard-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    shardQuery = /** @type {HTMLInputElement} */ ($("shard-search")).value.trim();
    shardPage = 0;
    void loadShards();
  });
  $("acct-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    acctQuery = /** @type {HTMLInputElement} */ ($("acct-search")).value.trim();
    acctPage = 0;
    void loadAccounts();
  });
  $("acct-prev").addEventListener("click", () => { acctPage = Math.max(0, acctPage - 1); void loadAccounts(); });
  $("acct-next").addEventListener("click", () => { acctPage++; void loadAccounts(); });
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="banned"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) void loadBanned();
  });
  $("banned-refresh").addEventListener("click", () => void loadBanned());
  // SERVER HEALTH: every 10 s, only while unfolded.
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="health"]')).addEventListener("toggle", (e) => {
    clearInterval(healthTimer);
    if (!/** @type {HTMLDetailsElement} */ (e.target).open) return;
    void loadHealth();
    healthTimer = setInterval(() => {
      if (document.visibilityState === "visible") void loadHealth();
    }, 10000);
  });
  $("health-refresh").addEventListener("click", () => void loadHealth());
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="accounts"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) void loadAccounts();
  });
  $("ach-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    achQuery = /** @type {HTMLInputElement} */ ($("ach-search")).value.trim();
    achPage = 0;
    void loadAchievements();
  });
  $("ach-sort").addEventListener("change", () => { achPage = 0; void loadAchievements(); });
  $("ach-prev").addEventListener("click", () => { achPage = Math.max(0, achPage - 1); void loadAchievements(); });
  $("ach-next").addEventListener("click", () => { achPage++; void loadAchievements(); });
  for (const id of ["ach-cat", "ach-list-sort"]) $(id).addEventListener("change", drawAchievementList);
  /** @type {HTMLDetailsElement} */ (document.querySelector('details[data-fold="achievements"]')).addEventListener("toggle", (e) => {
    if (/** @type {HTMLDetailsElement} */ (e.target).open) void loadAchievements();
  });
  $("shard-prev").addEventListener("click", () => { shardPage = Math.max(0, shardPage - 1); void loadShards(); });
  $("shard-next").addEventListener("click", () => { shardPage++; void loadShards(); });
  const make = /** @type {HTMLFormElement} */ (document.querySelector('form[data-action="create_badge"]'));
  make.addEventListener("input", drawBadgePreview);
  make.addEventListener("reset", () => setTimeout(drawBadgePreview));
  drawBadgePreview();
  wirePreview();
  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ ($("passcode"));
    try {
      const { token } = await call("/api/admin/login", { passcode: input.value });
      setSession(token);
      input.value = "";
      await refresh();
      log("Logged in.", true);
    } catch (err) {
      log(/** @type {Error} */ (err).message, false);
    }
  });
  $("logout").addEventListener("click", async () => {
    await call("/api/admin/logout", {}).catch(() => {});
    showLogin();
  });
  wireDaily();
  // [ REFRESH ]: new clan chat / messages since the page last looked.
  $("clans-refresh").addEventListener("click", async () => {
    clanListKey = ""; // redraw even if the list looks the same: open clans fetch their chat again
    await refresh();
  });
  $("dms-refresh").addEventListener("click", async () => {
    await refresh();
    loadDmPlayer();
    if (dmView.a) openDmThread(dmView.a, dmView.b);
  });
  $("dms-search").addEventListener("submit", (e) => {
    e.preventDefault();
    dmView.player = String(new FormData(/** @type {HTMLFormElement} */ (e.target)).get("player") ?? "").trim();
    loadDmPlayer();
  });
  const clearChat = $("chat-clear");
  clearChat.addEventListener("click", () => {
    if (!armed.has(clearChat)) {
      armArm(/** @type {HTMLButtonElement} */ (clearChat));
      return;
    }
    disarm(clearChat);
    chatAction("clear_chat", {});
  });
  document.querySelectorAll("form[data-action]").forEach((node) => {
    const form = /** @type {HTMLFormElement} */ (node);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = /** @type {HTMLElement | null} */ (/** @type {SubmitEvent} */ (e).submitter);
      submit(form, btn?.dataset.override ?? form.dataset.action ?? "", btn);
    });
  });
  document.querySelectorAll("[data-pct]").forEach((node) => {
    const b = /** @type {HTMLElement} */ (node);
    b.addEventListener("click", () => {
      if (!ov) return;
      const pct = Number(b.dataset.pct);
      const hp = pct >= 1 ? Math.round((ov.boss.max_hp * pct) / 100) : 1;
      const input = /** @type {HTMLInputElement} */ (document.querySelector('[data-action="set_hp"] [name="hp"]'));
      input.value = String(hp);
    });
  });
}

if (!forwardToCanonical("admin")) wire();
if (!forwardToCanonical("admin") && session()) refresh().catch(() => showLogin());
else showLogin();
setInterval(() => {
  if (!$("panel").hidden && document.visibilityState === "visible") refresh().catch(() => {});
}, 15000);
