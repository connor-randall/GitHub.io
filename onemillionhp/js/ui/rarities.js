// HELP > [ RARITIES ] (2026-11-06, players asked "is ascended better than boss
// unique?"): every rarity from weakest to strongest, how strong its stats are
// and where it comes from. Order and labels come from /api/content.

import { RARITY_STYLE, el } from "../ascii.js?v=b6664395f3";
import { state } from "../store.js?v=b6664395f3";

/** Where each rarity comes from, and how strong it is next to GODLY. */
const NOTES = /** @type {Record<string, string>} */ ({
  common: "drops from hits and chests",
  uncommon: "drops from hits and chests",
  rare: "drops from hits and chests",
  epic: "drops from hits and chests",
  legendary: "drops from hits and chests",
  mythic: "drops from hits and chests",
  godly: "the strongest drop from hits. chests too",
  ascended: "1.5x godly stats. chests only (ASCENDANT ARK); a city's #1 donor gets a 1.75x city-built one",
  boss_unique: "2x godly stats. one per boss: only that boss drops it, very rarely. sold on the AUCTION HOUSE, never the shop",
  sovereign: "3x godly stats, plus SET BONUSES. the best gear in the game: bought in THE FORGE",
});

export function renderRarities() {
  const host = /** @type {HTMLElement} */ (document.getElementById("panel-rarities"));
  // Strength order (content lists SOVEREIGN before BOSS UNIQUE; sovereign is stronger).
  const rank = (/** @type {any} */ r) => (r.id === "sovereign" ? 1 : 0);
  const list = [...(state.content?.rarities ?? [])].sort((a, b) => rank(a) - rank(b));
  const rows = el("ol", "rarity-ladder");
  list.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    const st = RARITY_STYLE[/** @type {keyof typeof RARITY_STYLE} */ (r.id)] ?? RARITY_STYLE.common;
    const li = el("li", "rarity-row");
    li.append(el("span", "rarity-n dim", `${String(i + 1).padStart(2, " ")}.`),
      el("span", `rarity-name r-${r.id}`, `${st.deco[0]}${r.label ?? r.id.toUpperCase()}${st.deco[1]}`),
      el("span", "rarity-note dim", NOTES[r.id] ?? ""));
    rows.append(li);
  });
  host.replaceChildren(
    el("div", "panel-h", "RARITIES"),
    el("div", "dim bag-note", "> weakest at the top, strongest at the bottom. a higher rarity always has bigger numbers in the same slot and theme."),
    rows,
    el("div", "dim bag-note", "> trade-off pieces (GLASS CANNON, MISER) swap some of one stat for another, but never beat the plain piece one rarity up."),
  );
}
