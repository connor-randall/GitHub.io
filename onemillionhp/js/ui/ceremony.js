// The death ceremony: when a boss falls, everyone gets the scoreboard (their
// own damage and rank, the top fighters), then a warning about what's next.
// Shown once per boss per browser, including to people who come back later.

import * as api from "../api.js?v=60002fcd68";
import { center, duration, el, fmt, padL } from "../ascii.js?v=60002fcd68";
import { now, state } from "../store.js?v=60002fcd68";
import { shake, showOverlay } from "./fx.js?v=60002fcd68";

const SEEN_KEY = "omhp.seen_death";
const W = 40;

/** @param {number} seq */
function seen(seq) {
  try {
    return (localStorage.getItem(SEEN_KEY) ?? "").split(",").includes(String(seq));
  } catch {
    return false;
  }
}
/** @param {number} seq */
function markSeen(seq) {
  try {
    const list = (localStorage.getItem(SEEN_KEY) ?? "").split(",").filter(Boolean);
    localStorage.setItem(SEEN_KEY, [...list, String(seq)].slice(-50).join(","));
  } catch {
    /* ignore */
  }
}

let running = false;

/** Show the ceremony for a dead boss, once. @param {any} boss */
export async function maybeShowDeath(boss) {
  if (!boss || boss.status !== "defeated" || running || !state.me || seen(boss.seq)) return;
  running = true;
  markSeen(boss.seq);
  try {
    const res = await api.getBossResults(boss.seq);
    await defeatScreen(res);
    if (res.boss.next_at) await incomingScreen(res.boss);
  } catch {
    /* the regular death screen still shows everything */
  } finally {
    running = false;
  }
}

/** Lines appear one after another. @param {HTMLElement} pre @param {Node[]} lines @param {number} step */
function reveal(pre, lines, step) {
  lines.forEach((node, i) => {
    const span = el("span", "cer-line pending");
    span.append(node);
    pre.append(span);
    setTimeout(() => span.classList.remove("pending"), 120 + i * step);
  });
}

/** @param {any} res */
function defeatScreen(res) {
  const b = res.boss;
  const me = res.me;
  const text = (/** @type {string} */ s, cls = "") => el("span", cls, s);
  const lines = [
    text("#".repeat(W), "cer-bar"),
    text("#" + center("", W - 2) + "#", "cer-bar"),
    text("#" + center(`${b.name} HAS FALLEN`, W - 2) + "#", "cer-title"),
    text("#" + center("", W - 2) + "#", "cer-bar"),
    text("#".repeat(W), "cer-bar"),
    text(" "),
    text(`KILLING BLOW  ${b.killer_name ?? "?"}`, "cer-kill"),
    text(`TOTAL DAMAGE  ${fmt(b.total_damage)}${b.overkill > 0 ? "+" : ""}`),
    text(`FIGHTERS      ${fmt(b.unique_players)}`),
    text(`TIME ALIVE    ${duration((b.defeated_at ?? b.started_at) - b.started_at)}`),
    text(" "),
  ];
  if (me && me.rank) {
    const pct = b.total_damage ? ((100 * me.damage) / b.total_damage).toFixed(me.damage / b.total_damage < 0.01 ? 2 : 1) : "0";
    lines.push(text(`YOU DEALT ${fmt(me.damage)} DAMAGE (${pct}% of it)`, "cer-you"));
    lines.push(text(`YOUR RANK  #${me.rank} OF ${fmt(b.unique_players)}`, "cer-you"));
  } else {
    lines.push(text("YOU DIDN'T LAND A HIT ON THIS ONE.", "cer-you dim"));
  }
  lines.push(text(" "), text(`TOP FIGHTERS ${"-".repeat(W - 13)}`, "dim"));
  res.top.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    const n = fmt(r.damage);
    const left = `${padL(String(i + 1), 2)}. ${r.name} `;
    const dots = ".".repeat(Math.max(1, W - left.length - n.length - 1));
    const mine = r.player_id === state.me?.id;
    lines.push(text(`${left}${dots} ${n}${mine ? " <" : ""}`, mine ? "cer-me" : i === 0 ? "cer-first" : ""));
  });
  shake("l");
  return showOverlay(
    (inner, close) => {
      inner.classList.add("ceremony");
      const pre = el("pre", "cer-board");
      inner.append(pre);
      reveal(pre, lines, 90);
      const actions = el("div", "actions");
      const next = el("button", "", "[ NEXT ]");
      next.addEventListener("click", close);
      actions.append(next);
      inner.append(actions);
      setTimeout(() => next.focus({ preventScroll: true }), 300);
    },
    { dismissable: false },
  );
}

/** @param {any} boss */
function incomingScreen(boss) {
  shake("l");
  return showOverlay(
    (inner, close) => {
      inner.classList.add("ceremony");
      inner.append(el("div", "panic", "oh god oh no oh god no another boss is coming!"));
      const count = el("div", "panic-count", "");
      inner.append(count);
      const tick = () => {
        if (!count.isConnected) return;
        const left = Math.max(0, Math.round(boss.next_at - now()));
        count.textContent = left > 0 ? `ARRIVES IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "IT'S HERE.";
        setTimeout(tick, 1000);
      };
      tick();
      const actions = el("div", "actions");
      const ok = el("button", "", "[ BRACE YOURSELF ]");
      ok.addEventListener("click", close);
      actions.append(ok);
      inner.append(actions);
      setTimeout(() => ok.focus({ preventScroll: true }), 300);
    },
    { dismissable: false },
  );
}
