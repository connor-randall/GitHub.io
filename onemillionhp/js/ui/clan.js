// [ CLAN ] in the YOU menu (server/omhp/clans.py). In a clan: its name, members
// (the leader can kick them and change the look) and [ LEAVE ]. Not in one:
// found your own (name, brackets, colour; costs shards) or join one for free.
// A clan's brackets replace the [ ] around its members' badges everywhere
// (badges.js); no two clans look the same, so looks already taken are greyed.
// CLAN CHAT under the clan's name: only members see it. New lines arrive over
// the live socket (type "clan_chat"); while the tab is closed "[ CLAN N ]"
// counts them (YOU adds that up).
// The leader writes a DESCRIPTION; it shows on the card that [JOIN CLAN] in
// CHAT opens (clancard.js).

import * as api from "../api.js?v=b6664395f3";
import { ago, el, fmt, ymd } from "../ascii.js?v=b6664395f3";
import { emit, now, on, state } from "../store.js?v=b6664395f3";
import { applyHeight, emoteButton, messageText, watchHeight } from "./chat.js?v=b6664395f3";
import { animateInView } from "./inview.js?v=b6664395f3";
import { badgeTag, forgetBadges, loadClanDefs, nameStar, withBadges } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showGear } from "./gear.js?v=b6664395f3";
import { openClanCard } from "./clancard.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const visible = () => !$("panel-clan").hidden;
/** The main CHAT's [ CLAN ] view (chatswitch.js, ticket #153), when it's showing. */
const mainHost = () => {
  const h = document.getElementById("chat-clan");
  return h && !h.hidden && !$("panel-chat").hidden ? h : null;
};

/** @type {any} */
let data = null;
let loading = false;
let busy = false;
/** The founding form / the leader's look editor, kept across redraws. */
const draft = { name: "", brackets: "", color: "" };
/** The leader's description being typed (null = not editing). @type {string | null} */
let descDraft = null;
const DESC_MAX = 200;
let armed = ""; // "leave" or "kick:<id>": the second click does it
/** MEMBERS order (ticket #334's clan board): joined | week | all. */
let memberSort = "joined";
let chatDraft = "";
let unseen = 0; // clan messages that came in while the tab was closed
let posting = false;

// Named or not decides what the tab shows: redraw when that changes (not on
// every "me", which would wipe what you're typing).
let wasNamed = false;
on("me", () => {
  const named = Boolean(state.me?.name_chosen);
  if (named === wasNamed) return;
  wasNamed = named;
  if (visible()) render();
});

/** Fetch and draw. */
export async function loadClan() {
  unseen = 0;
  paintTab();
  if (visible()) render();
  if (loading) return;
  loading = true;
  try {
    data = await api.getMyClan();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
    if (visible()) render();
  }
}

/** @param {string} action @param {Record<string, any>} [body] */
async function act(action, body) {
  if (busy) return;
  busy = true;
  try {
    const out = await api.clanAction(action, body);
    data = out;
    if (out.me) {
      state.me = out.me;
      emit("me");
    }
    if (state.me) forgetBadges(state.me.id);
    armed = "";
    if (action === "found" || action === "restyle" || out.disbanded) await loadClanDefs(true);
    else loadClanDefs(true);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    render();
  }
}

/** The clan's description (the leader edits it) and how to invite people. @param {any} k */
function description(k) {
  const parts = [heading("DESCRIPTION", k.is_leader ? "you can edit it" : "")];
  if (!k.is_leader) {
    parts.push(el("div", `clan-desc${k.description ? "" : " dim"}`, k.description || "> the leader hasn't written one yet."));
  } else {
    const box = /** @type {HTMLTextAreaElement} */ (el("textarea", "designer-input clan-desc-input"));
    box.maxLength = DESC_MAX;
    box.rows = 3;
    box.placeholder = "what's your clan about? who should join? (shows when someone opens your [JOIN CLAN])";
    box.value = descDraft ?? k.description ?? "";
    box.setAttribute("aria-label", "clan description");
    const count = el("span", "dim clan-desc-count", `${box.value.length} / ${DESC_MAX}`);
    const save = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SAVE DESCRIPTION ]"));
    save.type = "button";
    const paint = () => {
      count.textContent = `${box.value.length} / ${DESC_MAX}`;
      save.disabled = busy || box.value.trim() === (k.description ?? "");
    };
    box.addEventListener("input", () => {
      descDraft = box.value;
      paint();
    });
    save.addEventListener("click", async () => {
      await act("describe", { description: box.value });
      descDraft = null;
      render();
    });
    paint();
    const row = el("div", "clan-desc-row");
    row.append(save, " ", count);
    parts.push(box, row);
  }
  parts.push(el("div", "dim bag-note", "> invite people: type [JOIN CLAN] in CHAT. it becomes a button that opens this clan."));
  return parts;
}

/** A heading like the other panels: "CLAN ------". @param {string} title @param {string} [right] */
function heading(title, right = "") {
  const h = el("div", "panel-h", `${title} `);
  h.append(el("b", "", "-".repeat(Math.max(4, 30 - title.length - right.length))));
  if (right) h.append(el("span", "dim", ` ${right}`));
  return h;
}

/** "{" + "}" in a colour. @param {string} brackets @param {string} color @param {string} [inner] */
function look(brackets, color, inner = " ") {
  const [o, c] = Array.from(brackets);
  const s = el("span", "clan-look");
  const open = el("span", "clan-br badge-glyph", o);
  const close = el("span", "clan-br badge-glyph", c);
  open.style.color = color;
  close.style.color = color;
  s.append(open, inner, close);
  return s;
}

/** Bracket + colour pickers; looks another clan has are greyed out.
 * @param {string | null} ownId your clan (its own look isn't "taken") */
function lookPicker(ownId) {
  const own = ownId ? data.clans.find((/** @type {any} */ k) => String(k.id) === ownId) : null;
  const taken = new Set(data.taken.map((/** @type {string[]} */ t) => t.join("|")));
  if (own) taken.delete(`${own.brackets}|${own.color}`);
  draft.brackets ||= own?.brackets ?? data.brackets.find((/** @type {string} */ b) =>
    data.colors.some((/** @type {string} */ c) => !taken.has(`${b}|${c}`))) ?? data.brackets[0];
  if (!draft.color || taken.has(`${draft.brackets}|${draft.color}`)) {
    draft.color = (own && own.brackets === draft.brackets ? own.color : "")
      || data.colors.find((/** @type {string} */ c) => !taken.has(`${draft.brackets}|${c}`)) || data.colors[0];
  }
  const wrap = el("div", "clan-pick");
  const brRow = el("div", "clan-pick-row");
  brRow.append(el("span", "dim clan-pick-label", "BRACKETS "));
  for (const b of data.brackets) {
    const full = data.colors.every((/** @type {string} */ c) => taken.has(`${b}|${c}`));
    const btn = /** @type {HTMLButtonElement} */ (el("button", `inline-btn clan-opt${b === draft.brackets ? " on" : ""}`));
    btn.type = "button";
    btn.disabled = full;
    btn.title = full ? "every colour of these is taken" : "";
    btn.append(look(b, b === draft.brackets ? draft.color : "", "*"));
    btn.addEventListener("click", () => {
      draft.brackets = b;
      render();
    });
    brRow.append(btn);
  }
  const colRow = el("div", "clan-pick-row");
  colRow.append(el("span", "dim clan-pick-label", "COLOUR   "));
  for (const c of data.colors) {
    const gone = taken.has(`${draft.brackets}|${c}`);
    const btn = /** @type {HTMLButtonElement} */ (el("button", `inline-btn clan-opt${c === draft.color ? " on" : ""}`, gone ? "xx" : "██"));
    btn.type = "button";
    btn.style.color = c;
    btn.disabled = gone;
    btn.title = gone ? "another clan looks like that" : "";
    btn.addEventListener("click", () => {
      draft.color = c;
      render();
    });
    colRow.append(btn);
  }
  wrap.append(brRow, colRow);
  return wrap;
}

/** Your name with these brackets, as everyone will see it. */
function preview() {
  const me = state.me;
  const stars = badgeTag((me?.badges ?? "").split(".").filter((/** @type {string} */ t) => t && t[0] !== "C").join("."), null);
  const inner = el("span", "");
  if (stars) inner.append(...[...stars.childNodes].slice(1, -1));
  else inner.append(" ");
  const p = el("div", "clan-preview");
  const tag = look(draft.brackets, draft.color);
  tag.replaceChild(inner, tag.childNodes[1]);
  p.append(el("span", "dim", "PREVIEW  "), tag, " ", el("span", "", me?.name ?? "YOU"));
  return p;
}

function render() {
  const host = $("panel-clan");
  if (!data) {
    host.replaceChildren(el("div", "dim bag-note", loading ? "> loading..." : "> couldn't load clans."));
    return;
  }
  if (!state.me?.name_chosen) {
    host.replaceChildren(heading("CLAN"), el("div", "dim bag-note", "> make your account first (hit [ ATTACK ]) to join a clan."));
    return;
  }
  // A redraw (someone joined, a new leader...) keeps you typing in the chat box
  // or the description, caret and all.
  const active = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const typing = ["clan-chat-input", "clan-desc-input"].find((c) => active?.classList.contains(c));
  const caret = active?.selectionStart ?? null;
  host.replaceChildren(...(data.clan ? inClan(data.clan) : noClan()));
  if (typing) {
    const box = /** @type {HTMLInputElement | null} */ (host.querySelector(`.${typing}`));
    box?.focus({ preventScroll: true });
    if (box && caret !== null) box.setSelectionRange(caret, caret);
  }
}

/** @param {any} k */
function inClan(k) {
  const parts = [heading("CLAN", "")];
  const title = el("div", "clan-title");
  title.append(look(k.brackets, k.color), " ", el("b", "", k.name));
  parts.push(title, el("div", "dim clan-sub",
    `${k.members.length} / ${k.size} members :: led by ${k.leader ?? "?"} :: founded ${ymd(k.created_at)}`));
  if (k.members.length >= k.size) parts.push(el("div", "clan-full-note", "> the clan is FULL: nobody new can join."));
  parts.push(...description(k));

  parts.push(heading("CLAN CHAT", "members only"), clanChat());

  parts.push(heading("MEMBERS", ""), memberSortBar());
  const list = el("ul", `clan-members${memberSort === "joined" ? "" : " ranked"}`);
  const order = [...k.members];
  if (memberSort === "week") order.sort((a, b) => b.week_damage - a.week_damage || b.damage - a.damage);
  if (memberSort === "all") order.sort((a, b) => b.damage - a.damage);
  order.forEach((m, i) => {
    const li = el("li", m.player_id === state.me?.id ? "me" : "");
    const tag = badgeTag(m.badges, m.player_id);
    const name = /** @type {HTMLButtonElement} */ (el("button", "who who-gear", m.name));
    name.type = "button";
    name.title = `see what ${m.name} is wearing`;
    name.addEventListener("click", () => showGear(m.player_id));
    if (memberSort !== "joined") li.append(el("span", `clan-rank${i < 3 ? ` top${i + 1}` : ""}`, `#${i + 1} `.padStart(5)));
    if (tag) li.append(tag, " ");
    li.append(...nameStar(m.badges), name, ...nameStar(m.badges));
    if (m.leader) li.append(el("span", "clan-leader", " (leader)"));
    if (memberSort !== "joined") {
      const v = memberSort === "week" ? m.week_damage : m.damage;
      li.append(el("span", "dim clan-dmg", `  ${fmt(v)} dmg`));
    }
    if (k.is_leader && !m.leader) {
      const key = `kick:${m.player_id}`;
      const kick = /** @type {HTMLButtonElement} */ (el("button", `inline-btn danger${armed === key ? " armed" : ""}`,
        armed === key ? "[ SURE? KICK ]" : "[ kick ]"));
      kick.type = "button";
      kick.title = "take them out of the clan (they can't join it again)";
      kick.addEventListener("click", () => {
        if (armed !== key) {
          armed = key;
          render();
        } else act("kick", { player_id: m.player_id });
      });
      li.append(" ", kick);
    }
    list.append(li);
  });
  parts.push(list);
  if (memberSort === "week") {
    parts.push(el("div", "dim bag-note", `> this week = since Monday 00:00 UTC (${k.week_from}). resets every Monday.`));
  }
  parts.push(...privacyRows(k));

  if (k.is_leader) {
    // More room: SLOT_STEP more members for SLOT_PRICE shards, up to MAX_SIZE (ticket #160).
    parts.push(heading("CLAN SIZE", `${k.size} / ${data.max_size} max`));
    if (k.size + data.slot_step <= data.max_size) {
      const shards = state.me?.shards ?? 0;
      const buy = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
        shards >= data.slot_price ? `[ +${data.slot_step} SLOTS :: ${fmt(data.slot_price)} SHARDS ]`
          : `[ +${data.slot_step} SLOTS :: NEED ${fmt(data.slot_price)} SHARDS ]`));
      buy.type = "button";
      buy.disabled = shards < data.slot_price;
      buy.addEventListener("click", () => act("buy_slots"));
      parts.push(buy);
    } else parts.push(el("div", "dim bag-note", "> as big as a clan gets."));
    parts.push(heading("LOOK", "free"), lookPicker(String(k.id)), preview());
    const save = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SAVE LOOK ]"));
    save.type = "button";
    save.disabled = draft.brackets === k.brackets && draft.color === k.color;
    save.addEventListener("click", () => act("restyle", { brackets: draft.brackets, color: draft.color }));
    parts.push(save);
  }

  const leave = /** @type {HTMLButtonElement} */ (el("button", `inline-btn danger clan-leave${armed === "leave" ? " armed" : ""}`));
  leave.type = "button";
  const last = k.members.length <= 1;
  leave.textContent = armed === "leave"
    ? (last ? "[ SURE? THE CLAN ENDS WITH YOU ]" : "[ SURE? LEAVE ]")
    : "[ LEAVE CLAN ]";
  leave.title = k.is_leader && !last ? "the longest member becomes the leader" : "";
  leave.addEventListener("click", () => {
    if (armed !== "leave") {
      armed = "leave";
      render();
    } else act("leave");
  });
  parts.push(el("div", "clan-gap"), leave);
  return parts;
}

/** [ JOINED ] [ THIS WEEK ] [ ALL TIME ]: the clan board (ticket #334). */
function memberSortBar() {
  const bar = el("div", "clan-sort");
  for (const [key, label] of [["joined", "JOINED"], ["week", "THIS WEEK"], ["all", "ALL TIME"]]) {
    const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${memberSort === key ? " on" : ""}`, `[ ${label} ]`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(memberSort === key));
    b.addEventListener("click", () => {
      memberSort = key;
      render();
    });
    bar.append(b);
  }
  return bar;
}

/** Your own privacy switches (tickets #350 / #349). @param {any} k */
function privacyRows(k) {
  const pv = k.privacy ?? {};
  /** @param {string} key @param {string} label @param {string} note */
  const row = (key, label, note) => {
    const on = Boolean(pv[key]);
    const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn clan-priv", `${on ? "[x]" : "[ ]"} ${label}`));
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => act("privacy", { [key]: !on }));
    const line = el("div", "clan-priv-row");
    line.append(b, el("div", "dim clan-priv-note", note));
    return line;
  };
  return [heading("PRIVACY", "only affects you"),
    row("hide_brackets", "HIDE MY CLAN BRACKETS", "your badges show in plain [ ] brackets; you stay in the clan."),
    row("hide_listed", "HIDE ME FROM THE PUBLIC MEMBER LIST",
      k.is_leader ? "the leader always shows on it." : "outsiders only see a count of hidden members.")];
}

function noClan() {
  const parts = [heading("JOIN A CLAN", "free")];
  const kicked = new Set(data.kicked_from);
  if (!data.clans.length) parts.push(el("div", "dim bag-note", "> no clans yet. found the first one below."));
  const list = el("ul", "clan-list");
  for (const k of data.clans) {
    const li = el("li", "");
    li.append(look(k.brackets, k.color), " ", el("b", "", k.name),
      el("span", "dim", ` ${k.members} / ${k.size} members :: ${k.leader ?? "?"} `));
    const full = k.members >= k.size;
    const join = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
      kicked.has(k.id) ? "[ kicked ]" : full ? "[ FULL ]" : "[ JOIN ]"));
    join.type = "button";
    join.disabled = kicked.has(k.id) || full;
    join.addEventListener("click", () => act("join", { clan_id: k.id }));
    // Ticket #347: the description (and members, #349) before you join.
    const more = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ MORE ]"));
    more.type = "button";
    more.title = "description and members";
    more.addEventListener("click", () => openClanCard(String(k.id)));
    li.append(join, " ", more);
    if (k.description) li.append(el("div", "dim clan-list-desc", k.description));
    list.append(li);
  }
  parts.push(list);

  parts.push(heading("FOUND A CLAN", `${fmt(data.price)} shards`));
  const form = /** @type {HTMLFormElement} */ (el("form", "clan-found"));
  const input = /** @type {HTMLInputElement} */ (el("input", "clan-name"));
  input.maxLength = 16;
  input.placeholder = "CLAN NAME (3-16)";
  input.value = draft.name;
  input.setAttribute("aria-label", "clan name");
  input.addEventListener("input", () => (draft.name = input.value.toUpperCase()));
  const label = el("label", "clan-pick-row");
  label.append(el("span", "dim clan-pick-label", "NAME     "), input);
  const shards = state.me?.shards ?? 0;
  const go = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
    shards >= data.price ? `[ FOUND IT :: ${fmt(data.price)} SHARDS ]` : `[ NEED ${fmt(data.price)} SHARDS ]`));
  go.disabled = shards < data.price;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act("found", { name: input.value, brackets: draft.brackets, color: draft.color });
  });
  form.append(label, lookPicker(null), preview(), go,
    el("div", "dim clan-note", "your clan's brackets go around your badges everywhere your name shows. joining is free."));
  parts.push(form);
  return parts;
}

/** One clan chat line. @param {any} m */
function chatLine(m) {
  const mine = m.player_id === state.me?.id;
  const named = Boolean(state.me?.id && (m.mentions ?? []).includes(state.me.id));
  const li = el("li", `${mine ? "me" : ""}${named ? " mention-me" : ""}`);
  const t = el("span", "t", ago(now() - m.t));
  t.dataset.t = String(m.t);
  const who = /** @type {HTMLButtonElement} */ (el("button", "who who-gear", m.name));
  who.type = "button";
  who.title = `see what ${m.name} is wearing`;
  who.addEventListener("click", () => showGear(m.player_id));
  const text = el("span", "chat-text");
  text.append(withBadges(m.badges, m.player_id, who), ": ", messageText(m.text, (m.mentions ?? []).length > 0));
  li.append(t, text);
  li.dataset.id = String(m.id);
  return li;
}

/** [ load older ]: the page before the oldest shown, kept in place. @param {HTMLElement} ol */
function olderButton(ol) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "btn-text chat-older", "[ load older ]"));
  b.type = "button";
  b.addEventListener("click", async () => {
    if (!data?.messages?.length) return;
    try {
      const r = await api.getClanChatOlder(data.messages[0].id);
      const fromBottom = ol.scrollHeight - ol.scrollTop;
      data.messages = [...r.messages, ...data.messages];
      data.more_messages = r.more;
      b.remove();
      ol.prepend(...(r.more ? [olderButton(ol)] : []), ...r.messages.map(chatLine));
      ol.scrollTop = ol.scrollHeight - fromBottom;
    } catch (e) {
      showError(/** @type {Error} */ (e).message);
    }
  });
  return b;
}

const CLAN_HEIGHT_KEY = "omhp.chat.height.clan";

/** The clan's chat: its lines, and a box to talk. */
function clanChat() {
  const box = el("div", "clan-chat");
  const ol = el("ol", "chat-list clan-chat-list");
  applyHeight(ol, CLAN_HEIGHT_KEY); // drawn fresh often: keep the height you dragged it to (#296 #299)
  watchHeight(ol, () => CLAN_HEIGHT_KEY);
  const msgs = data.messages ?? [];
  if (data.more_messages) ol.append(olderButton(ol));
  if (!msgs.length) ol.append(el("li", "dim chat-empty", "> nobody's said anything yet. say hi to your clan."));
  for (const m of msgs) ol.append(chatLine(m));
  setTimeout(() => (ol.scrollTop = ol.scrollHeight), 0);
  animateInView(ol); // emotes and animated badges move on the lines you can see
  const f = /** @type {HTMLFormElement} */ (el("form", "chat-form"));
  f.autocomplete = "off";
  const input = /** @type {HTMLInputElement} */ (el("input", "clan-chat-input"));
  input.maxLength = 200;
  input.placeholder = "talk to your clan (@ player)";
  input.setAttribute("aria-label", "clan chat message");
  input.enterKeyHint = "send";
  input.value = chatDraft;
  input.addEventListener("input", () => (chatDraft = input.value));
  f.append(el("span", "chat-prompt", ">"), input, emoteButton(input), el("button", "btn-text", "[SEND]"));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || posting) return;
    posting = true;
    try {
      const { message } = await api.postClanChat(text);
      chatDraft = "";
      input.value = "";
      clanChatMessage(message);
    } catch (err) {
      showError(/** @type {Error} */ (err).message);
    } finally {
      posting = false;
      input.focus();
    }
  });
  box.append(ol, f);
  return box;
}

/** The main CHAT's [ CLAN ] view: the same clan chat as the CLAN tab. @param {HTMLElement} host */
export async function mountClanChat(host) {
  const draw = () => {
    if (data?.clan) host.replaceChildren(clanChat());
    else host.replaceChildren(el("div", "dim chat-empty", "> you're not in a clan. join or found one in YOU > CLAN."));
  };
  if (data) draw();
  else host.replaceChildren(el("div", "dim", "> loading..."));
  unseen = 0;
  paintTab();
  try {
    data = await api.getMyClan();
    if (!host.hidden) draw();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

/** "[ CLAN ]" / "[ CLAN 3 ]" (new clan messages while it was closed). */
function paintTab() {
  const t = document.querySelector('#tabs [data-tab="clan"]');
  if (!t) return;
  const text = unseen ? `[ CLAN ${unseen} ]` : "[ CLAN ]";
  if (t.textContent !== text) t.textContent = text;
}

/** A clan chat line over the socket (or one you just sent). @param {any} m */
export function clanChatMessage(m) {
  if (!m) return;
  if (data?.clan && data.clan.id === m.clan_id) {
    data.messages ??= [];
    if (data.messages.some((/** @type {any} */ x) => x.id === m.id)) return;
    data.messages.push(m);
  }
  const ol = (visible() ? $("panel-clan") : mainHost())?.querySelector(".clan-chat-list") ?? null;
  if (ol) {
    ol.querySelector(".chat-empty")?.remove();
    const stick = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 30 || m.player_id === state.me?.id;
    ol.append(chatLine(m));
    if (stick) ol.scrollTop = ol.scrollHeight;
  } else if (m.player_id !== state.me?.id) {
    unseen += 1;
    paintTab();
  }
}

/** Someone founded or restyled a clan: redraw if it's open. */
export function clansChanged() {
  if (visible()) loadClan();
}
