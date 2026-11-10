// [ PRESTIGE ] in the YOU menu: start over for a rainbow star on both sides of your
// name (server/omhp/prestige.py). 100k shards, then 1M, 10M... (+10% XP each). It wipes everything but
// your level, achievements and record, so you have to type the word to do it.

import * as api from "../api.js?v=b6664395f3";
import { bar, el, fmt } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { nameStar } from "./badges.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { button, popup, shake, showOverlay } from "./fx.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const WORD = "PRESTIGE";

/** @type {any} */
let data = null;
let busy = false;

export async function loadPrestige() {
  if (!$("panel-prestige").hidden) render();
  try {
    data = await api.getPrestige();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
  if (!$("panel-prestige").hidden) render();
}

const total = (/** @type {any[] | undefined} */ rows) => (rows ?? []).reduce((n, r) => n + (r.count ?? 0), 0);

/** The heavy pop-up: it can't be clicked away, says exactly what this player is about to
 * lose, starts on NO, and YES only wakes up once the word is typed. */
function areYouSure() {
  const me = state.me;
  showOverlay((inner, close) => {
    inner.classList.add("prestige-sure");
    const err = el("div", "name-err", "");
    const typed = /** @type {HTMLInputElement} */ (el("input"));
    typed.placeholder = `TYPE ${WORD}`;
    typed.setAttribute("aria-label", `Type ${WORD} to confirm`);
    typed.autocomplete = "off";
    typed.spellcheck = false;
    const yes = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ YES, WIPE EVERYTHING ]"));
    yes.disabled = true;
    typed.addEventListener("input", () => (yes.disabled = typed.value.trim().toUpperCase() !== WORD));
    const form = /** @type {HTMLFormElement} */ (el("form", "prestige-confirm"));
    form.append(typed, " ", yes);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (yes.disabled || busy) return;
      busy = true;
      yes.disabled = true;
      try {
        const res = await api.buyPrestige();
        data = res.prestige;
        state.me = res.me;
        emit("me");
        close();
        shake("l");
        popup("P R E S T I G E", "proc");
      } catch (ex) {
        err.textContent = `> ${/** @type {Error} */ (ex).message}`;
        yes.disabled = false;
      } finally {
        busy = false;
        render();
      }
    });
    const lost = el("pre", "prestige-sure-list", [
      `${fmt(me?.shards ?? 0).padStart(12)}  shards, all of them`,
      `${fmt(total(me?.inventory)).padStart(12)}  pieces of gear, worn, refined and FORGED ones too`,
      `${fmt(total(me?.boxes)).padStart(12)}  chests`,
      `${fmt(total(me?.scrolls)).padStart(12)}  scrolls`,
      "         ALL  auction listings, loadouts, charged crits, forge progress",
    ].join("\n"));
    const no = button("[ NO, KEEP EVERYTHING ]", close);
    const actions = el("div", "actions");
    actions.append(no);
    inner.append(el("h2", "prestige-sure-title", "! ! !  A R E   Y O U   S U R E ?  ! ! !"),
      el("div", "prestige-warn", "PRESTIGE WIPES YOUR CHARACTER. THIS CAN'T BE UNDONE, NOT EVEN BY THE ADMIN."),
      el("div", "dim", "you will lose:"), lost,
      el("div", "dim", "you keep your level, achievements, badges, name, stats, clan and city rankings."),
      actions, form, err);
    shake("l");
    no.focus({ preventScroll: true });
  }, { mustChoose: true });
}

function render() {
  const host = $("panel-prestige");
  if (!data) {
    host.replaceChildren(el("div", "dim bag-note", "> loading..."));
    return;
  }
  const me = state.me;
  const shards = me?.shards ?? 0;
  const head = el("div", "panel-h", "PRESTIGE  ::  START OVER, WEAR THE STARS");
  const parts = [head];
  const sample = el("div", "prestige-sample");
  sample.append(...nameStar("P"), el("b", "", me?.name ?? "YOUR NAME"), ...nameStar("P"));
  parts.push(sample);
  if (data.at) {
    const when = new Date(data.at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    parts.push(el("div", "dim bag-note", `> PRESTIGE ${data.count}, last reached on ${when}. the stars follow your name everywhere.`));
  }
  parts.push(el("div", "dim bag-note", `> PRESTIGE ${data.count + 1} needs ${fmt(data.price)} <>. each one costs ten times the last: 100k, 1M, 10M... and adds +10% XP to every hit after it (you level faster).${data.at ? "" : " a rainbow star goes on both sides of your name, everywhere it shows, for good."}`),
    el("div", "prestige-warn", "> YOU LOSE: ALL your shards, all gear (worn, bag, refined, on the auction house, and FORGED SOVEREIGN PIECES: you'd forge them again from 0), chests, scrolls, charged crits, loadouts and forge progress. THIS CAN'T BE UNDONE."),
    el("div", "dim bag-note", "> you keep: your level, achievements, badges, name and login, stats, clan and city rankings."));
  const have = Math.min(shards, data.price);
  parts.push(el("div", "prestige-bar", `${bar(have / data.price, 24)} ${fmt(have)} / ${fmt(data.price)} <>`));
  const go = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ PRESTIGE ]"));
  go.type = "button";
  go.disabled = busy || shards < data.price || !me?.name_chosen;
  go.addEventListener("click", areYouSure);
  parts.push(go);
  parts.push(el("div", "panel-h prestige-hall", `THE STARS  ::  ${fmt(data.total)}`));
  if (!data.hall.length) parts.push(el("div", "dim bag-note", "> nobody yet. be the first."));
  const list = el("ol", "prestige-list");
  for (const p of data.hall) {
    const li = el("li", p.player_id === me?.id ? "me" : "");
    li.append(...nameStar(p.badges), p.name, ...nameStar(p.badges), ...(p.count > 1 ? [el("span", "dim", ` x${p.count}`)] : []));
    list.append(li);
  }
  parts.push(list);
  host.replaceChildren(...parts);
}
