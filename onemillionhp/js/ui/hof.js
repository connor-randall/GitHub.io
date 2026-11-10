// HALL OF FAME (server/omhp/hof.py): the admin posts a boss's card in CHAT
// (chat.js hofLine), and every card ever posted lives in LEADERBOARD >
// [ HALL OF FAME ], newest boss first. A card: the boss's first phase shrunk
// onto a tiny pedestal, how long it lasted, fighters and hits, and everyone who
// healed it.

import * as api from "../api.js?v=b6664395f3";
import { duration, el, fmt } from "../ascii.js?v=b6664395f3";
import { withBadges } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** A tiny pedestal ``cols`` wide with the boss's number on its plaque. @param {number} cols @param {number} seq */
function pedestal(cols, seq) {
  const w = Math.max(14, cols);
  const plaque = ` HOF #${seq} `;
  const side = Math.max(0, w - 2 - plaque.length);
  return [
    ` ${"_".repeat(w - 2)} `,
    `|${"=".repeat(Math.floor(side / 2))}${plaque}${"=".repeat(Math.ceil(side / 2))}|`,
    `|${"_".repeat(w - 2)}|`,
    `/${"_".repeat(w)}\\`,
  ].map((l, i) => (i === 3 ? l : ` ${l} `)).join("\n");
}

/** One boss's card. @param {any} d  the card's data (hof.card on the server) */
export function hofCard(d) {
  const card = el("div", "hof-card");
  if (d.tint) card.style.setProperty("--hof-tint", d.tint);
  card.append(el("div", "hof-title", "*** HALL OF FAME ***"), el("div", "hof-name", `#${d.seq} ${d.name}`));
  if (d.subtitle) card.append(el("div", "hof-sub", `"${d.subtitle}"`));
  if (d.creator) card.append(el("div", "hof-sub", `designed by ${d.creator}`));
  // The first phase, shrunk, standing on its pedestal.
  const art = /** @type {string[]} */ (d.art ?? []);
  const cols = Math.max(0, ...art.map((l) => l.length));
  const ARTPX = 5;
  const PEDPX = 9;
  const stand = el("div", "hof-stand");
  const pic = el("pre", "hof-art", art.join("\n"));
  pic.style.fontSize = `${ARTPX}px`;
  const base = el("pre", "hof-pedestal", pedestal(Math.round((cols * ARTPX) / PEDPX), d.seq));
  base.style.fontSize = `${PEDPX}px`;
  stand.append(pic, base);
  card.append(stand);
  const lasted = duration(d.seconds);
  card.append(el("div", "hof-stat", d.alive ? `STILL STANDING AFTER ${lasted} (${fmt(d.hp)} HP LEFT)` : `LASTED ${lasted}`));
  card.append(el("div", "hof-stat", `${fmt(d.fighters)} FIGHTERS :: ${fmt(d.hits)} HITS`));
  if (d.killer) card.append(el("div", "hof-stat", `FINAL BLOW: ${d.killer}`));
  if (d.damage > d.max_hp) {
    card.append(el("div", "hof-stat", `TOOK ${fmt(d.damage)} DAMAGE ON A ${fmt(d.max_hp)} HP BAR`));
  }
  // Ticket #228: what that fight was like (THE FOLD's chest rain), set by the admin.
  const stats = /** @type {string[]} */ (d.stats ?? []);
  if (stats.length) card.append(el("div", "hof-heal-title", "THE FIGHT"), ...stats.map((line) => el("div", "hof-stat", line)));
  const hs = /** @type {any[]} */ (d.healers ?? []);
  if (hs.length) {
    const total = hs.length + (d.more_healers ?? 0);
    card.append(el("div", "hof-heal-title",
      `KEPT ALIVE BY ${total} HEALER${total === 1 ? "" : "S"} (${fmt(d.heals)} HEALS)`));
    const row = (/** @type {any} */ h, /** @type {number} */ i) => {
      const li = el("li");
      li.append(el("span", "hof-heal-rank", `${i + 1}. `), withBadges(h.badges, null, el("span", "who", h.name)),
        el("span", "hof-heal-n", ` x${h.n}`));
      return li;
    };
    // The top three always show; everyone is in the drop-down.
    const top = el("ol", "hof-healers");
    top.append(...hs.slice(0, 3).map(row));
    card.append(top);
    if (hs.length > 3) {
      const drop = /** @type {HTMLDetailsElement} */ (el("details", "hof-drop hof-drop-heals"));
      drop.append(el("summary", "", `[ ALL ${total} HEALERS ]`));
      const all = el("ol", "hof-healers");
      all.append(...hs.map(row));
      if (d.more_healers) all.append(el("li", "dim", `...and ${d.more_healers} more`));
      drop.append(all);
      card.append(drop);
    }
  } else {
    card.append(el("div", "hof-heal-title", "NOBODY HEALED IT. IT DID THIS ALONE."));
  }
  // Everyone who hit it, A to Z, no ranks or counts, in its own drop-down.
  const hitters = /** @type {any[]} */ (d.hitters ?? []);
  if (hitters.length) {
    const drop = /** @type {HTMLDetailsElement} */ (el("details", "hof-drop hof-drop-hits"));
    drop.append(el("summary", "", `[ ALL ${fmt(hitters.length)} WHO HIT IT ]`));
    const all = el("div", "hof-hitters");
    all.append(...hitters.map((h) => {
      const one = el("span", "hof-hitter");
      one.append(withBadges(h.badges, null, el("span", "who", h.name)));
      return one;
    }));
    drop.append(all);
    card.append(drop);
  }
  if (d.note) card.append(el("div", "hof-note", d.note));
  return card;
}

/** @type {any[] | null} */
let last = null;
let loadedAt = 0;

/** LEADERBOARD > [ HALL OF FAME ]: fetch (at most every 30 s) and draw. */
export async function loadHof() {
  const host = $("panel-hof");
  if (last) render(last);
  else host.replaceChildren(el("div", "dim", "> loading..."));
  if (last && Date.now() - loadedAt < 30000) return;
  try {
    last = (await api.getHof()).entries;
    loadedAt = Date.now();
    render(/** @type {any[]} */ (last));
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** @param {any[]} entries */
function render(entries) {
  const host = $("panel-hof");
  const head = el("div", "panel-h", "HALL OF FAME");
  if (!entries.length) {
    host.replaceChildren(head, el("div", "dim", "> nobody's up here yet. some bosses earn a place; when one does, it stands here."));
    return;
  }
  const list = el("div", "hof-list");
  list.append(...entries.map(hofCard));
  host.replaceChildren(head, list);
}
