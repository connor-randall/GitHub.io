// Attack + ultimate buttons, attack pips, reset countdown, keyboard.

import * as api from "../api.js?v=b7420735b5";
import { isAttackShortcut, isHeldSpace } from "../keyboard.js?v=b7420735b5";
import { el } from "../ascii.js?v=b7420735b5";
import { isAutoStash } from "../autostash.js?v=b7420735b5";
import * as sound from "../sound.js?v=b7420735b5";
import { applyBoss, boxById, emit, itemById, mergeFeed, now, state } from "../store.js?v=b7420735b5";
import { pulse } from "./ambient.js?v=b7420735b5";
import { hurt } from "./boss.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";
import { promptForName } from "./nameform.js?v=b7420735b5";
import { openBox } from "./bag.js?v=b7420735b5";
import { addFreshEvents } from "./feed.js?v=b7420735b5";
import { boxDropReveal, critBanner, lootReveal, overlayOpen, popup, shake } from "./fx.js?v=b7420735b5";
import { chooseScroll, scrollReveal } from "./scrolls.js?v=b7420735b5";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const btnAttack = /** @type {HTMLButtonElement} */ ($("btn-attack"));
const btnUlt = /** @type {HTMLButtonElement} */ ($("btn-ult"));

let busy = false;
let scrollFxFrame = 0;

const TREASURE_FRAMES = [
  ["*       +       .", "   .   $    *    ", "+      <>      $ "],
  ["  +       *      ", "$      .      +  ", "   *      $      ."],
  [".      $       * ", "    +     *      ", " $      <>     +  "],
  ["   *      .     $", "+      $      *  ", "    .       +     "],
];

/** Real ASCII animation: characters and positions change every frame. */
function animateScrollEffects() {
  scrollFxFrame++;
  const treasure = document.getElementById("boss-treasure-fx");
  if (treasure) {
    treasure.textContent = document.body.classList.contains("scroll-treasure")
      ? TREASURE_FRAMES[scrollFxFrame % TREASURE_FRAMES.length].join("\n") : "";
  }
  const poison = document.getElementById("boss-poison-fx");
  if (poison) {
    if (!document.body.classList.contains("scroll-poison")) poison.textContent = "";
    else {
      const width = 24, height = 7;
      const field = Array.from({ length: height }, () => Array(width).fill(" "));
      const bubbles = [[2, 0], [7, 3], [12, 1], [17, 5], [21, 2], [5, 6], [15, 4]];
      bubbles.forEach(([x, phase], i) => {
        const y = (height - 1 - ((scrollFxFrame + phase) % height) + height) % height;
        const chars = [".", "o", "O", "o"];
        const drift = x + Math.floor(scrollFxFrame / height) * (i % 2 ? 1 : -1);
        field[y][((drift % width) + width) % width] =
          chars[(scrollFxFrame + i) % chars.length];
      });
      poison.textContent = field.map((row) => row.join("")).join("\n");
    }
  }
}

export function renderControls() {
  const me = state.me;
  const alive = state.boss?.status === "alive";
  const frozen = Boolean(state.boss?.effects?.frozen_until && now() < state.boss.effects.frozen_until
    && state.boss.effects.frozen_by !== me?.id);
  const freezeActive = Boolean(state.boss?.effects?.frozen_until && now() < state.boss.effects.frozen_until);
  const treasureActive = Boolean(state.boss?.effects?.treasure_until && now() < state.boss.effects.treasure_until);
  const poisonActive = Boolean(state.boss?.effects?.poison_until && now() < state.boss.effects.poison_until);
  document.body.classList.toggle("scroll-frozen", frozen);
  document.body.classList.toggle("scroll-treasure", treasureActive);
  document.body.classList.toggle("scroll-poison", poisonActive);
  const seconds = (/** @type {number} */ until) => Math.max(0, Math.ceil(until - now()));
  const effects = [];
  if (freezeActive) effects.push({ cls: "effect-freeze", text: `❄ FROZEN BY ${state.boss.effects.frozen_by_name ?? "???"} :: ${seconds(state.boss.effects.frozen_until)}s ❄` });
  if (treasureActive) effects.push({ cls: "effect-treasure", text: `✦ TREASURE x2 BY ${state.boss.effects.treasure_by_name ?? "???"} :: ${seconds(state.boss.effects.treasure_until)}s ✦` });
  if (poisonActive) effects.push({ cls: "effect-poison", text: `oO POISONED BY ${state.boss.effects.poison_by_name ?? "???"} :: ${seconds(state.boss.effects.poison_until)}s Oo` });
  for (const id of ["boss-effects", "feed-effects"]) {
    const host = document.getElementById(id);
    if (!host) continue;
    host.replaceChildren(...effects.map((effect) => el("div", effect.cls, effect.text)));
    host.hidden = !effects.length;
  }
  const iceFx = document.getElementById("boss-freeze-fx");
  if (iceFx) iceFx.textContent = freezeActive ? ["/\\  /\\/\\   /\\  /\\/\\", " V   V  V     V   V  V", " |      |     |      |"].join("\n") : "";
  animateScrollEffects();
  const left = me?.attacks_left ?? 0;
  const per = me?.attacks_per_day ?? 5;
  const unnamed = Boolean(me && !me.name_chosen);
  // Unnamed players can still press it: it opens the name prompt.
  btnAttack.disabled = busy || !me || !alive || frozen || (left <= 0 && !unnamed);
  btnAttack.classList.toggle("busy", busy);
  // Unnamed players: pressing ATTACK asks for a name (and doesn't attack).
  const label = '<span class="br">[</span> A T T A C K <span class="br">]</span>';
  const html = frozen ? `${label}<span class="sub">FROZEN</span>`
    : unnamed ? `${label}<span class="sub">name yourself before fighting</span>` : label;
  if (btnAttack.innerHTML !== html) btnAttack.innerHTML = html;
  $("boss-stage").classList.toggle("hittable", !btnAttack.disabled);

  const pips = $("pips");
  pips.replaceChildren(el("span", "dim", "ATTACKS "));
  for (let i = 0; i < per; i++) pips.append(el("span", i < left ? "on" : "off", i < left ? "[*]" : "[ ]"));
  if (left > per) pips.append(el("span", "on bonus", ` +${left - per}`)); // bonus attacks above max
  pips.append(el("span", "", `  ${left} / ${per}`));

  const scrollCount = (me?.scrolls ?? []).reduce((n, s) => n + s.count, 0);
  btnUlt.disabled = busy || !alive || scrollCount === 0;
  btnUlt.classList.remove("armed");
  btnUlt.innerHTML = scrollCount
    ? `<span class="br">[</span> S C R O L L S  x${scrollCount} <span class="br">]</span>`
    : '<span class="br">[</span> N O  S C R O L L <span class="br">]</span>';
  const warn = $("ult-warn");
  warn.classList.toggle("spent", scrollCount === 0);
  warn.textContent = scrollCount ? "CLICK TO CHOOSE + DEPLOY" : "SCROLLS DROP FROM ATTACKS";

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
    if (a.crit) {
      sound.crit();
      popup(`-${a.damage.toLocaleString("en-US")}`, "crit");
      critBanner(a.damage); // shows over the fight without stopping it
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
      procs.autosold && `AUTO-SOLD ${itemById(a.item_id)?.name ?? "LOOT"} +${procs.autosold}<>`,
      a.item_id && !procs.autosold && isAutoStash() && `STASHED ${itemById(a.item_id)?.name ?? "LOOT"}`,
    ].filter(Boolean);
    callouts.forEach((txt, i) => setTimeout(() => popup(/** @type {string} */ (txt), "proc"), 250 + i * 260));
    if (procs.refund) sound.loot();
    if (a.item_id && !procs.autosold) {
      const item = itemById(a.item_id);
      if (item && isAutoStash()) sound.loot(); // straight to the bag: just the callout
      else if (item) {
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
    if (procs.scroll_id) {
      sound.loot();
      await scrollReveal(procs.scroll_id, true);
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

export function initControls() {
  btnAttack.addEventListener("click", () => doAttack("normal"));
  // The boss itself is a target: tapping it is the same as ATTACK.
  $("boss-stage").addEventListener("click", () => {
    if (!btnAttack.disabled) doAttack("normal");
  });
  btnUlt.addEventListener("click", chooseScroll);
  setInterval(animateScrollEffects, 180);
  document.addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    // Browsers mark the extra keydown events fired by a held key as repeats.
    // Stop held Space even when the attack button itself has keyboard focus.
    if (isHeldSpace(e)) {
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || overlayOpen()) return;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if (t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // native click
    const k = e.key.toLowerCase();
    if (isAttackShortcut(e)) {
      e.preventDefault();
      if (!btnAttack.disabled) doAttack("normal");
    } else if (k === "s") {
      e.preventDefault();
      chooseScroll();
    }
  });
}
