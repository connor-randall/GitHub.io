// Attack, ultimate + scroll buttons, attack pips, reset countdown, keyboard.

import * as api from "../api.js?v=b6664395f3";
import { isAttackShortcut, isHeldSpace, loadoutShortcut } from "../keyboard.js?v=b6664395f3";
import { wearLoadout } from "./loadouts.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { isAutoStash } from "../autostash.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { applyBoss, boxById, emit, itemById, mergeFeed, now, state } from "../store.js?v=b6664395f3";
import { hurt } from "./boss.js?v=b6664395f3";
import { noteBanned } from "./appeal.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { promptForName } from "./nameform.js?v=b6664395f3";
import { openBox } from "./bag.js?v=b6664395f3";
import { addFreshEvents } from "./feed.js?v=b6664395f3";
import { boxDropReveal, critBanner, lootReveal, overlayOpen, popup, shake } from "./fx.js?v=b6664395f3";
import { relicSequence } from "./relic.js?v=b6664395f3";
import { chooseScroll, scrollReveal } from "./scrolls.js?v=b6664395f3";
import { every, learning, scrollsOpen, ultOpen } from "./tutorial.js?v=b6664395f3";
import { eventCallouts, huntAim } from "./worldevent.js?v=b6664395f3";
import { animateUltWorld, explainUlt, showUlt, ultEffects } from "./ults.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const btnAttack = /** @type {HTMLButtonElement} */ ($("btn-attack"));
const btnUlt = /** @type {HTMLButtonElement} */ ($("btn-ult"));
const btnScroll = /** @type {HTMLButtonElement} */ ($("btn-scroll"));

// Ticket #178: up to two attacks in flight, so a slow reply (a laggy
// connection, a busy phone at the end of a fight) doesn't swallow clicks.
// Sends stay at least MIN_GAP_MS apart (the server takes 4 a second).
const MAX_IN_FLIGHT = 2;
const MIN_GAP_MS = 250;
let inFlight = 0;
let lastSent = -1e9;
/** Attacks sent / the newest whose reply was used: an older reply never overwrites a newer one. */
let sent = 0;
let newest = 0;
/** Loot / chest pop-ups being shown for an attack: no attacking under them. */
let revealing = 0;
/** A click that came too soon after the last send: fired once the gap is up. */
let queued = false;
const busy = () => revealing > 0 || inFlight >= MAX_IN_FLIGHT;
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
    const text = document.body.classList.contains("scroll-treasure")
      ? TREASURE_FRAMES[scrollFxFrame % TREASURE_FRAMES.length].join("\n") : "";
    if (treasure.textContent !== text) treasure.textContent = text; // idle: no write at all
  }
  const poison = document.getElementById("boss-poison-fx");
  if (poison) {
    if (!document.body.classList.contains("scroll-poison")) {
      if (poison.textContent) poison.textContent = "";
    } else {
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
  if (freezeActive) {
    const s = seconds(state.boss.effects.frozen_until);
    effects.push({ cls: "effect-freeze", text: `❄ FROZEN BY ${state.boss.effects.frozen_by_name ?? "???"} :: ${s}s ❄`, short: `❄ FROZEN ${s}s` });
  }
  if (treasureActive) {
    const s = seconds(state.boss.effects.treasure_until);
    effects.push({ cls: "effect-treasure", text: `✦ TREASURE x2 BY ${state.boss.effects.treasure_by_name ?? "???"} :: ${s}s ✦`, short: `✦ x2 ${s}s` });
  }
  const fx = state.boss?.effects ?? {};
  if (fx.frenzy_until && now() < fx.frenzy_until) { // FRENZY / WAR CRY scrolls (2026-11-06)
    const s = seconds(fx.frenzy_until);
    effects.push({ cls: "effect-frenzy", text: `>> FRENZY BY ${fx.frenzy_by_name ?? "???"}: FREE ATTACKS :: ${s}s <<`, short: `>> FREE ${s}s` });
  }
  if (fx.war_cry_until && now() < fx.war_cry_until) {
    const s = seconds(fx.war_cry_until);
    effects.push({ cls: "effect-warcry", text: `!! WAR CRY BY ${fx.war_cry_by_name ?? "???"}: +25% DAMAGE :: ${s}s !!`, short: `!! +25% ${s}s` });
  }
  if (poisonActive) {
    const s = seconds(state.boss.effects.poison_until);
    effects.push({ cls: "effect-poison", text: `oO POISONED BY ${state.boss.effects.poison_by_name ?? "???"} :: ${s}s Oo`, short: `oO POISON ${s}s` });
  }
  effects.push(...ultEffects()); // CHARM ULTS: DEEP WINTER, ETERNAL SNOOZE, your LIGHTNING ROD
  const feedFx = document.getElementById("feed-effects");
  if (feedFx) {
    feedFx.replaceChildren(...effects.map((effect) => el("div", effect.cls, effect.text)));
    feedFx.hidden = !effects.length;
  }
  // Tickets #213 / #232: under the boss it's always exactly one line (blank when
  // there's nothing), so scrolls coming and going never push the buttons around.
  // Two or more share the line in short form; the full text is in the hover box.
  const bossFx = document.getElementById("boss-effects");
  if (bossFx) {
    const many = effects.length > 1;
    bossFx.replaceChildren(...(effects.length ? effects.map((effect) => el("span", effect.cls, many ? effect.short : effect.text))
      : ["\u00a0"]));
    bossFx.title = many ? effects.map((effect) => effect.text).join("\n") : "";
    bossFx.hidden = false;
  }
  const iceFx = document.getElementById("boss-freeze-fx");
  if (iceFx) iceFx.textContent = freezeActive ? ["/\\  /\\/\\   /\\  /\\/\\", " V   V  V     V   V  V", " |      |     |      |"].join("\n") : "";
  animateScrollEffects();
  const left = me?.attacks_left ?? 0;
  const per = me?.attacks_per_day ?? 5;
  const base = Math.min(per, me?.attacks_base ?? per); // slots past this come from the CITY's perks
  const unnamed = Boolean(me && !me.name_chosen);
  const round2 = alive && state.boss?.event?.kind === "second_wind"; // ROUND 2: attacks are free
  const frenzy = alive && Boolean(state.boss?.effects?.frenzy_until && now() < state.boss.effects.frenzy_until);
  // Unnamed players can still press it: it opens the name prompt.
  const orbit = (me?.free_hits ?? 0) > 0; // PERPETUAL ORBIT ult: free attacks banked
  btnAttack.disabled = busy() || !me || !alive || frozen || (left <= 0 && !unnamed && !round2 && !frenzy && !orbit);
  btnAttack.classList.toggle("busy", busy());
  // Unnamed players: pressing ATTACK asks for a name (and doesn't attack).
  const label = '<span class="br">[</span> A T T A C K <span class="br">]</span>';
  const html = frozen ? `${label}<span class="sub">FROZEN</span>`
    : unnamed ? `${label}<span class="sub">name yourself before fighting</span>`
      : round2 ? `${label}<span class="sub">ROUND ${state.boss?.event?.round ?? 2}: FREE ATTACKS. SPAM IT!</span>`
        : frenzy ? `${label}<span class="sub">FRENZY: FREE ATTACKS!</span>` : label;
  if (btnAttack.innerHTML !== html) btnAttack.innerHTML = html;
  $("boss-stage").classList.toggle("hittable", !btnAttack.disabled);

  // Crit charges (from chests): how many of your next attacks are guaranteed crits.
  const crits = $("fight-crits");
  const n = me?.next_crits ?? 0;
  const fb = me?.fireballs ?? 0; // charged FIREBALL scrolls (2026-11-06)
  const critText = [n > 0 ? `!! NEXT ${n} ATTACK${n === 1 ? "" : "S"} WILL CRIT !!` : "",
    fb > 0 ? `*~ ${fb} FIREBALL${fb === 1 ? "" : "S"} READY: +1,000 ON YOUR NEXT HIT ~*` : ""].filter(Boolean).join("  ");
  if (crits.textContent !== critText) crits.textContent = critText;
  if (crits.hidden !== !critText) crits.hidden = !critText;

  const pips = $("pips");
  if (pips.dataset.key !== `${left}/${per}/${base}`) { // redrawn several times a second: only when it changed
    pips.dataset.key = `${left}/${per}/${base}`;
    pips.classList.toggle("meter", per > 10);
    pips.replaceChildren(el("span", "dim", "ATTACKS "));
    if (per > 10) { // ticket #210: a [*] each wrapped over three lines; one bar, a * per attack
      // Stars past the base max are the CITY's (blue); bonus attacks above max
      // (chests, steals) turn the bar's last stars green, one each.
      const full = Math.min(left, per);
      const extra = Math.min(Math.max(0, left - per), per);
      const plain = Math.min(full - extra, base);
      pips.append(el("span", "dim", "["), el("span", "on", "*".repeat(plain)),
        el("span", "on city", "*".repeat(full - extra - plain)), el("span", "on bonus", "*".repeat(extra)),
        el("span", "off", "-".repeat(per - full)), el("span", "dim", "]"));
    } else {
      for (let i = 0; i < per; i++) {
        pips.append(el("span", i >= left ? "off" : i >= base ? "on city" : "on", i < left ? "[*]" : "[ ]"));
      }
    }
    if (left > per) pips.append(el("span", "on bonus", ` +${left - per}`)); // bonus attacks above max
    pips.append(el("span", "pips-n", `  ${left} / ${per}`));
  }

  // Ultimate: free, on its own timer (server-checked; the countdown is just for show).
  // One timer per player: swapping charms doesn't reset it, so it isn't capped at the worn charm's recharge.
  const ultWait = me?.ultimate_ready_at ? Math.max(0, Math.ceil(me.ultimate_ready_at - now())) : 0;
  const charmUlt = me?.ult ?? null; // CHARM ULTS: no charm, no ultimate
  const ultOk = Boolean(me) && alive && ultWait === 0 && Boolean(charmUlt);
  // New players meet the ULTIMATE after a few hits (tutorial.js), not on arrival.
  const ultShown = ultOpen();
  btnUlt.hidden = !ultShown;
  $("ult-warn").hidden = !ultShown;
  btnUlt.disabled = busy() || !ultOk || frozen || round2 || !ultShown; // ROUND 2: plain attacks only
  btnUlt.classList.toggle("charging", ultWait > 0);
  // Ticket #173: it's back. Flash it, even while an attack cooldown greys it out.
  if (ultWasCharging && ultWait === 0 && ultOk) {
    btnUlt.classList.remove("recharged");
    void btnUlt.offsetWidth;
    btnUlt.classList.add("recharged");
    clearTimeout(ultFlashEnd);
    ultFlashEnd = setTimeout(() => btnUlt.classList.remove("recharged"), 1500);
  } else if (ultWait > 0 && btnUlt.classList.contains("recharged")) {
    btnUlt.classList.remove("recharged"); // ticket #220: spent mid-flash, so stop flashing now
    clearTimeout(ultFlashEnd);
  }
  ultWasCharging = ultWait > 0;
  const ultHtml = charmUlt ? '<span class="br">[</span> U L T I M A T E <span class="br">]</span>'
    : '<span class="br">[</span> N O &nbsp;U L T <span class="br">]</span>';
  if (btnUlt.innerHTML !== ultHtml) btnUlt.innerHTML = ultHtml;
  btnUlt.title = charmUlt ? `${charmUlt.name}: ${charmUlt.text}` : "wear a charm: your charm is your ultimate";
  $("btn-ult-info").hidden = !ultShown || !charmUlt; // only once you have an ult
  const warn = $("ult-warn");
  const recharge = every(me?.ult_recharge ?? 60).toUpperCase();
  // While learning, the line under it says what it is (the one explanation it gets).
  warn.classList.toggle("spent", ultWait > 0 || !charmUlt);
  warn.textContent = !charmUlt ? "WEAR A CHARM TO GET AN ULT"
    : round2 ? "OFF DURING ROUND 2"
      : ultWait > 0 ? `${charmUlt.name} :: ${Math.floor(ultWait / 60)}:${String(ultWait % 60).padStart(2, "0")}`
        : alive && learning() ? `READY :: ${charmUlt.name}, BACK ${recharge}`
          : alive ? `READY :: ${charmUlt.name}` : `RECHARGES ${recharge}`;

  const scrollCount = (me?.scrolls ?? []).filter((/** @type {any} */ s) => s.scroll_id !== "ruined") // junk: sell / donate only
    .reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.count, 0);
  // No empty [ NO SCROLL ] for new players: it shows with their first scroll, or once the SHOP opens.
  const scrollShown = scrollsOpen();
  btnScroll.hidden = !scrollShown;
  $("scroll-warn").hidden = !scrollShown;
  btnScroll.disabled = busy() || !alive || scrollCount === 0 || !scrollShown;
  btnScroll.innerHTML = scrollCount
    ? `<span class="br">[</span> S C R O L L S &nbsp;x${scrollCount} <span class="br">]</span>`
    : '<span class="br">[</span> N O &nbsp;S C R O L L <span class="br">]</span>';
  const scrollWarn = $("scroll-warn");
  scrollWarn.classList.toggle("spent", scrollCount === 0);
  scrollWarn.textContent = scrollCount ? "CLICK TO CHOOSE + DEPLOY" : "BUY SCROLLS IN THE SHOP";

  // The keys line only names the buttons that are showing.
  const keys = ["[A]/[SPACE] attack", ultShown && "[U] ultimate", scrollShown && "[S] scroll",
    !$("loadout-quick").hidden && "[1]-[3] loadout"].filter(Boolean).join(" · ");
  const keysLine = $("fight-keys");
  if (keysLine.textContent !== `keys: ${keys}`) keysLine.textContent = `keys: ${keys}`;

  const last = state.lastHit;
  const lh = $("last-hit");
  lh.textContent = last ? `${last.damage.toLocaleString("en-US")} DAMAGE${last.crit ? " (CRIT)" : ""}` : "--";
  lh.classList.toggle("crit", Boolean(last?.crit));
  $("boss-dmg").textContent = (me?.boss_damage ?? 0).toLocaleString("en-US");
  tickCountdown();
}

/** Was the ultimate recharging at the last draw (so the draw where it's ready flashes it). */
let ultWasCharging = false;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let ultFlashEnd;

/** "+1 ATTACK IN 0:42" while recharging; fetch the new count when it lands. */
let refetching = false;
export function tickCountdown() {
  const me = state.me;
  const r = $("reset-in");
  if (!me || !me.next_attack_at) {
    // Full (2026-11-06): say so, so nobody sits on a full pool thinking it's charging.
    const full = Boolean(me?.name_chosen && state.boss?.status === "alive" &&
      (me.attacks_left ?? 0) >= (me.attacks_per_day ?? 5));
    const text = full ? "ATTACKS FULL :: NOT RECHARGING" : "";
    if (r.textContent !== text) r.textContent = text;
    r.classList.toggle("full", full);
    return;
  }
  r.classList.remove("full");
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

// For the bot scan (api.attack's AttackInput): mouse moves since the last attack.
let moves = 0;

/** What the click or key press that fired an attack looked like.
 * @param {Event} e @returns {import("../api.js").AttackInput} */
function inputOf(e) {
  const mv = moves;
  moves = 0;
  const tr = e.isTrusted;
  if (!(e instanceof MouseEvent) || e.detail === 0) return { s: "k", x: 0, y: 0, mv, tr }; // keys, Enter/Space on a button
  const type = /** @type {PointerEvent} */ (e).pointerType;
  const s = type === "mouse" ? "m" : type === "touch" ? "t" : type === "pen" ? "p" : "x";
  const box = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
  return { s, x: Math.round(e.clientX - box.left), y: Math.round(e.clientY - box.top), mv, tr };
}

/** @param {"normal"|"ultimate"} kind @param {number} [aim] THE HUNT: the zone tapped
 * @param {import("../api.js").AttackInput} [input] how it was clicked */
async function doAttack(kind, aim, input) {
  if (busy()) return;
  if (state.me && !state.me.name_chosen) {
    // Account first; then the hit they asked for lands (a plain attack only).
    promptForName(kind === "normal" ? () => doAttack(kind, aim, input) : undefined);
    return;
  }
  const wait = lastSent + MIN_GAP_MS - performance.now();
  if (wait > 0) { // too soon after the last one: keep the click, send it when allowed
    if (!queued) {
      queued = true;
      setTimeout(() => {
        queued = false;
        doAttack(kind, aim, input);
      }, wait);
    }
    return;
  }
  inFlight++;
  lastSent = performance.now();
  const seq = ++sent;
  fireAnim(kind === "ultimate" ? btnUlt : btnAttack);
  renderControls();
  let showing = false;
  try {
    let res;
    try {
      res = await api.attack(kind, aim, input);
    } finally {
      inFlight--;
    }
    revealing++; // only stays up while a pop-up below is awaited
    showing = true;
    const a = res.attack;
    if (seq > newest) {
      newest = seq;
      state.me = res.me;
    }
    state.lastHit = { damage: a.damage, crit: a.crit, kind: a.kind };
    if (applyBoss(res.boss)) emit("boss");
    if (res.events) addFreshEvents(mergeFeed(res.events)); // our own hit, straight into the feed
    emit("me");
    if (kind !== "ultimate") hurt(a.crit ? 420 : 240);
    if (kind === "ultimate") {
      showUlt(a.procs?.ult ?? {}); // CHARM ULTS: never a hit; over the fight, never pauses it
    } else if (a.crit) {
      sound.crit();
      popup(`-${a.damage.toLocaleString("en-US")}`, "crit");
      critBanner(a.damage); // shows over the fight without stopping it
    } else {
      sound.hit();
      popup(`-${a.damage}`, "mine");
      shake("s");
    }
    // Item effects that fired, as floating callouts. Loot is named in its rarity colour.
    const procs = a.procs ?? {};
    const drop = itemById(a.item_id);
    /** @type {[string, string]} */
    const loot = [drop?.name ?? "LOOT", `r-${drop?.rarity ?? "common"}`];
    /** @type {(string | (string | [string, string])[])[]} */
    const callouts = [
      procs.double && "DOUBLE STRIKE!",
      procs.saved && "FREE ATTACK!",
      procs.refund && (procs.refund_partial ? "ULT TIMER CUT!" : "ULT RECHARGED!"), // long ults: one timer off
      procs.forced_crit && "CHARGED CRIT!",
      procs.fireball && `FIREBALL! +${fmt(procs.fireball)}`,
      procs.war_cry && "WAR CRY +25%",
      procs.rod && `+${procs.rod} <> ROD`,
      procs.autosold && ["AUTO-SOLD ", loot, ` +${procs.autosold}<>`],
      a.item_id && !procs.autosold && (isAutoStash("items", drop?.rarity) || procs.free) && ["STASHED ", loot],
      ...eventCallouts(procs),
    ].filter((c) => Boolean(c));
    // Loot lines are plain text with the name coloured; effects stay green.
    callouts.forEach((txt, i) => setTimeout(() => popup(txt, Array.isArray(txt) ? "loot" : "proc"), 250 + i * 260));
    if (procs.refund) sound.loot();
    const spam = Boolean(procs.free); // ROUND 2: no pop-ups mid-spam, drops go straight to the bag
    if (a.item_id && !procs.autosold) {
      const item = itemById(a.item_id);
      const relic = item?.rarity === "boss_unique"; // one in a million: always the full show
      if (item && (isAutoStash("items", item.rarity) || spam) && !relic) sound.loot(); // straight to the bag: just the callout
      else if (item) {
        if (relic) await relicSequence(item);
        else sound.loot();
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
      if (boxDef && (isAutoStash("boxes") || spam)) {
        sound.loot(); // straight to the bag: just the callout
        setTimeout(() => popup(`STASHED ${boxDef.name}`, "proc"), 250 + callouts.length * 260);
      } else if (boxDef) {
        sound.loot();
        await boxDropReveal(boxDef, () => openBox(boxDef), undefined, true);
      }
    }
    if (procs.scroll_id) {
      sound.loot();
      if (spam) popup("SCROLL FOUND!", "proc");
      else await scrollReveal(procs.scroll_id, true);
    }
    if (procs.welcome_box) {
      // A new player's first hit that landed: the welcome crate, after they've seen the hit.
      const boxDef = boxById(procs.welcome_box);
      if (boxDef) {
        sound.loot();
        await boxDropReveal(boxDef, () => openBox(boxDef), "WELCOME, FIGHTER! A FREE LOOT BOX");
      }
    }
    if (procs.kill_box) {
      // The final blow's reward: always shown, even with chest auto stash on.
      const boxDef = boxById(procs.kill_box);
      if (boxDef) {
        sound.loot();
        await boxDropReveal(boxDef, () => openBox(boxDef), `FINAL BLOW! ${procs.kill_box_count ?? 1}x ${boxDef.name}`);
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
    if (err.code === "BANNED") noteBanned(); // the ban banner (with [ APPEAL ]) shows up
    if (["CAPTCHA", "NO_ATTACKS", "ULTIMATE_USED", "BOSS_DEFEATED", "NO_CHARM"].includes(err.code)) {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    }
  } finally {
    if (showing) revealing--;
    renderControls();
  }
}

let deniedAt = 0;
/** ATTACK pressed (Space / a tap on the boss) with nothing left: say so, instead
 * of nothing happening (it looked broken). The countdown flashes, the pips
 * jolt, a dull thud. At most every 600 ms. */
function outOfAttacks() {
  const me = state.me;
  const alive = state.boss?.status === "alive";
  if (!me || !me.name_chosen || !alive || (me.attacks_left ?? 0) > 0 || busy()) return;
  if (state.boss?.event?.kind === "second_wind") return;
  const t = Date.now();
  if (t - deniedAt < 600) return;
  deniedAt = t;
  for (const id of ["reset-in", "pips"]) {
    const node = document.getElementById(id);
    if (!node) continue;
    node.classList.remove("denied");
    void node.offsetWidth; // restart the animation
    node.classList.add("denied");
  }
  sound.denied();
}

export function initControls() {
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") moves++;
  }, { passive: true });
  btnAttack.addEventListener("click", (e) => doAttack("normal", undefined, inputOf(e)));
  // The boss itself is a target: tapping it is the same as ATTACK.
  $("boss-stage").addEventListener("click", (e) => {
    // THE HUNT: where on the boss you tapped is where you aimed.
    if (!btnAttack.disabled) doAttack("normal", huntAim(e.clientX, e.clientY, $("boss-stage")), inputOf(e));
    else outOfAttacks();
  });
  btnUlt.addEventListener("click", (e) => doAttack("ultimate", undefined, inputOf(e)));
  btnScroll.addEventListener("click", chooseScroll);
  $("btn-ult-info").addEventListener("click", explainUlt);
  setInterval(animateScrollEffects, 180);
  setInterval(animateUltWorld, 300);
  document.addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return; // typing (e.g. in chat) never attacks
    // Browsers mark the extra keydown events fired by a held key as repeats.
    // Stop held Space even when the attack button itself has keyboard focus.
    if (isHeldSpace(e)) {
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || overlayOpen()) return;
    if (t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // native click
    const k = e.key.toLowerCase();
    if (isAttackShortcut(e)) {
      e.preventDefault();
      if (!btnAttack.disabled) doAttack("normal", undefined, inputOf(e));
      else outOfAttacks();
    } else if (k === "u") {
      e.preventDefault();
      if (!btnUlt.disabled && !btnUlt.hidden) doAttack("ultimate", undefined, inputOf(e));
    } else if (k === "s") {
      e.preventDefault();
      if (!btnScroll.hidden) chooseScroll();
    } else if (loadoutShortcut(e) !== null) {
      e.preventDefault();
      wearLoadout(/** @type {number} */ (loadoutShortcut(e))); // 1, 2, 3: wear that loadout
    }
  });
}
