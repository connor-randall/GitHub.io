// The death ceremony: when a boss falls, everyone gets the scoreboard (their
// own damage and rank, the top fighters), then the next boss makes its entrance.
// Shown once per boss per browser, including to people who come back later.

import * as api from "../api.js?v=b6664395f3";
import { center, duration, el, fmt, padL, padR } from "../ascii.js?v=b6664395f3";
import { bossDef, now, state } from "../store.js?v=b6664395f3";
import { nextBossAfter, nextBossScreen } from "./aftermath.js?v=b6664395f3";
import { badgeTag, badgeWidth, nameStar } from "./badges.js?v=b6664395f3";
import { deathOrigin } from "./boss.js?v=b6664395f3";
import { playDeath } from "./deathfx.js?v=b6664395f3";
import { SKIP_DEATH, onSkipDeath, shake, showOverlay } from "./fx.js?v=b6664395f3";
import { drawGraph, graphCols } from "./hpgraph.js?v=b6664395f3";

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

/** [ SKIP ] in the corner for the whole ceremony: ends it at once, back to the game.
 * @returns {{skipped: () => boolean, remove: () => void}} */
function skipButton() {
  let skipped = false;
  const b = /** @type {HTMLButtonElement} */ (el("button", "ceremony-skip", "[ SKIP ]"));
  b.type = "button";
  b.title = "skip the rest and go back to the game";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    skipped = true;
    b.remove();
    document.dispatchEvent(new Event(SKIP_DEATH));
  });
  document.body.append(b);
  return { skipped: () => skipped, remove: () => b.remove() };
}

/** Show the ceremony for a dead boss, once. @param {any} boss */
export async function maybeShowDeath(boss) {
  if (!boss || boss.status !== "defeated" || running || !state.me || seen(boss.seq)) return;
  running = true;
  markSeen(boss.seq);
  const skip = skipButton();
  try {
    const def = bossDef(boss.def_id);
    const results = api.getBossResults(boss.seq); // fetch while the animation plays
    const graph = api.getBossGraph(boss.seq, graphCols(W + 6)).catch(() => null);
    if (def) await playDeath({ ...def, name: boss.name }, deathOrigin(boss.seq) ?? {});
    if (skip.skipped()) return;
    const res = await results;
    if (skip.skipped()) return;
    await defeatScreen(res, graph);
    if (skip.skipped()) return;
    const next = nextBossAfter(boss);
    if (res.boss.next_at && next) await nextBossScreen(next, res.boss.next_at);
  } catch {
    /* the regular death screen still shows everything */
  } finally {
    skip.remove();
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
      last_hits: names.map((name, i) => ({ name, player_id: `preview-${i}`, ultimate: i === 2, crit: i === 1,
        damage: 400 + i * 137, killing_blow: i === 0, at: t - i * 0.7 })),
    }, Promise.resolve(sampleGraph(def.name, graphCols(W + 6))));
    const next = state.boss?.next_definition; // whoever really is up next
    if (next) await nextBossScreen(next, now() + 60);
  } finally {
    running = false;
  }
}

/** A made-up fight for the admin's preview: steady hits, one heal, one poison.
 * @param {string} name @param {number} cols */
function sampleGraph(name, cols) {
  let hp = 1_000_000;
  const points = Array.from({ length: cols }, (_, i) => {
    const hits = Math.round(20 + 18 * Math.sin(i / 3) + (i > cols * 0.8 ? 40 : 0));
    hp = Math.max(0, hp - hits * 600);
    const heal = i === Math.floor(cols * 0.45) ? 100_000 : 0;
    const poison = i === Math.floor(cols * 0.65) ? 10_000 : 0;
    hp = Math.min(1_000_000, hp + heal - poison);
    return { hp: i === cols - 1 ? 0 : hp, hits, ...(heal ? { heal } : {}), ...(poison ? { poison } : {}) };
  });
  return { name, max_hp: 1_000_000, status: "defeated", seconds: 3 * 3600, points };
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

/** @param {any} res @param {Promise<any>} [graph] the HP graph, if it loads */
function defeatScreen(res, graph) {
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
  // The last few attacks, kill first: who missed it by THAT much.
  const hits = res.last_hits ?? [];
  if (hits.length) {
    lines.push(text(`LAST HITS ${"-".repeat(W - 10)}`, "dim"));
    const end = b.defeated_at ?? hits[0].at;
    for (const h of hits) {
      const when = h.killing_blow ? "KILL" : `-${Math.max(0, end - h.at).toFixed(1)}s`;
      const right = `${h.ultimate ? "ULT " : ""}${h.crit ? "CRIT " : ""}${fmt(h.damage)}`;
      const left = `${padR(when, 7)}${h.name} `;
      const dots = ".".repeat(Math.max(1, W - left.length - right.length - 1));
      const mine = h.player_id === state.me?.id;
      lines.push(text(`${left}${dots} ${right}${mine ? " <" : ""}`,
        mine ? "cer-me" : h.killing_blow ? "cer-kill" : ""));
    }
    lines.push(text(" "));
  }
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
    const num = `${padL(String(i + 1), 2)}. `;
    const left = `${num}${r.name} `;
    const dots = ".".repeat(Math.max(1, W - left.length - badgeWidth(r.badges) - n.length - 1));
    const mine = r.player_id === state.me?.id;
    const line = text("", mine ? "cer-me" : i === 0 ? "cer-first" : "");
    const tag = badgeTag(r.badges, r.player_id);
    line.append(num, ...(tag ? [tag, " "] : []), ...nameStar(r.badges), r.name, ...nameStar(r.badges), ` ${dots} ${n}${mine ? " <" : ""}`);
    lines.push(line);
  });
  shake("l");
  return showOverlay(
    (inner, close) => {
      inner.classList.add("ceremony");
      const pre = el("pre", "cer-board");
      inner.append(pre);
      reveal(pre, lines, 90);
      // The fight's HP graph draws itself once the scoreboard is up.
      const graphHost = el("div", "hp-graph-host cer-graph");
      inner.append(graphHost);
      graph?.then((g) => {
        if (g) setTimeout(() => graphHost.isConnected && void drawGraph(graphHost, g), 200 + lines.length * 90);
      });
      const actions = el("div", "actions");
      const next = el("button", "", "[ NEXT ]");
      next.addEventListener("click", onSkipDeath(close));
      actions.append(next);
      inner.append(actions);
      setTimeout(() => next.focus({ preventScroll: true }), 300);
    },
    { dismissable: false },
  );
}
