// The death ceremony: when a boss falls, everyone gets the scoreboard (their
// own damage and rank, the top fighters), then the next boss makes its entrance.
// Shown once per boss per browser, including to people who come back later.

import * as api from "../api.js?v=3c47ca09f7";
import { center, duration, el, fmt, padL } from "../ascii.js?v=3c47ca09f7";
import { bossDef, now, state } from "../store.js?v=3c47ca09f7";
import { nextBossDef, nextBossScreen } from "./aftermath.js?v=3c47ca09f7";
import { deathOrigin } from "./boss.js?v=3c47ca09f7";
import { playDeath } from "./deathfx.js?v=3c47ca09f7";
import { shake, showOverlay } from "./fx.js?v=3c47ca09f7";

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
    const def = bossDef(boss.def_id);
    const results = api.getBossResults(boss.seq); // fetch while the animation plays
    if (def) await playDeath({ ...def, name: boss.name }, deathOrigin(boss.seq) ?? {});
    const res = await results;
    await defeatScreen(res);
    const next = nextBossDef(boss.def_id);
    if (res.boss.next_at && next) await nextBossScreen(next, res.boss.next_at);
  } catch {
    /* the regular death screen still shows everything */
  } finally {
    running = false;
  }
}

/**
 * Play the whole death sequence for any boss without anything dying: the
 * animation, a sample scoreboard and the "another boss is coming" screen.
 * Opened from the admin panel (#preview-death=<boss id>); only this screen sees it.
 * @param {string} bossId
 */
export async function previewDeath(bossId) {
  const def = bossDef(bossId) ?? bossDef(state.boss?.def_id ?? "");
  if (!def || running) return;
  running = true;
  try {
    const rect = document.getElementById("boss-art")?.getBoundingClientRect() ?? null;
    const live = state.boss && state.boss.def_id === def.id && state.boss.status === "alive";
    await playDeath(def, live ? { rect, lines: null } : {});
    const t = now();
    const names = ["SAMPLE_HERO", "PREVIEW_PAL", "TEST_DUMMY", "NOT_REAL", "EXAMPLE_EDDIE"];
    await defeatScreen({
      boss: { name: def.name, killer_name: "SAMPLE_HERO", total_damage: 1_000_000, overkill: 0,
        unique_players: 42, started_at: t - 3 * 3600, defeated_at: t, next_at: t + 60 },
      me: { damage: 12_345, rank: 7 },
      top: names.map((name, i) => ({ name, player_id: `preview-${i}`, damage: 120_000 - i * 17_000 })),
    });
    const next = nextBossDef(def.id);
    if (next) await nextBossScreen(next, now() + 60);
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
