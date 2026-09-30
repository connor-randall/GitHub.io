// [ POLLS ] panel: the admin's yes/no questions. Vote (you can change it
// until the timer runs out), see the counts once you've voted, and when a
// poll ends with more than half YES it PASSES, with a one-time celebration.

import * as api from "../api.js?v=b7420735b5";
import { bar, center, duration, el, fitArt, fmt } from "../ascii.js?v=b7420735b5";
import { now, state } from "../store.js?v=b7420735b5";
import { blockLetters } from "./aftermath.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SEEN_KEY = "omhp.polls.celebrated"; // polls whose PASSED animation this browser has played
const SKIP_KEY = "omhp.polls.skipped"; // polls this browser chose not to vote on
const SCRAMBLE = "#%&@$*+=:;";

/** @type {any[]} */
let polls = [];
let loadedAt = 0;
let loading = false;
let busy = false;
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll ids remembered in this browser under ``key``. @param {string} key */
function remembered(key) {
  try {
    return new Set((localStorage.getItem(key) ?? "").split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** @param {string} key @param {number} id */
function remember(key, id) {
  try {
    localStorage.setItem(key, [...remembered(key), String(id)].slice(-100).join(","));
  } catch {
    /* ignore */
  }
}

const skipped = (/** @type {any} */ poll) => remembered(SKIP_KEY).has(String(poll.id));

/** "[ POLLS 2 ]" when there are open polls you haven't voted on. */
function paintBadge() {
  const tab = document.querySelector('#tabs [data-tab="polls"]');
  if (!tab) return;
  const t = now();
  const waiting = polls.filter((p) => p.ends_at > t && !p.my_vote && !skipped(p)).length;
  tab.textContent = waiting ? `[ POLLS ${waiting} ]` : "[ POLLS ]";
  tab.classList.toggle("has-new", waiting > 0);
}

/** Fetch the polls (for the tab badge even when the tab is closed). @param {boolean} [force] */
export async function loadPolls(force = false) {
  if (loading || (!force && Date.now() - loadedAt < 10000 && polls.length)) {
    if (visible()) render();
    return;
  }
  loading = true;
  try {
    const res = await api.getPolls();
    polls = res.polls ?? [];
    loadedAt = Date.now();
    paintBadge();
    if (visible()) render();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
  }
}

const visible = () => !$("panel-polls").hidden;

/** @param {any} poll @param {"yes" | "no"} choice */
async function vote(poll, choice) {
  if (busy || poll.my_vote === choice) return;
  busy = true;
  try {
    const res = await api.votePoll(poll.id, choice);
    polls = polls.map((p) => (p.id === poll.id ? res.poll : p));
    paintBadge();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    if (/** @type {api.ApiError} */ (e).code === "POLL_CLOSED") loadPolls(true);
  } finally {
    busy = false;
    render();
  }
}

/** A YES / NO result row: ``YES [████░░░░] 67%  12``. @param {string} label @param {number} n @param {number} total @param {boolean} mine */
function resultRow(label, n, total, mine) {
  const pct = total ? Math.round((100 * n) / total) : 0;
  const row = el("div", `poll-row poll-${label.toLowerCase()}`);
  row.append(
    el("span", "poll-label", label.padEnd(3)),
    " ",
    el("span", "poll-bar", bar(total ? n / total : 0, 16)),
    el("span", "poll-pct", ` ${String(pct).padStart(3)}% `),
    el("span", "dim", fmt(n)),
  );
  if (mine) row.append(el("span", "poll-mine", "  < you"));
  return row;
}

/** @param {any} poll */
function card(poll) {
  const t = now();
  const closed = poll.closed || poll.ends_at <= t;
  const cls = closed ? (poll.passed ? "passed" : "failed") : "open";
  const c = el("div", `poll poll-${cls}`);
  c.dataset.id = String(poll.id);
  c.append(el("div", "poll-h", `POLL #${poll.id}`), el("div", "poll-q", poll.question));

  const status = el("div", "poll-status");
  if (closed) status.append(el("span", "dim", "ENDED"));
  else status.append(el("span", "dim", "ENDS IN "), el("span", "poll-left", duration(poll.ends_at - t)));
  c.append(status);

  if (!closed) {
    const buttons = el("div", "poll-vote");
    for (const choice of /** @type {const} */ (["yes", "no"])) {
      const on = poll.my_vote === choice;
      const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn poll-${choice}`,
        on ? `[x ${choice.toUpperCase()} ]` : `[ ${choice.toUpperCase()} ]`));
      b.setAttribute("aria-pressed", String(on));
      b.disabled = busy;
      b.addEventListener("click", () => vote(poll, choice));
      buttons.append(b);
    }
    if (!poll.my_vote && !skipped(poll)) {
      // Not voting is fine too: off the badge, and you see the results.
      const skip = el("button", "inline-btn poll-skip", "[ SKIP ]");
      skip.addEventListener("click", () => {
        remember(SKIP_KEY, poll.id);
        paintBadge();
        render();
      });
      buttons.append(skip);
    }
    if (poll.my_vote) buttons.append(el("span", "dim poll-hint", " you can change your vote until it ends"));
    else if (skipped(poll)) buttons.append(el("span", "dim poll-hint", " skipped. you can still vote until it ends"));
    c.append(buttons);
  }

  const total = poll.yes + poll.no;
  if (poll.my_vote || closed || skipped(poll)) {
    c.append(
      resultRow("YES", poll.yes, total, poll.my_vote === "yes"),
      resultRow("NO", poll.no, total, poll.my_vote === "no"),
      el("div", "dim poll-total", `${fmt(total)} vote${total === 1 ? "" : "s"}`),
    );
  } else {
    c.append(el("div", "dim poll-hint", "> vote to see the results"));
  }

  if (closed) {
    const stamp = el("pre", `art poll-stamp ${poll.passed ? "stamp-passed" : "stamp-failed"}`);
    c.append(stamp);
    const word = blockLetters(poll.passed ? "PASSED" : "FAILED");
    const caption = poll.passed ? "more than half said YES" : total ? "not enough YES votes" : "nobody voted";
    const w = Math.max(caption.length, ...word.map((l) => l.length));
    const lines = [...word, "", center(caption, w)];
    if (poll.passed && !remembered(SEEN_KEY).has(String(poll.id)) && poll.closed) {
      remember(SEEN_KEY, poll.id);
      celebrate(c, stamp, lines);
    } else {
      stamp.textContent = lines.join("\n");
      requestAnimationFrame(() => fitArt(stamp, 13));
    }
  }
  return c;
}

/** The PASSED moment: the card flashes, the block letters decode out of
 * scrambled symbols, sparkles burst around it. @param {HTMLElement} c @param {HTMLElement} stamp @param {string[]} lines */
async function celebrate(c, stamp, lines) {
  stamp.textContent = lines.join("\n");
  requestAnimationFrame(() => fitArt(stamp, 13));
  if (reduced) return;
  c.classList.add("celebrate");
  const frames = 14;
  for (let f = 0; f <= frames; f++) {
    if (!stamp.isConnected) return;
    const settle = f / frames;
    stamp.textContent = lines.map((line) => [...line].map((ch) =>
      ch === " " || Math.random() < settle ? ch : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]).join("")).join("\n");
    await sleep(55);
  }
  stamp.textContent = lines.join("\n");
  const w = Math.max(...lines.map((l) => l.length));
  for (let burst = 0; burst < 6; burst++) {
    if (!stamp.isConnected) return;
    const spark = () => Array.from({ length: w }, () => (Math.random() < 0.18 ? "*+.'"[Math.floor(Math.random() * 4)] : " ")).join("");
    stamp.textContent = [spark(), ...lines, spark()].join("\n");
    await sleep(140);
  }
  stamp.textContent = lines.join("\n");
  setTimeout(() => c.classList.remove("celebrate"), 600);
}

function render() {
  const host = $("panel-polls");
  if (!state.content) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  const parts = [el("div", "panel-h", "POLLS")];
  if (!polls.length) parts.push(el("div", "dim bag-note", "> no polls right now. check back later."));
  for (const p of polls) parts.push(card(p));
  host.replaceChildren(...parts);
  startTicker();
}

/** While the tab is open: count down each second, and when a poll's time
 * runs out, fetch its final counts (and celebrate if it passed). */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!visible() || document.visibilityState !== "visible") return;
    const t = now();
    let ended = false;
    for (const p of polls) {
      const node = document.querySelector(`#panel-polls .poll[data-id="${p.id}"] .poll-left`);
      if (!p.closed && p.ends_at <= t) ended = true;
      else if (node) node.textContent = duration(p.ends_at - t);
    }
    if (ended && !loading) {
      polls = polls.map((p) => (p.ends_at <= t ? { ...p, closed: true } : p));
      setTimeout(() => loadPolls(true), 1200); // the server's final word (passed or not)
    } else if (Date.now() - loadedAt > 15000) loadPolls(true); // fresh counts now and then
  }, 1000);
}
