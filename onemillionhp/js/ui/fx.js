// Effects: shake, damage popups, crit banner, ultimate sequence, loot reveal,
// item cards and the modal overlay they all share.

import { RARITY_STYLE, bigText, box, center, centerBlock, dedent, el, fitArt, fmt, widthOf } from "../ascii.js";
import { rarityById, state } from "../store.js";

const overlay = /** @type {HTMLElement} */ (document.getElementById("overlay"));
const shakeEl = /** @type {HTMLElement} */ (document.getElementById("shake"));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @param {"s"|"l"} size */
export function shake(size) {
  if (reduced) return;
  shakeEl.classList.remove("shake-s", "shake-l");
  void shakeEl.offsetWidth; // restart the animation
  shakeEl.classList.add(size === "l" ? "shake-l" : "shake-s");
}

/** Floating damage number over the boss.
 * @param {string} text @param {"mine"|"crit"|"small"} kind */
export function popup(text, kind) {
  const host = document.getElementById("popups");
  if (!host) return;
  const p = el("div", "pop" + (kind === "crit" ? " crit" : kind === "small" ? " small" : ""), text);
  const spread = kind === "small" ? 140 : 60;
  p.style.setProperty("margin-left", `${Math.round((Math.random() - 0.5) * spread)}px`);
  p.style.setProperty("top", `${30 + Math.round(Math.random() * 25)}%`);
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

/**
 * Show content in the overlay until closed. Overlays queue, so a crit
 * banner followed by a loot drop play one after the other.
 * @param {(inner: HTMLElement, close: () => void) => void} build
 * @param {{autoCloseMs?: number, dismissable?: boolean}} [opts]
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
      closeCurrent = close;
      build(inner, close);
      if (opts.dismissable !== false) {
        overlay.onclick = (e) => {
          if (e.target === overlay) close();
        };
      }
      if (opts.autoCloseMs) timer = setTimeout(close, opts.autoCloseMs);
      const focusable = /** @type {HTMLElement | null} */ (inner.querySelector("button"));
      focusable?.focus({ preventScroll: true });
      inner.querySelectorAll("pre.art").forEach((p) => fitArt(/** @type {HTMLElement} */ (p), 16));
    });
  queue = queue.then(run, run);
  return queue;
}

export function closeOverlay() {
  closeCurrent?.();
}

/** Reveal a <pre> line by line (JS timers, not CSS delays: deterministic
 * and each line ends up plainly visible). @param {HTMLElement} pre @param {string[]} lines @param {number} stepMs */
function revealLines(pre, lines, stepMs) {
  const spans = lines.map((l) => el("span", stepMs ? "pending" : "", l || " "));
  pre.classList.add("reveal");
  pre.replaceChildren(...spans);
  pre.dataset.cols = String(widthOf(lines));
  spans.forEach((sp, i) => setTimeout(() => sp.classList.remove("pending"), i * stepMs));
}

/** @param {string} label @param {() => void} fn */
function button(label, fn) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "", label));
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

// ---------------------------------------------------------------- item card

/**
 * The canonical ASCII rendering of an item: art, name and rarity inside a
 * border drawn in that rarity's characters.
 * @param {any} item @param {{unknown?: boolean, count?: number, equipped?: boolean, width?: number}} [o]
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
  const tag = [o.equipped ? "EQUIPPED" : "", o.count && o.count > 1 ? `x${o.count}` : ""].filter(Boolean).join("  ");
  // Lines are pre-centred to the box's inner width, so box() must not re-centre them.
  return box([...centerBlock(art, inner - 2), " ", center(name, inner - 2), center(label, inner - 2), center(tag, inner - 2)], {
    width: inner + 2,
    align: "left",
    style: o.unknown ? RARITY_STYLE.common : style,
  });
}

// ------------------------------------------------------------ crit banner

/** @param {number} damage */
export function critBanner(damage) {
  const w = 28;
  const lines = [
    "!".repeat(w),
    "!!" + center("CRITICAL STRIKE", w - 4) + "!!",
    "!!" + " ".repeat(w - 4) + "!!",
    ...centerBlock(bigText(fmt(damage)), w - 4).map((l) => "!!" + l.padEnd(w - 4) + "!!"),
    "!!" + " ".repeat(w - 4) + "!!",
    "!!" + center(`${fmt(damage)} DAMAGE`, w - 4) + "!!",
    "!".repeat(w),
  ];
  shake("l");
  return showOverlay(
    (inner) => {
      const pre = el("pre", "art crit-banner");
      revealLines(pre, lines, 35);
      inner.append(pre);
    },
    { autoCloseMs: 2200 },
  );
}

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

/**
 * @param {any} item
 * @param {(id: string) => Promise<void>} onEquip
 */
export function lootReveal(item, onEquip) {
  const rank = rarityById(item.rarity)?.rank ?? 0;
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const header = box(["ITEM FOUND"], { width: 28, style });
  return showOverlay((inner, close) => {
    const pre = el("pre", `art r-${item.rarity}`);
    inner.append(pre);
    const suspense = rank >= 3 ? 900 : rank >= 2 ? 450 : 0; // epic+ gets a drumroll
    if (suspense) {
      revealLines(pre, [...header, "", center(". . .", 28)], 0);
      shake("s");
    }
    setTimeout(() => {
      const lines = [...header, ...itemLines(item, { width: 26 })];
      revealLines(pre, lines, rank >= 3 ? 70 : 40);
      fitArt(pre, 16);
      if (rank >= 4) shake("l");
      const flavor = el("div", "flavor dim", `"${item.flavor}"`);
      const actions = el("div", "actions");
      actions.append(
        button("[ EQUIP ]", async () => {
          await onEquip(item.id);
          close();
        }),
        button("[ STASH ]", close),
      );
      inner.append(flavor, actions);
      actions.querySelector("button")?.focus({ preventScroll: true });
    }, suspense);
  });
}
