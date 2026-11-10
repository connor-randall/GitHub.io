// [JOIN CLAN] typed in CHAT (chat.js) becomes a button; it opens this card of
// the sender's clan (as it is now): its name in its brackets and colour, the
// leader's description, how full it is, and [ JOIN ] / [ CLOSE ]. A clan with
// no description yet shows its leader a way to write one (the [ CLAN ] tab).

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { badgeTag, clanIn, forgetBadges, loadClanDefs, nameStar } from "./badges.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";
import { showNotice } from "./notice.js?v=b6664395f3";

/** The text typed in CHAT that becomes the button (any case, any spacing inside). */
export const JOIN_TAG = /^\s*JOIN\s+CLAN\s*$/i;

/** "{" + "}" in a colour around the name. @param {any} k */
function title(k) {
  const [o, c] = Array.from(String(k.brackets));
  const t = el("div", "clan-card-name");
  const open = el("span", "clan-br badge-glyph", o);
  const close = el("span", "clan-br badge-glyph", c);
  open.style.color = close.style.color = k.color;
  t.append(open, " ", el("b", "", k.name), " ", close);
  return t;
}

/** [ MEMBERS ] drop-down (ticket #349): fetched the first time it opens.
 * Members who chose to stay off the list are only counted. @param {any} k */
function memberFold(k) {
  const fold = /** @type {HTMLDetailsElement} */ (el("details", "clan-card-members"));
  const list = el("ul", "clan-members");
  const sum = el("summary", "", `[+] MEMBERS (${k.members})`);
  fold.append(sum, list);
  let loaded = false;
  fold.addEventListener("toggle", async () => {
    sum.textContent = `[${fold.open ? "-" : "+"}] MEMBERS (${k.members})`;
    if (!fold.open || loaded) return;
    loaded = true;
    list.replaceChildren(el("li", "dim", "> loading..."));
    try {
      const out = await api.getClanMembers(k.id);
      const rows = out.members.map((/** @type {any} */ m) => {
        const li = el("li", "");
        const tag = badgeTag(m.badges, m.player_id);
        if (tag) li.append(tag, " ");
        li.append(...nameStar(m.badges), el("span", "", m.name), ...nameStar(m.badges),
          el("span", "dim", ` L${m.level}`), m.leader ? el("span", "clan-leader", " (leader)") : "");
        return li;
      });
      if (out.hidden) rows.push(el("li", "dim", `+ ${out.hidden} who keep${out.hidden === 1 ? "s" : ""} to themselves`));
      list.replaceChildren(...(rows.length ? rows : [el("li", "dim", "> nobody to show.")]));
    } catch (e) {
      loaded = false;
      list.replaceChildren(el("li", "dim", `> ${/** @type {Error} */ (e).message}`));
    }
  });
  return fold;
}

/** The [ CLAN ] tab (clicked like its menu entry, so the tab bar stays in charge). */
function openClanTab() {
  /** @type {HTMLElement | null} */ (document.querySelector('#tabs [data-tab="clan"]'))?.click();
}

/** Show the card for clan ``clanId`` (a string from a badge's "C<id>"). @param {string} clanId */
export async function openClanCard(clanId) {
  /** @type {any} */
  let k = null;
  try {
    k = ((await api.getClans()).clans ?? []).find((/** @type {any} */ c) => String(c.id) === clanId) ?? null;
  } catch {
    k = null;
  }
  showOverlay((inner, close) => {
    const card = el("div", "gear-card clan-card");
    const x = /** @type {HTMLButtonElement} */ (el("button", "gear-x", "[x]"));
    x.type = "button";
    x.setAttribute("aria-label", "close");
    x.addEventListener("click", close);
    card.append(x, el("div", "panel-h", "CLAN"));
    const buttons = el("div", "clan-card-buttons");
    const shut = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ CLOSE ]"));
    shut.type = "button";
    shut.addEventListener("click", close);
    if (!k) {
      card.append(el("div", "dim clan-card-desc", "> that clan is gone."));
      buttons.append(shut);
      card.append(buttons);
      inner.append(card);
      return;
    }
    const me = state.me;
    const leader = Boolean(me?.id && k.leader_id === me.id);
    card.append(title(k), el("div", "dim clan-card-sub", `${k.members} / ${k.size} members :: led by ${k.leader ?? "?"}`));
    if (k.description) card.append(el("div", "clan-card-desc", k.description));
    else {
      const none = el("div", "dim clan-card-desc", "> no description yet.");
      if (leader) {
        const write = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ WRITE ONE ]"));
        write.type = "button";
        write.title = "in the [ CLAN ] tab, under DESCRIPTION";
        write.addEventListener("click", () => {
          close();
          openClanTab();
        });
        none.append(" ", write);
      }
      card.append(none);
    }
    card.append(memberFold(k));
    const mine = clanIn(me?.badges);
    const full = k.members >= k.size;
    // Why [ JOIN ] can't be pressed, if it can't.
    const why = !me?.name_chosen ? "make your account first (hit [ ATTACK ]) to join a clan."
      : mine === String(k.id) ? "you're in this clan."
        : mine ? "leave your clan first (YOU > CLAN)."
          : full ? "the clan is full." : "";
    const msg = el("div", "dim clan-card-note", why ? `> ${why}` : "");
    const join = /** @type {HTMLButtonElement} */ (el("button", "inline-btn clan-card-join", "[ JOIN ]"));
    join.type = "button";
    join.disabled = Boolean(why);
    join.addEventListener("click", async () => {
      join.disabled = true;
      try {
        const out = await api.clanAction("join", { clan_id: k.id });
        if (out.me) {
          state.me = out.me;
          emit("me");
          forgetBadges(out.me.id);
        }
        loadClanDefs(true);
        close();
        showNotice(`CLAN :: you joined ${k.name}!`, false);
      } catch (e) {
        msg.textContent = `> ${/** @type {Error} */ (e).message}`;
      }
    });
    if (mine !== String(k.id)) buttons.append(join); // your own clan: just the note
    buttons.append(shut);
    card.append(msg, buttons);
    inner.append(card);
  });
}
