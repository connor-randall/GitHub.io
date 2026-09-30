// [ HISTORY ] panel: every boss instance, alive or dead.

import * as api from "../api.js?v=b7420735b5";
import { RARITY_STYLE, box, centerBlock, duration, el, fmt } from "../ascii.js?v=b7420735b5";
import { bossDef, state } from "../store.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";
import { playDeath } from "./deathfx.js?v=b7420735b5";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
let replaying = false;

// ---------------------------------------------------------------- history

export async function loadHistory() {
  const host = $("panel-history");
  try {
    const { bosses } = await api.getHistory();
    const parts = bosses.map((/** @type {any} */ b) => {
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
      return pre;
    });
    const future = el("pre", "history-item dim");
    const next = state.boss?.next_definition;
    const queuedCommunity = String(next?.id ?? "").startsWith("community_");
    future.textContent = centerBlock(next ? [
      "NEXT IN LINE",
      "",
      next.name,
      ...(queuedCommunity ? ["COMMUNITY BOSS", next.intro ?? ""] : [next.subtitle ?? ""]),
    ] : ["BOSS #???", "", state.content?.next_boss_teaser ?? ""], 34).join("\n");
    if (next?.tint) future.style.setProperty("--history-tint", next.tint);
    host.replaceChildren(...parts, future);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}
