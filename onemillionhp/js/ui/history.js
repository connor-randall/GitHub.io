// [ HISTORY ] panel: every boss instance, alive or dead.

import * as api from "../api.js";
import { RARITY_STYLE, box, centerBlock, duration, el, fmt } from "../ascii.js";
import { bossDef, state } from "../store.js";
import { showError } from "./errors.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

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
      ];
      const pre = el("pre", "history-item");
      pre.textContent = box(lines, {
        align: "left",
        padX: 2,
        style: alive ? RARITY_STYLE.common : { h: "#", v: "#", c: "#" },
      }).join("\n");
      if (!alive && def) pre.title = String(def.death_line ?? "").split(def.name).join(b.name);
      return pre;
    });
    const future = el("pre", "history-item dim");
    future.textContent = centerBlock(["BOSS #???", "", state.content?.next_boss_teaser ?? ""], 34).join("\n");
    host.replaceChildren(...parts, future);
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}
