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
 * total_attacks only grows within a boss, and seq only grows across bosses.
 * @param {any} boss @returns {boolean} whether anything changed */
export function applyBoss(boss) {
  const cur = state.boss;
  if (cur && (boss.seq < cur.seq || (boss.seq === cur.seq && boss.total_attacks < cur.total_attacks)))
    return false;
  if (cur && boss.seq === cur.seq && boss.total_attacks === cur.total_attacks && boss.status === cur.status)
    return false;
  state.boss = boss;
  return true;
}

const FEED_KEEP = 80;

/** Merge events into the feed by id. Returns the genuinely new ones.
 * @param {any[]} events */
export function mergeFeed(events) {
  const seen = new Set(state.feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  if (!fresh.length) return fresh;
  state.feed = [...state.feed, ...fresh].sort((a, b) => a.id - b.id).slice(-FEED_KEEP);
  return fresh;
}

/** @param {string} id */
export const itemById = (id) => state.content?.items.find((/** @type {any} */ i) => i.id === id);
/** @param {string} id */
export const rarityById = (id) => state.content?.rarities.find((/** @type {any} */ r) => r.id === id);
/** @param {string} id */
export const bossDef = (id) => state.content?.bosses.find((/** @type {any} */ b) => b.id === id);

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
