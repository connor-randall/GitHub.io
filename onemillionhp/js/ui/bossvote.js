// [ VOTE ON BOSSES ]: players' YES / NO on pending boss designs, one at a
// time, first frame only (no artist, no running count, so the drawing is all
// you judge). After 24 h, more than half YES puts it in the boss queue
// (server designvote.py). You can change a vote until it closes.

import * as api from "../api.js?v=b6664395f3";
import { DESIGN_COLORS } from "../boss-design.js?v=b6664395f3";
import { duration, el, fitArt, fmt, holdHeight } from "../ascii.js?v=b6664395f3";
import { now, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const SKIP_KEY = "omhp.bossvote.skipped"; // designs this browser passed on for now

/** @type {{ min_votes: number, open: any[], recent: any[] }} */
let data = { min_votes: 0, open: [], recent: [] };
let loadedAt = 0;
let loading = false;
let busy = false;
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;

/** @returns {Set<string>} */
function skippedIds() {
  try {
    return new Set((localStorage.getItem(SKIP_KEY) ?? "").split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} ids */
function saveSkipped(ids) {
  try {
    localStorage.setItem(SKIP_KEY, [...ids].slice(-300).join(","));
  } catch {
    /* ignore */
  }
}

const visible = () => !$("panel-bossvote").hidden;
const waiting = () => {
  const skipped = skippedIds();
  return data.open.filter((d) => !d.mine && !d.my_vote && !skipped.has(d.id));
};

/** "[ VOTE ON BOSSES ]" lights up (no number: the backlog can be long) while one waits for you. */
function paintBadge() {
  const tab = document.querySelector('#tabs [data-tab="bossvote"]');
  if (tab) tab.classList.toggle("has-new", waiting().length > 0);
}

/** @param {boolean} [force] */
export async function loadBossVotes(force = false) {
  if (loading || (!force && Date.now() - loadedAt < 10000 && loadedAt)) {
    if (visible()) render();
    return;
  }
  loading = true;
  try {
    data = await api.getBossVotes();
    loadedAt = Date.now();
    paintBadge();
    if (visible()) render();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
  }
}

/** @param {any} design @param {"yes" | "no"} choice */
async function vote(design, choice) {
  if (busy || design.my_vote === choice) return;
  busy = true;
  try {
    await api.voteBoss(design.id, choice);
    data.open = data.open.map((d) => (d.id === design.id ? { ...d, my_vote: choice } : d));
    paintBadge();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    if (/** @type {api.ApiError} */ (e).code === "VOTE_CLOSED") loadBossVotes(true);
  } finally {
    busy = false;
    render();
  }
}

/** The boss's first frame in its colour. @param {any} d */
function artOf(d) {
  const pre = el("pre", "art bv-art");
  pre.textContent = d.art;
  pre.style.color = DESIGN_COLORS[/** @type {keyof typeof DESIGN_COLORS} */ (d.color)] ?? DESIGN_COLORS.amber;
  requestAnimationFrame(() => fitArt(pre, 15));
  return pre;
}

/** @param {any} d @param {number} left how many still wait, this one included */
function ballot(d, left) {
  const c = el("div", "bv-card");
  c.dataset.id = d.id;
  const head = el("div", "bv-head");
  head.append(el("span", "bv-name", d.name), el("span", "dim", `${fmt(left)} left`));
  head.querySelector(".bv-name")?.setAttribute("style",
    `color: ${DESIGN_COLORS[/** @type {keyof typeof DESIGN_COLORS} */ (d.color)] ?? DESIGN_COLORS.amber}`);
  const frame = el("div", "bv-frame");
  frame.append(artOf(d));
  const status = el("div", "poll-status");
  status.append(el("span", "dim", "VOTING ENDS IN "), el("span", "poll-left bv-left", duration(d.ends_at - now())));
  const buttons = el("div", "poll-vote bv-vote");
  for (const choice of /** @type {const} */ (["yes", "no"])) {
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn poll-${choice}`, `[ ${choice.toUpperCase()} ]`));
    b.disabled = busy;
    b.addEventListener("click", () => vote(d, choice));
    buttons.append(b);
  }
  const skip = el("button", "inline-btn poll-skip", "[ SKIP ]");
  skip.addEventListener("click", () => {
    const ids = skippedIds();
    ids.add(d.id);
    saveSkipped(ids);
    paintBadge();
    render();
  });
  buttons.append(skip);
  c.append(head, frame, status, buttons);
  return c;
}

/** A line under YOUR VOTES: the name, your vote, and the other button to change it. @param {any} d */
function voteRow(d) {
  const row = el("div", "bv-row");
  row.dataset.id = d.id;
  row.append(el("span", "bv-row-name", d.name.padEnd(24)));
  for (const choice of /** @type {const} */ (["yes", "no"])) {
    const on = d.my_vote === choice;
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn poll-${choice}`,
      on ? `[x ${choice.toUpperCase()} ]` : `[ ${choice.toUpperCase()} ]`));
    b.setAttribute("aria-pressed", String(on));
    b.disabled = busy;
    b.addEventListener("click", () => vote(d, choice));
    row.append(b);
  }
  row.append(el("span", "dim bv-left", ` ${duration(d.ends_at - now())}`));
  return row;
}

/** A closed vote: APPROVED / DENIED / NOT ENOUGH VOTES, with the count and the artist. @param {any} r */
function resultRow(r) {
  const row = el("div", `bv-result bv-${r.result}`);
  const word = { approved: "APPROVED", denied: "DENIED", few: "NOT ENOUGH VOTES" }[/** @type {string} */ (r.result)] ?? "";
  row.append(el("span", "bv-verdict", word), " ", el("span", "", r.name),
    el("div", "dim", `  by ${r.creator_name} :: ${fmt(r.yes)} YES / ${fmt(r.no)} NO`));
  return row;
}

function render() {
  const host = $("panel-bossvote");
  if (!state.content) {
    host.replaceChildren(el("div", "dim", "> connecting..."));
    return;
  }
  holdHeight(host);
  const parts = [el("div", "panel-h", "VOTE ON BOSSES")];
  {
    parts.push(el("div", "dim bag-note",
      `> other players' boss designs. after 24 hours, more than half YES (at least ${fmt(data.min_votes)} votes) and it joins the fight.`));
    const queue = waiting();
    if (queue.length) parts.push(ballot(queue[0], queue.length));
    else {
      const skipped = data.open.filter((d) => !d.mine && !d.my_vote && skippedIds().has(d.id));
      parts.push(el("div", "bv-done", data.open.some((d) => !d.mine)
        ? "> you've voted on every boss. new designs show up here."
        : "> no bosses to vote on right now. design one in [ DESIGN A BOSS ]!"));
      if (skipped.length) {
        const back = el("button", "inline-btn", `[ SEE THE ${fmt(skipped.length)} YOU SKIPPED ]`);
        back.addEventListener("click", () => {
          const ids = skippedIds();
          for (const d of skipped) ids.delete(d.id);
          saveSkipped(ids);
          paintBadge();
          render();
        });
        parts.push(back);
      }
    }
    const voted = data.open.filter((d) => d.my_vote);
    if (voted.length) {
      parts.push(el("div", "panel-h bv-sub", "YOUR VOTES (change until it ends)"), ...voted.map(voteRow));
    }
    const mine = data.open.filter((d) => d.mine);
    if (mine.length) {
      parts.push(el("div", "panel-h bv-sub", "YOUR BOSSES ON THE BALLOT"));
      for (const d of mine) {
        const row = el("div", "bv-row");
        row.dataset.id = d.id;
        row.append(el("span", "bv-row-name", d.name.padEnd(24)), el("span", "dim bv-left", duration(d.ends_at - now())));
        parts.push(row);
      }
    }
  }
  if (data.recent.length) parts.push(el("div", "panel-h bv-sub", "RECENT RESULTS"), ...data.recent.map(resultRow));
  host.replaceChildren(...parts);
  startTicker();
}

/** While the tab is open: count down, and refetch when one runs out. */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!visible() || document.visibilityState !== "visible") return;
    const t = now();
    let ended = false;
    for (const d of data.open) {
      if (d.ends_at <= t) ended = true;
      for (const node of document.querySelectorAll(`#panel-bossvote [data-id="${d.id}"] .bv-left`)) {
        node.textContent = (node.classList.contains("poll-left") ? "" : " ") + duration(d.ends_at - t);
      }
    }
    if (ended) {
      data.open = data.open.filter((d) => d.ends_at > t);
      render();
      setTimeout(() => loadBossVotes(true), 12000); // the server settles every 10 s: then RECENT RESULTS has it
    }    else if (Date.now() - loadedAt > 60000) loadBossVotes(true);
  }, 1000);
}
