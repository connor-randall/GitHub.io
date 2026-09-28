// Attack + ultimate buttons, attack pips, reset countdown, keyboard.

import * as api from "../api.js?v=2bd23f6de6";
import { el } from "../ascii.js?v=2bd23f6de6";
import * as sound from "../sound.js?v=2bd23f6de6";
import { applyBoss, boxById, emit, itemById, mergeFeed, now, state } from "../store.js?v=2bd23f6de6";
import { pulse } from "./ambient.js?v=2bd23f6de6";
import { hurt } from "./boss.js?v=2bd23f6de6";
import { showError } from "./errors.js?v=2bd23f6de6";
import { promptForName } from "./nameform.js?v=2bd23f6de6";
import { openBox } from "./bag.js?v=2bd23f6de6";
import { addFreshEvents } from "./feed.js?v=2bd23f6de6";
import { boxDropReveal, critBanner, lootReveal, overlayOpen, popup, shake, ultimateSequence } from "./fx.js?v=2bd23f6de6";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const btnAttack = /** @type {HTMLButtonElement} */ ($("btn-attack"));
const btnUlt = /** @type {HTMLButtonElement} */ ($("btn-ult"));

let busy = false;
let ultArmedUntil = 0;

export function renderControls() {
  const me = state.me;
  const alive = state.boss?.status === "alive";
  const left = me?.attacks_left ?? 0;
  const per = me?.attacks_per_day ?? 5;
  const unnamed = Boolean(me && !me.name_chosen);
  // Unnamed players can still press it: it opens the name prompt.
  btnAttack.disabled = busy || !me || !alive || (left <= 0 && !unnamed);
  btnAttack.classList.toggle("busy", busy);
  // Unnamed players: pressing ATTACK asks for a name (and doesn't attack).
  const label = '<span class="br">[</span> A T T A C K <span class="br">]</span>';
  const html = unnamed ? `${label}<span class="sub">name yourself before fighting</span>` : label;
  if (btnAttack.innerHTML !== html) btnAttack.innerHTML = html;
  $("boss-stage").classList.toggle("hittable", !btnAttack.disabled);

  const pips = $("pips");
  pips.replaceChildren(el("span", "dim", "ATTACKS "));
  for (let i = 0; i < per; i++) pips.append(el("span", i < left ? "on" : "off", i < left ? "[*]" : "[ ]"));
  if (left > per) pips.append(el("span", "on bonus", ` +${left - per}`)); // bonus attacks above max
  pips.append(el("span", "", `  ${left} / ${per}`));

  const ultOk = Boolean(me?.ultimate_available) && alive;
  btnUlt.disabled = busy || !ultOk;
  const armed = ultOk && performance.now() < ultArmedUntil;
  btnUlt.classList.toggle("armed", armed);
  btnUlt.innerHTML = armed
    ? '<span class="br">[</span> CONFIRM? TAP AGAIN <span class="br">]</span>'
    : '<span class="br">[</span> U L T I M A T E <span class="br">]</span>';
  const warn = $("ult-warn");
  warn.classList.toggle("spent", Boolean(me?.ultimate_used));
  warn.textContent = me?.ultimate_used
    ? `ULTIMATE SPENT ON THIS BOSS (${(me.ultimate_damage ?? 0).toLocaleString("en-US")} DMG)`
    : "!! ONE USE PER BOSS !!";

  const last = state.lastHit;
  const lh = $("last-hit");
  lh.textContent = last ? `${last.damage.toLocaleString("en-US")} DAMAGE${last.crit ? " (CRIT)" : ""}` : "--";
  lh.classList.toggle("crit", Boolean(last?.crit));
  $("boss-dmg").textContent = (me?.boss_damage ?? 0).toLocaleString("en-US");
  tickCountdown();
}

/** "+1 ATTACK IN 0:42" while recharging; fetch the new count when it lands. */
let refetching = false;
export function tickCountdown() {
  const me = state.me;
  const r = $("reset-in");
  if (!me || !me.next_attack_at) {
    r.textContent = "";
    return;
  }
  const left = me.next_attack_at - now();
  const secs = Math.max(0, Math.ceil(left));
  r.textContent = `+1 ATTACK IN ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  if (left <= 0 && !refetching) {
    refetching = true;
    api.getMe().then((m) => {
      state.me = m;
      emit("me");
    }).catch(() => {}).finally(() => (refetching = false));
  }
}

/** @param {HTMLButtonElement} b */
function fireAnim(b) {
  b.classList.remove("fire");
  void b.offsetWidth;
  b.classList.add("fire");
  setTimeout(() => b.classList.remove("fire"), 200);
}

/** @param {"normal"|"ultimate"} kind */
async function doAttack(kind) {
  if (busy) return;
  if (state.me && !state.me.name_chosen) {
    promptForName(); // name first; attacking is a separate press
    return;
  }
  busy = true;
  fireAnim(kind === "ultimate" ? btnUlt : btnAttack);
  renderControls();
  try {
    const res = await api.attack(kind);
    const a = res.attack;
    state.me = res.me;
    state.lastHit = { damage: a.damage, crit: a.crit, kind: a.kind };
    if (applyBoss(res.boss)) emit("boss");
    if (res.events) addFreshEvents(mergeFeed(res.events)); // our own hit, straight into the feed
    emit("me");
    hurt(a.crit || kind === "ultimate" ? 420 : 240);
    pulse(kind === "ultimate" ? 1.6 : a.crit ? 1.1 : 0.55);
    if (kind === "ultimate") {
      sound.ultimate();
      await ultimateSequence(a.damage);
    } else if (a.crit) {
      sound.crit();
      popup(`-${a.damage.toLocaleString("en-US")}`, "crit");
      await critBanner(a.damage);
    } else {
      sound.hit();
      popup(`-${a.damage}`, "mine");
      shake("s");
    }
    // Item effects that fired, as floating callouts.
    const procs = a.procs ?? {};
    const callouts = [
      procs.double && "DOUBLE STRIKE!",
      procs.saved && "FREE ATTACK!",
      procs.refund && "ULT RECHARGED!",
      procs.forced_crit && "CHARGED CRIT!",
    ].filter(Boolean);
    callouts.forEach((txt, i) => setTimeout(() => popup(/** @type {string} */ (txt), "proc"), 250 + i * 260));
    if (procs.refund) sound.loot();
    if (a.item_id) {
      const item = itemById(a.item_id);
      if (item) {
        sound.loot();
        await lootReveal(item, async (id) => {
          try {
            state.me = await api.equip(id);
            emit("me");
          } catch (e) {
            showError(/** @type {Error} */ (e).message);
          }
        });
      }
    }
    if (procs.box_id) {
      const boxDef = boxById(procs.box_id);
      if (boxDef) {
        sound.loot();
        await boxDropReveal(boxDef, () => openBox(boxDef));
      }
    }
  } catch (e) {
    const err = /** @type {api.ApiError} */ (e);
    if (err.code === "NEED_NAME") {
      api.getMe().then((m) => {
        state.me = m;
        promptForName();
      }).catch(() => {});
      return;
    }
    showError(err.message);
    if (err.code === "NO_ATTACKS" || err.code === "ULTIMATE_USED" || err.code === "BOSS_DEFEATED") {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    }
  } finally {
    busy = false;
    renderControls();
  }
}

function ultClick() {
  if (btnUlt.disabled) return;
  if (performance.now() < ultArmedUntil) {
    ultArmedUntil = 0;
    doAttack("ultimate");
  } else {
    ultArmedUntil = performance.now() + 3500;
    renderControls();
    setTimeout(renderControls, 3600);
  }
}

export function initControls() {
  btnAttack.addEventListener("click", () => doAttack("normal"));
  // The boss itself is a target: tapping it is the same as ATTACK.
  $("boss-stage").addEventListener("click", () => {
    if (!btnAttack.disabled) doAttack("normal");
  });
  btnUlt.addEventListener("click", ultClick);
  document.addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.metaKey || e.ctrlKey || e.altKey || overlayOpen()) return;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if (t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // native click
    const k = e.key.toLowerCase();
    if (k === "a" || k === " ") {
      e.preventDefault();
      if (!btnAttack.disabled) doAttack("normal");
    } else if (k === "u") {
      e.preventDefault();
      ultClick();
    }
  });
}
