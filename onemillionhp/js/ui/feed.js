// Global activity feed.

import { RARITY_STYLE, ago, el, fmt } from "../ascii.js?v=b6664395f3";
import * as api from "../api.js?v=b6664395f3";
import { FEED_KEEP, MINE_KEEP, SCROLLS, addOlderFeed, boxById, isMine, itemById, mergeFeed, now, on, rarityById, state }
  from "../store.js?v=b6664395f3";
import { crownStar, withBadges } from "./badges.js?v=b6664395f3";
import { adminTag } from "./notice.js?v=b6664395f3";

const list = /** @type {HTMLOListElement} */ (document.getElementById("feed"));
const jump = /** @type {HTMLButtonElement} */ (document.getElementById("feed-jump"));
/** Scrolled down reading history: new lines wait until you're back at the top. */
const paused = () => list.scrollTop > 24;

/** TEAMS: which side this line's player is on, if a match is on and the line
 * belongs to it. @param {any} e */
function sideOf(e) {
  const ev = state.boss?.status === "alive" ? state.boss.event : null;
  if (ev?.kind !== "teams" || !e.player_id || e.t < ev.started_at) return null;
  return ev.teams_of?.[e.player_id] ?? null;
}

/** Build the message spans for one event. @param {any} e @returns {Node[]} */
function message(e) {
  const side = sideOf(e);
  const who = () => {
    const name = withBadges(e.badges, e.player_id, el("span", "who", e.name ?? "?"));
    if (!side) return name;
    const tagged = el("span", "");
    tagged.append(el("span", `team-tag ${side}`, `[${side.toUpperCase()}] `), name);
    return tagged;
  };
  const num = (/** @type {number} */ n) => el("span", "num", fmt(n));
  const txt = (/** @type {string} */ s) => document.createTextNode(s);
  switch (e.kind) {
    case "hit":
    case "crit":
    case "ultimate":
      // POSSESSION: their hit went into the boss's HP bar the wrong way.
      if (e.possessed || e.heal) {
        return [lead(e), who(), el("span", "possessed-tag", " is POSSESSED and HEALED "),
          txt(bossNameOf(e)), txt(" "), el("span", "heal-num", `+${fmt(e.heal ?? 0)}`)];
      }
      // SHIELD WALL: the shield took it, not the boss.
      if (e.shield) return [lead(e), who(), txt(" hit the SHIELD for "), num(e.damage), ...procTags(e)];
      if (e.kind === "crit") return [lead(e), who(), txt(" landed a CRITICAL for "), num(e.damage), txt(" !!"), ...procTags(e)];
      if (e.kind === "ultimate" && e.ult) { // CHARM ULTS: what it did, not a number
        return [lead(e), who(), txt(" used "), el("span", "ult-tag", e.ult_name ?? "ULTIMATE"),
          txt(e.text ? `: ${e.text}` : ""), ...procTags(e)];
      }
      if (e.kind === "ultimate") return [lead(e), who(), txt(" used ULTIMATE for "), num(e.damage), ...procTags(e)];
      return [lead(e), who(), txt(" hit "), txt(bossNameOf(e)), txt(" for "), num(e.damage),
        ...procTags(e)];
    case "box": {
      const b = boxById(e.box_id);
      return [lead(e), who(), txt(" found a "), el("span", "box-tag", `[${b?.name ?? e.box_id}]`)];
    }
    case "unbox": {
      const b = boxById(e.box_id);
      const bits = [lead(e), who(), txt(" opened "), el("span", "box-tag", `[${b?.name ?? e.box_id}]`), txt(" -> ")];
      if (e.reward === "item" && e.item_id) {
        const item = itemById(e.item_id);
        const r = rarityById(e.rarity);
        const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
        bits.push(el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`));
      } else if (e.reward === "attacks") bits.push(txt(`+${e.amount} ATTACK${e.amount > 1 ? "S" : ""}`));
      else if (e.reward === "next_crit") bits.push(txt(`${e.amount} CRIT CHARGE${e.amount > 1 ? "S" : ""}`));
      else bits.push(txt("ULTIMATE RECHARGED"));
      if (e.sold) bits.push(txt(" (auto-sold "), el("span", "shard-tag", `<> ${e.sold}`), txt(")"));
      return bits;
    }

    case "unbox_many": // OPEN ALL: one line for the batch
      return [lead(e), who(), txt(` opened ${fmt(e.count)} chest${e.count === 1 ? "" : "s"}`)];

    case "event":
      return eventLine(e, who, num, txt);
    case "scroll_drop":
      return [lead(e), who(), txt(` found a ${(e.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} SCROLL` )];
    case "scroll_use":
      return e.scroll_id === "freezing"
        ? [el("span", "feed-ice", "▼▼▼ "), who(), txt(" DEPLOYED FREEZING — EVERYONE IS FROZEN "),
          el("span", "feed-ice", " ▼▼▼")]
        : e.scroll_id === "event" // the EVENT scroll: the event's own start line follows
          ? [txt(">>> "), who(), txt(" READ AN EVENT SCROLL... <<<")]
          : e.scroll_id === "fireball"
            ? [txt(">>> "), who(), txt(" CHARGED A FIREBALL: +1,000 ON THEIR NEXT HIT <<<")]
            : [txt(">>> "), who(), txt(` DEPLOYED ${(e.scroll_id ?? "").replaceAll("_", " ").toUpperCase()} <<<`)];
    case "poison_complete":
      return e.name
        ? [txt(">>> "), who(), txt("'S POISON FINISHED: "), num(e.damage), txt(" TOTAL DAMAGE <<<")]
        : [txt(">>> POISON FINISHED: "), num(e.damage), txt(" TOTAL DAMAGE <<<")];
    case "loot": {
      const item = itemById(e.item_id);
      const r = rarityById(e.rarity);
      const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
      const tag = el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`);
      return [lead(e), who(), txt(" found "), tag,
        ...(e.sold ? [txt(" (auto-sold "), el("span", "shard-tag", `<> ${e.sold}`), txt(")")] : [])];
    }
    case "unique_gift": { // ticket #186: a BOSS UNIQUE paid everyone online
      const item = itemById(e.item_id);
      return [txt(">>> "), who(), txt(" found "), el("span", "r-boss_unique", item?.name ?? e.item_id),
        txt(`: ${fmt(e.count)} player${e.count === 1 ? "" : "s"} online got `), el("span", "shard-tag", `<> ${e.shards}`),
        txt(" <<<")];
    }
    case "forge": { // THE FORGE: someone filled a Sovereign bar (forge.py)
      const item = itemById(e.item_id);
      return [txt(e.first ? "$$$ FIRST EVER $$$ " : "$$ "), who(), txt(" FORGED "),
        el("span", `r-sovereign${item?.gear_set ? ` set-${item.gear_set}` : ""}`, `<$ SOVEREIGN $> ${item?.name ?? e.item_id}`),
        txt(" $$")];
    }
    case "sell": {
      const item = itemById(e.item_id);
      const r = rarityById(e.rarity);
      const st = RARITY_STYLE[e.rarity] ?? RARITY_STYLE.common;
      const tag = el("span", `r-${e.rarity}`, `${st.deco[0]}${r?.label ?? e.rarity}${st.deco[1]} ${item?.name ?? e.item_id}`);
      return [lead(e), who(), txt(" sold "), ...(e.count > 1 ? [txt(`${e.count} x `)] : []), tag,
        txt(" for "), el("span", "shard-tag", `<> ${e.shards}`)];
    }
    case "sellall":
      return [lead(e), who(), txt(` sold ${e.count} duplicate${e.count > 1 ? "s" : ""} for `),
        el("span", "shard-tag", `<> ${e.shards}`)];
    case "autosell":
      return [lead(e), who(), txt(` auto-sold ${e.count} item${e.count > 1 ? "s" : ""} for `),
        el("span", "shard-tag", `<> ${e.shards}`)];
    case "prestige":
      return [lead(e), who(), txt(" reached "), el("span", "admin-text", e.count > 1 ? `PRESTIGE ${e.count}` : "PRESTIGE"), txt("!")];
    case "buy":
      if (e.scroll_id) {
        const def = SCROLLS[/** @type {keyof typeof SCROLLS} */ (e.scroll_id)];
        const tag = el("span", "", def?.name ?? e.scroll_id);
        if (def) tag.style.setProperty("color", def.color);
        return [lead(e), who(), txt(e.count > 1 ? ` bought ${fmt(e.count)}x ` : " bought a "), tag, txt(" for "),
          el("span", "shard-tag", `<> ${fmt(e.shards)}`)];
      }
      return [lead(e), who(), txt(e.count > 1 ? ` bought ${fmt(e.count)}x ` : " bought "),
        el("span", "box-tag", boxById(e.box_id)?.name ?? e.box_id), txt(" for "), el("span", "shard-tag", `<> ${fmt(e.shards)}`)];
    case "phase_gift":
      return [txt(`>>> ${e.boss} DROPPED LOOT: ${e.count} player${e.count === 1 ? "" : "s"} online got `),
        el("span", "box-tag", `[${boxById(e.box_id)?.name ?? e.box_id}]`), txt(" <<<")];
    case "phase":
      return [txt(`>>> ${e.boss} ENTERS ${e.label} <<<`)];
    case "donate": {
      const what = e.what === "shards" ? `${fmt(e.count)} shard${e.count === 1 ? "" : "s"}`
        : e.what === "dupes" ? `${fmt(e.count)} duplicate item${e.count === 1 ? "" : "s"}`
        : e.what === "rarity" || e.what === "rarity_spares"
          ? `${fmt(e.count)} ${rarityById(e.ref)?.label ?? e.ref} item${e.count === 1 ? "" : "s"}`
        : e.what === "item" ? `${e.count > 1 ? `${e.count} x ` : ""}${itemById(e.ref)?.name ?? e.ref}`
          : e.what === "box" ? `${e.count > 1 ? `${e.count} x ` : ""}${boxById(e.ref)?.name ?? e.ref}`
            : `${e.count > 1 ? `${e.count} x ` : ""}${(e.ref ?? "").replace("_", " ")} scroll`;
      return [lead(e), who(), txt(` gave the city ${what} `), el("span", "city-pts", `(+${fmt(e.points)})`)];
    }
    case "city_built":
      return [el("span", "city-built-line", e.city
        ? `*** ${e.building} IS FINISHED! EVERY CITY PERK IS DOUBLED ***`
        : `*** THE CITY BUILT ${e.building}! ***`)];
    case "crown": // the day's biggest hit took the CROWN (server/omhp/crown.py)
      return [lead(e), who(), el("span", "crown-line",
        e.prev ? ` STOLE THE CROWN FROM ${e.prev} WITH A HIT OF ${fmt(e.damage)}!` : ` TOOK THE CROWN WITH A HIT OF ${fmt(e.damage)}!`)];
    case "defeat":
      // Ticket #238: the hit and how far past 0 HP it went (older lines have neither).
      return [txt("### "), who(), txt(` DEALT THE KILLING BLOW TO ${e.boss}${e.damage ? ` WITH ${fmt(e.damage)}` : ""}${
        e.overkill > 0 ? ` (${fmt(e.overkill)} OVERKILL)` : ""} ###`)];
    case "admin":
      return [adminTag(), txt(" "), el("span", "admin-text", e.text ?? "")];
    case "spawn":
      return [txt(`>>> BOSS #${String(e.number).padStart(3, "0")} ${e.boss} HAS APPEARED <<<`)];
    default: // something newer than this page knows how to show
      return e.name ? [lead(e), who(), txt(` ${e.kind}`)] : [txt(`> ${e.kind}`)];
  }
}

/** The boss a line is about: the current one's name only for its own lines.
 * (Every older line used to take the new boss's name after a kill.) @param {any} e */
function bossNameOf(e) {
  const b = state.boss;
  return b && (e.boss_seq === null || e.boss_seq === undefined || e.boss_seq === b.seq) ? b.name ?? "the boss" : "the boss";
}

/** The "> " a player's line starts with: the crown instead while they hold
 * today's CROWN (server/omhp/crown.py; the boss snapshot says who). @param {any} e */
function lead(e) {
  const span = el("span", "lead");
  span.dataset.pid = e.player_id ?? "";
  paintLead(span);
  return span;
}

/** @param {HTMLElement} span */
function paintLead(span) {
  const crowned = Boolean(span.dataset.pid) && span.dataset.pid === state.boss?.crown?.player_id;
  if (span.firstChild && crowned === span.classList.contains("crowned")) return;
  span.classList.toggle("crowned", crowned);
  span.replaceChildren(...(crowned ? [crownStar(), " "] : ["> "]));
}

/** The CROWN changed hands (or a new day began): move it to the new holder's lines. */
let crownedPid = "";
export function paintCrowns() {
  const pid = state.boss?.crown?.player_id ?? "";
  if (pid === crownedPid) return;
  crownedPid = pid;
  list.querySelectorAll(".lead").forEach((s) => paintLead(/** @type {HTMLElement} */ (s)));
}

/** Short tags for item effects that fired on a hit. @param {any} e */
function procTags(e) {
  const tags = [e.fire && "2X", e.double && "x2", e.saved && "FREE", e.refund && "ULT+",
    e.event === "windup" && "WIND-UP 2x", e.event === "stagger" && "STAGGER", e.combo >= 2 && `${e.combo}-HIT COMBO`,
    e.deal === "won" && "DEAL WON", e.deal === "lost" && "DEAL LOST", e.shard && `+${e.shard} <>`].filter(Boolean);
  return tags.length ? [el("span", "proc-tag", ` [${tags.join(" ")}]`)] : [];
}

/** A world event line. @param {any} e @param {() => Node} who
 * @param {(n: number) => Node} num @param {(s: string) => Node} txt @returns {Node[]} */
function eventLine(e, who, num, txt) {
  const tag = (/** @type {string} */ s) => el("span", "event-tag", s);
  const NAMES = /** @type {Record<string, string>} */ ({ windup: "WIND-UP", overload: "OVERLOAD", merchant: "THE MERCHANT",
    stash: "A STASH", replay: "REPLAY", combo: "COMBO", fog: "FOG", swap: "SWAP MEET", deal: "THE DEAL", second_wind: "SECOND WIND",
    shard_rain: "SHARD RAIN", shield: "SHIELD WALL", hunt: "THE HUNT", hill: "KING OF THE HILL", teams: "TEAMS",
    well: "THE WISHING WELL", laststand: "LAST STAND", possess: "POSSESSION", meow: "MEOW MODE" });
  const name = NAMES[e.ev] ?? e.ev;
  const START = /** @type {Record<string, string>} */ ({
    windup: "WIND-UP! ULTIMATES DO 2x IN 30 SECONDS. HOLD THEM.",
    overload: "OVERLOAD! FILL THE METER AND EVERYONE WHO HELPED GETS THEIR ULT BACK.",
    merchant: "THE MERCHANT HAS ARRIVED. 3 MINUTES. NO REFUNDS.",
    stash: "A STASH APPEARED! BREAK IT AND EVERYONE WHO HIT IT GETS A BOX.",
    replay: "RECORDING... EVERYTHING HIT IN THE NEXT 30s LANDS AGAIN.",
    combo: "COMBO! KEEP HITTING WITHIN 2s OF EACH OTHER: UP TO 10x DAMAGE ON NORMAL HITS.",
    fog: "THE FOG ROLLED IN. THE HP BAR LIES AND THE FEED IS LOST IN IT. BOX FIND +50%.",
    swap: "SWAP MEET! EVERYONE IS WEARING SOMEONE ELSE'S GEAR.",
    deal: "A STRANGER OFFERS A DEAL...",
    shard_rain: "SHARD RAIN! FOR 30 SECONDS EVERY ATTACK GIVES +1 SHARD.",
    second_wind: "IT GOT BACK UP! ROUND 2: FREE ATTACKS AND 5x LOOT UNTIL IT FALLS. SPAM IT!",
    shield: "SHIELD WALL! IT BLOCKS EVERY HIT. BREAK IT AND EVERYONE WHO HIT IT GETS A BOX.",
    hunt: "THE HUNT! TAP THE BOSS WHERE THE WEAK SPOT IS FOR 3x LOOT.",
    hill: "KING OF THE HILL! MOST HITS IN 2 MINUTES. THE TOP 3 GET A BOX.",
    teams: "RED vs BLUE! EVERYONE ONLINE PICKED A SIDE. MORE HITS WINS A BOX EACH.",
    well: "A WISHING WELL! FILL IT WITH SHARDS TOGETHER AND EVERY THROWER GETS 2x BACK.",
    laststand: "LAST STAND! DRAIN ITS RAGE WITH HITS, OR IT HEALS 10%.",
    meow: "=^.^= MEOW MODE! 10 CATS ARE IN EVERYONE'S WAY. PET THEM ALL TO ATTACK (1-10 SHARDS EACH). CHAT IS ALL (meow).",
  });
  switch (e.stage) {
    case "start":
      if (e.ev === "second_wind" && (e.round ?? 2) > 2) { // ticket #268
        return [tag(`>>> ${e.round === 3 ? "THIRD" : "FOURTH"} WIND! IT GOT BACK UP AGAIN! ROUND ${e.round}: FREE ATTACKS AND ${e.round === 3 ? 8 : 12}x LOOT. SPAM IT! <<<`)];
      }
      if (e.ev === "possess") {
        if (e.count === 1 || !e.count) return [tag(">>> POSSESSION! "), who(), tag("'S HITS HEAL THE BOSS. HIT IT TO FREE THEM! <<<")];
        const names = (e.names ?? []).join(", ") + (e.count > (e.names ?? []).length ? ", ..." : "");
        return [tag(">>> POSSESSION! "), num(e.count), tag(` FIGHTERS ARE POSSESSED (${names}): THEIR HITS HEAL THE BOSS. HIT IT TO FREE THEM! <<<`)];
      }
      return [tag(`>>> ${START[e.ev] ?? `${name} STARTED`} <<<`)];
    case "live": return [tag(">>> THE OPENING! ULTIMATES DO 2x FOR 10 SECONDS! <<<")];
    case "full": return [tag(`>>> OVERLOAD! ${e.count} FIGHTER${e.count === 1 ? "" : "S"} GOT THEIR ULTIMATE BACK. BOSS STAGGERED x1.5! <<<`)];
    case "fizzle": return [tag(">>> THE OVERLOAD FIZZLED. <<<")];
    case "broken": return [tag(`>>> ${e.ev === "shield" ? "SHIELD" : "STASH"} BROKEN! `), num(e.count), tag(` FIGHTER${e.count === 1 ? "" : "S"} GET A BOX. TOP HITTER: `), who(), tag(" <<<")];
    case "escaped": return [tag(">>> THE STASH GOT AWAY. <<<")];
    case "held":
      if (e.ev === "laststand") return [tag(">>> THE LAST STAND HELD! "), num(e.count), tag(` FIGHTER${e.count === 1 ? "" : "S"} GET A BOX <<<`)];
      return [tag(">>> THE SHIELD HELD... AND CRUMBLED AWAY. <<<")];
    case "raged": return [tag(">>> ITS RAGE BOILED OVER. THE BOSS HEALED "), num(e.healed ?? 0), tag(" <<<")];
    case "granted": return [tag(">>> THE WISH IS GRANTED! "), num(e.count), tag(` THROWER${e.count === 1 ? "" : "S"} GOT `), num(e.given ?? 0), tag(" SHARDS BACK <<<")];
    case "dry": return [tag(">>> THE WELL RAN DRY. "), num(e.filled ?? 0), tag(" SHARDS SANK <<<")];
    case "refund": return [tag(">>> THE BOSS FELL BEFORE THE WELL FILLED. "), num(e.count ?? 0), tag(` THROWER${e.count === 1 ? "" : "S"} GOT `), num(e.given ?? 0), tag(" SHARDS BACK <<<")];
    case "freed": return [tag(">>> EXORCISED! "), num(e.possessed ?? 1), tag(` POSSESSED FIGHTER${e.possessed === 1 ? " IS" : "S ARE"} FREE. `), num(e.count), tag(` EXORCIST${e.count === 1 ? "" : "S"} GET A BOX <<<`)];
    case "payout": return [tag(">>> REPLAY! "), num(e.damage), tag(" DAMAGE LANDED AGAIN <<<")];
    case "sale": {
      const item = e.item_id ? itemById(e.item_id) : null;
      const what = e.box_id ? el("span", "box-tag", boxById(e.box_id)?.name ?? e.box_id)
        : el("span", `r-${e.rarity}`, `${e.what === "wild" ? "THE ??? ... " : ""}${rarityById(e.rarity)?.label ?? e.rarity} ${item?.name ?? ""}`);
      return [txt("$ "), who(), txt(" bought "), what, txt(" from the merchant")];
    }
    case "taken": return [txt("? "), who(), txt(e.offer === "double" ? " took the deal: next ultimate is 2x or nothing" : " took the deal: 5 attacks for "),
      ...(e.box_id ? [el("span", "box-tag", boxById(e.box_id)?.name ?? e.box_id)] : [])];
    case "end":
      if (e.ev === "combo") return [tag(`>>> COMBO OVER. BEST CHAIN: ${e.best ?? 0} HITS <<<`)];
      if (e.ev === "shard_rain") return [tag(">>> THE SHARD RAIN STOPPED. "), num(e.given ?? 0), tag(" SHARDS RAINED DOWN <<<")];
      if (e.ev === "second_wind") {
        return [tag(e.again ? ">>> DOWN... ": ">>> DOWN FOR GOOD. "), num(e.count ?? 0),
          tag(` FIGHTER${e.count === 1 ? "" : "S"} MADE IT THROUGH ROUND ${e.round ?? 2} <<<`)];
      }
      if (e.ev === "hunt") {
        return e.name ? [tag(">>> THE HUNT IS OVER. TOP HUNTER: "), who(), tag(" WITH "), num(e.hits ?? 0), tag(" SPOT HITS <<<")]
          : [tag(">>> THE HUNT IS OVER. NOBODY FOUND THE WEAK SPOT. <<<")];
      }
      if (e.ev === "hill") return e.name ? [tag(">>> "), who(), tag(" IS KING OF THE HILL! THE TOP 3 GET A BOX <<<")] : [tag(">>> NOBODY CLIMBED THE HILL. <<<")];
      if (e.ev === "teams") {
        const w = e.winner === "tie" ? "IT'S A TIE" : e.winner ? `${String(e.winner).toUpperCase()} WINS` : "NOBODY HIT";
        return [tag(`>>> ${w}! RED `), num(e.red ?? 0), tag(" :: BLUE "), num(e.blue ?? 0), tag(" <<<")];
      }
      if (e.ev === "meow") return [tag(">>> MEOW MODE IS OVER. "), num(e.petted ?? 0), tag(" CATS PETTED BY "), num(e.count ?? 0), tag(` FIGHTER${e.count === 1 ? "" : "S"} FOR `), num(e.given ?? 0), tag(" SHARDS <<<")];
      if (e.ev === "possess") return [tag(">>> THE SPIRITS LEFT. THE POSSESSED HEALED THE BOSS "), num(e.healed ?? 0), tag(" <<<")];
      return [tag(`>>> ${name} IS OVER <<<`)];
    case "cancel": return [tag(`>>> ${name} ENDED EARLY <<<`)];
    default: return [tag(`>>> ${name} <<<`)];
  }
}

// ------------------------------------------------------------- filter
// [ SHOW ▾ ] by the heading: tick what the feed shows. Each line carries its
// category (cat-<id>) and the list hides the unticked ones with CSS, so a
// change is instant and nothing is redrawn. Boss lines (spawn, phase, kill)
// and the admin's always show. Remembered per browser.

/** [id, label, kinds]. */
const CATEGORIES = /** @type {const} */ ([
  ["attacks", "ATTACKS", ["hit", "crit", "ultimate"]],
  ["loot", "ITEMS", ["loot", "scroll_drop", "forge", "unique_gift"]],
  ["boxes", "BOXES", ["box", "unbox", "unbox_many", "phase_gift"]],
  ["scrolls", "SCROLLS USED", ["scroll_use", "poison_complete"]],
  ["shop", "SHOP", ["sell", "sellall", "autosell", "buy"]],
  ["city", "CITY", ["donate", "city_built"]],
  ["events", "WORLD EVENTS", ["event"]],
]);
/** @type {Map<string, string>} kind -> category */
const CAT_OF = new Map(CATEGORIES.flatMap(([id, , kinds]) => kinds.map((k) => /** @type {[string, string]} */ ([k, id]))));
const FILTER_KEY = "omhp.feed.hide";
const RARITY_KEY = "omhp.feed.hide_rarity";
const ONLY_ME_KEY = "omhp.feed.only_me";
/** Kinds whose line names an item (and so its rarity): drops, chests that gave one, sales. */
const ITEM_LINES = new Set(["loot", "unbox", "sell"]);

/** Categories switched off. @type {Set<string>} */
const hiddenCats = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((c) => CATEGORIES.some(([id]) => id === c)) : []);
  } catch {
    return new Set();
  }
})();

/** Item rarities switched off (their item lines hide, whatever the category). @type {Set<string>} */
const hiddenRarities = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(RARITY_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((r) => typeof r === "string" && /^[a-z_]+$/.test(r)) : []);
  } catch {
    return new Set();
  }
})();
/** ONLY ME (ticket #77): just your own lines (attacks, drops, sales...). */
let onlyMe = (() => {
  try {
    return localStorage.getItem(ONLY_ME_KEY) === "1";
  } catch {
    return false;
  }
})();
/** One rule per hidden rarity (rarities come from the content, so no fixed CSS). */
const rarityStyle = document.head.appendChild(document.createElement("style"));
/** The player id the ONLY ME rule was written for. @type {string | undefined} */
let styledFor;
let raritiesOpen = false;

/** Whether an event's line gets past the SHOW filters: the same rules as
 * applyFilter's CSS (category, item rarity, ONLY ME). @param {any} e */
function shown(e) {
  const cat = CAT_OF.get(e.kind);
  if (cat && hiddenCats.has(cat)) return false;
  if (ITEM_LINES.has(e.kind) && e.rarity && (e.kind !== "unbox" || e.reward === "item") && hiddenRarities.has(e.rarity)) return false;
  return !(onlyMe && styledFor && e.player_id !== styledFor);
}

function applyFilter() {
  for (const [id] of CATEGORIES) list.classList.toggle(`hide-${id}`, hiddenCats.has(id));
  const me = state.me?.id;
  styledFor = me;
  rarityStyle.textContent = [...hiddenRarities].map((r) => `#feed li.rar-${r} { display: none; }`)
    // Matched by player id, not the .me class, so lines drawn before you loaded still count.
    .concat(onlyMe && me && /^[0-9a-f]+$/.test(me) ? [`#feed li:not([data-pid="${me}"]):not(.feed-end) { display: none; }`] : [])
    .join("\n");
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...hiddenCats]));
    localStorage.setItem(RARITY_KEY, JSON.stringify([...hiddenRarities]));
    localStorage.setItem(ONLY_ME_KEY, onlyMe ? "1" : "0");
  } catch {
    /* private mode: just for this visit */
  }
}

/** The [ SHOW ▾ ] menu. */
function buildFilter() {
  const host = document.getElementById("feed-filter");
  if (!host) return;
  const btn = /** @type {HTMLButtonElement} */ (el("button", "feed-dd-btn", ""));
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  const menu = el("div", "feed-dd-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  /** [ RARITIES ▾ ] under ITEMS: one checkbox per item rarity. */
  const rarityRows = () => {
    const rarities = (state.content?.rarities ?? []);
    const toggle = /** @type {HTMLButtonElement} */ (el("button", `feed-dd-sub${hiddenRarities.size ? " on-some" : ""}`,
      `${raritiesOpen ? "\u25BE" : "\u25B8"} RARITIES${hiddenRarities.size ? ` (${rarities.length - hiddenRarities.size}/${rarities.length})` : ""}`));
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(raritiesOpen));
    toggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      raritiesOpen = !raritiesOpen;
      paint();
      /** @type {HTMLElement | null} */ (menu.querySelector(".feed-dd-sub"))?.focus({ preventScroll: true });
    });
    if (!raritiesOpen) return [toggle];
    return [toggle, ...rarities.map((/** @type {any} */ r) => {
      const on = !hiddenRarities.has(r.id);
      const b = /** @type {HTMLButtonElement} */ (el("button", `feed-dd-rar${on ? " on" : ""}`, ""));
      b.type = "button";
      b.setAttribute("role", "menuitemcheckbox");
      b.setAttribute("aria-checked", String(on));
      b.dataset.rar = r.id;
      b.append(`[${on ? "x" : " "}] `, el("span", `r-${r.id}`, r.label));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (on) hiddenRarities.add(r.id);
        else hiddenRarities.delete(r.id);
        applyFilter();
        paintJump();
        paint();
        /** @type {HTMLElement | null} */ (menu.querySelector(`[data-rar="${r.id}"]`))?.focus({ preventScroll: true });
        fillIfShort();
      });
      return b;
    })];
  };
  const paint = () => {
    const off = hiddenCats.size;
    const filtered = off > 0 || hiddenRarities.size > 0 || onlyMe;
    btn.textContent = onlyMe ? "[ SHOW: ONLY ME \u25BE ]" : off ? `[ SHOW ${CATEGORIES.length - off}/${CATEGORIES.length} \u25BE ]`
      : filtered ? "[ SHOW (FILTERED) \u25BE ]" : "[ SHOW ALL \u25BE ]";
    btn.classList.toggle("on", filtered);
    const me = /** @type {HTMLButtonElement} */ (el("button", `feed-dd-me${onlyMe ? " on" : ""}`, `[${onlyMe ? "x" : " "}] ONLY ME`));
    me.type = "button";
    me.title = "only your own attacks, drops, chests and sales";
    me.setAttribute("role", "menuitemcheckbox");
    me.setAttribute("aria-checked", String(onlyMe));
    me.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onlyMe = !onlyMe;
      autoPages = 0; // ONLY ME may need a page of your older lines to fill the box
      applyFilter();
      paintJump();
      paint();
      paintFooter();
      /** @type {HTMLElement | null} */ (menu.querySelector(".feed-dd-me"))?.focus({ preventScroll: true });
      fillIfShort();
    });
    menu.replaceChildren(me, ...CATEGORIES.flatMap(([id, label]) => {
      const on = !hiddenCats.has(id);
      const b = /** @type {HTMLButtonElement} */ (el("button", on ? "on" : "", `[${on ? "x" : " "}] ${label}`));
      b.type = "button";
      b.setAttribute("role", "menuitemcheckbox");
      b.setAttribute("aria-checked", String(on));
      b.addEventListener("click", (ev) => {
        ev.stopPropagation(); // stays open: tick several in a row
        if (on) hiddenCats.add(id);
        else hiddenCats.delete(id);
        applyFilter();
        paintJump();
        paint();
        /** @type {HTMLElement | null} */ (menu.querySelector(`[data-cat="${id}"]`))?.focus({ preventScroll: true });
        fillIfShort();
      });
      b.dataset.cat = id;
      return id === "loot" ? [b, ...rarityRows()] : [b];
    }), (() => {
      const all = /** @type {HTMLButtonElement} */ (el("button", "feed-dd-all", "[ SHOW EVERYTHING ]"));
      all.type = "button";
      all.addEventListener("click", (ev) => {
        ev.stopPropagation();
        hiddenCats.clear();
        hiddenRarities.clear();
        onlyMe = false;
        applyFilter();
        paintJump();
        paint();
      });
      return all;
    })());
  };
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) /** @type {HTMLElement | null} */ (menu.querySelector("button"))?.focus({ preventScroll: true });
  });
  document.addEventListener("click", (ev) => {
    if (!(ev.target instanceof Node) || !host.contains(ev.target)) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !menu.hidden) {
      close();
      btn.focus({ preventScroll: true });
    }
  });
  paint();
  host.replaceChildren(btn, menu);
  applyFilter();
  on("me", () => { // ONLY ME needs your id, which can arrive after the feed
    if (state.me?.id !== styledFor) applyFilter();
  });
}
buildFilter();

/** @param {any} e @param {boolean} fresh */
function row(e, fresh) {
  const li = el("li", `k-${e.kind}`);
  const cat = CAT_OF.get(e.kind);
  if (cat) li.classList.add(`cat-${cat}`);
  if (ITEM_LINES.has(e.kind) && e.rarity && (e.kind !== "unbox" || e.reward === "item")) li.classList.add(`rar-${e.rarity}`);
  if (e.kind === "scroll_use" && e.scroll_id === "freezing") li.classList.add("freeze-feed-row");
  li.dataset.id = String(e.id);
  if (e.player_id) li.dataset.pid = e.player_id;
  if (e.player_id && e.player_id === state.me?.id) li.classList.add("me");
  const side = sideOf(e);
  if (side) li.classList.add(`team-${side}`);
  if (e.possessed || e.heal) li.classList.add("possessed-heal"); // POSSESSION: a hit that healed the boss
  if (fresh) li.classList.add("new");
  const t = el("span", "t", ago(now() - e.t));
  t.dataset.t = String(e.t);
  const m = el("span", "m");
  m.append(...message(e));
  li.append(t, m);
  return li;
}

// ------------------------------------------------------------ scrolling feed
// Newest at the top; scroll down for history. Older pages load on demand.

let reachedStartAll = false;
let reachedStartMine = false; // ONLY ME pages through your own lines (ticket #120)
const reachedStart = () => (onlyMe ? reachedStartMine : reachedStartAll);
const mineCount = () => state.feed.filter(isMine).length;
/** Hit the history cap (FEED_KEEP lines, MINE_KEEP of yours with ONLY ME): stop loading older ones. */
const full = () => (onlyMe ? mineCount() >= MINE_KEEP : state.feed.length - mineCount() >= FEED_KEEP);
let loadingOlder = false;
const footer = el("li", "feed-end dim", "");

function paintFooter() {
  footer.textContent = reachedStart() ? (onlyMe ? "--- that's all of yours (2 weeks) ---" : "--- start of the fight ---")
    : full() ? `--- that's the last ${onlyMe ? MINE_KEEP : FEED_KEEP} ---` : loadingOlder ? "loading older..."
      : "--- scroll for older ---";
}

/** Render every loaded event, newest first. */
export function renderFeed() {
  const events = [...state.feed].reverse();
  if (!events.length) {
    list.replaceChildren(el("li", "dim", "> silence. be the first to strike."));
    return;
  }
  paintFooter();
  list.replaceChildren(...events.map((e) => row(e, false)), footer);
  fillIfShort();
}

/** New events arrived: slide them in at the top without redrawing the rest.
 * If you've scrolled down to read history, the list doesn't move under you.
 * @param {any[]} fresh */
export function addFreshEvents(fresh) {
  if (!fresh.length) return;
  if (!list.contains(footer)) {
    renderFeed(); // was the empty placeholder
    return;
  }
  const top = list.scrollTop;
  const before = list.scrollHeight;
  // Oldest first, each slotted in by time (almost always at the very top), so
  // a line released a moment late never lands above a newer one.
  for (const e of [...fresh].sort((a, b) => a.t - b.t || a.id - b.id)) {
    const li = row(e, true);
    let at = list.firstElementChild;
    while (at && at !== footer && Number(at.querySelector(".t")?.getAttribute("data-t") ?? Infinity) > e.t) {
      at = at.nextElementSibling;
    }
    list.insertBefore(li, at);
  }
  // Keep the list to what the store keeps (FEED_KEEP lines, MINE_KEEP of
  // yours): the rest drop off (not while you're scrolled down reading them).
  if (!paused() && list.childElementCount - 1 > state.feed.length) {
    const kept = new Set(state.feed.map((e) => String(e.id)));
    for (const li of [...list.children]) {
      if (li !== footer && /** @type {HTMLElement} */ (li).dataset.id && !kept.has(/** @type {HTMLElement} */ (li).dataset.id ?? "")) li.remove();
    }
  }
  paintFooter();
  // Scrolled down reading: keep what you're looking at still. At (or nearly
  // at) the top, let new lines push in, so a jump back to the top lands there.
  if (top > 24) list.scrollTop = top + (list.scrollHeight - before);
}

// Other players' events come in batches (and players unload attacks in
// bursts), so they're released at a steady pace instead of all at once: one
// line at a time normally, faster (and several per step) when there's a
// backlog, never more than ~STREAM_MAX_MS behind.
const STREAM_MAX_MS = 300;
/** @type {any[]} */
const waiting = [];
/** @type {ReturnType<typeof setTimeout> | undefined} */
let streamTimer;
/** @type {(shown: any[]) => void} */
let onStreamed = () => {};

/** Queue live events from others; ``onShown`` runs as each one appears.
 * @param {any[]} events @param {(shown: any[]) => void} onShown */
export function streamEvents(events, onShown) {
  if (!events.length) return;
  onStreamed = onShown;
  waiting.push(...events);
  waiting.sort((a, b) => a.t - b.t || a.id - b.id);
  if (!streamTimer) releaseNext();
}

function releaseNext() {
  if (!waiting.length || paused()) {
    streamTimer = undefined; // paused: picks up again from the scroll handler
    paintJump();
    return;
  }
  const gap = Math.max(30, Math.min(100, STREAM_MAX_MS / waiting.length));
  const perStep = Math.max(1, Math.ceil((waiting.length * gap) / STREAM_MAX_MS));
  const fresh = mergeFeed(waiting.splice(0, perStep)); // skips any we already have (e.g. your own)
  if (fresh.length) {
    addFreshEvents(fresh);
    onStreamed(fresh);
  }
  paintJump();
  streamTimer = setTimeout(releaseNext, gap);
}

/** "[ ^ JUMP TO TOP :: 12 NEW ]" while you're scrolled down; hidden at the top. */
function paintJump() {
  if (!paused()) {
    jump.hidden = true;
    return;
  }
  // Waiting lines past the cap would only fall off the bottom later: keep the newest.
  if (waiting.length > FEED_KEEP) waiting.splice(0, waiting.length - FEED_KEEP);
  const n = waiting.filter(shown).length; // only lines the SHOW filters let through (ticket #104)
  jump.textContent = n ? `[ ^ JUMP TO TOP :: ${n >= FEED_KEEP ? `${FEED_KEEP}+` : n} NEW ]` : "[ ^ JUMP TO TOP ]";
  jump.classList.toggle("has-new", n > 0);
  jump.hidden = false;
}

jump.addEventListener("click", () => {
  list.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});

/** Start over (e.g. after an admin reset). */
export function resetFeedHistory() {
  waiting.length = 0; // anything still queued belongs to the old feed
  reachedStartAll = reachedStartMine = false;
  autoPages = 0;
  renderFeed();
}

let lastOlderAt = 0;

async function loadOlder() {
  if (loadingOlder || reachedStart() || full() || !state.feed.length) return;
  if (performance.now() - lastOlderAt < 700) return; // never more than ~1 page a second
  lastOlderAt = performance.now();
  // ONLY ME: page back from your oldest line, through just your lines (the server's events_player index).
  const mine = onlyMe;
  const oldest = (mine ? state.feed.find(isMine) : null) ?? state.feed[0];
  loadingOlder = true;
  paintFooter();
  try {
    const want = Math.min(100, mine ? MINE_KEEP - mineCount() : FEED_KEEP - (state.feed.length - mineCount()));
    const { events } = await api.getOlderFeed(oldest.t, oldest.id, want, mine);
    if (events.length < want) {
      if (mine) reachedStartMine = true;
      else reachedStartAll = true;
    }
    const added = addOlderFeed(events);
    const rows = [...added].sort((a, b) => b.t - a.t || b.id - a.id).map((e) => row(e, false));
    for (const r of rows) list.insertBefore(r, footer);
  } catch {
    /* try again on the next scroll */
  } finally {
    loadingOlder = false;
    paintFooter();
  }
  fillIfShort();
}

/** Pages loaded to fill a short feed box (not by scrolling). */
let autoPages = 0;
const AUTO_PAGE_LIMIT = 2;

/** Load a page or two if the box is visible but too short to scroll. A
 * hidden feed (another tab open) has no height: it must never count as
 * "short", or it pages through the whole history in a loop. */
function fillIfShort() {
  if (reachedStart() || full() || autoPages >= AUTO_PAGE_LIMIT) return;
  if (list.clientHeight === 0 || !list.isConnected || list.offsetParent === null) return;
  if (list.scrollHeight <= list.clientHeight + 40) {
    autoPages++;
    loadOlder();
  }
}

list.addEventListener("scroll", () => {
  if (list.clientHeight > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 200) loadOlder();
  paintJump();
  if (!paused() && waiting.length && !streamTimer) releaseNext(); // back at the top: let them in
}, { passive: true });

export function tickAges() {
  list.querySelectorAll(".t").forEach((n) => {
    const t = Number(/** @type {HTMLElement} */ (n).dataset.t);
    if (t) n.textContent = ago(now() - t);
  });
}
