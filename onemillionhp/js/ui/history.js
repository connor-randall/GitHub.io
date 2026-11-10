// [ HISTORY ] panel: every boss instance, alive or dead.

import * as api from "../api.js?v=b6664395f3";
import { RARITY_STYLE, box, center, duration, el, fmt } from "../ascii.js?v=b6664395f3";
import { bossDef, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { playDeath } from "./deathfx.js?v=b6664395f3";
import { openGraph } from "./hpgraph.js?v=b6664395f3";
import { pageOf, pager } from "./pager.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
let replaying = false;
let page = 0;
const PER_PAGE = 10;
/** @type {any[]} */
let all = [];

// ---------------------------------------------------------------- history

export async function loadHistory() {
  try {
    all = [...(await api.getHistory()).bosses].sort((a, b) => b.seq - a.seq); // newest first
    drawHistory();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

function drawHistory() {
  const host = $("panel-history");
  const shown = pageOf(all, page, PER_PAGE);
  page = shown.page;
  const parts = shown.items.map((/** @type {any} */ b) => {
    const def = bossDef(b.def_id);
    const alive = b.status === "alive";
    const end = alive ? Date.now() / 1000 : b.defeated_at;
    const lines = [
      `BOSS #${String(b.seq).padStart(3, "0")}  ${b.name}`,
      alive ? `STATUS  ALIVE  ${fmt(b.hp)} / ${fmt(b.max_hp)} HP` : "STATUS  DEFEATED",
      ...(alive ? [] : [`KILLING BLOW  ${b.killer_name}`]),
      `ATTACKS  ${fmt(b.total_attacks)}`,
      `FIGHTERS ${fmt(b.unique_players)}`,
      `DAMAGE   ${fmt(b.total_damage)}${b.overkill > 0 ? "+" : ""}`,
      `${alive ? "ALIVE FOR" : "TIME ALIVE"} ${duration(end - b.started_at)}`,
      ...(!alive && def ? ["", "[ REPLAY DEATH ]"] : []),
    ];
    const pre = el("pre", "history-item");
    if (def?.tint) pre.style.setProperty("--history-tint", def.tint);
    const framed = box(lines, {
      align: "left",
      padX: 2,
      style: alive ? RARITY_STYLE.common : { h: "#", v: "#", c: "#" },
    });
    framed.forEach((line, i) => {
      if (i) pre.append("\n");
      if (i === 0 || i === framed.length - 1) pre.append(el("span", "history-border", line));
      else pre.append(el("span", "history-border", line[0]), line.slice(1, -1),
        el("span", "history-border", line.slice(-1)));
    });
    if (!alive && def) {
      pre.classList.add("history-replay");
      pre.setAttribute("role", "button");
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", `Replay ${b.name}'s death animation`);
      pre.title = `Replay ${b.name}'s death animation`;
      const replay = async () => {
        if (replaying) return;
        replaying = true;
        try {
          await playDeath({ ...def, name: b.name,
            death_line: String(def.death_line ?? "").split(def.name).join(b.name) });
        } finally {
          replaying = false;
          if (pre.isConnected) pre.focus({ preventScroll: true });
        }
      };
      pre.addEventListener("click", replay);
      pre.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          void replay();
        }
      });
    }
    const entry = el("div", "history-entry");
    const graph = el("button", "inline-btn history-graph", alive ? "[ HP GRAPH SO FAR ]" : "[ HP GRAPH ]");
    graph.addEventListener("click", () => void openGraph(b.seq));
    entry.append(pre, graph);
    return entry;
  });
  const future = el("pre", "history-item dim");
  const next = state.boss?.next_definition;
  const queuedCommunity = String(next?.id ?? "").startsWith("community_");
  // Ticket #71: a long entrance line wraps (word by word, each line centred) instead of running off.
  const W = 34;
  future.textContent = (next ? [
    "NEXT IN LINE",
    "",
    next.name,
    ...(queuedCommunity ? ["COMMUNITY BOSS", next.intro ?? ""] : [next.subtitle ?? ""]),
  ] : ["BOSS #???", "", state.content?.next_boss_teaser ?? ""])
    .flatMap((line) => wrapWords(line, W)).map((line) => center(line, W).replace(/\s+$/, "")).join("\n");
  if (next?.tint) future.style.setProperty("--history-tint", next.tint);
  const nav = (/** @type {number} */ to) => {
    page = to;
    drawHistory();
    host.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  // Coming next goes first, on page 1; the pager sits above and below the list.
  host.replaceChildren(...(page === 0 ? [future] : []), pager(page, shown.pages, nav), ...parts,
    pager(page, shown.pages, nav));
}

/** Words onto lines of at most ``w`` (a word longer than that is cut). @param {string} text @param {number} w */
function wrapWords(text, w) {
  if (text.length <= w) return [text];
  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (let word of text.split(/\s+/)) {
    while (word.length > w) {
      if (line) lines.push(line);
      lines.push(word.slice(0, w));
      word = word.slice(w);
      line = "";
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= w) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
