// Badges by names:  [*****] NAME . Each * is one badge:
//   a boss's colour  helped kill that boss       (token "b<seq>")
//   gold             finished #1 on a leaderboard (token "g")
//   rainbow &        designed a boss that made it in (token "d"; designers only)
//   rainbow $        designed a boss the admin approved (token "p")
//   ?                did something secret and cool (token "x")
//   rainbow          landed a final blow          (token "k")
//   red/white V      FIRST BLOOD: a boss's very first hit (token "v")
//   ^ by tier        achievements unlocked: white, green, blue, purple, gold,
//                    pink, and rainbow for all 60    (token "a<tier>", 1-7)
//   gold gem, animated  the CROWN: held the day's biggest single hit at midnight Mountain time (token "h",
//                    server/omhp/crown.py). While the day's on, the holder's feed lines lead with it.
//   green #          placed in a finished city's top donors (token "y", ticket #191)
//   rainbow * on BOTH SIDES of the name  PRESTIGE: started over (token "P", server/omhp/prestige.py)
//   admin-made       any symbol/colour, given by hand (token "c<id>"); a symbol of
//                    several characters cycles through them, and a second colour
//                    makes it flash (server/omhp/badge_symbols.py)
// Hover (or tap) the stars for an ASCII box saying what each one is for (the
// crown leading a feed or CHAT line too).
// In a CLAN (server/omhp/clans.py) the badge string ends in "C<id>": the [ ]
// become that clan's brackets in its colour ({***} NAME, or { } NAME with no
// badges), and the hover box says which clan. GET /api/clans says how each looks.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { bossDef, state } from "../store.js?v=b6664395f3";

/** Boss number -> boss definition id (from the boss history), for colours. @type {Map<string, string>} */
const seqDef = new Map();
/** @type {Promise<void> | null} */
let loadingSeqs = null;

/** Look up boss numbers we haven't seen, then colour any stars waiting on them. */
function loadSeqs() {
  loadingSeqs ??= api.getHistory().then((h) => {
    for (const b of h.bosses ?? []) seqDef.set(String(b.seq), b.def_id);
    document.querySelectorAll(".badge-b").forEach((s) => paint(/** @type {HTMLElement} */ (s)));
  }).catch(() => {}).finally(() => {
    setTimeout(() => (loadingSeqs = null), 30000); // new bosses: look again later
  });
  return loadingSeqs;
}

/** The admin's badges: id -> {symbol, color, rainbow, ...}. @type {Map<string, any>} */
const customDefs = new Map();
/** @type {Promise<void> | null} */
let loadingCustom = null;

/** (Re)load the admin's badge designs, then redraw any waiting on them. @param {boolean} [force] */
export function loadBadgeDefs(force = false) {
  if (force) loadingCustom = null;
  loadingCustom ??= api.getBadgeDefs().then((res) => {
    customDefs.clear();
    for (const b of res.badges ?? []) customDefs.set(String(b.id), b);
    document.querySelectorAll(".badge-c").forEach((s) => paintCustom(/** @type {HTMLElement} */ (s)));
  }).catch(() => {
    loadingCustom = null;
  });
  return loadingCustom;
}

/** Clans: id -> {name, brackets, color, ...}. @type {Map<string, any>} */
const clanDefs = new Map();
/** @type {Promise<void> | null} */
let loadingClans = null;

/** (Re)load how the clans look, then repaint every clan bracket. @param {boolean} [force] */
export function loadClanDefs(force = false) {
  if (force) loadingClans = null;
  loadingClans ??= api.getClans().then((res) => {
    clanDefs.clear();
    for (const k of res.clans ?? []) clanDefs.set(String(k.id), k);
    // Only the brackets around names (data-clan); the CLAN tab's pickers draw their own.
    document.querySelectorAll(".clan-br[data-clan]").forEach((b) => paintBracket(/** @type {HTMLElement} */ (b)));
  }).catch(() => {
    loadingClans = null;
  });
  return loadingClans;
}

/** One side of the [ ]: the clan's bracket and colour (plain [ ] until it loads,
 * or for a clan that's gone). @param {HTMLElement} b */
function paintBracket(b) {
  const side = b.dataset.side === "close" ? 1 : 0;
  const def = clanDefs.get(b.dataset.clan ?? "");
  if (!def && !loadingClans) loadClanDefs();
  b.textContent = def ? Array.from(def.brackets)[side] : "[]"[side];
  b.style.color = def?.color ?? "";
}

/** @param {string | null} clanId @param {"open" | "close"} side */
function bracket(clanId, side) {
  const b = el("span", "clan-br badge-glyph");
  b.dataset.side = side;
  if (clanId) {
    b.dataset.clan = clanId;
    paintBracket(b);
  } else b.textContent = side === "open" ? "[" : "]";
  return b;
}

/** @param {HTMLElement} star */
function paintCustom(star) {
  const def = customDefs.get(star.dataset.id ?? "");
  if (!def) {
    loadBadgeDefs();
    return;
  }
  paintLook(star, def);
}

const FRAME_MS = 400;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let frame = 0;
/** @type {number | null} */
let ticker = null;

/** Step every animated star on the page together (stops when none are left). */
function tick() {
  if (document.hidden) return;
  frame += 1;
  const stars = document.querySelectorAll(".badge-anim");
  if (!stars.length) {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    return;
  }
  stars.forEach((s) => {
    const frames = Array.from(/** @type {HTMLElement} */ (s).dataset.frames ?? "");
    if (frames.length) s.textContent = frames[frame % frames.length];
  });
}

/** How an admin-made badge's star looks: its symbol (several characters
 * animate), colour, rainbow or two-colour flash. Also used by the admin's preview.
 * @param {HTMLElement} star @param {{symbol?: string, color?: string, color2?: string, rainbow?: boolean}} def */
export function paintLook(star, def) {
  const frames = Array.from(def.symbol || "*");
  const animated = frames.length > 1 && !reduced;
  star.textContent = frames[animated ? frame % frames.length : 0];
  star.classList.toggle("badge-anim", animated);
  if (animated) {
    star.dataset.frames = frames.join("");
    ticker ??= window.setInterval(tick, FRAME_MS);
  } else delete star.dataset.frames;
  const rainbow = Boolean(def.rainbow);
  const flash = !rainbow && Boolean(def.color2);
  star.classList.toggle("badge-rainbow", rainbow);
  star.classList.toggle("badge-flash", flash);
  star.style.color = rainbow || flash ? "" : def.color ?? "";
  star.style.setProperty("--c1", flash ? def.color ?? "" : "");
  star.style.setProperty("--c2", flash ? def.color2 ?? "" : "");
}

/** @param {HTMLElement} star */
function paint(star) {
  const seq = star.dataset.seq ?? "";
  const def = seqDef.get(seq);
  if (!def) {
    loadSeqs();
    return;
  }
  const tint = bossDef(def)?.tint;
  if (tint) star.style.color = tint;
}

/** The CROWN (token "h", server/omhp/crown.py): a gold gem, with a glint. */
const CROWN = { symbol: "◇◆✶◆", color: "#ffd23f" };
const CROWN_HOW = ["biggest single hit of the day (Mountain time): a bigger one takes it",
  "whoever holds it at midnight unlocks it for good"];

/** The crown that leads today's holder's lines in the feed (in place of ">");
 * hovering it says what it is and who holds it. */
export function crownStar() {
  const s = star("h");
  s.dataset.crown = "1";
  s.tabIndex = 0;
  s.setAttribute("role", "button");
  s.setAttribute("aria-label", "the CROWN: show what it's for");
  return s;
}

/** Highest ^ tier (all achievements): rainbow. */
const TOP_ACHIEVEMENT_TIER = 7;

/** One coloured star for a badge token. @param {string} token */
function star(token) {
  const kind = token[0];
  const tier = kind === "a" ? Number(token.slice(1)) || 1 : 0;
  const rainbow = kind === "d" || kind === "p" || tier >= TOP_ACHIEVEMENT_TIER;
  const symbol = { d: "&", p: "$", x: "?", a: "^", v: "V", y: "#" }[kind] ?? "*";
  const s = el("span", `badge badge-${kind}${tier ? ` badge-a${tier}` : ""}${rainbow ? " badge-rainbow" : ""}`, symbol);
  s.dataset.token = token;
  if (kind === "b") {
    s.dataset.seq = token.slice(1);
    paint(s);
  } else if (kind === "c") {
    s.dataset.id = token.slice(1);
    paintCustom(s);
  } else if (kind === "h") paintLook(s, CROWN);
  return s;
}

/** A badge string's tokens, minus any this page doesn't draw (a line saved
 * with a badge that's since been retired, e.g. the old "hc"/"hx" race badges).
 * @param {string | null | undefined} badges */
const known = (badges) => (badges ?? "").split(".").filter((t) => t && t !== "P" && (t[0] !== "h" || t === "h"));

/** Has this badge string got PRESTIGE? @param {string | null | undefined} badges */
export const hasPrestige = (badges) => (badges ?? "").split(".").includes("P");

/** PRESTIGE's rainbow star, to spread on each side of a name: [star] or nothing.
 * @param {string | null | undefined} badges @returns {HTMLElement[]} */
export function nameStar(badges) {
  if (!hasPrestige(badges)) return [];
  const s = el("span", "badge prestige-star badge-rainbow", "*");
  s.title = "PRESTIGE";
  s.setAttribute("aria-label", "PRESTIGE");
  return [s];
}

/** The clan id in a badge string ("k.g.C4" -> "4"), or null. @param {string | null | undefined} badges */
export const clanIn = (badges) => (badges ?? "").split(".").find((t) => /^C\d+$/.test(t))?.slice(1) ?? null;

/** ``[***]`` for a badge string like "k.g.b7" (null when there are none), in
 * the clan's brackets with a "C<id>" (``{ }`` for a clan member with no badges).
 * @param {string | null | undefined} badges @param {string | null | undefined} playerId */
export function badgeTag(badges, playerId) {
  const tokens = known(badges).filter((t) => t[0] !== "C");
  const clan = clanIn(badges);
  if (!tokens.length && !clan) return null;
  const tag = el("span", "badges");
  if (playerId) {
    tag.dataset.pid = playerId;
    tag.tabIndex = 0;
    tag.setAttribute("role", "button");
    const what = [tokens.length ? `${tokens.length} badge${tokens.length === 1 ? "" : "s"}` : "", clan ? "clan" : ""];
    tag.setAttribute("aria-label", `${what.filter(Boolean).join(" and ")}: show what they're for`);
  }
  tag.append(bracket(clan, "open"), ...(tokens.length ? tokens.map(star) : [" "]), bracket(clan, "close"));
  return tag;
}

/** How many characters ``[***] `` takes (for lining up ASCII tables). @param {string | null | undefined} badges */
export const badgeWidth = (badges) => {
  const n = known(badges).filter((t) => t[0] !== "C").length;
  return (n || clanIn(badges) ? Math.max(n, 1) + 3 : 0) + (hasPrestige(badges) ? 2 : 0); // a star each side of the name
};

/** Badges then the name, e.g. for the feed. @param {string | null | undefined} badges
 * @param {string | null | undefined} playerId @param {HTMLElement} nameNode */
export function withBadges(badges, playerId, nameNode) {
  const tag = badgeTag(badges, playerId);
  const starred = hasPrestige(badges);
  if (!tag && !starred) return nameNode;
  const wrap = el("span", "named");
  wrap.append(...(tag ? [tag, " "] : []), ...nameStar(badges), nameNode, ...nameStar(badges));
  return wrap;
}

// ---------------------------------------------------------------- hover box

/** @type {Map<string, {at: number, data: any}>} */
const details = new Map();
/** @type {HTMLElement | null} */
let tip = null;
/** @type {HTMLElement | null} */
let tipFor = null;
const MAX_LINES = 3; // per badge; "...and N more" after that, unless the box was clicked open
let tipFull = false; // clicked open (ticket #265): every line, and it stays until clicked away
let pointerAt = 0; // a tap focuses the stars and then clicks them: let the click decide

/** @param {string} pid */
async function fetchDetails(pid) {
  const hit = details.get(pid);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const data = await api.getPlayerBadges(pid);
  details.set(pid, { at: Date.now(), data });
  return data;
}

/** The ASCII box: a title row, then each badge with its lines (the first
 * MAX_LINES of each unless ``full``).
 * @param {any} data @param {string} [heading] @param {boolean} [full] @returns {HTMLElement} */
function tipBox(data, heading = `${data.name}'S ${data.badges.length || !data.clan ? "BADGES" : "CLAN"}`, full = false) {
  /** @type {{text: string, token?: string, clan?: any}[]} */
  const rows = [{ text: heading }];
  const k = data.clan;
  if (k) {
    const when = new Date(k.created_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    rows.push({ text: "" }, { text: `CLAN ${k.name}`, clan: k },
      { text: `  ${k.members} member${k.members === 1 ? "" : "s"}, led by ${k.leader ?? "?"}` },
      { text: `  founded ${when}${k.founder && k.founder !== k.leader ? ` by ${k.founder}` : ""}` });
  }
  for (const b of data.badges) {
    rows.push({ text: "", token: undefined });
    rows.push({ text: b.title, token: b.token });
    const lines = full ? [...b.lines] : b.lines.slice(0, MAX_LINES);
    if (lines.length < b.lines.length) lines.push(`...and ${b.lines.length - MAX_LINES} more (click to see all)`);
    for (const line of lines) rows.push({ text: `  ${line}` });
  }
  const lead = (/** @type {{token?: string, clan?: any}} */ r) => (r.token ? 2 : r.clan ? 3 : 0);
  const w = Math.max(...rows.map((r) => r.text.length + lead(r)));
  const pre = el("pre", "badge-tip-box");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.append(edge);
  for (const r of rows) {
    const line = el("span", r.token || r.clan ? "tip-title" : "");
    line.append("| ");
    if (r.token) line.append(star(r.token), " ");
    if (r.clan) {
      const [o, c] = Array.from(r.clan.brackets);
      line.append(el("span", "clan-br badge-glyph", o), el("span", "clan-br badge-glyph", c), " ");
      line.querySelectorAll(".clan-br").forEach((b) => (/** @type {HTMLElement} */ (b).style.color = r.clan.color));
    }
    line.append(r.text.padEnd(w - lead(r)), " |\n");
    pre.append(line);
  }
  pre.append(edge.trimEnd());
  return pre;
}

/** Below the element, kept on screen. @param {HTMLElement} tag */
function place(tag) {
  if (!tip) return;
  tip.hidden = false;
  const r = tag.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - box.width - 8));
  const below = r.bottom + 6;
  const top = below + box.height > window.innerHeight - 8 ? Math.max(8, r.top - box.height - 6) : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** @param {HTMLElement} tag @param {boolean} [full] every line, pinned open */
async function show(tag, full = false) {
  tipFor = tag;
  tipFull = full;
  tip ??= document.body.appendChild(el("div", "badge-tip"));
  tip.setAttribute("role", "tooltip");
  if (tag.dataset.crown) { // the crown leading a feed / CHAT line: what it is, who has it
    const held = state.boss?.crown;
    const lines = [held ? `held right now by ${held.name}, with a hit of ${fmt(held.value)}` : "nobody holds it right now",
      ...CROWN_HOW];
    tip.replaceChildren(tipBox({ badges: [{ token: "h", title: "THE CROWN", lines }] }, "WHAT IS THIS?"));
    place(tag);
    return;
  }
  const pid = tag.dataset.pid;
  if (!pid) return;
  try {
    const data = await fetchDetails(pid);
    if (tipFor !== tag) return; // moved on while it loaded
    tip.replaceChildren(tipBox(data, undefined, full));
  } catch {
    if (tipFor !== tag) return;
    tip.replaceChildren(el("pre", "badge-tip-box", "+-----------+\n| (unknown) |\n+-----------+"));
  }
  place(tag);
}

function hide() {
  tipFor = null;
  tipFull = false;
  if (tip) tip.hidden = true;
}

/** Hover, keyboard focus and taps on any [***] on the page. */
export function initBadges() {
  const tagOf = (/** @type {EventTarget | null} */ t) =>
    t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest(".badges[data-pid], .badge[data-crown]")) : null;
  document.addEventListener("pointerdown", () => (pointerAt = Date.now()), { capture: true });
  document.addEventListener("pointerover", (e) => {
    const tag = tagOf(e.target);
    if (tag && e.pointerType === "mouse" && tag !== tipFor) show(tag);
  });
  document.addEventListener("pointerout", (e) => {
    const tag = tagOf(e.target);
    if (tag && e.pointerType === "mouse" && !tipFull && !tag.contains(/** @type {Node | null} */ (e.relatedTarget))) hide();
  });
  document.addEventListener("click", (e) => {
    const tag = tagOf(e.target);
    if (tag) {
      e.stopPropagation();
      if (tipFor === tag && tipFull) hide();
      else show(tag, true); // a click opens the whole list (a hover shows the first lines)
    } else if (tipFor) hide();
  });
  document.addEventListener("focusin", (e) => {
    const tag = tagOf(e.target);
    if (tag && Date.now() - pointerAt > 500) show(tag); // keyboard (Tab) focus
  });
  document.addEventListener("focusout", (e) => {
    if (tagOf(e.target) && Date.now() - pointerAt > 500) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
}

/** Forget cached hover boxes (e.g. after changing your own badges). @param {string} [pid] */
export function forgetBadges(pid) {
  if (pid) details.delete(pid);
  else details.clear();
}
