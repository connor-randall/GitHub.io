// AUTO STASH: found items skip their pop-up and go straight to the bag, by
// rarity (e.g. stash commons and uncommons quietly, still pop up rare and
// up so you can equip them). Found loot chests have their own on/off switch.
// Off by default; remembered per browser (like sound). Boss relics always
// get their pop-up.

const BOX_KEY = "omhp.autostash.boxes";
const RARITY_KEY = "omhp.autostash.rarities";
const OLD_ITEMS_KEY = "omhp.autostash"; // before rarities: "on" = every item

/** Rarities that skip the pop-up; "all" = every one (the old switch, or ticked all). @type {Set<string> | "all"} */
let rarities = new Set();
let boxes = false;
try {
  boxes = localStorage.getItem(BOX_KEY) === "on";
  const saved = localStorage.getItem(RARITY_KEY);
  if (saved) rarities = new Set(JSON.parse(saved));
  else if (localStorage.getItem(OLD_ITEMS_KEY) === "on") rarities = "all";
} catch {
  /* ignore */
}

function save() {
  try {
    localStorage.removeItem(OLD_ITEMS_KEY); // replaced by the rarity list from now on
    localStorage.setItem(RARITY_KEY, JSON.stringify(rarities === "all" ? [] : [...rarities]));
  } catch {
    /* ignore */
  }
}

/** Does a found item of this rarity skip its pop-up? ("boxes": does a found chest?)
 * @param {"items" | "boxes"} [kind] @param {string} [rarity] */
export function isAutoStash(kind = "items", rarity) {
  if (kind === "boxes") return boxes;
  if (rarity === "boss_unique") return false;
  if (rarities === "all") return true;
  return rarity ? rarities.has(rarity) : rarities.size > 0;
}

/** Chests: on / off. @param {boolean} on */
export function setAutoStashBoxes(on) {
  boxes = on;
  try {
    localStorage.setItem(BOX_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

/** Items: stash one rarity quietly or not. ``all`` = every rarity in the game, in order.
 * @param {string} rarity @param {boolean} on @param {string[]} all */
export function setAutoStashRarity(rarity, on, all) {
  const set = rarities === "all" ? new Set(all) : new Set(rarities);
  if (on) set.add(rarity);
  else set.delete(rarity);
  rarities = set;
  save();
}

/** Items: stash this rarity and everything below it (the "[ AUTO STASH ... ]" pop-up button).
 * @param {string} rarity @param {string[]} all rarities, lowest first */
export function setAutoStashUpTo(rarity, all) {
  const set = rarities === "all" ? new Set(all) : new Set(rarities);
  for (const r of all.slice(0, all.indexOf(rarity) + 1)) set.add(r);
  rarities = set;
  save();
}

/** For redraw checks: what's stashed right now. */
export const autoStashKey = () => `${boxes}:${rarities === "all" ? "all" : [...rarities].sort().join(",")}`;
