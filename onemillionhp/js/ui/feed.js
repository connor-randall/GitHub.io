// Global activity feed.

import { RARITY_STYLE, ago, el, fmt } from "../ascii.js?v=0267a0c4ee";
import { itemById, now, rarityById, state } from "../store.js?v=0267a0c4ee";

const list = /** @type {HTMLOListElement} */ (document.getElementById("feed"));
const SHOW = 40;

/** Build the message spans for one event. @param {any} e @returns {Node[]} */
function message(e) {
  const who = () => el("span", "who", e.name ?? "?");
  const num = (/** @type {number} */ n) => el("span", "num", fmt(n));
  const txt = (/** @type {string} */ s) => document.createTextNode(s);
  switch (e.kind) {
    case "hit":
      return [txt("> "), who(), txt(" hit "), txt(state.boss?.name ?? "the boss"), txt(" for "), num(e.damage)];
    case "crit":
      return [txt("> "), who(), txt(" landed a CRITICAL for "), num(e.damage), txt(" !!")];
    case "ultimate":
      return [txt("> "), who(), txt(" used ULTIMATE for "), num(e.damage)];
    case "loot": {
      const item = itemById(e.item_id);
      const r = rarityById(e.rarity);
      const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
      const tag = el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`);
      return [txt("> "), who(), txt(" found "), tag];
    }
    case "phase":
      return [txt(`>>> ${e.boss} ENTERS ${e.label} <<<`)];
    case "defeat":
      return [txt("### "), who(), txt(` DEALT THE KILLING BLOW TO ${e.boss} ###`)];
    case "spawn":
      return [txt(`>>> BOSS #${String(e.number).padStart(3, "0")} ${e.boss} HAS APPEARED <<<`)];
    default:
      return [txt(`> ${e.kind}`)];
  }
}

/** @param {any} e @param {boolean} fresh */
function row(e, fresh) {
  const li = el("li", `k-${e.kind}`);
  if (e.player_id && e.player_id === state.me?.id) li.classList.add("me");
  if (fresh) li.classList.add("new");
  const t = el("span", "t", ago(now() - e.t));
  t.dataset.t = String(e.t);
  const m = el("span", "m");
  m.append(...message(e));
  li.append(t, m);
  return li;
}

/** Render the whole feed (newest first). @param {Set<number>} [freshIds] */
export function renderFeed(freshIds) {
  const events = state.feed.slice(-SHOW).reverse();
  if (!events.length) {
    list.replaceChildren(el("li", "dim", "> silence. be the first to strike."));
    return;
  }
  list.replaceChildren(...events.map((e) => row(e, Boolean(freshIds?.has(e.id)))));
}

export function tickAges() {
  list.querySelectorAll(".t").forEach((n) => {
    const t = Number(/** @type {HTMLElement} */ (n).dataset.t);
    if (t) n.textContent = ago(now() - t);
  });
}
