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
/** Your own lines are kept apart, up to this many, so a busy feed doesn't push
 * them out (the feed's ONLY ME, ticket #120). */
export const MINE_KEEP = 1000;

/** Is this feed line yours? @param {any} e */
export const isMine = (e) => Boolean(state.me?.id && e.player_id === state.me.id);

/** The newest FEED_KEEP of everyone else's lines and MINE_KEEP of yours, oldest first. @param {any[]} events */
function keepFeed(events) {
  events.sort((a, b) => a.t - b.t || a.id - b.id);
  let others = 0;
  let mine = 0;
  const out = [];
  for (let i = events.length - 1; i >= 0; i--) {
    if (isMine(events[i]) ? mine++ < MINE_KEEP : others++ < FEED_KEEP) out.push(events[i]);
  }
  return out.reverse();
}

/** Merge events into the feed by id. Returns the genuinely new ones.
 * @param {any[]} events */
export function mergeFeed(events) {
  const seen = new Set(state.feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  if (!fresh.length) return fresh;
  state.feed = keepFeed([...state.feed, ...fresh]);
  return fresh;
}

/** Add an older page (from /api/feed) below what we have. Returns the new ones.
 * @param {any[]} events */
export function addOlderFeed(events) {
  const seen = new Set(state.feed.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  state.feed = keepFeed([...fresh, ...state.feed]);
  return fresh.filter((e) => state.feed.includes(e));
}

/** @param {string} id */
export const itemById = (id) => state.content?.items.find((/** @type {any} */ i) => i.id === id);
/** An item as YOU hold it: your refined copy's numbers and rank (THE
 * BLACKSMITH) over the catalog's, named "RUSTED SWORD [2]" once merged, or
 * just the catalog item. Only for your own copy: chat and other players see
 * the plain name. @param {any} item */
export const ownItemOf = (item) => refinedCopy(item, item ? state.me?.refined?.[item.id] : null);
/** A catalog item as one refined copy: "NAME [2]" (merged), its own numbers,
 * and what was done to it (for the item card's REFINED box). Whoever's copy it
 * is: yours, a listing's, someone's worn gear. @param {any} item
 * @param {{rank: number, mods: any, respecced?: boolean, respecs?: number, affix?: string} | null | undefined} r */
export const refinedCopy = (item, r) => (item && r ? {
  ...item, name: r.rank ? `${item.name} [${r.rank}]` : item.name, mods: r.mods,
  refine_rank: r.rank, refine_respecced: Boolean(r.respecced), refine_respecs: r.respecs ?? 0,
  refine_affix: r.affix ?? null,
} : item);
/** @param {string} id */
export const ownItem = (id) => ownItemOf(itemById(id));
/** @param {string} id */
export const rarityById = (id) => state.content?.rarities.find((/** @type {any} */ r) => r.id === id);
/** @param {string} id */
export const boxById = (id) => state.content?.boxes?.find((/** @type {any} */ b) => b.id === id);
/** @param {string} id */
export const bossDef = (id) => state.content?.bosses.find((/** @type {any} */ b) => b.id === id)
  ?? (state.boss?.def_id === id ? state.boss.definition : undefined);

export const SCROLLS = {
  freezing: { name: "FREEZING SCROLL", mini: "*/\\*", color: "#8bdcff", description: "Stops everyone else attacking for 10 seconds. You can still hit.", limits: ["One freeze at a time.", "Can't be used below 10% boss HP.", "Max 3 per player per boss."], art: ["    .-=================-.", "  _/  *   /\\   /\\  *  \\_", " / *   /\\/  \\/  \\   * \\", "|        F R E E Z E      |", "|   *      \\  /      *   |", " \\_   /\\   \\/   /\\   _/", "   '==v============v=='"] },
  poison: { name: "POISON SCROLL", mini: "o(x)o", color: "#75e36d", description: "Deals 1% of the boss's max HP over 10 seconds, counted as your damage.", limits: ["Stacks with other players' poison, not your own.", "Can't be used below 10% boss HP.", "Can't land the killing blow."], art: ["    .-=================-.", "  _/   o    O    o      \\_", " /       .-^^-.      o   \\", "|       / x  x \\          |", "|       \\  __ /  P O I S O N|", " \\_  o  '----'     O   _/", "   '==o============O=='"] },
  treasure: { name: "TREASURE SCROLL", mini: "*<>$*", color: "#ffd45c", description: "Doubles item and loot box drops for everyone for 10 seconds.", limits: ["Another one restarts the 10 seconds; they don't add up."], art: ["    .-=================-.", "  _/  *    $    <>   *  \\_", " /      .--------.       \\", "|      /_|_|__|_|_\\      |", "|      |  T R E A S U R E |", " \\_  * '--------'  $  _/", "   '==$============*=='"] },
  attack_steal: { name: "ATTACK STEAL SCROLL", mini: "[*]->+", color: "#dc8cff", description: "Takes every attack held by players online and gives them to you, plus 1 per player.", limits: ["Everyone online drops to 0 attacks.", "You get 100 at most."], art: ["    .-=================-.", "  _/ [*]  [*]  [*]     \\_", " /      \\   |   /        \\", "|         \\  |  /         |", "|      ---> [+] <---       |", " \\_   A T T A C K S   _/", "   '==^============^=='"] },
  // 2026-11-06: the SCROLL BOX's scrolls (tickets #272, #185, #208).
  fireball: { name: "FIREBALL SCROLL", mini: "~*@*~", color: "#ff7a3d", description: "Charges a fireball: your next hit deals +1,000 damage. It can land the killing blow.", limits: ["Hold up to 3 charged at once.", "Normal attacks only."], art: ["    .-=================-.", "  _/   ~  (  )  ~      \\_", " /     (  )  (  )        \\", "|    ~~~*@@@@@*~~~>      |", "|       F I R E B A L L  |", " \\_   (  )  (  )    _/", "   '==~============~=='"] },
  frenzy: { name: "FRENZY SCROLL", mini: ">>!<<", color: "#ffb347", description: "For 10 seconds, everyone's normal attacks are free.", limits: ["One frenzy at a time.", "Not during SECOND WIND (already free)."], art: ["    .-=================-.", "  _/  >>   >>   >>     \\_", " /    \\o/  \\o/  \\o/      \\", "|      |    |    |        |", "|       F R E N Z Y       |", " \\_  >>   >>   >>   _/", "   '==>============<=='"] },
  war_cry: { name: "WAR CRY SCROLL", mini: "!o!", color: "#ff5340", description: "For 10 seconds, everyone's hits do 25% more damage.", limits: ["One war cry at a time."], art: ["    .-=================-.", "  _/   !!   \\o/   !!    \\_", " /          |           \\", "|          / \\    +25%    |", "|      W A R   C R Y      |", " \\_   !!        !!   _/", "   '==!============!=='"] },
  event: { name: "EVENT SCROLL", mini: "[?!]", color: "#c99bff", description: "Starts a random world event right now.", limits: ["Only when no event is running: one at a time."], art: ["    .-=================-.", "  _/   ?    !    ?      \\_", " /     .---------.       \\", "|      |  ? ? ?  |        |", "|        E V E N T        |", " \\_   '---------'    _/", "   '==?============!=='"] },
  ruined: { name: "RUINED SCROLL", mini: "~~?~", color: "#8a8170", description: "The ink ran. It does nothing, but the CITY will take it, and the shop pays a little.", limits: ["Can't be used."], art: ["    .-=================-.", "  _/  ~  ~~   ~ .  ~   \\_", " /  ~ FRIEBAL  ~~   ~    \\", "|    ~~  .  ~ ~~   ~      |", "|   ~  ~  ~~  RUIN   ~    |", " \\_  ~   ~~   ~    _/", "   '==~============~=='"] },
  boss_heal: { name: "BOSS HEAL SCROLL", mini: "+<3+", color: "#ff6e62", description: "Heals the boss 10% of its max HP and pays you 100 shards.", limits: ["Only at 89% boss HP or lower.", "Max 3 per player per boss."], art: ["    .-=================-.", "  _/    .:::. .:::.     \\_", " /     :::::::::::::     \\", "|       ':::::::::'       |", "|         ':::::'  +10%   |", " \\_         ':'       _/", "   '==+============+=='"] },
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
