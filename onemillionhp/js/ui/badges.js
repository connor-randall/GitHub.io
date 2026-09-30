// Badges by names:  [*****] NAME . Each * is one badge:
//   a boss's colour  helped kill that boss       (token "b<seq>")
//   gold             finished #1 on a leaderboard (token "g")
//   rainbow          landed a final blow          (token "k")
//   admin-made       any symbol/colour, given by hand (token "c<id>")
// Hover (or tap) the stars for an ASCII box saying what each one is for.

import * as api from "../api.js?v=b7420735b5";
import { el } from "../ascii.js?v=b7420735b5";
import { bossDef } from "../store.js?v=b7420735b5";

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

/** @param {HTMLElement} star */
function paintCustom(star) {
  const def = customDefs.get(star.dataset.id ?? "");
  if (!def) {
    loadBadgeDefs();
    return;
  }
  star.textContent = def.symbol || "*";
  star.classList.toggle("badge-rainbow", Boolean(def.rainbow));
  star.style.color = def.rainbow ? "" : def.color;
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

/** One coloured star for a badge token. @param {string} token */
function star(token) {
  const kind = token[0];
  const s = el("span", `badge badge-${kind}`, "*");
  if (kind === "b") {
    s.dataset.seq = token.slice(1);
    paint(s);
  } else if (kind === "c") {
    s.dataset.id = token.slice(1);
    paintCustom(s);
  }
  return s;
}

/** ``[***]`` for a badge string like "k.g.b7" (null when there are none).
 * @param {string | null | undefined} badges @param {string | null | undefined} playerId */
export function badgeTag(badges, playerId) {
  const tokens = (badges ?? "").split(".").filter(Boolean);
  if (!tokens.length) return null;
  const tag = el("span", "badges");
  if (playerId) {
    tag.dataset.pid = playerId;
    tag.tabIndex = 0;
    tag.setAttribute("role", "button");
    tag.setAttribute("aria-label", `${tokens.length} badge${tokens.length === 1 ? "" : "s"}: show what they're for`);
  }
  tag.append("[", ...tokens.map(star), "]");
  return tag;
}

/** How many characters ``[***] `` takes (for lining up ASCII tables). @param {string | null | undefined} badges */
export const badgeWidth = (badges) => {
  const n = (badges ?? "").split(".").filter(Boolean).length;
  return n ? n + 3 : 0;
};

/** Badges then the name, e.g. for the feed. @param {string | null | undefined} badges
 * @param {string | null | undefined} playerId @param {HTMLElement} nameNode */
export function withBadges(badges, playerId, nameNode) {
  const tag = badgeTag(badges, playerId);
  if (!tag) return nameNode;
  const wrap = el("span", "named");
  wrap.append(tag, " ", nameNode);
  return wrap;
}

// ---------------------------------------------------------------- hover box

/** @type {Map<string, {at: number, data: any}>} */
const details = new Map();
/** @type {HTMLElement | null} */
let tip = null;
/** @type {HTMLElement | null} */
let tipFor = null;
const MAX_LINES = 3; // per badge; "...and N more" after that
let pointerAt = 0; // a tap focuses the stars and then clicks them: let the click decide

/** @param {string} pid */
async function fetchDetails(pid) {
  const hit = details.get(pid);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const data = await api.getPlayerBadges(pid);
  details.set(pid, { at: Date.now(), data });
  return data;
}

/** The ASCII box: a title row, then each badge with its lines.
 * @param {any} data @returns {HTMLElement} */
function tipBox(data) {
  /** @type {{text: string, token?: string}[]} */
  const rows = [{ text: `${data.name}'S BADGES` }];
  for (const b of data.badges) {
    rows.push({ text: "", token: undefined });
    rows.push({ text: b.title, token: b.token });
    const lines = b.lines.slice(0, MAX_LINES);
    if (b.lines.length > MAX_LINES) lines.push(`...and ${b.lines.length - MAX_LINES} more`);
    for (const line of lines) rows.push({ text: `  ${line}` });
  }
  const w = Math.max(...rows.map((r) => r.text.length + (r.token ? 2 : 0)));
  const pre = el("pre", "badge-tip-box");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.append(edge);
  for (const r of rows) {
    const line = el("span", r.token ? "tip-title" : "");
    line.append("| ");
    if (r.token) line.append(star(r.token), " ");
    line.append(r.text.padEnd(w - (r.token ? 2 : 0)), " |\n");
    pre.append(line);
  }
  pre.append(edge.trimEnd());
  return pre;
}

/** @param {HTMLElement} tag */
async function show(tag) {
  const pid = tag.dataset.pid;
  if (!pid) return;
  tipFor = tag;
  tip ??= document.body.appendChild(el("div", "badge-tip"));
  tip.setAttribute("role", "tooltip");
  try {
    const data = await fetchDetails(pid);
    if (tipFor !== tag) return; // moved on while it loaded
    tip.replaceChildren(tipBox(data));
  } catch {
    if (tipFor !== tag) return;
    tip.replaceChildren(el("pre", "badge-tip-box", "+-----------+\n| (unknown) |\n+-----------+"));
  }
  tip.hidden = false;
  // Below the stars, kept on screen.
  const r = tag.getBoundingClientRect();
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

/** Hover, keyboard focus and taps on any [***] on the page. */
export function initBadges() {
  const tagOf = (/** @type {EventTarget | null} */ t) =>
    t instanceof Element ? /** @type {HTMLElement | null} */ (t.closest(".badges[data-pid]")) : null;
  document.addEventListener("pointerdown", () => (pointerAt = Date.now()), { capture: true });
  document.addEventListener("pointerover", (e) => {
    const tag = tagOf(e.target);
    if (tag && e.pointerType === "mouse" && tag !== tipFor) show(tag);
  });
  document.addEventListener("pointerout", (e) => {
    const tag = tagOf(e.target);
    if (tag && e.pointerType === "mouse" && !tag.contains(/** @type {Node | null} */ (e.relatedTarget))) hide();
  });
  document.addEventListener("click", (e) => {
    const tag = tagOf(e.target);
    if (tag) {
      e.stopPropagation();
      if (tipFor === tag) hide();
      else show(tag);
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
