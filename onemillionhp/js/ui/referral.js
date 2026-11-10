// SHARE YOUR CODE: send a friend your code (or a link with it). They get
// shards when they use it; you get yours once they've played (50 attacks). Links look like <site>/#ref=CODE: the code is
// kept until the visitor has a name, then used for them automatically.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { CANONICAL } from "../home.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showNotice } from "./notice.js?v=b6664395f3";
import { shardsReveal } from "./fx.js?v=b6664395f3";

const PENDING_KEY = "omhp.ref";

/** @type {any} what the server said about your code (null = not asked yet) */
let info = null;
let loading = false;
let failed = false; // the last fetch failed: show [ RETRY ] instead of "fetching" forever
let using = false;
let announcing = false;

/** @param {string} key @param {string | null} [value] */
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: links just won't auto-fill */
  }
  return null;
}

/** On load: keep a code from a share link, then tidy the address bar. */
export function captureRefLink() {
  const m = location.hash.match(/^#ref=([A-Za-z0-9]{4,12})$/);
  if (!m) return;
  store(PENDING_KEY, m[1].toUpperCase());
  history.replaceState(null, "", location.pathname + location.search);
}

/** Use a code: shows the reward, or the reason it didn't work.
 * @param {string} code @param {{quiet?: boolean}} [opts] quiet: don't show errors */
async function redeem(code, opts = {}) {
  if (using) return;
  using = true;
  try {
    const res = await api.useReferral(code);
    store(PENDING_KEY, null);
    state.me = res.me;
    info = null; // refetch "you used X's code"
    emit("me");
    if (res.paid) await shardsReveal(res.shards, "SHARE CODE USED!", `"you and ${res.from} both get +${fmt(res.shards)} <>. go spend it."`);
    else showNotice(`SHARE CODE USED! make ${res.active_attacks} attacks and you and ${res.from} both get +${fmt(res.shards)} <>.`, false);
  } catch (e) {
    const err = /** @type {api.ApiError} */ (e);
    if (err.code !== "NEED_NAME") store(PENDING_KEY, null); // anything else won't fix itself
    if (!opts.quiet || !["NEED_NAME", "ALREADY_USED", "OWN_CODE"].includes(err.code)) showError(err.message);
  } finally {
    using = false;
  }
}

/** Called on every "me": a link's code is used once the player has a name,
 * and the code's owner hears who used it. @param {any} me */
export function onMe(me) {
  if (!me) return;
  const pending = store(PENDING_KEY);
  if (pending && me.name_chosen) redeem(pending, { quiet: true });
  const names = me.referrals_new ?? [];
  if (names.length && !announcing) {
    announcing = true;
    api.ackReferrals().catch(() => {});
    info = null;
    const who = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    shardsReveal(1000 * names.length, "YOUR CODE PAID OUT!",
      `"${who} used your share code and played. +1,000 <> each."`).then(() => (announcing = false));
  }
}

/** The address a share link should point at. @param {string} code */
const linkFor = (code) => `${CANONICAL || location.origin + location.pathname.replace(/\/$/, "")}/#ref=${code}`;

/** @param {string} text @param {HTMLElement} button @param {string} label */
async function copy(text, button, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "[ COPIED! ]";
  } catch {
    window.prompt("Copy this:", text); // old browsers / no clipboard permission
  }
  setTimeout(() => (button.textContent = label), 1500);
}

/** The YOU tab's SHARE YOUR CODE section (SPREAD THE WORD shows it too, without the box to
 * use someone else's code: ``withRedeem`` false). @param {() => void} rerender @param {boolean} [withRedeem] */
export function shareSection(rerender, withRedeem = true) {
  const box = el("div", "share-box");
  box.append(el("div", "panel-h", "SHARE YOUR CODE"));
  if (!info) {
    const fetchCode = () => {
      loading = true;
      failed = false;
      api.getReferral().then((r) => (info = r)).catch(() => (failed = true)).finally(() => {
        loading = false;
        rerender();
      });
    };
    if (failed && !loading) {
      const retry = el("button", "inline-btn", "[ RETRY ]");
      retry.addEventListener("click", () => {
        fetchCode();
        rerender();
      });
      const line = el("div", "dim bag-note", "> couldn't fetch your code. ");
      line.append(retry);
      box.append(line);
      return box;
    }
    box.append(el("div", "dim bag-note", "> fetching your code..."));
    if (!loading) fetchCode();
    return box;
  }
  const reward = fmt(info.reward);
  box.append(el("div", "bag-note",
    `> a friend uses your code: once they've made ${info.active_attacks} attacks, you BOTH get +${reward} <>.`));
  const row = el("div", "share-row");
  row.append(el("span", "share-code", info.code));
  const copyCode = el("button", "inline-btn", "[ COPY CODE ]");
  copyCode.addEventListener("click", () => copy(info.code, copyCode, "[ COPY CODE ]"));
  const link = linkFor(info.code);
  const canShare = "share" in navigator; // phones: the system share sheet
  const shareLink = el("button", "inline-btn", canShare ? "[ SHARE LINK ]" : "[ COPY LINK ]");
  shareLink.addEventListener("click", () => {
    if (canShare) {
      navigator.share({ title: "ONE MILLION HP", text: `Hit the boss with me. My code: ${info.code}`, url: link })
        .catch(() => {});
    } else copy(link, shareLink, "[ COPY LINK ]");
  });
  row.append(copyCode, shareLink);
  const waiting = info.pending ? ` (${info.pending} still need to play)` : "";
  box.append(row, el("div", "dim bag-note", `> used by ${info.uses} / ${info.max_uses} friends${waiting}.`),
    el("div", "dim bag-note share-fine",
      `fine print: both of you are paid once the friend has made ${info.active_attacks} attacks; accounts that ` +
      `never play pay nothing. one code per player, up to ${info.max_uses} friends per code, only from friends ` +
      "on other networks."));

  if (!withRedeem) return box;
  if (info.used_code_of) {
    box.append(el("div", "dim bag-note", `> you used ${info.used_code_of}'s code. +${reward} <> each.`));
  } else {
    const form = /** @type {HTMLFormElement} */ (el("form", "share-use"));
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.placeholder = "CODE";
    input.maxLength = 12;
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "characters");
    input.value = store(PENDING_KEY) ?? "";
    const go = el("button", "inline-btn", "[ USE CODE ]");
    form.append(el("span", "dim", "GOT A FRIEND'S CODE? "), input, go);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      input.blur();
      await redeem(code);
      rerender();
    });
    box.append(form);
  }
  return box;
}
