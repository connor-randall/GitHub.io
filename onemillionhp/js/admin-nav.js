// Admin panel navigation: the sections are grouped into tabs (only one
// group shows at a time), HOME lists what needs you plus every section, and
// the JUMP box finds any section by anything in it ("/" focuses it).
// The address follows along (#tickets, #players...), so Back works and a
// section can be bookmarked.

import { geoPanel } from "./admin-geo.js?v=b6664395f3";
import { el, fmt } from "./ascii.js?v=b6664395f3";

const TAB_KEY = "omhp.admin.tab";

/** Each tab's sections, in the order they show (by data-fold; "refill" is THE REFILL STATION).
 * INBOX = things waiting on you; PLAYERS = working on people; GAME = how the game plays. */
const TABS = /** @type {const} */ ([
  ["home", "HOME", ["refill"]],
  ["live", "LIVE", ["boss", "events", "limited-event", "double-damage", "meow-mode", "post", "hall-of-fame", "cutscenes", "chat", "polls"]],
  ["inbox", "INBOX", ["tickets", "boss-designs", "reports", "suspects", "appeals", "bounties", "banned"]],
  ["players", "PLAYERS", ["players", "shards", "accounts", "dms", "clans", "referrals", "achievements", "badges"]],
  ["game", "GAME", ["rules", "odds", "daily", "items", "relics", "forge", "auction", "city"]],
  ["settings", "SETTINGS", ["health", "passcode", "danger"]],
]);
/** Tab names from before the 2026-11 reshuffle, so a saved tab still lands somewhere sensible. */
const OLD_TABS = /** @type {Record<string, string>} */ ({ community: "inbox", cutscenes: "live", content: "game" });
/** Words people search for that aren't in a section's text. */
const ALIASES = /** @type {Record<string, string>} */ ({
  players: "ban unban rename captcha save code look up lookup give attacks gear",
  shards: "give shards balance wallet ledger money",
  accounts: "password login reset",
  post: "pin pinned popup pop up rotate rotating announce message notice",
  rules: "tuning recharge crit ult timer shop prices chest limit attacks per day",
  "double-damage": "2x double fire",
  "meow-mode": "cat meow",
  "limited-event": "events tab countdown timer limited city 72",
  "hall-of-fame": "hof whiskers fame",
  events: "world event director second wind shard rain",
  boss: "hp queue spawn rename boss next",
  "boss-designs": "submissions designs vote community",
  suspects: "bots bot captcha flags reset whitelist",
  cutscenes: "catfall cat fall cutscene",
  forge: "sovereign teaser",
  items: "give item chest box gallery",
  danger: "wipe reset everything",
  dms: "messages private",
});

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Every section, by its key. @type {Map<string, HTMLElement>} */
const sections = new Map();
/** Each section's words for the JUMP box (headings, labels, buttons, hints, aliases). @type {Map<string, string>} */
const words = new Map();
let tab = "home";
/** What the HOME strip last counted. @type {{key: string, label: string, n: number, hot: boolean}[]} */
let needs = [];

/** A section's key: its fold's name, or "refill". @param {HTMLElement} s */
const keyOf = (s) => (s.classList.contains("admin-power") ? "refill"
  : /** @type {HTMLElement | null} */ (s.querySelector("details.fold"))?.dataset.fold ?? "");

/** The section's name as its heading shows it, without brackets or counts. @param {string} key */
function nameOf(key) {
  if (key === "refill") return "REFILL STATION";
  const h2 = sections.get(key)?.querySelector("summary h2");
  const text = h2 ? [...h2.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("") : key;
  return text.replace(/[[\]]/g, "").trim();
}

/** Which tab a section is on (anything unlisted shows on HOME, with a warning to list it). @param {string} key */
function tabOf(key) {
  const t = TABS.find(([, , keys]) => /** @type {readonly string[]} */ (keys).includes(key))?.[0];
  if (!t) console.warn("admin-nav: section not in any tab:", key);
  return t ?? "home";
}

/** Show one tab's sections (HOME also shows the directory). @param {string} id @param {boolean} [push] */
function showTab(id, push = false) {
  const want = OLD_TABS[id] ?? id;
  tab = TABS.some(([t]) => t === want) ? want : "home";
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* ignore */
  }
  for (const [key, s] of sections) s.hidden = tabOf(key) !== tab;
  $("admin-home").hidden = tab !== "home";
  document.querySelectorAll("#admin-tabs [role=tab]").forEach((b) =>
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === tab)));
  setHash(tab, push);
}

/** The address bar follows the panel: #tab or #section. @param {string} where @param {boolean} push */
function setHash(where, push) {
  const want = `#${where}`;
  if (location.hash === want) return;
  if (push) history.pushState(null, "", want);
  else history.replaceState(null, "", want);
}

/** Open a section wherever it is: switch to its tab, unfold it, scroll to it. @param {string} key */
export function goTo(key) {
  const s = sections.get(key);
  if (!s) return;
  showTab(tabOf(key));
  setHash(key, true);
  const fold = /** @type {HTMLDetailsElement | null} */ (s.querySelector("details.fold"));
  if (fold && !fold.open) fold.open = true; // fires "toggle": the section loads itself
  // Below the sticky header, not under it.
  const top = s.getBoundingClientRect().top + window.scrollY - ($("admin-tabs").closest(".admin-sticky")?.getBoundingClientRect().height ?? 0) - 8;
  window.scrollTo({ top, behavior: "smooth" });
  s.classList.remove("jumped");
  void s.offsetWidth; // restart the flash
  s.classList.add("jumped");
}

function drawTabs() {
  const nav = $("admin-tabs");
  const tabs = TABS.map(([id, label, keys]) => {
    const hot = needs.filter((n) => n.hot && /** @type {readonly string[]} */ (keys).includes(n.key))
      .reduce((sum, n) => sum + n.n, 0);
    const b = el("button", "admin-tab", hot ? `${label} ${fmt(hot)}` : label);
    b.setAttribute("role", "tab");
    b.dataset.tab = id;
    b.setAttribute("aria-selected", String(id === tab));
    if (hot) b.classList.add("hot");
    b.addEventListener("click", () => {
      showTab(id, true);
      window.scrollTo({ top: 0 });
    });
    return b;
  });
  // Close every open section on this tab (they stay open between visits otherwise).
  const fold = el("button", "admin-tab admin-foldall", "FOLD ALL");
  fold.title = "close every open section on this tab";
  fold.addEventListener("click", () => {
    for (const [key, s] of sections) {
      if (tabOf(key) !== tab) continue;
      s.querySelectorAll("details.fold[open]").forEach((d) => (/** @type {HTMLDetailsElement} */ (d).open = false));
    }
  });
  nav.replaceChildren(...tabs, fold);
}

/** Does a section match what's typed in JUMP? @param {string} key @param {string} q (lower case) */
function matches(key, q) {
  if (!q) return true;
  const hay = `${nameOf(key).toLowerCase()} ${words.get(key) ?? ""}`;
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** HOME: the "needs you" counts, then every section grouped by tab, then the map. */
function drawHome() {
  const q = /** @type {HTMLInputElement} */ ($("jump")).value.trim().toLowerCase();
  const home = $("admin-home");
  const hot = needs.filter((n) => n.hot);
  const strip = el("div", "needs");
  strip.append(el("span", "needs-h", hot.length ? "NEEDS YOU" : "ALL CLEAR"));
  for (const n of hot) {
    const b = el("button", "inline-btn need", `[ ${fmt(n.n)} ${n.label} ]`);
    b.addEventListener("click", () => goTo(n.key));
    strip.append(b);
  }
  if (!hot.length) strip.append(el("span", "hint", "no new tickets, submissions, suspects, appeals or reports."));
  const dir = el("div", "admin-dir");
  for (const [, label, keys] of TABS) {
    const shown = /** @type {readonly string[]} */ (keys).filter((k) => sections.has(k) && matches(k, q));
    if (!shown.length) continue;
    const group = el("div", "dir-group");
    group.append(el("div", "dir-h", label));
    for (const key of shown) {
      const n = needs.find((x) => x.key === key && x.n > 0);
      const b = el("button", `inline-btn dir-link${n?.hot ? " hot" : ""}`, `${nameOf(key)}${n ? `  ${fmt(n.n)}` : ""}`);
      b.addEventListener("click", () => goTo(key));
      group.append(b);
    }
    dir.append(group);
  }
  if (!dir.childElementCount) dir.append(el("p", "hint", "nothing matches that."));
  home.replaceChildren(...(q ? [dir] : [strip, dir, geoPanel()]));
}

/** New counts from the overview (called on every refresh). @param {any} ov */
export function updateNeeds(ov) {
  const tickets = ov.tickets ?? [];
  const newTickets = tickets.filter((/** @type {any} */ t) => t.status === "new").length;
  const pending = (ov.boss_designs ?? []).filter((/** @type {any} */ d) => d.status === "pending").length;
  needs = [
    { key: "tickets", label: "NEW TICKETS", n: newTickets, hot: true },
    { key: "boss-designs", label: "BOSS SUBMISSIONS", n: pending, hot: true },
    { key: "suspects", label: "SUSPECTS", n: ov.suspects?.flagged?.length ?? 0, hot: true },
    { key: "appeals", label: "BAN APPEALS", n: ov.appeals_open ?? 0, hot: true },
    { key: "reports", label: "REPORTED PLAYERS", n: ov.reports_open ?? 0, hot: true },
    { key: "bounties", label: "NEW BOUNTY POSTS", n: ov.bounties_open ?? 0, hot: true },
    { key: "polls", label: "OPEN POLLS", n: (ov.polls ?? []).filter((/** @type {any} */ p) => !p.closed).length, hot: false },
    { key: "tickets", label: "IN PROGRESS", n: tickets.filter((/** @type {any} */ t) => t.status === "in_progress").length, hot: false },
  ].map((n) => ({ ...n, hot: n.hot && n.n > 0 }));
  // Counts on the busy queues' own headings too (REPORTS / APPEALS / SUSPECTS already have theirs).
  const count = (/** @type {string} */ id, /** @type {number} */ n, /** @type {string} */ word) => {
    const node = document.getElementById(id);
    if (node) node.textContent = n ? `:: ${fmt(n)} ${word}` : "";
  };
  count("ticket-count", newTickets, "NEW");
  count("design-count", pending, "PENDING");
  drawTabs();
  drawHome();
}

/** Open whatever the address names (#tab or #section). */
function followHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return false;
  if (sections.has(h)) goTo(h);
  else if (TABS.some(([t]) => t === h) || OLD_TABS[h]) showTab(h);
  else return false;
  return true;
}

export function initNav() {
  const panel = $("panel");
  for (const s of /** @type {NodeListOf<HTMLElement>} */ (panel.querySelectorAll(":scope > section.adm:not(#admin-home)"))) {
    const key = keyOf(s);
    if (!key) continue;
    sections.set(key, s);
    const text = [...s.querySelectorAll("h2, h3, label, button, .hint, summary")].map((n) => n.textContent ?? "").join(" ");
    words.set(key, `${text} ${ALIASES[key] ?? ""}`.toLowerCase().replace(/\s+/g, " "));
  }
  // Put each tab's sections in its listed order (the page's own order is history).
  for (const [, , keys] of TABS) for (const k of keys) { const s = sections.get(k); if (s) panel.append(s); }
  for (const [k, s] of sections) if (!TABS.some(([, , keys]) => /** @type {readonly string[]} */ (keys).includes(k))) panel.append(s);
  // Hints that name another section become links to it: <button data-goto="rules">.
  document.addEventListener("click", (e) => {
    const link = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest?.("[data-goto]"));
    if (!link) return;
    e.preventDefault();
    goTo(link.dataset.goto ?? "");
  });
  let saved = "home";
  try {
    saved = localStorage.getItem(TAB_KEY) ?? "home";
  } catch {
    /* ignore */
  }
  drawTabs();
  if (!followHash()) showTab(saved);
  drawHome();
  window.addEventListener("popstate", () => {
    if (!followHash()) showTab("home");
  });
  const jump = /** @type {HTMLInputElement} */ ($("jump"));
  jump.addEventListener("input", () => {
    if (jump.value.trim() && tab !== "home") showTab("home");
    drawHome();
  });
  jump.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = jump.value.trim().toLowerCase();
      const keys = [...sections.keys()];
      const hit = keys.find((k) => nameOf(k).toLowerCase().startsWith(q)) ?? keys.find((k) => matches(k, q));
      if (hit) {
        jump.value = "";
        drawHome();
        goTo(hit);
      }
    } else if (e.key === "Escape") {
      jump.value = "";
      drawHome();
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    if (e.key === "/" && !typing && !$("panel").hidden) {
      e.preventDefault();
      jump.focus();
    }
  });
}
