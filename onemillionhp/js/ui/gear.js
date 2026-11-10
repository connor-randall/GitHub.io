// Worn equipment drawn on a body: your own in the YOU tab, and anyone's in the
// card that opens when you click a name in CHAT or in the ONLINE list (not the
// attack feed).

import * as api from "../api.js?v=b6664395f3";
import { el, setArt } from "../ascii.js?v=b6664395f3";
import { itemById, refinedCopy, state } from "../store.js?v=b6664395f3";
import { badgeTag, nameStar } from "./badges.js?v=b6664395f3";
import { auctionable, findOnAuction } from "./auction.js?v=b6664395f3";
import { refineBox } from "./blacksmith.js?v=b6664395f3";
import { EQUIP_SLOTS, effectLine, totalLine } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { itemLines, showOverlay } from "./fx.js?v=b6664395f3";
import { canReport, reportButton } from "./report.js?v=b6664395f3";
import { isMuted, setMuted } from "../mute.js?v=b6664395f3";
import { tabOpen } from "./tutorial.js?v=b6664395f3";

// A slot box by each part of the body it goes on.
const FIGURE = [
  "    .---.    ",
  "   /     \\   ",
  "   \\     /   ",
  "    '-.-'    ",
  " .---| |---. ",
  "/    '-'    \\",
  "| /|     |\\ |",
  "| ||     || |",
  "|_||     ||_|",
  "(_)|_____|(_)",
  "   |  |  |   ",
  "   |  |  |   ",
  "   |  |  |   ",
  "  _|  |  |_  ",
  " (___/ \\___) ",
];

/** The body with a box per slot. ``onSlot`` runs when a box is clicked.
 * @param {Record<string, string | null>} worn slot -> item id
 * @param {(slot: string, label: string, item: any) => void} onSlot
 * @param {(label: string, item: any) => string} ariaLabel
 * @param {(id: string) => any} [lookup] how to see an item: yours shows your refined copy */
export function gearDoll(worn, onSlot, ariaLabel, lookup = itemById) {
  const doll = el("div", "doll");
  const fig = el("pre", "doll-fig", FIGURE.join("\n"));
  fig.setAttribute("aria-hidden", "true");
  doll.append(fig);
  for (const [slot, label] of EQUIP_SLOTS) {
    const id = worn?.[slot];
    const item = id ? lookup(id) : null;
    const b = /** @type {HTMLButtonElement} */ (el("button", `doll-slot slot-${slot}${item ? "" : " empty"}`));
    b.type = "button";
    b.append(el("span", "doll-label", `[ ${label} ]`), el("span", item ? `doll-item r-${item.rarity}` : "doll-item", item ? item.name : "--"));
    b.setAttribute("aria-label", ariaLabel(label, item));
    b.addEventListener("click", () => onSlot(slot, label, item));
    doll.append(b);
  }
  return doll;
}

/** "TOTAL: +12 MAX DMG, ..." for a set of worn gear. @param {any} mods @param {any} raw @param {string} none */
export function gearTotal(mods, raw, none) {
  const total = totalLine(mods, raw);
  const line = el("div", "stats bag-note doll-total", "TOTAL: ");
  if (total.length) line.append(...total);
  else line.append(none);
  return line;
}

/** Someone's worn equipment, in a card over the page. ``back`` (from the
 * ONLINE list) adds a [ < BACK ] to it. ``swap`` closes the card it replaces,
 * only once this one is loaded: closing first would show the page between the
 * two for as long as the request takes (a flash).
 * @param {string} playerId @param {(swap?: () => void) => void} [back] @param {() => void} [swap] */
export async function showGear(playerId, back, swap) {
  let g;
  try {
    g = await api.getPlayerGear(playerId);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    return;
  }
  swap?.();
  gearCard(g, back);
}

/** A shared link's card: #p=NAME (ticket #67). @param {string} name */
export async function showGearByName(name) {
  try {
    gearCard(await api.getGearByName(name));
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** The link that opens ``name``'s card. @param {string} name */
export const gearLink = (name) => `${location.origin}${location.pathname}#p=${encodeURIComponent(name)}`;

/** @param {any} g the server's gear_of @param {(swap?: () => void) => void} [back] */
function gearCard(g, back) {
  const playerId = g.player_id;
  showOverlay((inner, close) => {
    const card = el("div", "gear-card");
    const head = el("div", "gear-head");
    const tag = badgeTag(g.badges, null);
    head.append(...(tag ? [tag, " "] : []), ...nameStar(g.badges), el("span", "gear-name", g.name), ...nameStar(g.badges), el("span", "dim", `  LV ${g.level}`));
    // Tap a slot: that item's card (art and all) and what it does, under the body.
    const detail = el("div", "gear-detail dim", "> nothing worn yet");
    let opened = false;
    const pick = (/** @type {string} */ slot, /** @type {string} */ label, /** @type {any} */ item) => {
      card.querySelectorAll(".doll-slot.on").forEach((s) => s.classList.remove("on"));
      card.querySelector(`.slot-${slot}`)?.classList.add("on");
      if (!item) {
        detail.replaceChildren(el("span", "dim", `${label}: nothing worn`));
      } else {
        const art = el("pre", `art gear-art r-${item.rarity}`);
        detail.replaceChildren(art, effectLine(item), ...refineBox(item), ...(item.flavor ? [el("div", "flavor", `"${item.flavor}"`)] : []));
        if (tabOpen("auction") && auctionable(item)) { // ticket #254: buy one like it
          const ah = el("button", "inline-btn", "[ FIND ON AH ]");
          ah.title = "open the AUCTION HOUSE on this item's listings";
          ah.addEventListener("click", () => {
            close();
            findOnAuction(itemById(item.id) ?? item);
          });
          const line = el("div", "");
          line.append(ah);
          detail.append(line);
        }
        requestAnimationFrame(() => setArt(art, itemLines(item, { width: 26 }), 15));
      }
      // On a phone the card is taller than the screen: bring what you tapped into view.
      if (opened) requestAnimationFrame(() => detail.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    };
    // Their refined copies (THE BLACKSMITH) show as theirs: "NAME [2]", their numbers, the REFINED box.
    const dollFor = (/** @type {any} */ worn) => gearDoll(worn, pick,
      (label, item) => `${label}: ${item ? item.name : "empty"}. Show what it does`,
      (id) => refinedCopy(itemById(id), g.refined?.[id]));
    let doll = dollFor(g.worn);
    let total = gearTotal(g.mods, g.mods_raw, "nothing worn yet.");
    // Ticket #67: WORN, or one of their saved loadouts.
    /** @type {any[]} */
    const sets = [{ name: "WORN", worn: g.worn, mods: g.mods, mods_raw: g.mods_raw }, ...(g.loadouts ?? [])];
    const setRow = el("div", "actions gear-sets");
    const showSet = (/** @type {number} */ i) => {
      const s = sets[i];
      const nextDoll = dollFor(s.worn);
      const nextTotal = gearTotal(s.mods, s.mods_raw, "nothing worn yet.");
      doll.replaceWith(nextDoll);
      total.replaceWith(nextTotal);
      doll = nextDoll;
      total = nextTotal;
      setRow.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i));
      openFirst(s.worn);
    };
    if (sets.length > 1) {
      sets.forEach((s, i) => {
        const b = el("button", `inline-btn${i ? "" : " on"}`, `[ ${s.name} ]`);
        b.title = i ? "a loadout they saved" : "what they wear right now";
        b.addEventListener("click", () => showSet(i));
        setRow.append(b);
      });
    }
    const shut = el("button", "", "[ CLOSE ]");
    shut.addEventListener("click", close);
    const actions = el("div", "actions");
    if (back) {
      const prev = el("button", "", "[ < BACK ]");
      prev.addEventListener("click", () => back(close));
      actions.append(prev);
    }
    if (playerId !== state.me?.id) {
      // Ticket #121: hide their CHAT messages (in this browser only).
      const mute = el("button", "", "");
      const paint = () => (mute.textContent = isMuted(playerId) ? "[ UNMUTE IN CHAT ]" : "[ MUTE IN CHAT ]");
      paint();
      mute.title = "hide (or show again) this player's chat messages, for you only";
      mute.addEventListener("click", () => {
        setMuted(playerId, g.name, !isMuted(playerId));
        paint();
      });
      actions.append(mute);
      if (state.me?.name_chosen && tabOpen("dms")) {
        const dm = el("button", "", "[ MESSAGE ]");
        dm.title = `send ${g.name} a private message`;
        dm.addEventListener("click", () => {
          close();
          import("./dms.js").then((m) => m.openDm(playerId));
        });
        actions.append(dm);
      }
    }
    const copy = el("button", "", "[ COPY LINK ]");
    copy.title = "a link that opens this card (for the wiki, Discord...)";
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(gearLink(g.name)).then(() => (copy.textContent = "[ COPIED ]"),
        () => showError(gearLink(g.name)));
    });
    actions.append(copy, shut);
    // A second close at the top: on a phone the card is taller than the screen.
    const x = el("button", "gear-x", "[ X ]");
    x.setAttribute("aria-label", "close");
    x.addEventListener("click", close);
    card.append(x, el("div", "panel-h", "WORN EQUIPMENT"), head, ...(sets.length > 1 ? [setRow] : []), doll,
      total, detail, actions);
    inner.append(card);
    // Open on their weapon (or the first thing they wear), so there's art straight away.
    const openFirst = (/** @type {any} */ worn) => {
      const first = ["weapon", ...EQUIP_SLOTS.map(([s]) => s)].find((s) => worn?.[s] && itemById(worn[s]));
      if (first) pick(first, EQUIP_SLOTS.find(([s]) => s === first)?.[1] ?? "", itemById(worn[first]));
      else detail.replaceChildren(el("span", "dim", "> nothing worn"));
    };
    openFirst(g.worn);
    opened = true;
  });
}

/** Everyone with the game open (the [N ONLINE] at the top): badges, name and
 * level; click a name to see what they're wearing. ``swap``: as for showGear.
 * @param {() => void} [swap] */
export async function showOnline(swap) {
  let data;
  try {
    data = await api.getOnline();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    return;
  }
  swap?.();
  /** @type {any[]} */
  const players = data.players ?? [];
  showOverlay((inner, close) => {
    const card = el("div", "gear-card online-card");
    const x = el("button", "gear-x", "[ X ]");
    x.setAttribute("aria-label", "close");
    x.addEventListener("click", close);
    const others = Math.max(0, (data.connections ?? 0) - players.length);
    card.append(x, el("div", "panel-h", "WHO'S ONLINE"),
      el("div", "dim online-sub", `${players.length} player${players.length === 1 ? "" : "s"}`
        + (others ? ` :: +${others} more tab${others === 1 ? "" : "s"} or visitor${others === 1 ? "" : "s"}` : "")
        + " :: click a name to see their gear"));
    const list = el("div", "online-list");
    const rows = players.map((p) => {
      const row = el("div", `online-row${p.player_id === state.me?.id ? " me" : ""}`);
      const tag = badgeTag(p.badges, p.player_id);
      const name = /** @type {HTMLButtonElement} */ (el("button", "online-name", p.name));
      name.type = "button";
      name.title = `see what ${p.name} is wearing`;
      name.addEventListener("click", () => showGear(p.player_id, showOnline, close));
      row.append(...(tag ? [tag, " "] : []), ...nameStar(p.badges), name, ...nameStar(p.badges), el("span", "dim online-lv", `LV ${p.level}`),
        ...(p.player_id === state.me?.id ? [el("span", "online-you", "YOU")] : []),
        ...(canReport(p.player_id) ? [reportButton({ player_id: p.player_id, name: p.name }, "[ REPORT ]", close)] : []));
      row.dataset.name = p.name.toLowerCase();
      return row;
    });
    if (!rows.length) list.append(el("div", "dim", "> nobody's signed in right now."));
    list.append(...rows);
    // A long list gets a name filter.
    if (rows.length > 12) {
      const find = /** @type {HTMLInputElement} */ (el("input", "online-find"));
      find.type = "search";
      find.placeholder = "find a name";
      find.setAttribute("aria-label", "find a name");
      find.addEventListener("input", () => {
        const q = find.value.trim().toLowerCase();
        for (const r of rows) r.hidden = Boolean(q) && !(r.dataset.name ?? "").includes(q);
      });
      card.append(find);
    }
    const shut = el("button", "", "[ CLOSE ]");
    shut.addEventListener("click", close);
    const actions = el("div", "actions");
    actions.append(shut);
    card.append(list, actions);
    inner.append(card);
  });
}
