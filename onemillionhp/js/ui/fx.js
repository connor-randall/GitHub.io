// Effects: shake, damage popups, crit banner, ultimate sequence, loot reveal,
// item cards and the modal overlay they all share.

import { RARITY_STYLE, bigText, box, center, centerBlock, dedent, el, fitArt, fmt, segText, widthOf } from "../ascii.js?v=b6664395f3";
import { isAutoStash, setAutoStashBoxes, setAutoStashUpTo } from "../autostash.js?v=b6664395f3";
import { summarizeBoxResults } from "../box-results.js?v=b6664395f3";
import * as api from "../api.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { boxById, emit, ownItem, rarityById, state } from "../store.js?v=b6664395f3";
import { EFFECT_HELP, effectLine, effectParts, themeLine } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const overlay = /** @type {HTMLElement} */ (document.getElementById("overlay"));
const shakeEl = /** @type {HTMLElement} */ (document.getElementById("shake"));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// [SHAKE:OFF] in the top bar (ticket #165): no screen shake at all, on this browser.
const SHAKE_KEY = "omhp.shake";
let shakeOff = false;
try {
  shakeOff = localStorage.getItem(SHAKE_KEY) === "off";
} catch {
  /* ignore */
}
export const shakeOn = () => !shakeOff;
/** @param {boolean} on */
export function setShake(on) {
  shakeOff = !on;
  try {
    localStorage.setItem(SHAKE_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

/** @param {"s"|"l"} size */
export function shake(size) {
  if (reduced || shakeOff) return;
  shakeEl.classList.remove("shake-s", "shake-l");
  void shakeEl.offsetWidth; // restart the animation
  shakeEl.classList.add(size === "l" ? "shake-l" : "shake-s");
}

/** Floating damage number (or effect callout) over the boss. Damage
 * numbers ("-1,234") are drawn in small ASCII digits. A callout can also be
 * pieces, e.g. ["STASHED ", [item name, "r-epic"]]: a [text, class] piece is
 * coloured by that class (loot shows in its rarity colour).
 * @param {string | (string | [string, string])[]} text @param {"mine"|"crit"|"small"|"proc"|"loot"} kind */
export function popup(text, kind) {
  const host = document.getElementById("popups");
  if (!host) return;
  const seg = typeof text === "string" && /^-[\d,]+$/.test(text);
  const p = el("div", "pop" + (kind === "mine" ? "" : " " + kind) + (seg ? " seg" : ""),
    typeof text !== "string" ? undefined : seg ? segText(text).join("\n") : text);
  if (typeof text !== "string") {
    p.append(...text.map((part) => (typeof part === "string" ? part : el("span", part[1], part[0]))));
  }
  const spread = kind === "small" ? 140 : 60;
  p.style.setProperty("margin-left", `${Math.round((Math.random() - 0.5) * spread)}px`);
  // Your own numbers rise from above the boss's face, where they can be read;
  // everyone else's stay small, lower down.
  const mine = kind === "mine" || kind === "crit";
  p.style.setProperty("top", `${mine ? 8 + Math.round(Math.random() * 12) : 30 + Math.round(Math.random() * 25)}%`);
  host.append(p);
  if (host.children.length > 14) host.firstElementChild?.remove();
  p.addEventListener("animationend", () => p.remove());
}

// ------------------------------------------------------------------ overlay

/** @type {(() => void) | null} */
let closeCurrent = null;
/** @type {Promise<void>} */
let queue = Promise.resolve();

export const overlayOpen = () => !overlay.hidden;
/** A pop-up the player is in the middle of (loot, gifts, the death scoreboard),
 * as opposed to the welcome / name screens, which lose nothing on a reload. */
export const busyOverlay = () => !overlay.hidden && !overlay.classList.contains("identify");

/**
 * Show content in the overlay until closed. Overlays queue, so a crit
 * banner followed by a loot drop play one after the other.
 * @param {(inner: HTMLElement, close: () => void) => void} build
 * mustChoose: only the overlay's own buttons close it (no background click, no Escape).
 * @param {{autoCloseMs?: number, dismissable?: boolean, mustChoose?: boolean}} [opts]
 * @returns {Promise<void>}
 */
export function showOverlay(build, opts = {}) {
  const run = () =>
    new Promise((resolve) => {
      const inner = el("div", "overlay-inner");
      overlay.replaceChildren(inner);
      overlay.hidden = false;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const close = () => {
        if (timer) clearTimeout(timer);
        overlay.hidden = true;
        overlay.replaceChildren();
        overlay.onclick = null;
        closeCurrent = null;
        resolve(undefined);
      };
      closeCurrent = opts.mustChoose ? null : close;
      build(inner, close);
      if (opts.dismissable !== false && !opts.mustChoose) {
        overlay.onclick = (e) => {
          if (e.target === overlay) close();
        };
      }
      if (opts.autoCloseMs) timer = setTimeout(close, opts.autoCloseMs);
      // First button, unless the build already chose what to focus.
      const focusable = /** @type {HTMLElement | null} */ (inner.querySelector("button"));
      if (!inner.contains(document.activeElement)) focusable?.focus({ preventScroll: true });
      inner.querySelectorAll("pre.art").forEach((p) => fitArt(/** @type {HTMLElement} */ (p), 16));
    });
  queue = queue.then(run, run);
  return queue;
}

/** The death ceremony's [ SKIP ]: every screen of it listens and finishes itself. */
export const SKIP_DEATH = "omhp:skip-death";

/** Call ``finish`` once, also when [ SKIP ] is pressed; the returned function is
 * the guarded finish (a late second call can't close the next pop-up).
 * @param {() => void} finish @returns {() => void} */
export function onSkipDeath(finish) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    document.removeEventListener(SKIP_DEATH, once);
    finish();
  };
  document.addEventListener(SKIP_DEATH, once);
  return once;
}

export function closeOverlay() {
  closeCurrent?.();
}

/** Reveal a <pre> line by line (JS timers, not CSS delays: deterministic
 * and each line ends up plainly visible). @param {HTMLElement} pre @param {(string | (string | [string, string])[])[]} lines @param {number} stepMs */
function revealLines(pre, lines, stepMs) {
  // A line can be pieces: [text, class] pieces are coloured (rarity colours in the chest haul).
  const flat = lines.map((l) => (typeof l === "string" ? l : l.map((p) => (typeof p === "string" ? p : p[0])).join("")));
  const spans = lines.map((l, i) => {
    const sp = el("span", stepMs ? "pending" : "", typeof l === "string" ? l || " " : undefined);
    if (typeof l !== "string") sp.append(...l.map((p) => (typeof p === "string" ? p : el("span", p[1], p[0]))));
    if (!flat[i]) sp.textContent = " ";
    return sp;
  });
  pre.classList.add("reveal");
  pre.replaceChildren(...spans);
  pre.dataset.cols = String(widthOf(flat));
  spans.forEach((sp, i) => setTimeout(() => sp.classList.remove("pending"), i * stepMs));
}

/** @param {string} label @param {() => void} fn */
export function button(label, fn) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "", label));
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

// ---------------------------------------------------------------- item card

/**
 * The canonical ASCII rendering of an item: art, name and rarity inside a
 * border drawn in that rarity's characters.
 * @param {any} item @param {{unknown?: boolean, count?: number, equipped?: boolean, locked?: boolean, loadouts?: string, width?: number}} [o]
 */
export function itemLines(item, o = {}) {
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const rarity = rarityById(item.rarity);
  const inner = o.width ?? 24;
  const base = dedent(item.art);
  const drawn = o.unknown ? base.map((l) => l.replace(/[^ ]/g, ".")) : base;
  // Pad every item to the tallest art so cards line up in the grid.
  const tallest = Math.max(...(state.content?.items ?? [item]).map((/** @type {any} */ i) => i.art.length));
  const extra = Math.max(0, tallest - drawn.length);
  const top = Math.floor(extra / 2);
  const art = [...Array(top).fill(""), ...drawn, ...Array(extra - top).fill("")];
  const label = o.unknown ? "[ ??? ]" : style.deco[0] + (rarity?.label ?? item.rarity.toUpperCase()) + style.deco[1];
  const name = o.unknown ? "? ? ? ? ?" : item.name;
  const tag = o.unknown
    ? ""
    : [item.slot.toUpperCase(), o.equipped ? "EQUIPPED" : "", o.locked ? "LOCKED" : "",
      o.count && o.count > 1 ? `x${o.count}` : ""]
        .filter(Boolean)
        .join("  ");
  // Saved loadouts it's in ("L1 L3"), on a line of its own so every card is the same height.
  const inLoadouts = o.loadouts === undefined ? null : o.loadouts ? `[ ${o.loadouts} ]` : "";
  // Lines are pre-centred to the box's inner width, so box() must not re-centre them.
  const theme = o.unknown ? "" : themeLine(item, inner < 30);
  return box([...centerBlock(art, inner - 2), " ", center(name, inner - 2), center(label, inner - 2),
    center(theme, inner - 2), center(tag, inner - 2), ...(inLoadouts === null ? [] : [center(inLoadouts, inner - 2)])], {
    width: inner + 2,
    align: "left",
    style: o.unknown ? RARITY_STYLE.common : style,
  });
}

// ------------------------------------------------------------ crit banner

/** @param {number} damage @param {string} [title] */
export function critBanner(damage, title = "CRITICAL STRIKE") {
  // Grow the frame to fit big numbers (block digits are 6 columns each), so
  // the !! borders always line up.
  const digits = bigText(fmt(damage));
  const w = Math.max(28, widthOf(digits) + 6, title.length + 6);
  const lines = [
    "!".repeat(w),
    "!!" + center(title, w - 4) + "!!",
    "!!" + " ".repeat(w - 4) + "!!",
    ...centerBlock(digits, w - 4).map((l) => "!!" + l.padEnd(w - 4) + "!!"),
    "!!" + " ".repeat(w - 4) + "!!",
    "!!" + center(`${fmt(damage)} DAMAGE`, w - 4) + "!!",
    "!".repeat(w),
  ];
  shake("l");
  // Not a pop-up: a see-through layer, so clicks and keys keep hitting the
  // boss while it plays. A new crit replaces it; it fades out on its own.
  critLayer ??= document.body.appendChild(el("div", "crit-layer"));
  critLayer.setAttribute("aria-hidden", "true");
  clearTimeout(critTimer);
  const layer = critLayer;
  const pre = el("pre", "art crit-banner");
  layer.replaceChildren(pre);
  layer.classList.remove("leaving");
  layer.hidden = false;
  revealLines(pre, lines, 35);
  // Shrink the font so a wide banner still fits the screen (~0.6em per char).
  const px = Math.min(16, Math.max(5, (window.innerWidth - 40) / (w * 0.602)));
  pre.style.setProperty("font-size", px.toFixed(2) + "px");
  critTimer = setTimeout(() => {
    layer.classList.add("leaving");
    critTimer = setTimeout(() => (layer.hidden = true), 300);
  }, CRIT_SHOW_MS);
}

/** CHARM ULTS: the same see-through layer as a crit, with words instead of a
 * number: a border of the ult's own character, its name, what it did.
 * @param {string} title @param {string[]} body @param {string} [edge] border char @param {string} [cls] colour class
 * @param {number} [showMs] */
export function ultBanner(title, body, edge = "!", cls = "", showMs = 2600) {
  const w = Math.max(30, title.length + 8, ...body.map((l) => l.length + 8));
  const e2 = edge.repeat(2);
  const lines = [
    edge.repeat(w),
    e2 + center(title, w - 4) + e2,
    e2 + " ".repeat(w - 4) + e2,
    ...body.map((l) => e2 + center(l, w - 4) + e2),
    edge.repeat(w),
  ];
  shake("s");
  critLayer ??= document.body.appendChild(el("div", "crit-layer"));
  critLayer.setAttribute("aria-hidden", "true");
  clearTimeout(critTimer);
  const layer = critLayer;
  const pre = el("pre", `art crit-banner ult-banner ${cls}`.trim());
  layer.replaceChildren(pre);
  layer.classList.remove("leaving");
  layer.hidden = false;
  revealLines(pre, lines, 35);
  const px = Math.min(16, Math.max(5, (window.innerWidth - 40) / (w * 0.602)));
  pre.style.setProperty("font-size", px.toFixed(2) + "px");
  critTimer = setTimeout(() => {
    layer.classList.add("leaving");
    critTimer = setTimeout(() => (layer.hidden = true), 300);
  }, showMs);
}

const CRIT_SHOW_MS = 1600;
/** @type {HTMLElement | null} */
let critLayer = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let critTimer;

// --------------------------------------------------------- ultimate sequence

const RING = [".", "o", "O", "0", "@", "#"];

/** One frame of the charge-up: concentric rings expanding from the centre.
 * @param {number} t 0..1 @param {number} W @param {number} H */
function ringFrame(t, W, H) {
  const rows = [];
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const maxR = Math.hypot(cx / 2, cy);
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - cx) / 2, y - cy) / maxR; // chars are ~2x taller than wide
      let ch = " ";
      for (let k = 0; k < 3; k++) {
        const r = t * 1.4 - k * 0.22;
        if (r > 0 && Math.abs(d - r) < 0.05) ch = RING[Math.min(RING.length - 1, 5 - k * 2)];
      }
      if (ch === " " && d < t * 0.35) ch = RING[Math.floor(Math.random() * 3)];
      if (ch === " " && Math.random() < 0.012 * t) ch = "*";
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

/** @param {number} damage */
export function ultimateSequence(damage) {
  const W = 38, H = 15;
  return showOverlay(
    (inner, close) => {
      const title = el("pre", "art ult-stage");
      const stage = el("pre", "art ult-stage");
      const foot = el("div", "actions");
      inner.append(title, stage, foot);
      title.textContent = center("U L T I M A T E", W);
      title.dataset.cols = String(W);
      stage.dataset.cols = String(W);
      fitArt(title, 16);
      fitArt(stage, 16);
      const frames = reduced ? 1 : 16;
      let f = 0;
      const tick = () => {
        if (f < frames) {
          stage.textContent = ringFrame((f + 1) / frames, W, H).join("\n");
          f++;
          setTimeout(tick, 55);
          return;
        }
        shake("l");
        overlay.style.setProperty("background", "rgba(255,176,0,.85)");
        setTimeout(() => {
          overlay.style.removeProperty("background");
          countUp();
        }, 110);
      };
      const countUp = () => {
        const start = performance.now();
        const dur = reduced ? 1 : 700;
        const step = () => {
          const k = Math.min(1, (performance.now() - start) / dur);
          const n = Math.round(damage * (1 - Math.pow(1 - k, 3)));
          const block = centerBlock(bigText(fmt(n)), W);
          stage.textContent = ["", "", ...block, "", center(`${fmt(n)} DAMAGE`, W), "", ""].join("\n");
          if (k < 1) requestAnimationFrame(step);
          else foot.append(button("[ OK ]", close));
        };
        step();
      };
      tick();
    },
    { autoCloseMs: 6000 },
  );
}

// ------------------------------------------------------------- loot reveal

/** A new player who hasn't worn gear yet (tutorial step 3): drops ask EQUIP or
 * LATER only, and auto-stash settings wait until they know what gear is. */
const gearNewbie = () => (state.me?.tutorial?.stage ?? 6) < 3;

/**
 * @param {any} item
 * @param {(id: string) => Promise<void>} onEquip
 */
export function lootReveal(item, onEquip, title = "ITEM FOUND") {
  const bossUnique = item.rarity === "boss_unique";
  const rank = rarityById(item.rarity)?.rank ?? 0;
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const header = box([bossUnique ? "A BOSS RELIC AWAKENS" : title], { width: 28, style });
  return showOverlay((inner, close) => {
    // Ticket #103: clicks still flying from spamming ATTACK would select the art
    // while it draws. Not selectable until the choices unlock.
    inner.classList.add("no-select");
    if (bossUnique) {
      inner.classList.add("boss-unique-reveal");
      inner.append(el("div", "boss-unique-banner", "BOSS UNIQUE :: BEYOND GODLY"));
    }
    const pre = el("pre", `art r-${item.rarity}`);
    inner.append(pre);
    const suspense = reduced ? 0 : bossUnique ? 700 : rank >= 3 ? 900 : rank >= 2 ? 450 : 0;
    if (suspense) {
      revealLines(pre, [...header, "", center(". . .", 28)], 0);
      shake("s");
    }
    setTimeout(() => {
      const lines = [...header, ...itemLines(item, { width: 26 })];
      const step = rank >= 3 ? 70 : 40;
      revealLines(pre, lines, step);
      fitArt(pre, 16);
      if (rank >= 4) shake("l");
      const flavor = el("div", "flavor dim", `"${item.flavor}"`);
      // What the item actually does, plus a plain-English line per effect.
      const stats = el("div", "item-detail stats loot-stats");
      // Green/red against what you wear now. A copy of the very item you wear
      // (ticket #113) compares with that copy: all grey, not all green.
      const wornId = state.me?.worn?.[item.slot] ?? null;
      stats.append(effectLine(item, wornId ? ownItem(wornId) : null)); // a new drop vs. your (maybe refined) worn copy
      if (wornId === item.id) stats.append(el("div", "dim", "> you're already wearing one of these"));
      for (const [k, v] of Object.entries(EFFECT_HELP)) {
        if (effectParts(item.mods).some((p) => p.endsWith(k))) stats.append(el("div", "dim", `${k}: ${v}`));
      }
      stats.append(el("div", "dim", `${item.slot.toUpperCase()} SLOT`));
      if (bossUnique) {
        stats.append(el("div", "boss-unique-banner", "ONE BOSS. ONE SIGNATURE. YOURS."));
      }
      const actions = el("div", "actions");
      const choices = [
        button(`[ EQUIP ${item.slot.toUpperCase()} ]`, async () => {
          await onEquip(item.id);
          close();
        }),
        button(gearNewbie() ? "[ LATER ]" : "[ STASH ]", close),
        button(`[ AUTO STASH ${rarityById(item.rarity)?.label ?? item.rarity.toUpperCase()} & BELOW? ]`, () => {
          // this one is stashed too; the next ones of this rarity or lower skip this pop-up
          setAutoStashUpTo(item.rarity, (state.content?.rarities ?? []).map((/** @type {any} */ r) => r.id));
          close();
        }),
      ];
      // Tickets #154 #100: sell it to the shop right here (what the shop pays for
      // its rarity; boss uniques and city pieces don't go to the shop).
      const sellPrice = item.city_only || bossUnique ? 0 : ((state.me?.shop ?? state.content?.shop)?.sell?.[item.rarity] ?? 0);
      if (sellPrice > 0 && !gearNewbie()) {
        choices.push(button(`[ SELL +${fmt(sellPrice)} ]`, async () => {
          try {
            const res = await api.sellItem(item.id, 1);
            state.me = res.me;
            emit("me");
            close();
          } catch (e) {
            showError(/** @type {Error} */ (e).message);
          }
        }));
      }
      // Neither choice works until the item has finished drawing (plus a
      // beat), so clicks and keys still flying from spamming ATTACK can't
      // pick one before the item is seen.
      for (const b of choices) b.disabled = true;
      setTimeout(() => {
        choices.forEach((b) => (b.disabled = false));
        inner.classList.remove("no-select");
      }, lines.length * step + CHOICE_DELAY_MS);
      actions.append(choices[0], choices[1], ...choices.slice(3));
      inner.append(flavor, stats, actions);
      if (!gearNewbie()) {
        const auto = el("div", "actions auto-stash-row");
        choices[2].title = "Items of this rarity and lower go straight to your inventory. Change it in [ INVENTORY ].";
        auto.append(choices[2]);
        inner.append(auto);
      }
      // Focus the card, not a button, so a held Space/Enter doesn't choose for them.
      inner.tabIndex = -1;
      inner.focus({ preventScroll: true });
    }, suspense);
  }, { mustChoose: true });
}

const CHOICE_DELAY_MS = 400;

// ------------------------------------------------------------- loot boxes

/** A loot box reveal (dropped from an attack, or a gift). Found boxes
 * (``offerAutoStash``) also get [ AUTO STASH? ] to skip this pop-up next time.
 * @param {any} boxDef @param {() => void} onOpen @param {string} [title] @param {boolean} [offerAutoStash] */
export function boxDropReveal(boxDef, onOpen, title = "LOOT BOX FOUND", offerAutoStash = false) {
  const W = Math.max(30, title.length + 6);
  return showOverlay(
    (inner, close) => {
      inner.style.setProperty("width", "min(92vw, 420px)");
      const pre = el("pre", "art box-drop");
      const lines = [...box([title], { width: W }), "", ...centerBlock(boxDef.art, W), "",
        center(boxDef.name, W)];
      inner.append(pre);
      revealLines(pre, lines, 45);
      inner.classList.add("no-select"); // ticket #103, as for items: not while it draws
      setTimeout(() => inner.classList.remove("no-select"), lines.length * 45 + CHOICE_DELAY_MS);
      fitArt(pre, 16);
      const flavor = el("div", "flavor dim", `"${boxDef.flavor}"`);
      const actions = el("div", "actions");
      actions.append(
        button("[ OPEN NOW ]", () => {
          close();
          onOpen();
        }),
        button("[ LATER ]", close),
      );
      inner.append(flavor, actions);
      if (offerAutoStash && !gearNewbie()) {
        const auto = el("div", "actions auto-stash-row");
        const b = button("[ AUTO STASH? ]", () => {
          setAutoStashBoxes(true); // this one is stashed too; the next ones skip this pop-up
          close();
        });
        b.title = "Found chests go straight to your bag. Turn it off in [ BAG ].";
        auto.append(b);
        inner.append(auto);
      }
      // Ticket #329: focus the card, not [ OPEN NOW ], so Space spammed at the
      // boss doesn't open a chest that pops up mid-fight.
      inner.tabIndex = -1;
      inner.focus({ preventScroll: true });
    },
    { autoCloseMs: 8000 },
  );
}

const SHARDS_ART = [
  "      /\\          /\\     ",
  "     /  \\   /\\   /  \\    ",
  "    / <> \\ /  \\ / <> \\   ",
  "    \\    / \\<>/ \\    /   ",
  "     \\  /   \\/   \\  /    ",
  "      \\/          \\/     ",
];

/** Shards from the admin: crystals, the amount in big digits, [ NICE ].
 * @param {number} amount @param {string} [title] @param {string} [note] replaces the "spend in [ SHOP ]" line */
export function shardsReveal(amount, title = "A GIFT FROM ***ADMIN***", note = "") {
  const W = Math.max(30, title.length + 6);
  return showOverlay(
    (inner, close) => {
      inner.style.setProperty("width", "min(92vw, 420px)");
      const pre = el("pre", "art shards-drop");
      const lines = [...box([title], { width: W }), "", ...centerBlock(SHARDS_ART, W), "",
        ...centerBlock(bigText(fmt(amount)), W), "", center("S H A R D S", W)];
      inner.append(pre);
      revealLines(pre, lines, 45);
      fitArt(pre, 16);
      const said = el("div", "flavor dim", note || `"+${fmt(amount)} <> to spend in [ SHOP ]"`);
      const actions = el("div", "actions");
      actions.append(button("[ NICE ]", close));
      inner.append(said, actions);
      actions.querySelector("button")?.focus({ preventScroll: true });
    },
    { autoCloseMs: 8000 },
  );
}

/** Attack Steal consequence: a full loot-style reveal, never an admin notice.
 * @param {string} name @param {number} amount */
export function stolenReveal(name, amount) {
  const W = 46;
  const thief = name.slice(0, 16);
  const frames = [
    ["[*] [*] [*] [*] [*]", "", "", "|        |"],
    ["    [*] [*] [*] [*]", "[*] ---->", "", "|  *     |"],
    ["        [*] [*] [*]", "     [*] ------>", "", "| **     |"],
    ["            [*] [*]", "          [*] ------>", "", "| ***    |"],
    ["                [*]", "               [*] --->", "", "| ****   |"],
    ["       EMPTY: 0", "                    [*] ->", "", "| *****  |"],
    ["       EMPTY: 0", "", "        ALL ATTACKS STOLEN", "|******  |"],
    ["       EMPTY: 0", "", "        ALL ATTACKS STOLEN", "|******  |"],
  ];
  return showOverlay((inner, close) => {
    inner.style.setProperty("width", "min(92vw, 440px)");
    const pre = el("pre", "art attack-stolen");
    pre.dataset.cols = String(W);
    const actions = el("div", "actions");
    actions.append(button("[ ACCEPT DEFEAT ]", close));
    inner.append(pre, actions);
    fitArt(pre, 16);
    let frame = 0;
    const draw = () => {
      if (!pre.isConnected) return false;
      const scene = frames[frame % frames.length];
      pre.textContent = [
        ...box(["A T T A C K   H E I S T"], { width: W }),
        "",
        center(`${thief} IS STEALING YOUR ATTACKS`, W),
        "",
        " YOUR ATTACKS                    THIEF'S STASH ",
        ` ${scene[0].padEnd(29)}.--------.`,
        ` ${scene[1].padEnd(29)}${scene[3]}`,
        ` ${scene[2].padEnd(29)}|        |`,
        ` ${"".padEnd(29)}'--------'`,
        "",
        center(`THEY GOT ${fmt(amount)} ATTACKS!`, W),
        center("YOUR ATTACKS: 0", W),
      ].join("\n");
      frame++;
      return true;
    };
    draw();
    const timer = setInterval(() => {
      if (!draw()) clearInterval(timer);
    }, 480);
  }, { mustChoose: true });
}

const BURST = [
  "   \\   |   //   ",
  " *  \\  |  //  * ",
  "  -- *  *  * --  ",
  "==== *  @  * ====",
  "  -- *  *  * --  ",
  " *  //  |  \\  * ",
  "   //   |   \\   ",
];

/** Shake, burst, reveal. @param {any} boxDef @param {any} result @param {(id: string) => Promise<void>} onEquip */
export function openBoxSequence(boxDef, result, onEquip) {
  const W = 30;
  const done = showOverlay((inner, close) => {
    // Give the stage a real width up front: art is sized to its container,
    // and an empty overlay would start out tiny.
    inner.style.setProperty("width", "min(92vw, 420px)");
    const pre = el("pre", "art box-open");
    inner.append(pre);
    const art = centerBlock(boxDef.art, W);
    let frame = 0;
    const frames = reduced ? 1 : 16;
    const tick = () => {
      if (!pre.isConnected) return;
      if (frame < frames) {
        // Shake harder and harder, sparks leaking out of the seams.
        const amp = 1 + Math.floor((frame / frames) * 3);
        const off = frame % 2 ? amp : 0;
        const sparks = frame > frames / 2 ? " * ".repeat(Math.ceil(frame / 4)).slice(0, W) : "";
        pre.textContent = ["", center(boxDef.name, W), center(sparks, W), ...art.map((l) => " ".repeat(off) + l),
          center(sparks, W)].join("\n");
        pre.dataset.cols = String(W + 4);
        fitArt(pre, 16);
        if (frame % 4 === 0) sound.rattle();
        frame++;
        setTimeout(tick, 70);
        return;
      }
      shake("l");
      sound.loot();
      pre.textContent = ["", "", ...centerBlock(BURST, W), "", ""].join("\n");
      fitArt(pre, 16);
      setTimeout(() => {
        const found = result.kind === "item"
          ? state.content?.items.find((/** @type {any} */ i) => i.id === result.item_id) : null;
        const stashed = result.kind === "item" && !result.autosold && isAutoStash("items", found?.rarity);
        if (result.kind === "item" && !result.autosold && !stashed) {
          close();
          return;
        }
        const sold = result.kind === "item" && (result.autosold || stashed)
          ? state.content?.items.find((/** @type {any} */ i) => i.id === result.item_id) : null;
        // Paid in shards instead (daily chest limit #346, or attacks / crits already full #240):
        // the headline says what you actually got.
        const text = sold ? sold.name
          : result.capped || (result.overflow_shards && result.overflow_shards >= result.amount)
            ? `+${fmt(result.overflow_shards)} <>`
          : result.kind === "attacks" ? `+${result.amount} ATTACK${result.amount > 1 ? "S" : ""}`
            : result.kind === "next_crit" ? `NEXT ${result.amount} HIT${result.amount > 1 ? "S" : ""} WILL CRIT`
              : result.kind === "scroll" ? `${(result.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} SCROLL`
              : result.kind === "box" ? `A ${boxById(result.box_got)?.name ?? "CHEST"}!`
              : "BONUS";
        const sub = sold ? (result.autosold ? `AUTO-SOLD :: +${result.autosold} SHARDS` : "STASHED IN YOUR BAG")
          : result.capped ? "daily chest attack limit :: paid in shards"
          : result.overflow_shards
            ? `${result.overflow_shards >= result.amount ? "" : `${fmt(result.overflow_shards)} over the cap :: `}${
              result.kind === "next_crit" ? "crit charges full" : "attacks full"} :: paid in shards`
          : result.kind === "attacks" ? "added to today"
          : result.kind === "next_crit" ? "guaranteed critical strikes"
          : result.kind === "box" ? "a chest in the chest :: saved in your bag" : "saved in your bag";
        const style = sold ? RARITY_STYLE[sold.rarity] ?? RARITY_STYLE.common : RARITY_STYLE.rare;
        // An auto-sold / auto-stashed item still shows in its rarity's colour, with the rarity named.
        if (sold) pre.classList.add(`r-${sold.rarity}`);
        const rarity = sold ? `[ ${(rarityById(sold.rarity)?.label ?? sold.rarity).toUpperCase()} ]` : "";
        const lines = [...box(["", text, rarity, sub, ""], { width: W, style }), ""];
        revealLines(pre, lines, 60);
        fitArt(pre, 16);
        const actions = el("div", "actions");
        actions.append(button("[ NICE ]", close));
        inner.append(actions);
        actions.querySelector("button")?.focus({ preventScroll: true });
      }, reduced ? 0 : 380);
    };
    tick();
  });
  // Items get the full item reveal (with equip) right after the burst.
  return done.then(() => {
    const item = result.kind === "item" && result.item_id && !result.autosold
      ? state.content?.items.find((/** @type {any} */ i) => i.id === result.item_id) : null;
    if (item && !isAutoStash("items", item.rarity)) {
      return lootReveal(item, onEquip, `${boxDef.name} :: ITEM`);
    }
    return undefined;
  });
}

/** Animate one chest type bursting open, then show its complete ASCII ledger.
 * @param {any[]} results @param {any} boxDef */
export function openAllBoxesReveal(results, boxDef) {
  const W = 50;
  const itemOf = (/** @type {any} */ row) => state.content?.items.find((/** @type {any} */ entry) => entry.id === row.item_id);
  const rank = (/** @type {any} */ row) => (row.kind === "item" ? rarityById(itemOf(row)?.rarity)?.rank ?? 0 : Infinity);
  // Attacks / crits / scrolls first, then items, rarest first.
  const rows = summarizeBoxResults(results).map((row, i) => ({ row, i }))
    .sort((a, b) => rank(b.row) - rank(a.row) || a.i - b.i).map(({ row }) => row);
  /** Each item line's coloured part ("NAME [RARITY]") and its class. @type {([string, string] | null)[]} */
  const colored = [];
  const rewardLines = rows.map((row) => {
    colored.push(null);
    if (row.kind === "capped") return `+${fmt(row.overflow)} <>  (x${fmt(row.count)} past today's chest attack limit)`;
    const over = row.overflow ? `  (+${fmt(row.overflow)} <> OVER CAP)` : "";
    if (row.kind === "attacks") return `+${fmt(row.amount)} ATTACKS${over}`;
    if (row.kind === "next_crit") return `+${fmt(row.amount)} GUARANTEED CRITS${over}`;
    if (row.kind === "scroll") {
      return `x${fmt(row.count)} ${(row.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} SCROLL`;
    }
    if (row.kind === "box") return `x${fmt(row.amount)} ${boxById(row.box_got)?.name ?? "CHEST"} (A CHEST IN THE CHEST)`;
    const item = itemOf(row);
    const name = item?.name ?? row.item_id ?? "UNKNOWN ITEM";
    const rarity = item ? rarityById(item.rarity)?.label.toUpperCase() : "ITEM";
    colored[colored.length - 1] = [`${name} [${rarity}]`, `r-${item?.rarity ?? "common"}`];
    return row.autosold
      ? `x${fmt(row.count)} ${name} [${rarity}]  SOLD +${fmt(row.autosold)} <>`
      : `x${fmt(row.count)} ${name} [${rarity}]`;
  });
  /** Box the reward lines, then cut each item's name out of its boxed line so it can be coloured.
   * @type {(string | (string | [string, string])[])[]} */
  const rewardBox = box(rewardLines.length ? rewardLines : ["(nothing?)"], { width: W, align: "left", padX: 2 })
    .map((line, i) => {
      const c = colored[i - 1]; // line 0 is the top border
      const at = c ? line.indexOf(c[0]) : -1;
      return c && at >= 0 ? [line.slice(0, at), c, line.slice(at + c[0].length)] : line;
    });
  return showOverlay((inner, close) => {
    inner.classList.add("open-all-results");
    inner.style.setProperty("width", "min(96vw, 620px)");
    const pre = el("pre", "art chest-ledger");
    const ledger = [
      ...box(["C H E S T   H A U L", `${fmt(results.length)} CHESTS OPENED`], { width: W }),
      "",
      ...rewardBox,
    ];
    pre.dataset.cols = String(W);
    const actions = el("div", "actions");
    inner.append(pre, actions);
    const chest = [" .------. ", "/______/|", "|  []  |/", "'------' "];
    const frames = [
      ["  .------.                    .------.  ", " /______/|    .------.       /______/| ", " |  []  |/   /______/|       |  []  |/ ", " '------'    |  []  |/       '------'  ", "             '------'                   "],
      ["       .------.          .------.       ", "      /______/| .------. /______/|      ", "      |  []  |//______/||  []  |/      ", "      '------' |  []  |/'------'       ", "               '------'                 "],
      ["            *  .------.  *              ", "          *   /______/|   *             ", "        < < < |  []  |/ > > >           ", "          *   '------'   *               ", "            *    *    *                  "],
      ["          \\  *  |  *  //               ", "        *  \\   |   //  *                ", "      -----  *  @  *  -----              ", "        *  //   |   \\  *                ", "          //  * | *  \\                  "],
    ];
    let frame = 0;
    const draw = () => {
      if (!pre.isConnected) return;
      if (frame < frames.length) {
        const scene = reduced && frame === 0 ? frames.at(-1) : frames[frame];
        pre.textContent = [center(`${boxDef?.name ?? "LOOT CHEST"} x${fmt(results.length)}`, W), "",
          ...(scene ?? chest).map((line) => center(line, W))].join("\n");
        fitArt(pre, 15);
        frame = reduced ? frames.length : frame + 1;
        setTimeout(draw, reduced ? 80 : 310);
        return;
      }
      shake("l");
      revealLines(pre, ledger, reduced ? 0 : 35);
      fitArt(pre, 15);
      actions.append(button("[ COLLECT ALL ]", close));
      actions.querySelector("button")?.focus({ preventScroll: true });
    };
    draw();
  }, { mustChoose: true });
}
