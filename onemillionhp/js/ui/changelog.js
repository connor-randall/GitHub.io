// [ CHANGELOG ] in the GAME menu: what changed, one drop-down per day (newest
// open). Entries are in changelog-data.js. The tab gets the "new" mark while
// there's a day you haven't opened the changelog since (localStorage).

import { el } from "../ascii.js?v=b6664395f3";
import { CHANGELOG } from "../changelog-data.js?v=b6664395f3";

const SEEN_KEY = "omhp.changelog.seen";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const tab = () => document.querySelector('#tabs [data-tab="changelog"]');
const newest = CHANGELOG[0]?.date ?? "";

function seen() {
  try {
    // Never opened it (a new browser): only the latest update counts as NEW,
    // not all 40-odd days of history.
    return localStorage.getItem(SEEN_KEY) ?? CHANGELOG[1]?.date ?? "";
  } catch {
    return newest; // no storage: never nag
  }
}

/** Mark the tab while there's something you haven't seen. */
export function paintChangelogBadge() {
  tab()?.classList.toggle("has-new", newest > seen());
}

/** "2026-10-13" -> "OCT 13". @param {string} date */
const day = (date) => {
  const [, m, d] = date.split("-").map(Number);
  return `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][m - 1]} ${d}`;
};

/** Days you've opened or closed by hand (kept while the page is open). @type {Map<string, boolean>} */
const opened = new Map();

export function renderChangelog() {
  const host = $("panel-changelog");
  const before = seen();
  const head = el("div", "changelog-head");
  head.append(el("div", "panel-h", "CHANGELOG"));
  /** @type {HTMLDetailsElement[]} */
  const folds = [];
  const all = /** @type {HTMLButtonElement} */ (el("button", "inline-btn changelog-all", ""));
  all.type = "button";
  const paintAll = () => (all.textContent = folds.every((f) => f.open) ? "[ CLOSE ALL ]" : "[ OPEN ALL ]");
  all.addEventListener("click", () => {
    const open = !folds.every((f) => f.open);
    for (const f of folds) f.open = open;
    paintAll();
  });
  head.append(all);
  const parts = [head];
  CHANGELOG.forEach((entry, i) => {
    const fold = /** @type {HTMLDetailsElement} */ (el("details", "changelog-day"));
    fold.open = opened.get(entry.date) ?? i === 0;
    const sum = el("summary", "changelog-sum");
    const n = entry.items.length;
    sum.append(el("span", "changelog-arrow", "\u25B8"), el("span", "changelog-date", day(entry.date)),
      el("span", "changelog-title", entry.title ? entry.title.toUpperCase() : ""),
      ...(entry.date > before ? [el("span", "changelog-new", "NEW")] : []),
      el("span", "changelog-count", `${n} change${n === 1 ? "" : "s"}`));
    fold.addEventListener("toggle", () => {
      opened.set(entry.date, fold.open);
      paintAll();
    });
    folds.push(fold);
    const list = el("ul", "changelog-list");
    for (const item of entry.items) {
      const li = el("li", "");
      const m = item.match(/^((?:#\d+\s*)+)(.*)$/s);
      if (m) li.append(el("span", "changelog-ticket", m[1].trim()), ` ${m[2]}`);
      else li.textContent = item;
      list.append(li);
    }
    fold.append(sum, list);
    parts.push(fold);
  });
  paintAll();
  parts.push(el("div", "dim bag-note", "> #N = the ticket it came from ([ TICKETS ] in this menu)."));
  host.replaceChildren(...parts);
  try {
    localStorage.setItem(SEEN_KEY, newest);
  } catch {
    /* private mode */
  }
  paintChangelogBadge();
}

paintChangelogBadge();
