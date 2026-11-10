// Admin HOME: [ PLAYERS WORLDWIDE ], an ASCII world map with where players
// are (GET /api/admin/geo, server geo.py: totals only, from each player's
// latest IP). Clusters glow by size; hover one for its city. Tables underneath.
// It only scans when [ SCAN ] is clicked; otherwise it shows the last scan.

import { ago, bar, el, fmt } from "./ascii.js?v=b6664395f3";
import { WORLD } from "./world-map.js?v=b6664395f3";

const FOLD_KEY = "omhp.admin.geo_open";
const RELOAD_MS = 5 * 60_000;

/** @type {(path: string, body?: unknown) => Promise<any>} */
let fetcher = async () => ({});
/** @type {any} */
let data = null;
let loadedAt = 0;
let loading = false;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let poll;

const root = /** @type {HTMLDetailsElement} */ (el("details", "geo"));
root.open = (() => {
  try {
    return localStorage.getItem(FOLD_KEY) !== "0";
  } catch {
    return true;
  }
})();
root.addEventListener("toggle", () => {
  try {
    localStorage.setItem(FOLD_KEY, root.open ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (root.open) fit();
});

/** The panel (kept between HOME redraws). */
export const geoPanel = () => root;

/** @param {(path: string, body?: unknown) => Promise<any>} call the admin's authenticated fetch */
export function initGeo(call) {
  fetcher = call;
  render();
  window.addEventListener("resize", fit);
}

/** Fetch the last scan's totals (at most every 5 minutes; never scans). ``scan``:
 * start a new scan ([ SCAN ]), then poll until it's done. @param {boolean} [scan] */
export async function loadGeo(scan = false) {
  if (loading || (!scan && !data?.scanning && data && Date.now() - loadedAt < RELOAD_MS)) return;
  loading = true;
  clearTimeout(poll);
  try {
    data = scan ? await fetcher("/api/admin/geo/scan", {}) : await fetcher("/api/admin/geo");
    loadedAt = Date.now();
  } catch (e) {
    data = { error: /** @type {Error} */ (e).message, result: data?.result ?? null };
  } finally {
    loading = false;
  }
  if (data?.scanning) poll = setTimeout(() => void loadGeo(), 3000);
  render();
}

/** Cell glyph and heat class for a cluster of n players. @param {number} n */
const glyph = (n) => (n >= 15 ? ["@", 4] : n >= 5 ? ["O", 3] : n >= 2 ? ["o", 2] : ["+", 1]);

/** The map: land as dim dots, clusters as glowing glyphs. @param {any[]} points */
function drawMap(points) {
  const { w, h, top, bottom, rows } = WORLD;
  /** @type {Map<number, {n: number, labels: [string, number][]}>} */
  const cells = new Map();
  for (const p of points) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(((p.lon + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((top - p.lat) / (top - bottom)) * h)));
    const cell = cells.get(y * w + x) ?? { n: 0, labels: [] };
    cell.n += p.n;
    cell.labels.push([p.label, p.n]);
    cells.set(y * w + x, cell);
  }
  const pre = el("pre", "geo-map");
  for (let y = 0; y < h; y++) {
    let run = "";
    for (let x = 0; x < w; x++) {
      const cell = cells.get(y * w + x);
      if (!cell) {
        run += rows[y][x] === "#" ? "." : " ";
        continue;
      }
      if (run) pre.append(run);
      run = "";
      const [ch, heat] = glyph(cell.n);
      const dot = el("span", `geo-pt h${heat}`, String(ch));
      cell.labels.sort((a, b) => b[1] - a[1]);
      dot.dataset.info = `${cell.labels.slice(0, 3).map(([l, n]) => `${l.toUpperCase()} ${fmt(n)}`).join("  ·  ")}`
        + `${cell.labels.length > 3 ? `  +${cell.labels.length - 3} more` : ""}`;
      pre.append(dot);
    }
    pre.append(`${run}\n`);
  }
  return pre;
}

/** Labelled ASCII bars. @param {[string, number, string?][]} rows label, value, note @param {number} total */
function bars(rows, total) {
  const box = el("div", "geo-bars");
  const most = Math.max(1, ...rows.map(([, n]) => n));
  for (const [label, n, note] of rows) {
    const row = el("div", "geo-bar");
    row.append(el("span", "geo-bar-l", label), el("span", "geo-bar-b", bar(n / most, 8)),
      el("span", "geo-bar-n", `${fmt(n)}  ${((n / Math.max(1, total)) * 100).toFixed(1)}%${note ? `  ${note}` : ""}`));
    box.append(row);
  }
  return box;
}

/** A titled box of the tables underneath. @param {string} title @param {Node} body */
const card = (title, body) => {
  const c = el("div", "geo-card");
  c.append(el("div", "geo-card-h", title), body);
  return c;
};

function render() {
  const r = data?.result;
  const sum = el("summary", "geo-sum");
  sum.append(el("span", "geo-title", "PLAYERS WORLDWIDE"));
  if (r) {
    sum.append(el("span", "geo-stat", ` // ${fmt(r.players)} PLAYERS // ${fmt(r.countries.length)} COUNTRIES`));
  }
  const status = el("span", "geo-status", data?.scanning ? "SCANNING..." : r ? `scanned ${ago(Date.now() / 1000 - r.at)} ago` : "");
  const rescan = /** @type {HTMLButtonElement} */ (el("button", "inline-btn geo-rescan", data?.scanning ? "[ SCANNING... ]" : "[ SCAN ]"));
  rescan.type = "button";
  rescan.disabled = Boolean(data?.scanning);
  rescan.addEventListener("click", (e) => {
    e.preventDefault();
    void loadGeo(true);
  });
  sum.append(status, rescan);

  const screen = el("div", "geo-screen");
  screen.append(drawMap(r?.points ?? []));
  if (!r) {
    screen.append(el("div", "geo-overlay", data?.error ? `> ${data.error}`
      : data?.scanning ? "> SCANNING THE PLANET... (~10 s)" : "> NO SCAN YET. CLICK [ SCAN ] TO MAP THE PLAYERS."));
  }
  const readout = el("div", "geo-readout", "> hover a dot");
  screen.addEventListener("mouseover", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.classList?.contains("geo-pt")) readout.textContent = `> ${t.dataset.info}`;
  });
  const legend = el("div", "geo-legend");
  legend.append(el("span", "geo-pt h1", "+"), " 1  ", el("span", "geo-pt h2", "o"), " 2-4  ",
    el("span", "geo-pt h3", "O"), " 5-14  ", el("span", "geo-pt h4", "@"), " 15+ players");

  const parts = [sum, screen, el("div", "geo-under", "")];
  parts[2].append(readout, legend);
  if (r) {
    const grid = el("div", "geo-grid");
    grid.append(
      card("TOP COUNTRIES  (players · their share of attacks)", bars(r.countries.slice(0, 12)
        .map((/** @type {any} */ c) => [c.name, c.players, `| ${Math.round(c.attack_share * 100)}% atk`]), r.located)),
      card("CONTINENTS", bars(r.continents.map((/** @type {[string, number]} */ [k, n]) => [k.toUpperCase(), n]), r.located)),
      card("NETWORK", bars(r.networks.map((/** @type {[string, number]} */ [k, n]) => [k, n]), r.located)),
      card("TOP REGIONS", bars(r.regions.slice(0, 10).map((/** @type {[string, number]} */ [k, n]) => [k, n]), r.located)),
    );
    parts.push(grid, el("div", "geo-source", `${r.source}. Totals only, from each player's latest IP; nothing per player is kept.`));
  }
  root.replaceChildren(...parts);
  fit();
}

/** Size the map's font so all its columns fit the box. */
function fit() {
  const pre = /** @type {HTMLElement | null} */ (root.querySelector(".geo-map"));
  if (!pre || !root.open) return;
  const width = pre.parentElement?.clientWidth ?? 0;
  if (!width) return;
  pre.style.fontSize = `${Math.max(5, Math.min(13, (width - 4) / (WORLD.w * 0.602))).toFixed(2)}px`;
}
