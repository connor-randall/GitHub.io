// Minimal shared client state with change notification.

/**
 * @typedef {{
 *   content: any | null,
 *   boss: any | null,
 *   me: any | null,
 *   feed: any[],
 *   online: number,
 *   lastHit: {damage: number, crit: boolean, kind: string} | null,
 *   serverSkew: number,
 * }} State
 */

/** @type {State} */
export const state = {
  content: null,
  boss: null,
  me: null,
  feed: [],
  online: 0,
  lastHit: null,
  serverSkew: 0, // server_time - local time, seconds
};

/** @type {Map<string, Set<() => void>>} */
const subs = new Map();

/** @param {string} key @param {() => void} fn */
export function on(key, fn) {
  if (!subs.has(key)) subs.set(key, new Set());
  subs.get(key)?.add(fn);
}

/** @param {...string} keys */
export function emit(...keys) {
  for (const k of keys) subs.get(k)?.forEach((fn) => fn());
}

/** Server-aligned "now" in seconds. */
export const now = () => Date.now() / 1000 + state.serverSkew;

/** Apply a boss snapshot only if it's not older than what we have.
 * revision grows for attacks and scroll effects; seq grows across bosses.
 * @param {any} boss @returns {boolean} whether anything changed */
export function applyBoss(boss) {
  // Community bosses arrive from the database rather than the deployed JSON.
  // Carry their definition with the live snapshot so already-open games can
  // render the next queued boss without a refresh.
  if (boss.definition && state.content && !state.content.bosses.some((/** @type {any} */ b) => b.id === boss.def_id)) {
    state.content.bosses.push(boss.definition);
  }
  const cur = state.boss;
  if (cur && (boss.seq < cur.seq || (boss.seq === cur.seq && (boss.revision ?? boss.total_attacks) < (cur.revision ?? cur.total_attacks))))
    return false;
  if (cur && boss.seq === cur.seq && (boss.revision ?? boss.total_attacks) === (cur.revision ?? cur.total_attacks) && boss.status === cur.status)
    return false;
  state.boss = boss;
  return true;
}

// The feed scrolls back a little way, not forever: the newest this many lines.
export const FEED_KEEP = 300;

/** Merge events into the feed by id. Returns the genuinely new ones.
 * @param {any[]} events */
export function mergeFeed(events) {
  const seen = new Set(state.feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  if (!fresh.length) return fresh;
  state.feed = [...state.feed, ...fresh].sort((a, b) => a.t - b.t || a.id - b.id).slice(-FEED_KEEP);
  return fresh;
}

/** Add an older page (from /api/feed) below what we have. Returns the new ones.
 * @param {any[]} events */
export function addOlderFeed(events) {
  const seen = new Set(state.feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  state.feed = [...fresh, ...state.feed].sort((a, b) => a.t - b.t || a.id - b.id).slice(-FEED_KEEP);
  return fresh.filter((e) => state.feed.includes(e));
}

/** @param {string} id */
export const itemById = (id) => state.content?.items.find((/** @type {any} */ i) => i.id === id);
/** @param {string} id */
export const rarityById = (id) => state.content?.rarities.find((/** @type {any} */ r) => r.id === id);
/** @param {string} id */
export const boxById = (id) => state.content?.boxes?.find((/** @type {any} */ b) => b.id === id);
/** @param {string} id */
export const bossDef = (id) => state.content?.bosses.find((/** @type {any} */ b) => b.id === id)
  ?? (state.boss?.def_id === id ? state.boss.definition : undefined);

export const SCROLLS = {
  freezing: { name: "FREEZING SCROLL", mini: "*/\\*", color: "#8bdcff", description: "Freezes everyone online for 10 seconds. No attacks can be made.", art: ["    .-=================-.", "  _/  *   /\\   /\\  *  \\_", " / *   /\\/  \\/  \\   * \\", "|        F R E E Z E      |", "|   *      \\  /      *   |", " \\_   /\\   \\/   /\\   _/", "   '==v============v=='"] },
  poison: { name: "POISON SCROLL", mini: "o(x)o", color: "#75e36d", description: "Poisons the boss for 10 seconds, dealing chip damage over time.", art: ["    .-=================-.", "  _/   o    O    o      \\_", " /       .-^^-.      o   \\", "|       / x  x \\          |", "|       \\  __ /  P O I S O N|", " \\_  o  '----'     O   _/", "   '==o============O=='"] },
  treasure: { name: "TREASURE SCROLL", mini: "*<>$*", color: "#ffd45c", description: "Doubles item and loot-box drop chances for everyone for 10 seconds.", art: ["    .-=================-.", "  _/  *    $    <>   *  \\_", " /      .--------.       \\", "|      /_|_|__|_|_\\      |", "|      |  T R E A S U R E |", " \\_  * '--------'  $  _/", "   '==$============*=='"] },
  attack_steal: { name: "ATTACK STEAL SCROLL", mini: "[*]->+", color: "#dc8cff", description: "Steals every attack held by online players, resets them to 0, then gives you the stolen total plus +1 per online player, capped at 100.", art: ["    .-=================-.", "  _/ [*]  [*]  [*]     \\_", " /      \\   |   /        \\", "|         \\  |  /         |", "|      ---> [+] <---       |", " \\_   A T T A C K S   _/", "   '==^============^=='"] },
  boss_heal: { name: "BOSS HEAL SCROLL", mini: "+<3+", color: "#ff6e62", description: "Restores 10% of the boss's maximum life. Usable only at 89% HP or lower.", art: ["    .-=================-.", "  _/    .:::. .:::.     \\_", " /     :::::::::::::     \\", "|       ':::::::::'       |", "|         ':::::'  +10%   |", " \\_         ':'       _/", "   '==+============+=='"] },
};

/**
 * Boss-flavoured text (taunts, epitaph, prompts) written for the boss's
 * default name and HP, rewritten for the current boss: an admin rename or a
 * new max HP shows up everywhere.
 * @param {string} text
 */
export function bossText(text) {
  const b = state.boss;
  const def = b && bossDef(b.def_id);
  if (!b || !def) return text;
  let out = text;
  if (def.name && b.name && def.name !== b.name) out = out.split(def.name).join(b.name);
  const defHp = Number(def.max_hp).toLocaleString("en-US");
  if (b.max_hp !== def.max_hp) out = out.split(defHp).join(Number(b.max_hp).toLocaleString("en-US"));
  return out;
}

/** Current boss name, for UI copy. */
export const bossName = () => state.boss?.name ?? "THE BOSS";
