// Effects: shake, damage popups, crit banner, ultimate sequence, loot reveal,
// item cards and the modal overlay they all share.

import { RARITY_STYLE, bigText, box, center, centerBlock, dedent, el, fitArt, fmt, widthOf } from "../ascii.js?v=c30f4a427c";
import { isAutoStash, setAutoStash } from "../autostash.js?v=c30f4a427c";
import { summarizeBoxResults } from "../box-results.js?v=c30f4a427c";
import { rarityById, state } from "../store.js?v=c30f4a427c";
import { EFFECT_HELP, effectLine, effectParts } from "./effects.js?v=c30f4a427c";

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

/** Floating damage number (or effect callout) over the boss.
 * @param {string} text @param {"mine"|"crit"|"small"|"proc"} kind */
export function popup(text, kind) {
  const host = document.getElementById("popups");
  if (!host) return;
  const p = el("div", "pop" + (kind === "mine" ? "" : " " + kind), text);
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
  const tag = o.unknown
    ? ""
    : [item.slot === "charm" ? "CHARM" : "WEAPON", o.equipped ? "EQUIPPED" : "", o.count && o.count > 1 ? `x${o.count}` : ""]
        .filter(Boolean)
        .join("  ");
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
  critTimer = setTimeout(() => {
    layer.classList.add("leaving");
    critTimer = setTimeout(() => (layer.hidden = true), 300);
  }, CRIT_SHOW_MS);
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

/**
 * @param {any} item
 * @param {(id: string) => Promise<void>} onEquip
 */
export function lootReveal(item, onEquip, title = "ITEM FOUND") {
  const rank = rarityById(item.rarity)?.rank ?? 0;
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const header = box([title], { width: 28, style });
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
      const step = rank >= 3 ? 70 : 40;
      revealLines(pre, lines, step);
      fitArt(pre, 16);
      if (rank >= 4) shake("l");
      const flavor = el("div", "flavor dim", `"${item.flavor}"`);
      // What the item actually does, plus a plain-English line per effect.
      const stats = el("div", "item-detail stats loot-stats");
      stats.append(effectLine(item));
      for (const [k, v] of Object.entries(EFFECT_HELP)) {
        if (effectParts(item.mods).some((p) => p.includes(k))) stats.append(el("div", "dim", `${k}: ${v}`));
      }
      stats.append(el("div", "dim", item.slot === "charm" ? "CHARM SLOT" : "WEAPON SLOT"));
      const actions = el("div", "actions");
      const choices = [
        button(`[ EQUIP ${item.slot === "charm" ? "CHARM" : "WEAPON"} ]`, async () => {
          await onEquip(item.id);
          close();
        }),
        button("[ STASH ]", close),
        button("[ AUTO STASH? ]", () => {
          setAutoStash(true); // this one is stashed too; the next ones skip this pop-up
          close();
        }),
      ];
      // Neither choice works until the item has finished drawing (plus a
      // beat), so clicks and keys still flying from spamming ATTACK can't
      // pick one before the item is seen.
      for (const b of choices) b.disabled = true;
      setTimeout(() => choices.forEach((b) => (b.disabled = false)), lines.length * step + CHOICE_DELAY_MS);
      actions.append(choices[0], choices[1]);
      const auto = el("div", "actions auto-stash-row");
      choices[2].title = "Found items go straight to your bag. Turn it off in [ BAG ].";
      auto.append(choices[2]);
      inner.append(flavor, stats, actions, auto);
      // Focus the card, not a button, so a held Space/Enter doesn't choose for them.
      inner.tabIndex = -1;
      inner.focus({ preventScroll: true });
    }, suspense);
  }, { mustChoose: true });
}

const CHOICE_DELAY_MS = 400;

// ------------------------------------------------------------- loot boxes

/** A loot box reveal (dropped from an attack, or a gift).
 * @param {any} boxDef @param {() => void} onOpen @param {string} [title] */
export function boxDropReveal(boxDef, onOpen, title = "LOOT BOX FOUND") {
  const W = Math.max(30, title.length + 6);
  return showOverlay(
    (inner, close) => {
      inner.style.setProperty("width", "min(92vw, 420px)");
      const pre = el("pre", "art box-drop");
      const lines = [...box([title], { width: W }), "", ...centerBlock(boxDef.art, W), "",
        center(boxDef.name, W)];
      inner.append(pre);
      revealLines(pre, lines, 45);
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
      actions.querySelector("button")?.focus({ preventScroll: true });
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
 * @param {number} amount @param {string} [title] */
export function shardsReveal(amount, title = "A GIFT FROM ***ADMIN***") {
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
      const note = el("div", "flavor dim", `"+${fmt(amount)} <> to spend in [ SHOP ]"`);
      const actions = el("div", "actions");
      actions.append(button("[ NICE ]", close));
      inner.append(note, actions);
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
        frame++;
        setTimeout(tick, 70);
        return;
      }
      shake("l");
      pre.textContent = ["", "", ...centerBlock(BURST, W), "", ""].join("\n");
      fitArt(pre, 16);
      setTimeout(() => {
        const stashed = result.kind === "item" && !result.autosold && isAutoStash();
        if (result.kind === "item" && !result.autosold && !stashed) {
          close();
          return;
        }
        const sold = result.kind === "item" && (result.autosold || stashed)
          ? state.content?.items.find((/** @type {any} */ i) => i.id === result.item_id) : null;
        const text = sold ? sold.name
          : result.kind === "attacks" ? `+${result.amount} ATTACK${result.amount > 1 ? "S" : ""}`
            : result.kind === "next_crit" ? `NEXT ${result.amount} HIT${result.amount > 1 ? "S" : ""} WILL CRIT`
              : result.kind === "scroll" ? `${(result.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} SCROLL`
              : "BONUS";
        const sub = sold ? (result.autosold ? `AUTO-SOLD :: +${result.autosold} SHARDS` : "STASHED IN YOUR BAG")
          : result.kind === "attacks" ? "added to today"
          : result.kind === "next_crit" ? "guaranteed critical strikes" : "saved in your bag";
        const style = sold ? RARITY_STYLE[sold.rarity] ?? RARITY_STYLE.common : RARITY_STYLE.rare;
        const lines = [...box(["", text, "", sub, ""], { width: W, style }), ""];
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
    if (result.kind === "item" && result.item_id && !result.autosold && !isAutoStash()) {
      const item = state.content?.items.find((/** @type {any} */ i) => i.id === result.item_id);
      if (item) return lootReveal(item, onEquip, `${boxDef.name} :: ITEM`);
    }
    return undefined;
  });
}

/** Animate one chest type bursting open, then show its complete ASCII ledger.
 * @param {any[]} results @param {any} boxDef */
export function openAllBoxesReveal(results, boxDef) {
  const W = 50;
  const rewardLines = summarizeBoxResults(results).map((row) => {
    if (row.kind === "attacks") return `+${fmt(row.amount)} ATTACKS`;
    if (row.kind === "next_crit") return `+${fmt(row.amount)} GUARANTEED CRITS`;
    if (row.kind === "scroll") {
      return `x${fmt(row.count)} ${(row.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} SCROLL`;
    }
    const item = state.content?.items.find((/** @type {any} */ entry) => entry.id === row.item_id);
    const name = item?.name ?? row.item_id ?? "UNKNOWN ITEM";
    const rarity = item ? rarityById(item.rarity)?.label.toUpperCase() : "ITEM";
    return row.autosold
      ? `x${fmt(row.count)} ${name} [${rarity}]  SOLD +${fmt(row.autosold)} <>`
      : `x${fmt(row.count)} ${name} [${rarity}]`;
  });
  return showOverlay((inner, close) => {
    inner.classList.add("open-all-results");
    inner.style.setProperty("width", "min(96vw, 620px)");
    const pre = el("pre", "art chest-ledger");
    const ledger = [
      ...box(["C H E S T   H A U L", `${fmt(results.length)} CHESTS OPENED`], { width: W }),
      "",
      ...box(rewardLines.length ? rewardLines : ["(nothing?)"], { width: W, align: "left", padX: 2 }),
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
