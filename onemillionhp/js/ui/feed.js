// Global activity feed.

import { RARITY_STYLE, ago, el, fmt } from "../ascii.js?v=3c47ca09f7";
import * as api from "../api.js?v=3c47ca09f7";
import { addOlderFeed, boxById, itemById, now, rarityById, state } from "../store.js?v=3c47ca09f7";

const list = /** @type {HTMLOListElement} */ (document.getElementById("feed"));

/** Build the message spans for one event. @param {any} e @returns {Node[]} */
function message(e) {
  const who = () => el("span", "who", e.name ?? "?");
  const num = (/** @type {number} */ n) => el("span", "num", fmt(n));
  const txt = (/** @type {string} */ s) => document.createTextNode(s);
  switch (e.kind) {
    case "hit":
      return [txt("> "), who(), txt(" hit "), txt(state.boss?.name ?? "the boss"), txt(" for "), num(e.damage),
        ...procTags(e)];
    case "crit":
      return [txt("> "), who(), txt(" landed a CRITICAL for "), num(e.damage), txt(" !!"), ...procTags(e)];
    case "box": {
      const b = boxById(e.box_id);
      return [txt("> "), who(), txt(" found a "), el("span", "box-tag", `[${b?.name ?? e.box_id}]`)];
    }
    case "unbox": {
      const b = boxById(e.box_id);
      const bits = [txt("> "), who(), txt(" opened "), el("span", "box-tag", `[${b?.name ?? e.box_id}]`), txt(" -> ")];
      if (e.reward === "item" && e.item_id) {
        const item = itemById(e.item_id);
        const r = rarityById(e.rarity);
        const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
        bits.push(el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`));
      } else if (e.reward === "attacks") bits.push(txt(`+${e.amount} ATTACK${e.amount > 1 ? "S" : ""}`));
      else if (e.reward === "next_crit") bits.push(txt(`${e.amount} CRIT CHARGE${e.amount > 1 ? "S" : ""}`));
      else bits.push(txt("ULTIMATE RECHARGED"));
      return bits;
    }
    case "ultimate":
      return [txt("> "), who(), txt(" used ULTIMATE for "), num(e.damage)];
    case "loot": {
      const item = itemById(e.item_id);
      const r = rarityById(e.rarity);
      const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
      const tag = el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`);
      return [txt("> "), who(), txt(" found "), tag];
    }
    case "sell": {
      const item = itemById(e.item_id);
      const r = rarityById(e.rarity);
      const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
      const tag = el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`);
      return [txt("> "), who(), txt(" sold "), ...(e.count > 1 ? [txt(`${e.count} x `)] : []), tag,
        txt(" for "), el("span", "shard-tag", `<> ${e.shards}`)];
    }
    case "sellall":
      return [txt("> "), who(), txt(` sold ${e.count} duplicate${e.count > 1 ? "s" : ""} for `),
        el("span", "shard-tag", `<> ${e.shards}`)];
    case "buy":
      return [txt("> "), who(), txt(" bought "), el("span", "box-tag", boxById(e.box_id)?.name ?? e.box_id),
        txt(" for "), el("span", "shard-tag", `<> ${e.shards}`)];
    case "phase":
      return [txt(`>>> ${e.boss} ENTERS ${e.label} <<<`)];
    case "defeat":
      return [txt("### "), who(), txt(` DEALT THE KILLING BLOW TO ${e.boss} ###`)];
    case "admin":
      return [el("span", "admin-tag", "***ADMIN***"), txt(" "), el("span", "admin-text", e.text ?? "")];
    case "spawn":
      return [txt(`>>> BOSS #${String(e.number).padStart(3, "0")} ${e.boss} HAS APPEARED <<<`)];
    default: // something newer than this page knows how to show
      return e.name ? [txt("> "), who(), txt(` ${e.kind}`)] : [txt(`> ${e.kind}`)];
  }
}

/** Short tags for item effects that fired on a hit. @param {any} e */
function procTags(e) {
  const tags = [e.double && "x2", e.saved && "FREE", e.refund && "ULT+"].filter(Boolean);
  return tags.length ? [el("span", "proc-tag", ` [${tags.join(" ")}]`)] : [];
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

// ------------------------------------------------------------ scrolling feed
// Newest at the top; scroll down for history. Older pages load on demand.

let reachedStart = false;
let loadingOlder = false;
const footer = el("li", "feed-end dim", "");

function paintFooter() {
  footer.textContent = reachedStart ? "--- start of the fight ---" : loadingOlder ? "loading older..." : "--- scroll for older ---";
}

/** Render every loaded event, newest first. */
export function renderFeed() {
  const events = [...state.feed].reverse();
  if (!events.length) {
    list.replaceChildren(el("li", "dim", "> silence. be the first to strike."));
    return;
  }
  paintFooter();
  list.replaceChildren(...events.map((e) => row(e, false)), footer);
  fillIfShort();
}

/** New events arrived: slide them in at the top without redrawing the rest.
 * If you've scrolled down to read history, the list doesn't move under you.
 * @param {any[]} fresh */
export function addFreshEvents(fresh) {
  if (!fresh.length) return;
  if (!list.contains(footer)) {
    renderFeed(); // was the empty placeholder
    return;
  }
  const top = list.scrollTop;
  const before = list.scrollHeight;
  const rows = [...fresh].sort((a, b) => b.t - a.t || b.id - a.id).map((e) => row(e, true));
  list.prepend(...rows);
  if (top > 0) list.scrollTop = top + (list.scrollHeight - before);
}

/** Start over (e.g. after an admin reset). */
export function resetFeedHistory() {
  reachedStart = false;
  renderFeed();
}

async function loadOlder() {
  if (loadingOlder || reachedStart || !state.feed.length) return;
  const oldest = state.feed[0];
  loadingOlder = true;
  paintFooter();
  try {
    const { events } = await api.getOlderFeed(oldest.t, oldest.id);
    if (events.length < 100) reachedStart = true;
    const added = addOlderFeed(events);
    const rows = [...added].sort((a, b) => b.t - a.t || b.id - a.id).map((e) => row(e, false));
    for (const r of rows) list.insertBefore(r, footer);
  } catch {
    /* try again on the next scroll */
  } finally {
    loadingOlder = false;
    paintFooter();
  }
  fillIfShort();
}

/** Keep loading until the box can actually scroll (or history runs out). */
function fillIfShort() {
  if (!reachedStart && list.scrollHeight <= list.clientHeight + 40) loadOlder();
}

list.addEventListener("scroll", () => {
  if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) loadOlder();
}, { passive: true });

export function tickAges() {
  list.querySelectorAll(".t").forEach((n) => {
    const t = Number(/** @type {HTMLElement} */ (n).dataset.t);
    if (t) n.textContent = ago(now() - t);
  });
}
