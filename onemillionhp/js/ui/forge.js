// [ THE FORGE ] in the WORLD menu (server/omhp/forge.py): the SOVEREIGN pieces,
// a million shards each, paid in a little at a time. A live ASCII furnace
// burns at the top; pick a slot and each of its two pieces sits in a mould
// whose art heats up from the bottom as the bar fills (cold grey, a molten
// line, then gold). Pouring throws sparks; filling the bar plays the reveal.
// [ MELT GEAR ] (ticket #138) melts gear into a piece at what the shop pays for
// it (data.worth): selling it and pouring the shards would give the same.

import * as api from "../api.js?v=b6664395f3";
import { RARITY_STYLE, ago, dedent, el, fmt } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { emit, itemById, now, on, ownItem, state } from "../store.js?v=b6664395f3";
import { loadoutTag } from "./loadouts.js?v=b6664395f3";
import { fxLow } from "./ambient.js?v=b6664395f3";
import { setBonusLines } from "./bag.js?v=b6664395f3";
import { EQUIP_SLOTS, effectLine, wornInSlot } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { playForgeScene } from "./forgescene.js?v=b6664395f3";
import { button, shake, showOverlay } from "./fx.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const panel = () => $("panel-forge");
const visible = () => !panel().hidden && document.visibilityState === "visible";
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {any} */
let data = null;
let slot = "weapon";
let busy = false;
/** "itemId:amount" waiting for its second click (big pours ask twice). */
let armed = "";
const CONFIRM_AT = 100_000;
const STEPS = [1_000, 10_000, 100_000];
/** The MELT picker that's open: which piece, what's picked ("item:<id>"), how many. */
let melt = { piece: "", pick: "", count: "1" };
/** The shard count the page was last drawn with. */
let drawnShards = -1;

// ------------------------------------------------------------- the furnace
// A small "doom fire": heat rises from the grate row by row, cooling and
// drifting sideways as it goes. Characters and colours come from the heat.

const FIRE_W = 26;
const FIRE_H = 6;
const RAMP = " .,:;*^%#@";
const heat = new Float32Array(FIRE_W * FIRE_H);
let flare = 0; // extra heat for a moment after a pour
let fireTimer = 0;
/** @type {HTMLElement | null} */
let fireEl = null;

function stepFire() {
  const base = 0.62 + flare * 0.38;
  for (let x = 0; x < FIRE_W; x++) heat[(FIRE_H - 1) * FIRE_W + x] = base * (0.7 + Math.random() * 0.3);
  for (let y = 0; y < FIRE_H - 1; y++) {
    for (let x = 0; x < FIRE_W; x++) {
      const drift = Math.max(0, Math.min(FIRE_W - 1, x + Math.floor(Math.random() * 3) - 1));
      const below = heat[(y + 1) * FIRE_W + drift];
      heat[y * FIRE_W + x] = Math.max(0, below - Math.random() * 0.22);
    }
  }
  flare = Math.max(0, flare - 0.06);
}

/** One row of fire as coloured runs (span per colour, not per cell). @param {number} y */
function fireRow(y) {
  /** @type {Node[]} */
  const out = [];
  let run = "";
  let cls = "";
  for (let x = 0; x < FIRE_W; x++) {
    const h = heat[y * FIRE_W + x];
    const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(h * RAMP.length))];
    const c = h > 0.8 ? "fire-4" : h > 0.6 ? "fire-3" : h > 0.4 ? "fire-2" : "fire-1";
    if (c !== cls && run) {
      out.push(el("span", cls, run));
      run = "";
    }
    cls = c;
    run += ch;
  }
  if (run) out.push(el("span", cls, run));
  return out;
}

/** The whole furnace, every row 32 columns: chimney smoke, the hood, the
 * fire behind its bars, the grate, the base. */
function drawFurnace() {
  if (!fireEl) return;
  const W = FIRE_W + 6; // "| |" + fire + "| |"
  const puff = (/** @type {number} */ shift) => {
    const row = Array(W).fill(" ");
    for (const c of [7 + shift, 23 - shift]) "( )".split("").forEach((ch, i) => (row[c - 1 + i] = ch));
    return row.join("");
  };
  const t = Math.floor(performance.now() / 450) % 2;
  const hood = Array(W - 4).fill("_");
  for (const c of [5, 21]) "|_|".split("").forEach((ch, i) => (hood[c - 1 + i] = ch));
  const iron = (/** @type {string} */ s) => el("span", "forge-iron", s);
  const title = "T H E   F O R G E";
  const padL = Math.floor((W - 4 - title.length) / 2);
  /** @type {(Node | string)[]} */
  const lines = [
    el("span", "forge-smoke", puff(t)), "\n",
    el("span", "forge-smoke", puff(1 - t)), "\n",
    iron(`  ${hood.join("")}  `), "\n",
    iron(" /"), el("span", "forge-name", `${" ".repeat(padL)}${title}${" ".repeat(W - 4 - padL - title.length)}`), iron("\\ "), "\n",
    iron(`| .${"-".repeat(FIRE_W)}. |`), "\n",
  ];
  for (let y = 0; y < FIRE_H; y++) lines.push(iron("| |"), ...fireRow(y), iron("| |"), "\n");
  lines.push(iron("| |"), el("span", "forge-grate", "#=".repeat(FIRE_W / 2)), iron("| |"), "\n");
  lines.push(iron(`|${"_".repeat(W - 2)}|`), "\n");
  lines.push(iron(`   /__\\${" ".repeat(W - 14)}/__\\   `));
  fireEl.replaceChildren(...lines);
}

function startFire() {
  if (fireTimer) return;
  const tick = () => {
    if (!fireEl || !fireEl.isConnected || !visible()) {
      clearInterval(fireTimer);
      fireTimer = 0;
      return;
    }
    stepFire();
    drawFurnace();
  };
  for (let i = 0; i < FIRE_H * 2; i++) stepFire(); // already burning when the tab opens
  drawFurnace();
  if (reduced || fxLow()) return; // [FX:LOW]: one still frame
  fireTimer = window.setInterval(tick, 110);
}

// ------------------------------------------------------------- a piece

/** "r-sovereign set-apex": the rarity colour, then its set's own (APEX / ETERNAL). @param {any} item */
const tone = (item) => `r-sovereign${item?.gear_set ? ` set-${item.gear_set}` : ""}`;

/** The piece's art, heated from the bottom: cold grey above, a molten line,
 * forged gold below. @param {any} item @param {number} frac 0..1 @param {boolean} forged */
function mould(item, frac, forged) {
  const art = dedent(item.art);
  const width = Math.max(...art.map((l) => l.length), 10);
  const pre = el("pre", "forge-mould");
  const rows = art.length;
  const hot = forged ? rows : Math.floor(frac * rows); // rows from the bottom that are done
  const edge = rows - hot - 1;                         // the row being poured right now
  const frame = (/** @type {string} */ s) => el("span", "forge-iron", s);
  /** @type {(Node | string)[]} */
  const out = [frame(`.${"=".repeat(width + 2)}.`), "\n"];
  art.forEach((line, i) => {
    const cls = forged ? tone(item) : i >= rows - hot ? "forge-gold" : i === edge && frac > 0 ? "forge-molten" : "forge-cold";
    out.push(frame("| "), el("span", cls, line.padEnd(width)), frame(" |"), "\n");
  });
  out.push(frame(`'${"=".repeat(width + 2)}'`));
  pre.append(...out);
  return pre;
}

/** [██████▓▒░·········] 37.2% @param {number} frac */
function bar(frac) {
  const W = 24;
  const full = Math.floor(frac * W);
  const wrap = el("div", "forge-bar");
  const done = frac >= 1;
  wrap.append(el("span", "forge-iron", "["), el("span", done ? "r-sovereign" : "forge-gold", "█".repeat(full)));
  if (!done) {
    const tail = full < W ? (frac > 0 ? "▓▒░".slice(0, Math.min(3, W - full)) : "") : "";
    wrap.append(el("span", "forge-molten", tail), el("span", "forge-cold", "·".repeat(Math.max(0, W - full - tail.length))));
  }
  wrap.append(el("span", "forge-iron", "] "), el("span", done ? "r-sovereign" : "forge-pct",
    done ? "FORGED" : `${(frac * 100).toFixed(frac < 0.1 ? 2 : 1)}%`));
  return wrap;
}

/** One mould: art, name, bar, what it does, and the pour buttons. @param {any} p (a forge piece) */
function card(p) {
  const item = itemById(p.item_id);
  if (!item) return el("div");
  const me = state.me;
  const frac = Math.min(1, p.paid / p.price);
  const box = el("div", `forge-card${p.forged ? " forged" : frac > 0 ? " warm" : ""}`);
  box.dataset.item = item.id;
  const st = RARITY_STYLE.sovereign ?? RARITY_STYLE.godly;
  box.append(
    mould(item, frac, p.forged),
    el("div", `forge-piece-name ${tone(item)}`, item.name),
    el("div", "dim forge-piece-tag", `${st.deco[0]}SOVEREIGN${st.deco[1]}${item.gear_set ? `  ${item.gear_set.toUpperCase()} SET` : ""}  ::  ${item.slot.toUpperCase()} :: ${item.theme}`),
    bar(p.forged ? 1 : frac),
  );
  if (!p.forged) box.append(el("div", "forge-nums", `${fmt(p.paid)} / ${fmt(p.price)} <>  ::  ${fmt(p.price - p.paid)} to go`));
  const wornId = wornInSlot(item, me);
  box.append(effectLine(item, wornId ? ownItem(wornId) : null));
  box.append(...setBonusLines(item, me));
  if (item.flavor) box.append(el("div", "flavor dim", `"${item.flavor}"`));
  const who = p.first ? `FIRST FORGED BY ${p.first}  ::  ${fmt(p.forged_by)} forged` : "never forged. be the first.";
  box.append(el("div", "forge-who", who));
  if (p.forged) {
    const worn = me && Object.values(me.worn ?? {}).includes(item.id);
    box.append(el("div", "forge-owned", worn ? "YOURS :: WEARING IT" : "YOURS"));
    if (!worn) box.append(button("[ WEAR IT ]", () => wear(item)));
    return box;
  }
  box.append(pourRow(p, item), meltRow(p, item));
  return box;
}

/** What you could melt: gear (not locked, not the copy you wear) at its sell
 * price. @returns {{key: string, label: string, each: number, have: number}[]} */
function meltables() {
  const me = state.me;
  const worth = data?.worth;
  if (!me || !worth) return [];
  const gear = [];
  for (const inv of me.inventory ?? []) {
    const it = itemById(inv.item_id);
    const each = it ? worth.item?.[it.rarity] : 0;
    const have = inv.count - (Object.values(me.worn ?? {}).includes(inv.item_id) ? 1 : 0);
    if (!it || !each || inv.locked || have < 1) continue;
    const tag = loadoutTag(it.id);
    gear.push({ key: `item:${it.id}`, label: `${it.name} (${it.rarity})${tag ? ` ${tag}` : ""}`, each, have });
  }
  gear.sort((a, b) => b.each - a.each || a.label.localeCompare(b.label));
  return gear;
}

/** [ MELT GEAR ]: pick one, how many, see what it's worth; melting asks twice.
 * @param {any} p @param {any} item */
function meltRow(p, item) {
  const row = el("div", "forge-melt");
  if (!state.me?.name_chosen) return row;
  if (melt.piece !== item.id) {
    const open = button("[ MELT GEAR ]", () => {
      melt = { piece: item.id, pick: "", count: "1" };
      armed = "";
      render();
    });
    open.title = "melt gear into this piece (worth what the shop would pay for it)";
    open.classList.add("forge-btn");
    row.append(open);
    return row;
  }
  const list = meltables();
  if (!list.length) {
    row.append(el("div", "dim", "> nothing to melt: no gear the shop buys that you're not wearing or have locked."));
    const shut = button("[ CLOSE ]", () => ((melt = { piece: "", pick: "", count: "1" }), render()));
    shut.classList.add("forge-cancel");
    row.append(shut);
    return row;
  }
  if (!list.some((m) => m.key === melt.pick)) melt.pick = list[0].key;
  const chosen = /** @type {{key: string, label: string, each: number, have: number}} */ (list.find((m) => m.key === melt.pick));
  const left = p.price - p.paid;
  const most = Math.min(chosen.have, Math.ceil(left / chosen.each));
  const pick = /** @type {HTMLSelectElement} */ (el("select", "forge-melt-pick"));
  for (const m of list) {
    const o = /** @type {HTMLOptionElement} */ (el("option", "", `${m.label} x${m.have} :: ${fmt(m.each)} <> each`));
    o.value = m.key;
    o.selected = m.key === melt.pick;
    pick.append(o);
  }
  pick.addEventListener("change", () => {
    melt.pick = pick.value;
    melt.count = "1";
    armed = "";
    render();
  });
  const count = /** @type {HTMLInputElement} */ (el("input", "loadout-input forge-melt-count"));
  count.type = "number";
  count.inputMode = "numeric";
  count.min = "1";
  count.max = String(most);
  count.value = String(Math.max(1, Math.min(most, Math.floor(Number(melt.count)) || 1)));
  const n = () => Math.max(1, Math.min(most, Math.floor(Number(count.value)) || 1));
  const sum = el("span", "dim forge-melt-sum");
  const paint = () => (sum.textContent = ` = ${fmt(Math.min(left, n() * chosen.each))} <>`);
  count.addEventListener("input", () => {
    melt.count = count.value;
    armed = "";
    paint();
  });
  paint();
  const all = button("[ MAX ]", () => {
    melt.count = String(most);
    render();
  });
  all.title = most === chosen.have ? "all you have" : "just enough to finish the piece";
  all.classList.add("forge-btn");
  const key = `melt:${item.id}:${melt.pick}`;
  const go = button(armed === key ? `[ MELT ${n()}? ]` : "[ MELT ]", () => {
    if (armed !== key) {
      armed = key;
      render();
      return;
    }
    armed = "";
    const [kind, ref] = melt.pick.split(/:(.*)/s);
    give(item, /** @type {"item"} */ (kind), ref, n());
  });
  go.classList.add("forge-btn");
  if (armed === key) go.classList.add("armed");
  go.disabled = busy;
  const close = button("[ CLOSE ]", () => {
    melt = { piece: "", pick: "", count: "1" };
    armed = "";
    render();
  });
  close.classList.add("forge-cancel");
  const line = el("div", "forge-melt-line");
  line.append(count, all, sum);
  const btns = el("div", "forge-melt-btns");
  btns.append(go, close);
  row.append(pick, line, btns);
  if (armed === key) row.append(el("div", "dim forge-warn", "melted gear never comes back."));
  return row;
}

/** [ +1K ] [ +10K ] [ +100K ] [ ALL IN ]: big pours ask twice. @param {any} p @param {any} item */
function pourRow(p, item) {
  const row = el("div", "forge-pour");
  const shards = state.me?.shards ?? 0;
  const left = p.price - p.paid;
  if (!state.me?.name_chosen && state.me) {
    row.append(el("div", "dim", "> choose your name first: the forge signs its work."));
    return row;
  }
  const opts = [...STEPS.map((n) => [`+${n >= 1000 ? `${n / 1000}K` : n}`, n]), ["ALL IN", Math.min(shards, left)]];
  for (const [label, raw] of opts) {
    const amount = Math.min(Number(raw), left, shards);
    const key = `${item.id}:${amount}`;
    const big = amount >= CONFIRM_AT || label === "ALL IN";
    const text = armed === key ? `[ POUR ${fmt(amount)}? ]` : `[ ${label} ]`;
    const b = button(text, () => {
      if (big && armed !== key) {
        armed = key;
        render();
        return;
      }
      armed = "";
      pour(item, amount);
    });
    b.classList.add("forge-btn");
    if (armed === key) b.classList.add("armed");
    b.disabled = busy || amount < 1 || (label !== "ALL IN" && Number(raw) > shards && Number(raw) <= left);
    if (label === "ALL IN" && amount > 0) b.title = `pour all ${fmt(amount)} you can`;
    row.append(b);
  }
  if (armed.startsWith(`${item.id}:`)) {
    const cancel = button("[ CANCEL ]", () => {
      armed = "";
      render();
    });
    cancel.classList.add("forge-cancel");
    row.append(cancel, el("div", "dim forge-warn", "poured shards never come back out."));
  }
  if (shards < 1) row.append(el("div", "dim", "> no shards on you. sell drops, open chests, come back hot."));
  return row;
}

// ------------------------------------------------------------- actions

/** This page's copy of one piece. @param {string} itemId */
const piece = (itemId) => (data?.pieces ?? []).find((/** @type {any} */ p) => p.item_id === itemId);

/** @param {any} item @param {number} amount */
async function pour(item, amount) {
  if (busy || amount < 1) return;
  busy = true;
  render();
  try {
    const out = await api.pourForge(item.id, amount);
    data = out.forge;
    state.me = out.me;
    emit("me");
    flare = Math.min(1, flare + 0.4 + Math.min(0.6, out.poured / 200_000));
    busy = false;
    render();
    strike(item.id, out.poured);
    // Your own forge: the smith at the anvil first (what everyone else sees), then your reveal.
    if (out.forged) {
      playForgeScene({ name: state.me?.name, item_id: item.id, first: piece(item.id)?.forged_by === 1 })
        .then(() => forgedReveal(item));
    }
  } catch (e) {
    busy = false;
    showError(/** @type {Error} */ (e).message);
    render();
  }
}

/** Melt gear into a piece. @param {any} item @param {"item"} kind @param {string} ref @param {number} count */
async function give(item, kind, ref, count) {
  if (busy || count < 1) return;
  busy = true;
  render();
  try {
    const out = await api.giveForge(item.id, kind, ref, count);
    data = out.forge;
    state.me = out.me;
    emit("me");
    melt.count = "1";
    flare = Math.min(1, flare + 0.4 + Math.min(0.6, out.worth / 200_000));
    busy = false;
    render();
    strike(item.id, out.worth);
    if (out.forged) {
      melt = { piece: "", pick: "", count: "1" };
      playForgeScene({ name: state.me?.name, item_id: item.id, first: piece(item.id)?.forged_by === 1 })
        .then(() => forgedReveal(item));
    }
  } catch (e) {
    busy = false;
    showError(/** @type {Error} */ (e).message);
    render();
  }
}

/** The hammer comes down: the mould jolts, sparks fly, the amount rises. @param {string} itemId @param {number} amount */
function strike(itemId, amount) {
  sound.hit();
  const cardEl = /** @type {HTMLElement | null} */ (panel().querySelector(`.forge-card[data-item="${itemId}"]`));
  if (!cardEl || reduced) return;
  const mouldEl = /** @type {HTMLElement | null} */ (cardEl.querySelector(".forge-mould"));
  mouldEl?.classList.remove("struck");
  void mouldEl?.offsetWidth;
  mouldEl?.classList.add("struck");
  const host = el("div", "forge-sparks");
  const n = 10 + Math.min(14, Math.floor(amount / 25_000));
  for (let i = 0; i < n; i++) {
    const s = el("span", `spark spark-${i % 3}`, "*+.'`"[i % 5]);
    const ang = Math.PI * (1.05 + Math.random() * 0.9);
    const dist = 40 + Math.random() * 70;
    s.style.setProperty("--dx", `${(Math.cos(ang) * dist).toFixed(0)}px`);
    s.style.setProperty("--dy", `${(Math.sin(ang) * dist).toFixed(0)}px`);
    s.style.animationDelay = `${(Math.random() * 80).toFixed(0)}ms`;
    host.append(s);
  }
  host.append(el("span", "forge-gain", `+${fmt(amount)} <>`));
  cardEl.append(host);
  setTimeout(() => host.remove(), 1100);
  if (amount >= CONFIRM_AT) shake("s");
}

/** @param {any} item */
async function wear(item) {
  try {
    state.me = await api.equip(item.id, item.slot);
    emit("me");
    render();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** The bar filled: white-hot, then the metal cools to gold. @param {any} item */
function forgedReveal(item) {
  sound.relic();
  shake("l");
  showOverlay((inner, close) => {
    inner.classList.add("forge-reveal");
    const banner = el("div", "forge-reveal-banner", "S O V E R E I G N   F O R G E D");
    const pre = mould(item, 1, false);
    pre.classList.add("white-hot");
    inner.append(banner, pre, el("div", `forge-piece-name ${tone(item)}`, item.name),
      el("div", "dim", `${item.slot.toUpperCase()} :: ${item.theme}  ::  bound to you, forever`));
    const wornId = wornInSlot(item, state.me);
    inner.append(effectLine(item, wornId ? ownItem(wornId) : null));
    const actions = el("div", "actions");
    const wearBtn = button(`[ WEAR ${item.slot.toUpperCase()} ]`, async () => {
      await wear(item);
      close();
    });
    const later = button("[ LATER ]", close);
    wearBtn.disabled = later.disabled = true; // let it cool first
    actions.append(wearBtn, later);
    inner.append(actions);
    setTimeout(() => {
      pre.classList.remove("white-hot");
      pre.classList.add("cooling");
      wearBtn.disabled = later.disabled = false;
    }, reduced ? 0 : 1400);
  }, { mustChoose: true });
}

// ------------------------------------------------------------- the page

/** Slot strip: each slot shows how hot your best piece there is. */
function slotStrip() {
  const strip = el("div", "forge-slots");
  for (const [id, label] of EQUIP_SLOTS) {
    const mine = (data?.pieces ?? []).filter((/** @type {any} */ p) => itemById(p.item_id)?.slot === id);
    if (!mine.length) continue;
    const best = Math.max(...mine.map((/** @type {any} */ p) => (p.forged ? 1 : p.paid / p.price)));
    const glyph = best >= 1 ? "$" : best >= 0.75 ? "▓" : best >= 0.4 ? "▒" : best > 0 ? "░" : "·";
    const b = button(`${label} ${glyph}`, () => {
      slot = id;
      armed = "";
      render();
    });
    b.classList.add("forge-slot");
    if (best > 0) b.classList.add(best >= 1 ? "done" : "warm");
    b.setAttribute("aria-pressed", String(slot === id));
    strip.append(b);
  }
  return strip;
}

const HALL_SHOWN = 8;
let hallOpen = false;

function hall() {
  const box = el("div", "forge-hall");
  box.append(el("div", "panel-h", "HALL OF THE FORGED"));
  const recent = data?.recent ?? [];
  if (!recent.length) {
    box.append(el("div", "dim", "> the hall is empty. the first name carved here stays here."));
    return box;
  }
  // Ticket #289: the hall keeps every name; the newest few show until you open the rest.
  for (const r of hallOpen ? recent : recent.slice(0, HALL_SHOWN)) {
    const item = itemById(r.item_id);
    const line = el("div", `forge-hall-line${r.player_id === state.me?.id ? " me" : ""}`);
    line.append(el("span", "dim", `${ago(now() - r.t)}  `), el("b", "", r.name),
      " forged ", el("span", tone(item), item?.name ?? r.item_id));
    box.append(line);
  }
  if (recent.length > HALL_SHOWN) {
    const more = el("button", "inline-btn", hallOpen ? "[ SHOW FEWER ]" : `[ SHOW ALL ${fmt(recent.length)} ]`);
    more.addEventListener("click", () => {
      hallOpen = !hallOpen;
      render();
    });
    box.append(more);
  }
  return box;
}

export function render() {
  const host = panel();
  if (host.hidden) return;
  drawnShards = state.me?.shards ?? 0;
  const keepScroll = host.scrollTop;
  if (!fireEl) fireEl = el("pre", "forge-furnace");
  /** @type {Node[]} */
  const parts = [fireEl];
  parts.push(el("div", "forge-sub",
    "SOVEREIGN gear. a million shards a piece, poured in as you go. the metal remembers every shard; none come back out."),
  el("div", "dim bag-note", "> PRESTIGE melts forged pieces and forge progress: you'd forge them again from 0."));
  const purse = el("div", "forge-purse");
  purse.append("YOUR SHARDS ", el("b", "shard-tag", `<> ${fmt(state.me?.shards ?? 0)}`));
  if (data) purse.append(el("span", "dim", `   ::   ${fmt(data.total_poured)} poured by everyone`));
  parts.push(purse);
  if (!data) {
    parts.push(el("div", "dim", "> stoking the fire..."));
  } else if (!data.pieces.length) {
    parts.push(el("div", "dim", "> the moulds are empty. sovereign gear is on its way."));
  } else {
    if (!data.pieces.some((/** @type {any} */ p) => itemById(p.item_id)?.slot === slot)) {
      slot = itemById(data.pieces[0].item_id)?.slot ?? "weapon";
    }
    parts.push(slotStrip());
    const moulds = el("div", "forge-moulds");
    for (const p of data.pieces) if (itemById(p.item_id)?.slot === slot) moulds.append(card(p));
    parts.push(moulds, hall());
  }
  host.replaceChildren(...parts);
  host.scrollTop = keepScroll;
  startFire();
}

/** The tab opened: draw now, then fetch. */
export async function loadForge() {
  render();
  try {
    data = await api.getForge();
    render();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  }
}

// Shards change (sales, chests): the buttons and purse follow. Not on every
// attack: a redraw would cut the sparks off mid-flight.
on("me", () => {
  const shards = state.me?.shards ?? 0;
  if (shards === drawnShards || panel().hidden || busy) return;
  drawnShards = shards;
  render();
});
