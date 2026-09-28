// Human-readable item effects, shared by the bag, player panel and admin.

import { el } from "../ascii.js?v=e54d3ddffb";

/** @param {number} x */
const pct = (x) => `${(x * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** Short effect phrases for a mods object. @param {any} m @returns {string[]} */
export function effectParts(m) {
  if (!m) return [];
  const out = [];
  if (m.min_dmg) out.push(`+${m.min_dmg} MIN DMG`);
  if (m.max_dmg) out.push(`+${m.max_dmg} MAX DMG`);
  if (m.crit_chance) out.push(`+${pct(m.crit_chance)} CRIT`);
  if (m.crit_dmg) out.push(`+${pct(m.crit_dmg)} CRIT DMG`);
  if (m.double_strike) out.push(`${pct(m.double_strike)} DOUBLE STRIKE`);
  if (m.executioner) out.push(`+${pct(m.executioner)} DMG IN FINAL PHASE`);
  if (m.save_attack) out.push(`${pct(m.save_attack)} FREE ATTACK`);
  if (m.ult_refund) out.push(`${pct(m.ult_refund)} ULT RECHARGE`);
  if (m.box_find) out.push(`+${pct(m.box_find)} BOX FIND`);
  if (m.loot_mult && m.loot_mult > 1) out.push(`+${pct(m.loot_mult - 1)} LOOT`);
  return out;
}

/** What each effect means, for the item detail view. */
export const EFFECT_HELP = {
  "FREE ATTACK": "chance an attack doesn't use up one of today's attacks",
  "ULT RECHARGE": "chance a normal attack recharges your spent ultimate",
  "DOUBLE STRIKE": "chance to hit twice in one attack",
  "CRIT DMG": "crits hit harder",
  "BOX FIND": "more loot boxes",
  "FINAL PHASE": "extra damage once the boss is below 10%",
};

/** One-line summary element. @param {any} item */
export function effectLine(item) {
  const parts = effectParts(item.mods);
  return el("div", "stats", parts.length ? parts.join("  ::  ") : "NO BONUS. JUST VIBES.");
}
