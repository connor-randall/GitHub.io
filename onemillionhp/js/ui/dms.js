// [ MESSAGES ] in the FEED menu (server/omhp/dms.py): private messages between
// two players. The list of conversations (newest first, unread counts), one
// thread at a time, and [ NEW MESSAGE ] by name. A player's gear card has
// [ MESSAGE ] too (openDm). New messages arrive over the live socket (type "dm");
// the unread count is in the tab label ("[ MESSAGES 2 ]"), which tabs.js adds
// up on the FEED menu. [ BLOCK ] stops someone messaging you. The newest 200
// between two players are kept; [ load older ] pages back through them.

import * as api from "../api.js?v=b6664395f3";
import { ago, el } from "../ascii.js?v=b6664395f3";
import { emit, now, on, state } from "../store.js?v=b6664395f3";
import { withEmotes } from "../emotes.js?v=b6664395f3";
import { badgeTag, nameStar, withBadges } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showGear } from "./gear.js?v=b6664395f3";
import { emoteButton } from "./chat.js?v=b6664395f3";
import { animateInView } from "./inview.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const visible = () => !$("panel-dms").hidden;
const tab = () => /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-tab="dms"]'));

/** @type {any} conversations + blocked */
let list = null;
/** @type {any} the open thread, or null */
let thread = null;
/** The player id of the open thread (set before it loads). @type {string | null} */
let openId = null;
let composing = false;
let sending = false;
let draft = "";

/** "[ MESSAGES ]" / "[ MESSAGES 2 ]". */
function paintTab() {
  const t = tab();
  if (!t) return;
  const n = state.me?.dm_unread ?? 0;
  const text = n ? `[ MESSAGES ${n} ]` : "[ MESSAGES ]";
  if (t.textContent !== text) t.textContent = text;
}
on("me", paintTab);
// Named or not decides what the tab shows: redraw when that changes (not on
// every "me", which would wipe what you're typing).
let wasNamed = false;
on("me", () => {
  const named = Boolean(state.me?.name_chosen);
  if (named === wasNamed) return;
  wasNamed = named;
  if (visible()) loadDms();
});

/** @param {number} n */
function setUnread(n) {
  if (!state.me || state.me.dm_unread === n) return;
  state.me.dm_unread = n;
  paintTab();
}

/** The tab was opened (or redrawn): the open thread, else the list. */
export async function loadDms() {
  if (visible()) render();
  try {
    if (openId) {
      thread = await api.getDmThread(openId);
      openId = thread.player_id;
      setUnread(thread.unread);
    } else {
      list = await api.getDms();
      setUnread(list.unread);
    }
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
    if (openId && !thread) openId = null;
  }
  if (visible()) render();
}

/** Open the MESSAGES tab on a thread with this player (from their gear card). @param {string} playerId */
export function openDm(playerId) {
  openId = playerId;
  thread = null;
  composing = false;
  if (!visible()) tab()?.click();
  else loadDms();
}

function back() {
  openId = null;
  thread = null;
  composing = false;
  loadDms();
}

/** @param {string} title */
function heading(title) {
  const h = el("div", "panel-h", `${title} `);
  h.append(el("b", "", "-".repeat(Math.max(4, 30 - title.length))));
  return h;
}

function render() {
  const host = $("panel-dms");
  if (!state.me?.name_chosen) {
    host.replaceChildren(heading("MESSAGES"), el("div", "dim bag-note", "> make your account first (hit [ ATTACK ]) to send messages."));
    return;
  }
  if (openId) host.replaceChildren(...threadView());
  else host.replaceChildren(...listView());
}

/** The message box. @param {(text: string) => Promise<void>} sendFn @param {string} placeholder */
function form(sendFn, placeholder) {
  const f = /** @type {HTMLFormElement} */ (el("form", "chat-form dm-form"));
  f.autocomplete = "off";
  const input = /** @type {HTMLInputElement} */ (el("input", "dm-input"));
  input.maxLength = 200;
  input.placeholder = placeholder;
  input.value = draft;
  input.setAttribute("aria-label", "message");
  input.enterKeyHint = "send";
  input.addEventListener("input", () => (draft = input.value));
  const go = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SEND ]"));
  f.append(el("span", "chat-prompt", ">"), input, emoteButton(input), go);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    try {
      await sendFn(text);
      draft = "";
      input.value = "";
    } catch (err) {
      showError(/** @type {Error} */ (err).message);
    } finally {
      sending = false;
      input.focus();
    }
  });
  setTimeout(() => input.focus({ preventScroll: true }), 0);
  return f;
}

function listView() {
  const parts = [heading("MESSAGES")];
  const add = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", composing ? "[ CLOSE ]" : "[ NEW MESSAGE ]"));
  add.type = "button";
  add.addEventListener("click", () => {
    composing = !composing;
    render();
  });
  parts.push(add);
  if (composing) {
    const to = /** @type {HTMLInputElement} */ (el("input", "dm-to"));
    to.maxLength = 17;
    to.placeholder = "player name";
    to.setAttribute("aria-label", "send to");
    const toRow = el("div", "chat-form dm-to-row");
    toRow.append(el("span", "chat-prompt", "TO:"), to);
    const box = el("div", "dm-new");
    box.append(toRow, form(async (text) => {
      const { message } = await api.sendDm(to.value.trim(), text);
      composing = false;
      openDm(message.to_id);
    }, "your message"));
    parts.push(box);
    setTimeout(() => to.focus(), 0);
  }
  if (!list) {
    parts.push(el("div", "dim bag-note", "> loading..."));
    return parts;
  }
  if (!list.conversations.length) parts.push(el("div", "dim bag-note", "> no messages yet. [ MESSAGE ] is on everyone's gear card too."));
  const ul = el("ul", "dm-list");
  for (const c of list.conversations) {
    const li = el("li", c.unread ? "dm-unread" : "");
    const open = /** @type {HTMLButtonElement} */ (el("button", "dm-row"));
    open.type = "button";
    const mine = c.last.from_id === state.me?.id;
    const tag = badgeTag(c.badges, null);
    if (tag) open.append(tag, " ");
    open.append(...nameStar(c.badges), el("b", "", c.name), ...nameStar(c.badges), el("span", "dim", ` ${ago(now() - c.last.t)}`),
      ...(c.unread ? [el("span", "dm-new-count", ` (${c.unread} new)`)] : []),
      el("div", "dm-last dim", `${mine ? "you: " : ""}${c.last.text}`));
    open.addEventListener("click", () => openDm(c.player_id));
    li.append(open);
    ul.append(li);
  }
  parts.push(ul);
  if (list.blocked.length) {
    const bar = el("div", "dim dm-blocked", "BLOCKED:");
    for (const b of list.blocked) {
      const un = /** @type {HTMLButtonElement} */ (el("button", "btn-text", ` ${b.name} [x]`));
      un.type = "button";
      un.title = `unblock ${b.name}: they can message you again`;
      un.addEventListener("click", async () => {
        await api.blockDm(b.player_id, false).catch((e) => showError(e.message));
        loadDms();
      });
      bar.append(un);
    }
    parts.push(bar);
  }
  return parts;
}

function threadView() {
  const top = el("div", "dm-top");
  const backBtn = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ < BACK ]"));
  backBtn.type = "button";
  backBtn.addEventListener("click", back);
  top.append(backBtn, " ");
  if (!thread) return [top, el("div", "dim bag-note", "> loading...")];
  const who = /** @type {HTMLButtonElement} */ (el("button", "who who-gear", thread.name));
  who.type = "button";
  who.title = `see what ${thread.name} is wearing`;
  who.addEventListener("click", () => showGear(thread.player_id));
  top.append(withBadges(thread.badges, thread.player_id, who), " ");
  const block = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", thread.blocked ? "[ UNBLOCK ]" : "[ BLOCK ]"));
  block.type = "button";
  block.title = thread.blocked ? "let them message you again" : "stop them messaging you (they aren't told)";
  block.addEventListener("click", async () => {
    try {
      const r = await api.blockDm(thread.player_id, !thread.blocked);
      thread.blocked = r.blocked;
      render();
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
    }
  });
  top.append(block);
  const ol = el("ol", "chat-list dm-thread");
  if (thread.more) ol.append(olderButton(ol));
  if (!thread.messages.length) ol.append(el("li", "dim chat-empty", `> say hi to ${thread.name}.`));
  for (const m of thread.messages) ol.append(line(m));
  setTimeout(() => (ol.scrollTop = ol.scrollHeight), 0);
  animateInView(ol); // emotes and animated badges move on the lines you can see
  const f = form(async (text) => {
    const { message } = await api.sendDm(thread.player_id, text);
    addToThread(message);
  }, `message ${thread.name}`);
  return [top, ol, f];
}

/** [ load older ]: the page before the oldest shown, kept in place. @param {HTMLElement} ol */
function olderButton(ol) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-older", "[ load older ]"));
  b.type = "button";
  b.addEventListener("click", async () => {
    if (!thread?.messages.length) return;
    try {
      const t = await api.getDmThread(thread.player_id, thread.messages[0].id);
      const fromBottom = ol.scrollHeight - ol.scrollTop;
      thread.messages = [...t.messages, ...thread.messages];
      thread.more = t.more;
      b.remove();
      ol.prepend(...(t.more ? [olderButton(ol)] : []), ...t.messages.map(line));
      ol.scrollTop = ol.scrollHeight - fromBottom;
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
    }
  });
  return b;
}

/** @param {any} m */
function line(m) {
  const mine = m.from_id === state.me?.id;
  const li = el("li", mine ? "me" : "");
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(el("span", "who", mine ? (state.me?.name ?? "YOU") : thread.name), ": ", ...withEmotes(m.text));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** @param {any} m */
function addToThread(m) {
  if (!thread || thread.messages.some((/** @type {any} */ x) => x.id === m.id)) return;
  thread.messages.push(m);
  if (!visible()) return;
  const ol = $("panel-dms").querySelector(".dm-thread");
  if (!ol) return;
  ol.querySelector(".chat-empty")?.remove();
  ol.append(line(m));
  ol.scrollTop = ol.scrollHeight;
}

/** A message over the socket (to you, or one you sent from another tab). @param {any} m */
export function dmMessage(m) {
  if (!m || !state.me) return;
  const other = m.from_id === state.me.id ? m.to_id : m.from_id;
  const incoming = m.to_id === state.me.id;
  if (thread && thread.player_id === other) {
    addToThread(m);
    // Reading it right now: mark it read (the fetch does that).
    if (incoming && visible()) api.getDmThread(other).then((t) => setUnread(t.unread)).catch(() => {});
    else if (incoming) setUnread((state.me.dm_unread ?? 0) + 1);
  } else if (incoming) {
    setUnread((state.me.dm_unread ?? 0) + 1);
    if (visible() && !openId) loadDms();
  }
  if (incoming) emit("dm");
}
