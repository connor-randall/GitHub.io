// [ CHAT ] in the FEED menu (server/omhp/chat.py). Named players talk; the server
// censors words the same way it does names, and keeps only the newest 300
// messages. New messages arrive over the live socket (type "chat"); the
// snapshot carries the newest 60 and [ load older ] fetches the rest.
// [ITEM NAME] in a message is a link to that item's card, for items the
// sender owns (the server lists them in the message's ``items``). Typing "["
// opens a picker of your own items, and their cards have [ SHOW IN CHAT ].
// Players you muted (mute.js, from their gear card) don't show; the line under
// the chat lists them, to unmute. (meow) and friends are animated emotes
// (emotes.js); the [ (:) ] button by SEND lists them.
// @NAME names a player (the server checks it and lists them in ``mentions``):
// highlighted, and a line naming you is marked and puts "@" on the CHAT tab.
// Typing "@" opens a picker of names (recent chatters and who's online).
// [JOIN CLAN] from a clan member is a button: the clan's card, with [ JOIN ] (clancard.js).
// Typing "[" in a clan offers it first in the picker.

import { RARITY_STYLE, ago, el } from "../ascii.js?v=b6664395f3";
import * as api from "../api.js?v=b6664395f3";
import { now, on, rarityById, refinedCopy, state } from "../store.js?v=b6664395f3";
import { clanIn, crownStar, withBadges } from "./badges.js?v=b6664395f3";
import { JOIN_TAG, openClanCard } from "./clancard.js?v=b6664395f3";
import { showGear } from "./gear.js?v=b6664395f3";
import { itemDetail } from "./bag.js?v=b6664395f3";
import { canReport, reportButton } from "./report.js?v=b6664395f3";
import { isMuted, mutedPlayers, setMuted } from "../mute.js?v=b6664395f3";
import { EMOTES, EMOTE_GROUPS, emoteNode, withEmotes } from "../emotes.js?v=b6664395f3";
import { hofCard } from "./hof.js?v=b6664395f3";

const KEEP = 300;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any[]} oldest first */
let messages = [];
let loadedAll = false;
let mode = "live";
let sending = false;

const list = () => $("chat-list");
/** Reading older messages: don't yank the list down when a new one lands. */
const atBottom = () => list().scrollHeight - list().scrollTop - list().clientHeight < 30;

/** A muted player's own message (system lines about them, like a crown or a
 * ban, still show). @param {any} m */
const hidden = (m) => !m.kind && isMuted(m.player_id);

/** @param {any} m */
function row(m) {
  if (m.kind === "first_blood") return firstBlood(m);
  if (m.kind === "crown" || m.kind === "crown_won") return crownLine(m);
  if (m.kind === "forge") return forgeLine(m);
  if (m.kind === "ban") return banLine(m);
  if (m.kind === "clan") return clanLine(m);
  if (m.kind === "meow") return meowLine(m);
  if (m.kind === "hof") return hofLine(m);
  const li = el("li", `${m.player_id === state.me?.id ? "me" : ""}${mentionsMe(m) ? " mention-me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const who = withBadges(m.badges, m.player_id, whoName(m));
  const text = el("span", "chat-text");
  const side = teamOf(m.player_id);
  if (side) text.append(el("span", `team-tag ${side}`, `[${side.toUpperCase()}] `));
  text.append(who, document.createTextNode(": "),
    chatText(m.text, m.items ?? [], (m.mentions ?? []).length > 0, m.refined ?? {}, clanIn(m.badges)));
  li.append(t, text);
  if (canReport(m.player_id)) {
    li.append(reportButton({ player_id: m.player_id, name: m.name, chat_id: m.id, text: m.text }, "[!]"));
  }
  li.dataset.id = String(m.id);
  return li;
}

// ------------------------------------------------------------- item tags

const TAG = /\[([^[\]]{1,40})\]/g;
/** @type {{content: any, byName: Map<string, any>} | null} */
let names = null;

/** Upper-case item name -> item. @param {string} name */
function itemByName(name) {
  const content = state.content;
  if (!content) return null;
  if (!names || names.content !== content) {
    names = { content, byName: new Map(content.items.map((/** @type {any} */ i) => [i.name.toUpperCase(), i])) };
  }
  return names.byName.get(name.trim().replace(/\s+/g, " ").toUpperCase()) ?? null;
}

/** "[$$ GODLY $$]"-style label for an item's rarity. @param {any} item */
function rarityTag(item) {
  const st = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  return `${st.deco[0]}${rarityById(item.rarity)?.label ?? item.rarity.toUpperCase()}${st.deco[1]}`;
}

/** A chat "ticket #N" / "poll #N" link was clicked: {detail: {tab, id}}. */
export const OPEN_TOWN = "omhp:open-town";

/** Does this message @name you? @param {any} m */
const mentionsMe = (m) => Boolean(state.me?.id && (m.mentions ?? []).includes(state.me.id));

const MENTION = /@[A-Z0-9_]{3,16}\b/g;
const TOWN_LINK = /\b(ticket|poll)\s?#(\d{1,6})\b/gi;

/** Ticket #326: "ticket #12" / "poll #3" open that ticket or poll (main.js
 * listens for the event: it owns the tabs). @param {string} text @returns {(string | Node)[]} */
function withLinks(text) {
  /** @type {(string | Node)[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TOWN_LINK)) {
    out.push(...withEmotes(text.slice(last, m.index)));
    const tab = m[1].toLowerCase() === "poll" ? "polls" : "tickets";
    const b = /** @type {HTMLButtonElement} */ (el("button", "chat-item chat-town-link", m[0]));
    b.type = "button";
    b.title = tab === "polls" ? "open this poll" : "open this ticket";
    b.addEventListener("click", () => document.dispatchEvent(
      new CustomEvent(OPEN_TOWN, { detail: { tab, id: Number(m[2]) } })));
    out.push(b);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...withEmotes(text.slice(last)));
  return out;
}

/** Text with emotes, ticket / poll links, and the server's @NAMEs highlighted (yours brighter).
 * @param {string} text @param {boolean} mentions */
function rich(text, mentions) {
  if (!mentions) return withLinks(text);
  /** @type {(string | Node)[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    out.push(...withLinks(text.slice(last, m.index)));
    const mine = m[0].slice(1) === state.me?.name;
    out.push(el("span", `chat-mention${mine ? " mine" : ""}`, m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...withLinks(text.slice(last)));
  return out;
}

/** Text with emotes and @NAMEs, no item links (CLAN CHAT). @param {string} text @param {boolean} mentions */
export const messageText = (text, mentions) => chatText(text, [], mentions);

/** A message's text, with the [ITEM] tags the server linked (``ids``, in
 * order) as links to the item's card. ``refined``: the sender's refined copies
 * (THE BLACKSMITH) as they were when sent: the link says "NAME [4]" and opens
 * that copy, REFINED box and all. ``clan``: the sender's clan when they said
 * it, which their [JOIN CLAN] opens.
 * @param {string} text @param {string[]} ids @param {boolean} [mentions] @param {Record<string, any>} [refined]
 * @param {string | null} [clan] */
function chatText(text, ids, mentions = false, refined = {}, clan = null) {
  const span = el("span", "");
  let last = 0;
  let next = 0;
  for (const m of text.matchAll(TAG)) {
    if (clan && JOIN_TAG.test(m[1])) {
      span.append(...rich(text.slice(last, m.index), mentions));
      const join = /** @type {HTMLButtonElement} */ (el("button", "chat-item chat-join-clan", "[JOIN CLAN]"));
      join.type = "button";
      join.title = "see their clan, and join it";
      join.addEventListener("click", () => openClanCard(clan));
      span.append(join);
      last = (m.index ?? 0) + m[0].length;
      continue;
    }
    const item = next < ids.length ? itemByName(m[1]) : null;
    if (!item || item.id !== ids[next]) continue;
    next += 1;
    span.append(...rich(text.slice(last, m.index), mentions));
    const copy = refinedCopy(item, refined[item.id]);
    const link = /** @type {HTMLButtonElement} */ (el("button", `chat-item r-${item.rarity}`, `[${copy.name}]`));
    link.type = "button";
    link.title = `${rarityTag(item)} ${item.slot.toUpperCase()}${copy === item ? "" : " (refined)"}: click to see it`;
    link.addEventListener("click", () => itemDetail(copy, copy !== item));
    span.append(link);
    last = (m.index ?? 0) + m[0].length;
  }
  span.append(...rich(text.slice(last), mentions));
  return span;
}

// ------------------------------------------------------------- emote picker

const EMOTE_GROUP_KEY = "omhp.emote.group";

/** The [ (:) ] list: every emote, moving, click one to put it in the box. @param {HTMLInputElement} input
 * @param {HTMLElement} button */
function toggleEmotes(input, button) {
  const form = /** @type {HTMLElement} */ (input.form);
  const open = form.querySelector(".emote-pick");
  if (open) {
    open.remove();
    button.setAttribute("aria-expanded", "false");
    return;
  }
  const box = el("div", "emote-pick");
  // [SHOW: ALL ▾]: ALL / ANIMALS / FACES / PEOPLE / THINGS, built like the auction house's
  // menus (remembered in this browser).
  let group = "";
  try {
    group = localStorage.getItem(EMOTE_GROUP_KEY) ?? "";
  } catch {
    /* private mode: ALL */
  }
  /** @type {[string, string][]} */
  const groups = [["", "ALL"], ...EMOTE_GROUPS.map(([id, label]) => /** @type {[string, string]} */ ([id, label]))];
  if (!groups.some(([id]) => id === group)) group = "";
  const dd = el("div", "auc-dd emote-dd");
  const ddBtn = el("button", "auc-dd-btn");
  ddBtn.setAttribute("type", "button");
  ddBtn.setAttribute("aria-haspopup", "true");
  const ddMenu = el("div", "auc-dd-menu");
  ddMenu.setAttribute("role", "menu");
  /** @param {boolean} open */
  const paintDd = (open) => {
    ddBtn.textContent = `[SHOW: ${groups.find(([id]) => id === group)?.[1] ?? "ALL"} \u25BE]`;
    ddBtn.classList.toggle("on", Boolean(group));
    ddBtn.setAttribute("aria-expanded", String(open));
    ddMenu.hidden = !open;
    for (const o of ddMenu.children) o.setAttribute("aria-checked", String(/** @type {HTMLElement} */ (o).dataset.group === group));
  };
  for (const [id, label] of groups) {
    const o = el("button", "", `[ ${label} ]`);
    o.setAttribute("type", "button");
    o.setAttribute("role", "menuitemradio");
    o.dataset.group = id;
    o.addEventListener("click", () => {
      group = id;
      try {
        localStorage.setItem(EMOTE_GROUP_KEY, id);
      } catch {
        /* just for now */
      }
      paintDd(false);
      fill();
    });
    ddMenu.append(o);
  }
  ddBtn.addEventListener("click", () => paintDd(ddMenu.hidden));
  dd.append(ddBtn, ddMenu);
  const list = el("div", "emote-list");
  const fill = () => {
    list.replaceChildren(...Object.keys(EMOTES).filter((n) => !group || EMOTES[n].group === group).map(option));
  };
  /** One emote to click. @param {string} name */
  const option = (name) => {
    const b = /** @type {HTMLButtonElement} */ (el("button", "emote-opt"));
    b.type = "button";
    b.title = EMOTES[name].hint;
    b.append(emoteNode(name), el("span", "dim", ` (${name})`));
    b.addEventListener("click", () => {
      const tag = `(${name}) `;
      if (input.value.length + tag.length + 1 > input.maxLength) return;
      const pad = input.value && !input.value.endsWith(" ") ? " " : "";
      input.value = `${input.value}${pad}${tag}`;
      box.remove();
      button.setAttribute("aria-expanded", "false");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return b;
  };
  paintDd(false);
  fill();
  box.append(dd, list);
  form.append(box);
  button.setAttribute("aria-expanded", "true");
}

/** The [ (:) ] button for a message box (CHAT, CLAN CHAT, MESSAGES): opens the
 * emote list over the box's form; a tap anywhere else closes it.
 * @param {HTMLInputElement} input (inside its form already, or once the button is added) */
export function emoteButton(input) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-emote-btn", "[ (:) ]"));
  b.type = "button";
  b.title = "emotes: type (meow), (wave), (gg)... or pick one";
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => toggleEmotes(input, b));
  const close = (/** @type {PointerEvent} */ e) => {
    const form = input.form;
    if (!form?.isConnected) return document.removeEventListener("pointerdown", close);
    if (!form.contains(/** @type {Node} */ (e.target))) form.querySelector(".emote-pick")?.remove();
  };
  document.addEventListener("pointerdown", close);
  return b;
}

/** Put "[ITEM NAME] " into the chat box and open the chat. @param {any} item */
export function shareInChat(item) {
  if (!state.me?.name_chosen) return;
  const panel = $("panel-chat");
  if (panel.hidden) /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-tab="chat"]'))?.click();
  const input = /** @type {HTMLInputElement} */ ($("chat-input"));
  const tag = `[${item.name}] `;
  const room = input.maxLength - input.value.length;
  if (tag.length > room) return;
  const pad = input.value && !input.value.endsWith(" ") ? " " : "";
  input.value = `${input.value}${pad}${tag}`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// The "[" picker: items whose names match what's typed after it, your own first.

/** @type {{list: HTMLElement, items: any[], at: number, start: number} | null} */
let picker = null;

/** @param {HTMLInputElement} input */
function pickerQuery(input) {
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const at = before.match(/(?:^|\s)@([A-Za-z0-9_]{0,16})$/);
  if (at) return { kind: "name", query: at[1].toUpperCase(), start: caret - at[1].length - 1, caret };
  const m = before.match(/\[([^[\]]{0,40})$/);
  return m ? { kind: "item", query: m[1].trimStart().toUpperCase(), start: caret - m[0].length, caret } : null;
}

/** Who's online, for the @ picker (fetched at most once a minute). @type {{at: number, names: string[]}} */
const online = { at: 0, names: [] };
function loadOnline() {
  if (Date.now() - online.at < 60000) return;
  online.at = Date.now();
  api.getOnline().then((r) => {
    online.names = (r.players ?? []).map((/** @type {any} */ p) => p.name);
  }).catch(() => {});
}

/** Names for "@que": recent chatters first, then who's online. @param {string} query */
function nameHits(query) {
  loadOnline();
  const seen = new Set([state.me?.name]);
  /** @type {string[]} */
  const names = [];
  for (const n of [...messages].reverse().filter((m) => !m.kind).map((m) => m.name).concat(online.names)) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names.filter((n) => n.includes(query))
    .sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)))
    .slice(0, 8).map((name) => ({ kind: "name", name }));
}

const JOIN_LABEL = "JOIN CLAN";

/** @param {HTMLInputElement} input */
function updatePicker(input) {
  const q = pickerQuery(input);
  const content = state.content;
  if (!q || !content) return closePicker();
  if (q.kind === "name") {
    const people = nameHits(q.query);
    if (!people.length) return closePicker();
    return openPicker(input, people, q.start);
  }
  // Only your own items: the picker never lists (or hints at) anything you haven't found.
  const owned = new Set((state.me?.inventory ?? []).map((/** @type {any} */ i) => i.item_id));
  const rank = (/** @type {any} */ i) => rarityById(i.rarity)?.rank ?? 0;
  const hits = content.items
    .filter((/** @type {any} */ i) => owned.has(i.id) && i.name.toUpperCase().includes(q.query))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      Number(b.name.toUpperCase().startsWith(q.query)) - Number(a.name.toUpperCase().startsWith(q.query))
      || rank(b) - rank(a) || a.name.localeCompare(b.name))
    .slice(0, 8);
  // In a clan: [JOIN CLAN] too, first in the list (it makes a join button, clancard.js).
  if (clanIn(state.me?.badges) && JOIN_LABEL.includes(q.query)) hits.unshift({ kind: "join", name: JOIN_LABEL });
  if (!hits.length) return closePicker();
  openPicker(input, hits.slice(0, 8), q.start);
}

/** @param {HTMLInputElement} input @param {any[]} hits @param {number} start */
function openPicker(input, hits, start) {
  const list = picker?.list ?? el("ul", "chat-picker");
  list.setAttribute("role", "listbox");
  if (!picker) $("chat-form").append(list);
  picker = { list, items: hits, at: Math.min(picker?.at ?? 0, hits.length - 1), start };
  paintPicker(input);
}

/** @param {HTMLInputElement} input */
function paintPicker(input) {
  if (!picker) return;
  const p = picker;
  p.list.replaceChildren(...p.items.map((item, i) => {
    const li = el("li", `chat-pick${i === p.at ? " on" : ""}`);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === p.at));
    if (item.kind === "name") li.append(el("span", "chat-mention", `@${item.name}`));
    else if (item.kind === "join") {
      li.append(el("span", "chat-join-clan", item.name), el("span", "dim chat-pick-meta", " invite people to your clan"));
    } else {
      li.append(el("span", `r-${item.rarity}`, item.name), el("span", "dim chat-pick-meta",
        ` ${rarityTag(item)} ${item.slot.toUpperCase()}`));
    }
    // mousedown, not click: the input keeps its focus (and its caret).
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      choose(input, item);
    });
    return li;
  }));
  p.list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}

/** Replace "[que" with "[ITEM NAME] ". @param {HTMLInputElement} input @param {any} item */
function choose(input, item) {
  const q = pickerQuery(input);
  if (!q) return closePicker();
  const tag = item.kind === "name" ? `@${item.name} ` : `[${item.name}] `;
  const before = input.value.slice(0, q.start);
  const after = input.value.slice(q.caret).replace(item.kind === "name" ? /^[A-Za-z0-9_]*\s?/ : /^\]?\s?/, "");
  const next = (before + tag + after).slice(0, input.maxLength);
  input.value = next;
  const at = Math.min(next.length, before.length + tag.length);
  input.setSelectionRange(at, at);
  closePicker();
  input.focus();
}

function closePicker() {
  picker?.list.remove();
  picker = null;
}

/** Arrow keys / Enter / Tab / Escape while the picker is open. @param {KeyboardEvent} e @param {HTMLInputElement} input */
function pickerKey(e, input) {
  if (!picker) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = picker.items.length;
    picker.at = (picker.at + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    paintPicker(input);
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    choose(input, picker.items[picker.at]);
  } else if (e.key === "Escape") {
    e.preventDefault();
    closePicker();
  }
}

/** The server's line when a boss takes its first hit, in red. @param {any} m */
function firstBlood(m) {
  const li = el("li", `chat-first-blood${m.player_id === state.me?.id ? " me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(el("span", "chat-fb-tag", "!! "), withBadges(m.badges, m.player_id, whoName(m)),
    document.createTextNode(` ${m.text}`), el("span", "chat-fb-tag", " !!"));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** The server saying someone forged a SOVEREIGN piece (forge.py), in gold. @param {any} m */
function forgeLine(m) {
  const li = el("li", `chat-forge${m.player_id === state.me?.id ? " me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(el("span", "chat-forge-tag", "$$ "), withBadges(m.badges, m.player_id, whoName(m)),
    el("span", "chat-forge-text", ` ${m.text}`), el("span", "chat-forge-tag", " $$"));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** The admin's HALL OF FAME card (ui/hof.js draws it; LEADERBOARD keeps them all). @param {any} m */
function hofLine(m) {
  /** @type {any} */
  let d;
  try {
    d = JSON.parse(m.text);
  } catch {
    return el("li", "chat-hof", "HALL OF FAME");
  }
  const li = el("li", "chat-hof");
  li.dataset.id = String(m.id);
  const card = hofCard(d);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  card.prepend(t);
  li.append(card);
  return li;
}

/** The admin switched MEOW MODE on or off: nobody's name, just the news. @param {any} m */
function meowLine(m) {
  const li = el("li", "chat-meow");
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text chat-meow-text");
  text.append(...withEmotes(m.text));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** Someone founded a clan: their new brackets lead the line. @param {any} m */
function clanLine(m) {
  const li = el("li", `chat-clan${m.player_id === state.me?.id ? " me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(el("span", "chat-clan-tag", ">> "), withBadges(m.badges, m.player_id, whoName(m)),
    el("span", "chat-clan-text", ` ${m.text}`));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** The admin banned someone by hand: everyone sees it in CHAT. @param {any} m */
function banLine(m) {
  const li = el("li", "chat-ban");
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(el("span", "chat-ban-tag", "!! "), withBadges(m.badges, m.player_id, whoName(m)),
    el("span", "chat-ban-text", ` ${m.text}`), el("span", "chat-ban-tag", " !!"));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** The server saying who took the CROWN, or who held it at midnight and
 * unlocked it (server/omhp/crown.py). The crown leads the line. @param {any} m */
function crownLine(m) {
  const li = el("li", `chat-crown${m.kind === "crown_won" ? " crown-won" : ""}${m.player_id === state.me?.id ? " me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const text = el("span", "chat-text");
  text.append(crownStar(), document.createTextNode(" "),
    withBadges(m.badges, m.player_id, whoName(m)), document.createTextNode(` ${m.text}`));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** A name in CHAT: click it to see what they're wearing (the attack feed's
 * names don't do this). @param {any} m */
function whoName(m) {
  if (!m.player_id) return el("span", "who", m.name);
  const b = /** @type {HTMLButtonElement} */ (el("button", "who who-gear", m.name));
  b.type = "button";
  b.title = `see what ${m.name} is wearing`;
  b.addEventListener("click", () => showGear(m.player_id));
  return b;
}

// ------------------------------------------------------------- TEAMS

/** The running TEAMS event (or null). */
const teamsEvent = () => {
  const ev = state.boss?.status === "alive" ? state.boss.event : null;
  return ev?.kind === "teams" ? ev : null;
};
/** Which side a player is on during TEAMS. @param {string | undefined} id */
const teamOf = (id) => (id ? teamsEvent()?.teams_of?.[id] ?? null : null);
let teamsKey = "";

/** During TEAMS: names in CHAT carry their side, and a highlighted line at the
 * bottom says which one you're on (and the score). */
function paintTeams() {
  const ev = teamsEvent();
  const key = ev ? `${ev.started_at}:${Object.keys(ev.teams_of ?? {}).length}` : "";
  if (key !== teamsKey) {
    teamsKey = key;
    render(); // tags on (or off) every name
  }
  const host = list();
  let banner = /** @type {HTMLElement | null} */ (host.parentElement?.querySelector(".chat-team") ?? null);
  const mine = teamOf(state.me?.id);
  if (!ev) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = el("div", "chat-team");
    host.after(banner);
  }
  banner.className = `chat-team ${mine ?? ""}`;
  banner.textContent = mine
    ? `!! TEAMS: YOU'RE ON ${mine.toUpperCase()}  ::  RED ${ev.red ?? 0} vs BLUE ${ev.blue ?? 0}`
    : `!! TEAMS: HIT THE BOSS TO JOIN A SIDE  ::  RED ${ev.red ?? 0} vs BLUE ${ev.blue ?? 0}`;
}
on("boss", paintTeams);
on("me", paintTeams);

function render() {
  const host = list();
  const stick = atBottom();
  const nodes = messages.filter((m) => !hidden(m)).map(row);
  if (!messages.length) nodes.push(el("li", "dim chat-empty", "> nobody's said anything yet. say hi."));
  else if (!loadedAll && messages.length >= 60) {
    const older = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-older", "[ load older ]"));
    older.type = "button";
    older.addEventListener("click", loadAll);
    nodes.unshift(older);
  }
  host.replaceChildren(...nodes);
  paintMuted();
  if (stick) host.scrollTop = host.scrollHeight;
}

/** "MUTED: NAME [x]  ..." under the chat while you have anyone muted. */
function paintMuted() {
  const host = list();
  let bar = /** @type {HTMLElement | null} */ (host.parentElement?.querySelector(".chat-muted") ?? null);
  const who = mutedPlayers();
  if (!who.length) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = el("div", "chat-muted dim");
    host.after(bar);
  }
  bar.replaceChildren("MUTED:", ...who.flatMap(([id, name]) => {
    const b = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-unmute", `${name} [x]`));
    b.type = "button";
    b.title = `unmute ${name}: see their messages again`;
    b.addEventListener("click", () => setMuted(id, name, false));
    return [" ", b];
  }));
}
on("muted", () => render());

/** @param {any[]} fresh */
function merge(fresh) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of fresh) byId.set(m.id, m);
  messages = [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP);
}

async function loadAll() {
  try {
    const { messages: all } = await api.getChat();
    const top = list().scrollHeight - list().scrollTop;
    messages = all;
    loadedAll = true;
    render();
    list().scrollTop = list().scrollHeight - top; // stay where you were reading
  } catch {
    /* try again later */
  }
}

/** The live snapshot (connect / reconnect): the newest messages. @param {any[] | undefined} recent */
export function chatSnapshot(recent) {
  if (!recent) return;
  if (loadedAll) merge(recent);
  else messages = recent;
  render();
}

const chatTab = () => document.querySelector('#tabs [data-tab="chat"]');
const open = () => !$("panel-chat").hidden;

/** The [ CHAT ] tab was opened: jump to the newest message, clear the "new" mark. */
export function chatOpened() {
  chatTab()?.classList.remove("has-new");
  const t = chatTab();
  if (t && t.textContent !== "[ CHAT ]") t.textContent = "[ CHAT ]";
  applyChatHeight();
  list().scrollTop = list().scrollHeight;
}

/** Ticket #168: drag the chat's bottom-right corner to make it taller or
 * shorter. Remembered in this browser, one height for the CHAT tab, one for
 * FEED + CHAT, and one for the clan's chat (tickets #296 #299: it's redrawn
 * often, and used to snap back). */
const heightKey = () => (list().closest(".feed-chat") ? "omhp.chat.height.both" : "omhp.chat.height");

/** Set a chat list to the height saved under ``key`` (none saved: the CSS one).
 * @param {HTMLElement} ol @param {string} key */
export function applyHeight(ol, key) {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem(key)) || 0;
  } catch {
    /* ignore */
  }
  ol.style.height = saved ? `${Math.min(1200, Math.max(80, saved))}px` : "";
}

/** Save a chat list's height under ``key()`` when the player drags its corner.
 * @param {HTMLElement} ol @param {() => string} key */
export function watchHeight(ol, key) {
  ol.addEventListener("pointerdown", () => {
    const before = ol.offsetHeight;
    window.addEventListener("pointerup", () => {
      const after = ol.offsetHeight;
      if (!after || after === before) return;
      try {
        localStorage.setItem(key(), String(after));
      } catch {
        /* ignore */
      }
    }, { once: true });
  });
}

const applyChatHeight = () => applyHeight(list(), heightKey());
const watchChatResize = () => watchHeight(list(), heightKey);

/** One new message over the socket. @param {any} m */
export function chatMessage(m) {
  if (!m || messages.some((x) => x.id === m.id)) return;
  if (hidden(m)) {
    merge([m]); // kept, so unmuting shows it
    return;
  }
  // Someone else talked while you're elsewhere: FEED gets a [!] (tabs.js reads has-new).
  if (!open() && m.player_id !== state.me?.id) chatTab()?.classList.add("has-new");
  // Someone @named you: "[ CHAT @ ]" until you look.
  if (!open() && mentionsMe(m)) {
    const t = chatTab();
    if (t) t.textContent = "[ CHAT @ ]";
  }
  const stick = atBottom();
  merge([m]);
  const host = list();
  host.querySelector(".chat-empty")?.remove();
  host.append(row(m));
  while (host.querySelectorAll("li[data-id]").length > KEEP) host.querySelector("li[data-id]")?.remove();
  if (stick || m.player_id === state.me?.id) host.scrollTop = host.scrollHeight;
}

/** The admin deleted a message (or cleared the chat). @param {{id?: number, all?: boolean}} d */
export function chatDelete(d) {
  messages = d.all ? [] : messages.filter((m) => m.id !== d.id);
  render();
}

/** Live or polling: without the socket, the chat refreshes itself every 10 s. @param {string} m */
/** MEOW MODE flipped (or a snapshot says where it is): the box says so. */
export function chatMeow() {
  paintForm();
}

export function chatMode(m) {
  mode = m;
}

function paintForm() {
  const input = /** @type {HTMLInputElement} */ ($("chat-input"));
  const named = Boolean(state.me?.name_chosen);
  input.disabled = !named;
  input.placeholder = !named ? "make your account first (hit [ ATTACK ]) to chat"
    : state.boss?.chat_meow ? "MEOW MODE: whatever you say comes out as (meow)"
      : "say something ([ item, @ player)";
}

export function initChat() {
  const form = /** @type {HTMLFormElement} */ ($("chat-form"));
  const input = /** @type {HTMLInputElement} */ ($("chat-input"));
  const note = $("chat-note");
  render();
  paintForm();
  watchChatResize();
  on("me", paintForm);
  input.addEventListener("input", () => updatePicker(input));
  input.addEventListener("click", () => updatePicker(input));
  input.addEventListener("keydown", (e) => pickerKey(e, input));
  input.addEventListener("blur", () => setTimeout(closePicker, 120));
  form.querySelector("button[type=submit]")?.before(emoteButton(input));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    note.textContent = "";
    try {
      const { message } = await api.postChat(text);
      input.value = "";
      closePicker();
      chatMessage(message);
    } catch (err) {
      note.textContent = `> ${/** @type {Error} */ (err).message}`;
    } finally {
      sending = false;
      input.focus();
    }
  });
  // Message ages ("12s", "4m") tick along like the feed's.
  setInterval(() => {
    list().querySelectorAll(".t").forEach((node) => {
      const t = /** @type {HTMLElement} */ (node);
      t.textContent = ago(now() - Number(t.dataset.t));
    });
  }, 5000);
  setInterval(() => {
    if (mode !== "live" && open() && document.visibilityState === "visible") {
      api.getChat().then(({ messages: all }) => {
        merge(all.slice(-60));
        render();
      }).catch(() => {});
    }
  }, 10000);
}
