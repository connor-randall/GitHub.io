// The HP graph: a boss's health from spawn to death, drawn as an ASCII plot
// that builds itself left to right like a terminal. Heals jump up in pink,
// poison shows in green, and a strip under the time axis shows when the
// hits landed. Shown on the death screen and from [ HISTORY ]. Where the
// server only has the hits to go on (est: the feed's old heal / poison lines
// were pruned, ticket #144) the line is dimmer and the legend says ESTIMATED.

import * as api from "../api.js?v=b6664395f3";
import { duration, el, fitArt, fmt } from "../ascii.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const H = 16; // plot rows: tall enough that changes of pace show as bends
const LABEL = 6; // "100% |"
const HITS = " .:-=+*#%@"; // hits per slice, quiet to busy

/** @typedef {{ch: string, cls?: string}} Cell */

/** The full picture as rows of cells. @param {any} g graph from the server */
function cells(g) {
  const pts = g.points;
  const W = pts.length;
  const level = (/** @type {number} */ hp) => (Math.max(0, Math.min(g.max_hp, hp)) / g.max_hp) * (H - 1);
  /** @type {Cell[][]} */
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: " " })));
  /** @type {number | null} */
  let prev = H - 1; // spawns at full HP
  pts.forEach((/** @type {any} */ p, /** @type {number} */ x) => {
    if (p.hp === null) { // not recorded
      grid[Math.floor(H / 2)][x] = { ch: "?", cls: "g-unknown" };
      prev = null;
      return;
    }
    const exact = level(p.hp);
    const y = Math.round(exact);
    const cls = p.heal ? "g-heal" : p.poison ? "g-poison" : p.est ? "g-est" : "g-line";
    // Where in its row the line sits: low, middle or high.
    const frac = exact - Math.floor(exact);
    const ch = Math.abs(exact - y) < 0.17 ? "-" : frac < 0.5 ? "'" : ".";
    // Below the line: a faint fill, so the shape reads at a glance.
    for (let r = 0; r < y; r++) grid[r][x] = { ch: ".", cls: "g-fill" };
    // A drop (or a heal's jump) wider than one row gets a vertical stroke.
    const from = prev ?? y; // coming out of a "?" stretch: no stroke
    const lo = Math.min(y, from), hi = Math.max(y, from);
    for (let r = lo + 1; r < hi; r++) grid[r][x] = { ch: "|", cls };
    grid[y][x] = { ch: p.heal ? "^" : p.poison ? "~" : ch, cls };
    prev = y;
  });
  if (g.status !== "alive") grid[Math.round(level(pts[W - 1].hp))][W - 1] = { ch: "X", cls: "g-kill" };
  // Top row first, with the HP axis on the left.
  const rows = [];
  for (let r = H - 1; r >= 0; r--) {
    const pct = r === H - 1 ? "100%" : r === Math.round((H - 1) * 3 / 4) ? " 75%"
      : r === Math.round((H - 1) / 2) ? " 50%" : r === Math.round((H - 1) / 4) ? " 25%" : r === 0 ? "  0%" : "";
    rows.push([{ ch: `${pct.padStart(4)} |`, cls: "g-axis" }, ...grid[r]]);
  }
  rows.push([{ ch: "     +", cls: "g-axis" }, { ch: "-".repeat(W), cls: "g-axis" }]);
  // Time since spawn: start, middle, end.
  const mid = duration(g.seconds / 2), end = duration(g.seconds);
  const axis = "0s".padEnd(Math.floor(W / 2) - Math.floor(mid.length / 2)) + mid;
  rows.push([{ ch: " ".repeat(LABEL), cls: "g-axis" },
    { ch: axis.padEnd(Math.max(axis.length + 1, W - end.length)) + end, cls: "g-axis" }]);
  // Hits per slice.
  const most = Math.max(1, ...pts.map((/** @type {any} */ p) => p.hits));
  rows.push([{ ch: "HITS  ", cls: "g-axis" }, ...pts.map((/** @type {any} */ p) => ({
    ch: p.hits ? HITS[Math.max(1, Math.round((p.hits / most) * (HITS.length - 1)))] : " ", cls: "g-hits" }))]);
  return rows;
}

/** One cell per character (labels and axes split up), so columns reveal evenly.
 * @param {Cell[][]} rows */
function flatten(rows) {
  return rows.map(([label, ...rest]) => [label,
    ...rest.flatMap((c) => [...c.ch].map((ch) => ({ ch, cls: c.cls })))]);
}

/** Paint rows into a <pre> with plot columns past ``upto`` hidden and a
 * cursor block at the line's leading edge.
 * @param {HTMLElement} pre @param {Cell[][]} rows @param {number} upto @param {number} cursorRow */
function paint(pre, rows, upto, cursorRow) {
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    if (i) frag.append("\n");
    let run = "", runCls = "";
    const push = (/** @type {string} */ ch, /** @type {string} */ cls) => {
      if (cls !== runCls && run) {
        frag.append(runCls ? el("span", runCls, run) : run);
        run = "";
      }
      runCls = cls;
      run += ch;
    };
    row.forEach((c, j) => {
      const col = j - 1; // the label is j = 0
      if (col < 0) push(c.ch, c.cls ?? "");
      else if (col > upto) push(" ", "");
      else if (col === upto && i === cursorRow) push("#", "g-cursor");
      else push(c.ch, c.cls ?? "");
    });
    if (run) frag.append(runCls ? el("span", runCls, run) : run);
  });
  pre.replaceChildren(frag);
}

/**
 * Draw the graph into ``host``, building itself left to right. Resolves when done.
 * @param {HTMLElement} host @param {any} g @param {{ms?: number}} [o]
 */
export function drawGraph(host, g, o = {}) {
  const W = g.points.length;
  const title = el("div", "g-title", `${g.name} :: HP OVER TIME`);
  const pre = el("pre", "art hp-graph");
  pre.dataset.cols = String(W + LABEL);
  const legend = el("div", "g-legend");
  const most = Math.max(0, ...g.points.map((/** @type {any} */ p) => p.hits));
  legend.append(el("span", "g-line", "-- HP"), "   ", el("span", "g-heal", "^ HEAL"), "   ",
    el("span", "g-poison", "~ POISON"),
    ...(g.status === "alive" ? [] : ["   ", el("span", "g-kill", "X KILL")]),
    ...(g.points.some((/** @type {any} */ p) => p.est) ? ["   ", el("span", "g-est", "-- ESTIMATED")] : []),
    ...(g.points.some((/** @type {any} */ p) => p.hp === null) ? ["   ", el("span", "g-unknown", "? NOT RECORDED")] : []));
  // What the HITS strip means, in real numbers: each character is one slice of the fight.
  const hitsKey = el("div", "g-legend");
  hitsKey.append("HITS: ", el("span", "g-hits", "."), " few  ", el("span", "g-hits", "@"),
    ` most (${fmt(most)} hits in ${g.seconds / W < 60 ? `${Math.max(1, Math.round(g.seconds / W))}s` : duration(g.seconds / W)})`);
  host.replaceChildren(title, pre, legend, hitsKey);
  fitArt(pre, 13);
  const rows = flatten(cells(g));
  const lineRow = (/** @type {number} */ x) => {
    const hp = g.points[Math.min(x, W - 1)].hp;
    return hp === null ? H - 1 - Math.floor(H / 2) : H - 1 - Math.round((Math.max(0, Math.min(g.max_hp, hp)) / g.max_hp) * (H - 1));
  };
  const last = rows[0].length - 1; // widest column (the time labels can run past the plot)
  if (reduced) {
    paint(pre, rows, last, -1);
    return Promise.resolve();
  }
  const step = Math.max(10, (o.ms ?? 1600) / W);
  return new Promise((resolve) => {
    let x = 0;
    const tick = () => {
      if (x >= W) {
        paint(pre, rows, Math.max(last, ...rows.map((r) => r.length)), -1);
        return resolve(undefined);
      }
      paint(pre, rows, x, lineRow(x));
      x++;
      setTimeout(tick, step);
    };
    tick();
  });
}

/** Columns that fit a box ``chars`` wide. @param {number} chars */
export const graphCols = (chars) => Math.max(20, chars - LABEL);

/** The graph in its own pop-up, e.g. from [ HISTORY ]. @param {number} seq */
export function openGraph(seq) {
  return showOverlay((inner, close) => {
    inner.classList.add("graph-pop");
    const host = el("div", "hp-graph-host", "loading the fight...");
    const actions = el("div", "actions");
    const done = el("button", "", "[ CLOSE ]");
    done.addEventListener("click", close);
    actions.append(done);
    inner.append(host, actions);
    api.getBossGraph(seq, graphCols(62)).then((g) => {
      if (!host.isConnected) return;
      const stats = el("div", "g-stats dim",
        `${fmt(g.points.reduce((n, /** @type {any} */ p) => n + p.hits, 0))} HITS OVER ${duration(g.seconds)}`);
      return drawGraph(host, g).then(() => host.append(stats));
    }).catch((e) => {
      host.textContent = /** @type {Error} */ (e).message;
    });
  });
}
