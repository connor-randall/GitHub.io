// What's in a loot box: hover (or tap) a box's picture in [ SHOP ] or
// [ BAG ] for an ASCII box listing everything it can give and the chance of
// each, rarities in their item colours. Numbers come from the server (the
// admin's odds included).

import { RARITY_STYLE, el } from "../ascii.js?v=c30f4a427c";
import { rarityById, state } from "../store.js?v=c30f4a427c";

/** @type {HTMLElement | null} */
let tip = null;
/** @type {HTMLElement | null} */
let tipFor = null;
let pointerAt = 0; // a tap focuses the picture and then clicks it: let the click decide

/** 48% / 9.6% / 0.12% / 0.012% @param {number} p 0..1 */
function pct(p) {
  const v = p * 100;
  if (v >= 1) return `${v.toFixed(1)}%`;
  if (v >= 0.1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(3)}%`;
}

/** Name of a non-item reward. @param {any} r */
function rewardName(r) {
  if (r.kind === "attacks") return `+${r.amount} ATTACK${r.amount === 1 ? "" : "S"}`;
  if (r.kind === "next_crit") return `${r.amount} CRIT CHARGE${r.amount === 1 ? "" : "S"}`;
  if (r.kind === "ultimate") return "ULTIMATE RECHARGE";
  return r.kind.toUpperCase();
}

/** The ASCII odds box for one loot box definition. @param {any} def */
function oddsBox(def) {
  const odds = def.odds ?? [];
  const items = odds.filter((/** @type {any} */ r) => r.kind === "item");
  const other = odds.filter((/** @type {any} */ r) => r.kind !== "item");
  /** @type {{label: string, chance: string, cls?: string, head?: boolean}[]} */
  const rows = [];
  if (items.length) {
    rows.push({ label: "AN ITEM", chance: pct(items.reduce((n, /** @type {any} */ r) => n + r.chance, 0)), head: true });
    for (const r of items) {
      const st = RARITY_STYLE[/** @type {keyof typeof RARITY_STYLE} */ (r.rarity)] ?? RARITY_STYLE.common;
      const label = rarityById(r.rarity)?.label ?? r.rarity.toUpperCase();
      rows.push({ label: `  ${st.deco[0]}${label}${st.deco[1]}`, chance: pct(r.chance), cls: `r-${r.rarity}` });
    }
  }
  for (const r of other) rows.push({ label: rewardName(r), chance: pct(r.chance), head: true });

  const title = `${def.name} :: WHAT'S INSIDE`;
  const w = Math.max(title.length, ...rows.map((r) => r.label.length + r.chance.length + 4));
  const pre = el("pre", "badge-tip-box box-odds-box");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.append(edge);
  const line = (/** @type {(Node | string)[]} */ ...nodes) => {
    const span = el("span");
    span.append("| ", ...nodes, " |\n");
    pre.append(span);
  };
  line(el("span", "tip-title", title.padEnd(w)));
  line(" ".repeat(w));
  for (const r of rows) {
    const dots = " " + ".".repeat(Math.max(1, w - r.label.length - r.chance.length - 2)) + " ";
    line(el("span", r.cls ?? (r.head ? "" : "dim"), r.label), el("span", "dim", dots), el("span", "box-odds-pct", r.chance));
  }
  line(" ".repeat(w));
  line(el("span", "dim", "(one reward per box)".padEnd(w)));
  pre.append(edge.trimEnd());
  return pre;
}

/** @param {HTMLElement} art */
function show(art) {
  const def = state.content?.boxes?.find((/** @type {any} */ b) => b.id === art.dataset.boxOdds);
  if (!def?.odds?.length) return;
  tipFor = art;
  tip ??= document.body.appendChild(el("div", "badge-tip box-odds-tip"));
  tip.setAttribute("role", "tooltip");
  tip.replaceChildren(oddsBox(def));
  tip.hidden = false;
  // Beside or below the picture, kept on screen.
  const r = art.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - box.width - 8));
  const below = r.bottom + 6;
  const top = below + box.height > window.innerHeight - 8 ? Math.max(8, r.top - box.height - 6) : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hide() {
  tipFor = null;
  if (tip) tip.hidden = true;
}

/** Make a box picture show its odds. @param {HTMLElement} art @param {string} boxId */
export function withOdds(art, boxId) {
  art.dataset.boxOdds = boxId;
  art.tabIndex = 0;
  art.setAttribute("role", "button");
  art.setAttribute("aria-label", "what's inside and the chances");
  art.classList.add("has-odds");
  return art;
}

/** Hover, taps and keyboard focus on any box picture. */
export function initBoxOdds() {
  const artOf = (/** @type {EventTarget | null} */ t) =>
    t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest("[data-box-odds]")) : null;
  document.addEventListener("pointerdown", () => (pointerAt = Date.now()), { capture: true });
  document.addEventListener("pointerover", (e) => {
    const art = artOf(e.target);
    if (art && e.pointerType === "mouse" && art !== tipFor) show(art);
  });
  document.addEventListener("pointerout", (e) => {
    const art = artOf(e.target);
    if (art && e.pointerType === "mouse" && !art.contains(/** @type {Node | null} */ (e.relatedTarget))) hide();
  });
  document.addEventListener("click", (e) => {
    const art = artOf(e.target);
    if (art) {
      if (tipFor === art) hide();
      else show(art);
    } else if (tipFor) hide();
  });
  document.addEventListener("focusin", (e) => {
    const art = artOf(e.target);
    if (art && Date.now() - pointerAt > 500) show(art);
  });
  document.addEventListener("focusout", (e) => {
    if (artOf(e.target) && Date.now() - pointerAt > 500) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
}
