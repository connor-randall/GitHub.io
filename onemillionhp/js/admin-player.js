// The player you're working on. Type a name in the sticky PLAYER box (or
// click any player name in the panel): every empty PLAYER box on the page
// fills with it, and [ CARD ] shows everything about them in one place, with
// the usual actions one click away. Before this, the same name was typed into
// up to 15 separate boxes and each form cleared it after use.

import { ago, el, fmt } from "./ascii.js?v=b6664395f3";

const KEY = "omhp.admin.player";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {(path: string, body?: unknown) => Promise<any>} */
let call = async () => ({});
/** @type {(msg: string, ok: boolean) => void} */
let log = () => {};
/** @type {(key: string) => void} */
let goTo = () => {};
/** @type {() => Promise<void>} */
let refresh = async () => {};
/** @type {() => boolean} */
let announcing = () => false;

export function currentPlayer() {
  return /** @type {HTMLInputElement} */ ($("cur-player")).value.trim();
}

/** Fill every PLAYER box we filled before, or that's empty (never one the admin typed into). */
function fillBoxes() {
  const who = currentPlayer();
  document.querySelectorAll("#panel input[name=player]").forEach((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    if (input.type === "hidden" || input.closest(".admin-current")) return;
    if (input.value && input.dataset.auto !== "1") return; // typed by hand: leave it
    input.value = who;
    input.dataset.auto = who ? "1" : "";
  });
}

/** Work on this player: the sticky box, every PLAYER box, and (optionally) their card.
 * @param {string} who name or id @param {boolean} [open] */
export function setPlayer(who, open = true) {
  const box = /** @type {HTMLInputElement} */ ($("cur-player"));
  box.value = who;
  try {
    if (who) localStorage.setItem(KEY, who);
    else localStorage.removeItem(KEY);
  } catch {
    /* just this visit */
  }
  fillBoxes();
  if (open && who) void showCard(who);
  if (!who) $("player-card").hidden = true;
}

/** A player's name that opens their card (and makes them the current player).
 * @param {string} name @param {string | null | undefined} [id] */
export function playerLink(name, id) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "player-link", name || "?"));
  b.type = "button";
  b.title = "open this player's card";
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPlayer(id || name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  return b;
}

/** Run one action on the card's player. @param {string} action @param {Record<string, unknown>} [extra] */
async function act(action, extra = {}) {
  const p = /** @type {any} */ ($("player-card")).dataset.pid;
  try {
    const res = await call("/api/admin/action", { action, player: p, announce: announcing(), ...extra });
    log(res.message, true);
    await refresh();
    await showCard(p);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** A button on the card. ``ask``: needs a second click. @param {string} label @param {() => void} run @param {boolean} [ask] */
function cardBtn(label, run, ask = false) {
  const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn${ask ? " danger" : ""}`, label));
  b.type = "button";
  let armedAt = 0;
  b.addEventListener("click", () => {
    if (ask && Date.now() - armedAt > 5000) {
      armedAt = Date.now();
      b.textContent = `[ SURE? ${label.replace(/^\[\s*|\s*\]$/g, "")} ]`;
      b.classList.add("armed");
      setTimeout(() => {
        b.textContent = label;
        b.classList.remove("armed");
      }, 5000);
      return;
    }
    run();
  });
  return b;
}

/** Fetch and draw the card. @param {string} who */
export async function showCard(who) {
  const host = $("player-card");
  host.hidden = false;
  host.replaceChildren(el("div", "hint", "> loading..."));
  /** @type {any} */
  let p;
  try {
    p = await call(`/api/admin/player?player=${encodeURIComponent(who)}`);
  } catch (e) {
    host.replaceChildren(el("div", "adm-result bad", `> ${/** @type {Error} */ (e).message}`), closeBtn());
    return;
  }
  host.dataset.pid = p.id;
  const now = Date.now() / 1000;
  const head = el("div", "pc-head");
  head.append(el("b", "pc-name", p.name),
    el("span", "dim", `  L${p.level}${p.prestige ? `  PRESTIGE ${p.prestige}` : ""}${p.clan ? `  ::  CLAN ${p.clan}` : ""}`),
    ...(p.banned ? [el("span", "pc-tag bad", ` BANNED${p.ban_reason ? ` (${p.ban_reason})` : ""}`)] : []),
    ...(p.whitelisted ? [el("span", "pc-tag ok", " WHITELISTED")] : []),
    ...(p.captcha.pending ? [el("span", "pc-tag warn", " CAPTCHA PENDING")] : []),
    closeBtn());
  const facts = el("div", "pc-facts");
  /** @param {string} k @param {string} v */
  const fact = (k, v) => {
    const f = el("span", "pc-fact");
    f.append(el("span", "dim", `${k} `), el("span", "", v));
    facts.append(f);
  };
  fact("SHARDS", `<> ${fmt(p.shards)}`);
  fact("DAMAGE", fmt(p.total_damage));
  fact("HITS", fmt(p.total_attacks));
  fact("ITEMS", fmt(p.items));
  fact("CHESTS", fmt(p.boxes));
  fact("JOINED", `${ago(now - p.created_at)} ago`);
  fact("LAST HIT", p.last_attack_at ? `${ago(now - p.last_attack_at)} ago` : "never");
  fact("LOGIN", p.login ? "password set" : p.named ? "no password" : "unnamed");
  fact("CAPTCHA", `${p.captcha.passed} ok / ${p.captcha.failed} miss${p.captcha.strikes ? ` (${p.captcha.strikes} strikes)` : ""}`);
  fact("TICKETS", fmt(p.tickets));
  const parts = [head, facts];
  if (p.flags?.length) parts.push(el("div", "pc-line bad", `FLAGGED: ${p.flags.join(" :: ")}`));
  else if (p.flags_reset_at) parts.push(el("div", "pc-line dim", `flags reset ${ago(now - p.flags_reset_at)} ago`));
  if (p.worn?.length) {
    const worn = el("div", "pc-line");
    worn.append(el("span", "dim", "WEARS "));
    p.worn.forEach((/** @type {any} */ w, /** @type {number} */ i) => {
      if (i) worn.append(el("span", "dim", " · "));
      worn.append(el("span", `r-${w.rarity}`, w.name));
    });
    parts.push(worn);
  }
  if (p.network?.length) {
    const net = el("div", "pc-line");
    net.append(el("span", "dim", `SAME NETWORK (${p.network.length}) `));
    for (const o of p.network) {
      const l = playerLink(o.name, o.id);
      if (o.banned) l.classList.add("banned");
      net.append(l, el("span", "dim", ` ${fmt(o.total_attacks)} hits  `));
    }
    parts.push(net);
  }
  const acts = el("div", "pc-acts");
  const amount = /** @type {HTMLInputElement} */ (el("input", "pc-amount"));
  amount.type = "number";
  amount.min = "1";
  amount.placeholder = "amount";
  amount.setAttribute("aria-label", "amount for GIVE");
  const need = (/** @type {(n: number) => void} */ run) => () => {
    const n = Number(amount.value);
    if (!(n > 0)) {
      log("Type an amount first.", false);
      amount.focus();
      return;
    }
    run(n);
  };
  acts.append(
    cardBtn("[ LOOK UP + SAVE CODE ]", () => void act("lookup_player")),
    p.banned ? cardBtn("[ UNBAN ]", () => void act("unban"), true) : cardBtn("[ BAN ]", () => void act("ban"), true),
    p.captcha.pending ? cardBtn("[ CLEAR CAPTCHA ]", () => void act("clear_captcha"))
      : cardBtn("[ CAPTCHA ]", () => void act("push_captcha")),
    cardBtn("[ RESET FLAGS ]", () => void act("reset_bot_flags"), true),
    p.whitelisted ? cardBtn("[ UN-WHITELIST ]", () => void act("whitelist_remove"))
      : cardBtn("[ WHITELIST ]", () => void act("whitelist_add")),
    cardBtn("[ REFILL ATTACKS ]", () => void act("refill_attacks")),
    el("span", "pc-sep", " "),
    amount,
    cardBtn("[ GIVE SHARDS ]", need((n) => void act("grant_shards", { amount: n }))),
    cardBtn("[ GIVE ATTACKS ]", need((n) => void act("grant_attacks", { amount: n }))),
    el("span", "pc-sep", " "),
    cardBtn("[ MESSAGES ]", () => goTo("dms")),
    cardBtn("[ ITEMS ]", () => goTo("items")),
    cardBtn("[ BADGES ]", () => goTo("badges")),
    cardBtn("[ PASSWORD ]", () => goTo("accounts")),
  );
  parts.push(acts);
  host.replaceChildren(...parts);
}

function closeBtn() {
  const x = /** @type {HTMLButtonElement} */ (el("button", "btn-text pc-close", "[x]"));
  x.type = "button";
  x.title = "close the card (the player stays picked)";
  x.addEventListener("click", () => ($("player-card").hidden = true));
  return x;
}

/** @param {{call: typeof call, log: typeof log, goTo: typeof goTo, refresh: typeof refresh, announcing: typeof announcing}} deps */
export function initPlayer(deps) {
  ({ call, log, goTo, refresh, announcing } = deps);
  const box = /** @type {HTMLInputElement} */ ($("cur-player"));
  try {
    box.value = localStorage.getItem(KEY) ?? "";
  } catch {
    /* ignore */
  }
  box.addEventListener("change", () => setPlayer(box.value.trim(), false));
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setPlayer(box.value.trim());
    }
  });
  $("cur-open").addEventListener("click", () => {
    if (currentPlayer()) void showCard(currentPlayer());
    else box.focus();
  });
  $("cur-clear").addEventListener("click", () => setPlayer(""));
  // A PLAYER box the admin types into is theirs from then on.
  document.addEventListener("input", (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === "player" && t.dataset.auto) t.dataset.auto = "";
  });
  fillBoxes();
}

/** After a redraw adds new PLAYER boxes. */
export const refillPlayerBoxes = fillBoxes;
