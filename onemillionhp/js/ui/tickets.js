// [ TICKETS ] panel: players file ISSUES (bug reports) and FEATURES (ideas),
// everyone sees the queue, and the admin marks each one NEW / IN PROGRESS /
// COMPLETED / SKIPPED (with an optional note) from the admin panel. Filter by
// type, and by status or "mine". Each ticket has a [ COMMENTS ] drop-down:
// each player can leave COMMENTS_MAX comments on one ticket (ticket #107).

import * as api from "../api.js?v=b6664395f3";
import { ago, bar, el, fmt } from "../ascii.js?v=b6664395f3";
import { now, on, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { adminTag } from "./notice.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const FILTER_KEY = "omhp.tickets.filter";
const KIND_KEY = "omhp.tickets.kind";
const PAGE = 30;
const TITLE_MAX = 80;
const BODY_MAX = 1000;
const COMMENTS_MAX = 5; // per player per ticket: server Game.TICKET_COMMENTS_MAX
const COMMENT_MAX = 300;

/** Filter buttons, in order: [id, label]. */
const FILTERS = /** @type {const} */ ([
  ["all", "ALL"],
  ["new", "NEW"],
  ["in_progress", "IN PROGRESS"],
  ["completed", "COMPLETED"],
  ["skipped", "SKIPPED"],
  ["mine", "MINE"],
]);
/** Type buttons, in order: [id, label]. */
const KINDS = /** @type {const} */ ([
  ["all", "ALL TYPES"],
  ["issue", "ISSUES"],
  ["feature", "FEATURES"],
]);
/** @type {Record<string, string>} */
const KIND_LABEL = { issue: "ISSUE", feature: "FEATURE" };
/** What the form asks for, per kind. */
const PLACEHOLDER = {
  "": ["pick ISSUE or FEATURE first", "details"],
  issue: ["what's broken? (short title)", "details: what you did, what happened, what device / browser"],
  feature: ["what's your idea? (short title)", "details: how it would work, why it would be fun"],
};
/** @type {Record<string, string>} */
const STATUS_LABEL = { new: "NEW", in_progress: "IN PROGRESS", completed: "COMPLETED", skipped: "SKIPPED" };

/** @type {any[]} */
let tickets = [];
let loadedAt = 0;
let loading = false;
let busy = false;
let shown = PAGE;
let filter = (() => {
  try {
    const saved = localStorage.getItem(FILTER_KEY) ?? "all";
    return FILTERS.some(([id]) => id === saved) ? saved : "all";
  } catch {
    return "all";
  }
})();
let kindFilter = (() => {
  try {
    const saved = localStorage.getItem(KIND_KEY) ?? "all";
    return KINDS.some(([id]) => id === saved) ? saved : "all";
  } catch {
    return "all";
  }
})();
/** The new ticket's type: "" until the player picks one. */
let draftKind = "";
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;

/** Built once and kept, so a refresh never wipes a half-typed ticket. */
/** @type {{root: HTMLElement, form: HTMLFormElement, kinds: HTMLElement, title: HTMLInputElement,
 *   body: HTMLTextAreaElement, count: HTMLElement, send: HTMLButtonElement, open: HTMLButtonElement,
 *   filters: HTMLElement, search: HTMLInputElement, list: HTMLElement} | null} */
let ui = null;

const visible = () => !$("panel-tickets").hidden;

// Named (or renamed) after the tab drew: [ + NEW TICKET ] unlocks.
on("me", () => {
  if (ui && visible()) render();
});

/** Fetch the queue (at most every 15 s unless ``force``). @param {boolean} [force] */
export async function loadTickets(force = false) {
  if (visible()) render();
  if (loading || (!force && Date.now() - loadedAt < 15000 && loadedAt)) return;
  loading = true;
  try {
    const res = await api.getTickets();
    tickets = res.tickets ?? [];
    loadedAt = Date.now();
    if (visible()) render();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
  }
}

/** @param {any} t @param {string} id */
const kindIs = (t, id) => id === "all" || (t.kind ?? "issue") === id;
/** @param {any} t @param {string} id */
const statusIs = (t, id) => id === "all" || (id === "mine" ? t.mine : t.status === id);
/** Ticket #96: what's typed in the search box, lower case ("" = everything). */
let query = "";
/** Every word typed is somewhere in the ticket: "#96", its title, text, author or the admin note.
 * @param {any} t */
const found = (t) => {
  const hay = `#${t.id} ${t.title} ${t.body ?? ""} ${t.name ?? ""} ${t.note ?? ""}`.toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
};
/** A "ticket #N" link in chat (ticket #326) shows just that ticket, until the search box is touched. */
let only = 0;
/** @param {any} t */
const matches = (t) => (only ? t.id === only : kindIs(t, kindFilter) && statusIs(t, filter) && (!query || found(t)));

/** Show only ticket ``id`` (open the tab after). @param {number} id */
export function showTicket(id) {
  if (!ui) build();
  only = id;
  query = "";
  shown = PAGE;
  if (ui) ui.search.value = `#${id}`;
  if (visible()) render();
}

const SORT_KEY = "omhp.tickets.sort";
/** "top": most +1s first; "new": IN PROGRESS first (what's being worked on), then newest. */
let sort = (() => {
  try {
    return localStorage.getItem(SORT_KEY) === "new" ? "new" : "top";
  } catch {
    return "top";
  }
})();
let voting = false;
/** Your ticket whose [ DELETE ] was clicked once (the second click deletes it). */
let armedDelete = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let disarm;
/** Tickets whose [ COMMENTS ] drop-down is open (kept across redraws). @type {Set<number>} */
const openComments = new Set();
/** Half-typed comments, by ticket id (kept across redraws). @type {Map<number, string>} */
const drafts = new Map();
let commenting = false;

/** Swap in the server's copy of one ticket. @param {any} fresh */
function replaceTicket(fresh) {
  tickets = tickets.map((x) => (x.id === fresh.id ? { ...fresh, mine: x.mine } : x));
}

/** Post a comment. @param {any} t @param {HTMLTextAreaElement} box */
async function sendComment(t, box) {
  const text = box.value.trim();
  if (commenting || !text) return;
  commenting = true;
  try {
    const res = await api.commentTicket(t.id, text);
    drafts.delete(t.id);
    replaceTicket(res.ticket);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    if (["COMMENTS_FULL", "TICKET_CLOSED"].includes(/** @type {api.ApiError} */ (e).code ?? "")) loadTickets(true);
  } finally {
    commenting = false;
    render();
  }
}

/** Take down your own comment. @param {any} comment */
async function dropComment(comment) {
  if (commenting) return;
  commenting = true;
  try {
    replaceTicket((await api.deleteTicketComment(comment.id)).ticket);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    commenting = false;
    render();
  }
}

/** [ COMMENTS (n/5) ] drop-down: the comments, oldest first, and a box to add one. @param {any} t */
function commentsFold(t) {
  /** @type {any[]} */
  const list = t.comments ?? [];
  const fold = /** @type {HTMLDetailsElement} */ (el("details", "ticket-comments"));
  fold.open = openComments.has(t.id);
  const mine = list.filter((cm) => cm.mine).length;
  const full = mine >= COMMENTS_MAX;
  const sum = el("summary", "inline-btn ticket-comments-sum", "");
  const label = () => (sum.textContent = `[ COMMENTS (${list.length}) ${fold.open ? "\u25B4" : "\u25BE"} ]`);
  label();
  fold.append(sum);
  fold.addEventListener("toggle", () => {
    if (fold.open) openComments.add(t.id);
    else openComments.delete(t.id);
    label();
  });
  const body = el("div", "ticket-comments-body");
  if (!list.length) body.append(el("div", "dim", "> no comments yet."));
  for (const cm of list) {
    const row = el("div", `ticket-comment${cm.mine ? " mine" : ""}`);
    const meta = el("div", "ticket-comment-meta");
    meta.append(el("span", "ticket-by", cm.name), el("span", "dim", ` · ${ago(now() - cm.created_at)} ago`));
    if (cm.mine) {
      const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn ticket-delete", "[ DELETE ]"));
      del.type = "button";
      del.title = "take your comment down";
      del.addEventListener("click", () => dropComment(cm));
      meta.append(" ", del);
    }
    row.append(meta, el("div", "ticket-text", cm.body));
    body.append(row);
  }
  const open = t.status === "new" || t.status === "in_progress";
  if (!open) body.append(el("div", "dim ticket-vote-hint", "> finished: comments are closed."));
  else if (full) body.append(el("div", "dim ticket-vote-hint", `> you've left ${COMMENTS_MAX} comments here: that's the limit.`));
  else if (!state.me?.name_chosen) body.append(el("div", "dim ticket-vote-hint", "> make your account first (hit [ ATTACK ]) to comment."));
  else {
    const form = el("form", "ticket-comment-form");
    const box = /** @type {HTMLTextAreaElement} */ (el("textarea", "designer-input ticket-comment-input"));
    box.rows = 2;
    box.maxLength = COMMENT_MAX;
    box.placeholder = `add to the idea, or raise a problem (${COMMENTS_MAX - mine} left)`;
    box.value = drafts.get(t.id) ?? "";
    box.addEventListener("input", () => drafts.set(t.id, box.value));
    const send = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ POST ]"));
    send.type = "submit";
    form.append(box, send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendComment(t, box);
    });
    body.append(form);
  }
  fold.append(body);
  return fold;
}

/** Take down your own ticket: the first click arms, the second deletes. @param {any} t */
async function remove(t) {
  if (busy) return;
  if (armedDelete !== t.id) {
    armedDelete = t.id;
    clearTimeout(disarm);
    disarm = setTimeout(() => {
      armedDelete = 0;
      render();
    }, 4000);
    render();
    return;
  }
  armedDelete = 0;
  clearTimeout(disarm);
  busy = true;
  try {
    await api.deleteTicket(t.id);
    tickets = tickets.filter((x) => x.id !== t.id);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    loadTickets(true);
  } finally {
    busy = false;
    render();
  }
}

/** +1s minus downvotes (ticket #274). @param {any} t */
const score = (t) => (t.votes ?? 0) - (t.downs ?? 0);
const ordered = () => [...tickets].filter(matches).sort((a, b) => (sort === "top"
  ? score(b) - score(a) || Number(b.status === "in_progress") - Number(a.status === "in_progress") || b.id - a.id
  : Number(b.status === "in_progress") - Number(a.status === "in_progress") || b.id - a.id));

/** +1 or -1 a ticket; the same button again takes your vote back. @param {any} t @param {1 | -1} way */
async function vote(t, way) {
  if (voting) return;
  voting = true;
  try {
    const res = await api.voteTicket(t.id, t.my_vote === way ? 0 : way);
    replaceTicket(res.ticket);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    if (/** @type {api.ApiError} */ (e).code === "TICKET_CLOSED") loadTickets(true);
  } finally {
    voting = false;
    render();
  }
}

function build() {
  const root = el("div", "tickets");
  const form = /** @type {HTMLFormElement} */ (el("form", "ticket-form"));
  form.hidden = true;
  const kinds = el("div", "ticket-kinds");
  kinds.setAttribute("role", "group");
  kinds.setAttribute("aria-label", "ticket type");
  const title = /** @type {HTMLInputElement} */ (el("input", "designer-input"));
  title.maxLength = TITLE_MAX;
  title.setAttribute("aria-label", "ticket title");
  const body = /** @type {HTMLTextAreaElement} */ (el("textarea", "designer-input ticket-body"));
  body.maxLength = BODY_MAX;
  body.rows = 10;
  body.setAttribute("aria-label", "ticket details");
  const count = el("span", "dim ticket-count");
  const send = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SUBMIT ]"));
  send.type = "submit";
  const cancel = /** @type {HTMLButtonElement} */ (el("button", "inline-btn ticket-cancel", "[ CANCEL ]"));
  cancel.type = "button";
  const row = el("div", "ticket-form-row");
  row.append(send, cancel, count);
  form.append(kinds, title, body, row);

  const open = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ + NEW TICKET ]"));
  open.addEventListener("click", () => {
    form.hidden = false;
    open.hidden = true;
    paintKinds();
    /** @type {HTMLElement | null} */ (kinds.querySelector("button"))?.focus();
  });
  cancel.addEventListener("click", () => {
    form.hidden = true;
    open.hidden = false;
  });
  const counter = () => {
    count.textContent = `${body.value.length}/${BODY_MAX}`;
  };
  body.addEventListener("input", counter);
  counter();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  const filters = el("div", "ticket-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "filter tickets");
  const search = /** @type {HTMLInputElement} */ (el("input", "designer-input ticket-search"));
  search.type = "search";
  search.placeholder = "search tickets (words or #number)";
  search.maxLength = 60;
  search.setAttribute("aria-label", "search tickets");
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    only = 0;
    shown = PAGE;
    render();
  });
  const list = el("div", "ticket-list");
  root.append(
    el("div", "panel-h", "TICKETS"),
    el("div", "dim bag-note", "> found a bug or have an idea? search first: someone may have filed it. everyone can see the queue and what's being worked on."),
    open, form, filters, search, list,
  );
  ui = { root, form, kinds, title, body, count, send, open, filters, search, list };
  // Left the comment box (posted, or tapped elsewhere): do the redraw that waited.
  list.addEventListener("focusout", () => setTimeout(() => {
    if (redrawWaiting && !typingComment() && visible()) render();
  }, 0));
  paintKinds();
}

/** The form's [ ISSUE ] [ FEATURE ] choice (nothing picked until clicked). */
function paintKinds() {
  if (!ui) return;
  const buttons = Object.entries(KIND_LABEL).map(([id, label]) => {
    const on = draftKind === id;
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn ticket-kind-pick tk-${id}`,
      on ? `[x ${label} ]` : `[ ${label} ]`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => {
      draftKind = id;
      paintKinds();
      ui?.title.focus();
    });
    return b;
  });
  ui.kinds.replaceChildren(el("span", "dim", "TYPE "), ...buttons,
    el("span", "dim ticket-kind-hint", draftKind === "feature" ? " something new" : draftKind ? " something broken" : ""));
  const [titleHint, bodyHint] = PLACEHOLDER[/** @type {keyof typeof PLACEHOLDER} */ (draftKind)];
  ui.title.placeholder = titleHint;
  ui.body.placeholder = bodyHint;
}

async function submit() {
  if (!ui || busy) return;
  if (!draftKind) {
    showError("Is it an ISSUE (something broken) or a FEATURE (an idea)? Pick one.");
    return;
  }
  const title = ui.title.value.trim();
  if (title.length < 4) {
    showError("Give it a title (4+ characters).");
    ui.title.focus();
    return;
  }
  busy = true;
  ui.send.disabled = true;
  try {
    const res = await api.submitTicket(title, ui.body.value, draftKind);
    tickets = [res.ticket, ...tickets.filter((t) => t.id !== res.ticket.id)];
    ui.form.reset();
    ui.count.textContent = `0/${BODY_MAX}`;
    ui.form.hidden = true;
    ui.open.hidden = false;
    if (kindFilter !== "all" && kindFilter !== draftKind) setKindFilter("all");
    draftKind = "";
    paintKinds();
    if (filter !== "all" && filter !== "mine" && filter !== "new") setFilter("all");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    ui.send.disabled = false;
    render();
  }
}

/** @param {string} id */
function setFilter(id) {
  filter = id;
  shown = PAGE;
  try {
    localStorage.setItem(FILTER_KEY, id);
  } catch {
    /* ignore */
  }
  render();
}

/** @param {string} id */
function setKindFilter(id) {
  kindFilter = id;
  shown = PAGE;
  try {
    localStorage.setItem(KIND_KEY, id);
  } catch {
    /* ignore */
  }
  render();
}

function paintFilters() {
  if (!ui) return;
  const types = el("div", "ticket-type-filters");
  for (const [id, label] of KINDS) {
    const n = tickets.filter((t) => kindIs(t, id)).length;
    const on = kindFilter === id;
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn ticket-filter tk-${id}`,
      on ? `[x ${label} ${fmt(n)} ]` : `[ ${label} ${fmt(n)} ]`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => setKindFilter(id));
    types.append(b);
  }
  const buttons = FILTERS.map(([id, label]) => {
    const n = tickets.filter((t) => kindIs(t, kindFilter) && statusIs(t, id)).length;
    if (id === "mine" && !n) return null; // nothing filed yet: no MINE button
    const on = filter === id;
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn ticket-filter tf-${id}`,
      on ? `[x ${label} ${fmt(n)} ]` : `[ ${label} ${fmt(n)} ]`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => setFilter(id));
    return b;
  }).filter((b) => b !== null);
  const sorts = el("span", "ticket-sorts");
  sorts.append(el("span", "dim", "SORT "));
  for (const [id, label] of /** @type {const} */ ([["top", "TOP VOTED"], ["new", "NEWEST"]])) {
    const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn ticket-filter ticket-sort",
      sort === id ? `[x ${label} ]` : `[ ${label} ]`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(sort === id));
    b.addEventListener("click", () => {
      sort = id;
      try {
        localStorage.setItem(SORT_KEY, id);
      } catch {
        /* ignore */
      }
      render();
    });
    sorts.append(b);
  }
  ui.filters.replaceChildren(types, ...buttons, sorts);
}

/** @param {any} t */
function card(t) {
  const c = el("div", `ticket ticket-${t.status}${t.mine ? " ticket-mine" : ""}`);
  const head = el("div", "ticket-head");
  const meta = el("span", "ticket-meta");
  meta.append(el("span", "ticket-id", `#${t.id}`), " ", el("span", "ticket-by", t.name),
    el("span", "dim", ` · ${ago(now() - t.created_at)} ago`));
  if (t.mine) meta.append(el("span", "ticket-you", " < you"));
  const tags = el("span", "ticket-tags");
  const kind = t.kind ?? "issue";
  tags.append(el("span", `ticket-kind tk-${kind}`, `[ ${KIND_LABEL[kind] ?? kind} ]`), " ",
    el("span", `ticket-status st-${t.status}`, `[ ${STATUS_LABEL[t.status] ?? t.status} ]`));
  head.append(meta, tags);
  c.append(head, el("div", "ticket-title", t.title));
  if (t.body) c.append(el("div", "ticket-text", t.body));
  c.append(voteRow(t), commentsFold(t));
  if (t.note) {
    const note = el("div", "ticket-note");
    note.append(adminTag(), " ", el("span", "", t.note));
    c.append(note);
  }
  if (t.status !== "new" && t.updated_at - t.created_at > 1) {
    c.append(el("div", "dim ticket-updated", `updated ${ago(now() - t.updated_at)} ago`));
  }
  return c;
}

/** Like the polls: a bar against the most-wanted ticket, the count, and +1.
 * @param {any} t */
function voteRow(t) {
  const most = Math.max(1, ...tickets.map((x) => x.votes ?? 0));
  const row = el("div", "ticket-votes");
  row.append(el("span", "ticket-vote-bar", bar((t.votes ?? 0) / most, 12)),
    el("span", "ticket-vote-n", ` ${fmt(t.votes ?? 0)} `), el("span", "dim", t.votes === 1 ? "vote " : "votes "));
  if (t.downs) row.append(el("span", "ticket-vote-down", `-${fmt(t.downs)} `));
  const open = t.status === "new" || t.status === "in_progress";
  if (t.mine) {
    row.append(el("span", "dim ticket-vote-hint", "your ticket"));
    const armed = armedDelete === t.id;
    const del = /** @type {HTMLButtonElement} */ (el("button", `inline-btn ticket-delete${armed ? " armed" : ""}`,
      armed ? "[ SURE? DELETE ]" : "[ DELETE ]"));
    del.type = "button";
    del.disabled = busy;
    del.title = "take this ticket down";
    del.addEventListener("click", () => remove(t));
    row.append(del);
  }
  else if (!open) row.append(el("span", "dim ticket-vote-hint", "voting closed"));
  else if (state.me?.id) {
    /** @param {1 | -1} way @param {string} label @param {string} hint */
    const btn = (way, label, hint) => {
      const on = t.my_vote === way;
      const b = /** @type {HTMLButtonElement} */ (el("button",
        `inline-btn ticket-vote${way < 0 ? " down" : ""}${on ? " voted" : ""}`, on ? `[x ${label} ]` : `[ ${label} ]`));
      b.type = "button";
      b.disabled = voting;
      b.setAttribute("aria-pressed", String(on));
      b.title = on ? "take your vote back" : hint;
      b.addEventListener("click", () => vote(t, way));
      return b;
    };
    row.append(btn(1, "+1", "I want this too"), " ", btn(-1, "-1", "I don't want this"));
    if (t.my_vote) row.append(el("span", "ticket-you", " < you"));
  }
  return row;
}

/** Typing a comment: is the caret in one of the list's comment boxes? */
const typingComment = () => Boolean(ui && document.activeElement?.matches(".ticket-comment-input")
  && ui.list.contains(document.activeElement));
/** A redraw skipped while typing a comment (ticket #132): done once you leave the box. */
let redrawWaiting = false;

function render() {
  const host = $("panel-tickets");
  if (!ui) build();
  if (!ui) return;
  if (ui.root.parentElement !== host) host.replaceChildren(ui.root);
  // Ticket #132: a redraw (an attack recharging sends "me", a refetch...) would
  // rebuild the comment box and take the keyboard away mid-sentence. Wait.
  if (typingComment()) {
    redrawWaiting = true;
    return;
  }
  redrawWaiting = false;
  const named = Boolean(state.me?.name_chosen);
  ui.open.disabled = !named;
  ui.open.title = named ? "" : "make your account first (hit [ ATTACK ])";
  paintFilters();
  const rows = ordered();
  const parts = rows.slice(0, shown).map(card);
  if (!loadedAt) parts.push(el("div", "dim bag-note", "> loading..."));
  else if (!rows.length) {
    parts.push(el("div", "dim bag-note", query || only ? "> no tickets match that search."
      : filter === "all" && kindFilter === "all" ? "> no tickets yet. be the first." : "> nothing here."));
  }
  if (rows.length > shown) {
    const more = /** @type {HTMLButtonElement} */ (el("button", "inline-btn ticket-more",
      `[ SHOW MORE (${fmt(rows.length - shown)}) ]`));
    more.type = "button";
    more.addEventListener("click", () => {
      shown += PAGE;
      render();
    });
    parts.push(more);
  }
  ui.list.replaceChildren(...parts);
  startTicker();
}

/** While the tab is open, pick up status changes every 30 s. */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!visible() || document.visibilityState !== "visible") return;
    if (document.activeElement?.closest(".ticket-comments")) return; // typing a comment: don't redraw under it
    if (Date.now() - loadedAt > 30000) loadTickets(true);
  }, 5000);
}
