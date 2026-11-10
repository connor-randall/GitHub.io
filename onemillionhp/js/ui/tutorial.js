// The new-player tutorial (server/omhp/tutorial.py): the page opens up a step
// at a time. Each step's tabs stay hidden until it's reached (tabs.js asks
// tabOpen), and a COACH box between the boss and FIGHT says what just opened
// and what to do next. [ GOT IT ] tells the server it was seen; [ SKIP
// TUTORIAL ] opens everything. Players from before the tutorial are DONE, so
// none of this shows for them.

import * as api from "../api.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { emit, on, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";

const DONE = 6;

/** The step each tab opens at (missing = always open). */
const TAB_STEP = /** @type {Record<string, number>} */ ({
  player: 2, inventory: 2, bag: 2, collection: 2,
  shop: 3, chat: 3, both: 3,
  ranks: 4, history: 4,
  achievements: 5, stats: 5, prestige: 5, auction: 5, blacksmith: 5, clan: 5, clanranks: 5, hof: 5, dms: 5, city: 5, polls: 5, tickets: 5,
  changelog: 5,
  forge: 6, designer: 6, bossvote: 6,
});
/** Other things that wait: the DAILY button (and its pop-up). */
const FEATURE_STEP = /** @type {Record<string, number>} */ ({ daily: 5 });

/** The step reached (everything is open until we know who you are). */
export const step = () => state.me?.tutorial?.stage ?? DONE;
/** @param {string} tab */
export const tabOpen = (tab) => step() >= (TAB_STEP[tab] ?? 0);
/** @param {string} feature */
export const featureOpen = (feature) => step() >= (FEATURE_STEP[feature] ?? 0);
/** Still learning: the FIGHT box starts with just ATTACK and opens up as you play. */
export const learning = () => step() < DONE;

/** Hits before a learner's [ ULTIMATE ] shows up (with a line under it saying what it is). */
const ULT_AFTER = 3;
export const ultOpen = () => !learning() || (state.me?.total_attacks ?? 0) >= ULT_AFTER;
/** The scroll button: once you hold a scroll, or the SHOP (where they're sold) is open. */
export const scrollsOpen = () => !learning() || tabOpen("shop")
  || (state.me?.scrolls ?? []).some((/** @type {any} */ s) => s.count > 0);
/** Up to this step the coach stays in its box: the first hits go uninterrupted by pop-ups. */
const QUIET_UNTIL = 2;

/** "every minute", "every 2 minutes", "every 30 seconds". @param {number} secs */
export const every = (secs) => (secs === 60 ? "every minute"
  : secs % 60 === 0 ? `every ${secs / 60} minutes` : `every ${Math.round(secs)} seconds`);

/** "26 attacks (20, plus 6 from the CITY: the blue stars)": the max you really hold. */
function maxAttacks() {
  const per = state.me?.attacks_per_day ?? 5;
  const city = per - (state.me?.attacks_base ?? per);
  return city > 0 ? `${per} attacks (${per - city}, plus ${city} from the CITY: the blue stars)` : `${per} attacks`;
}

/** What the coach says at each step: a title, lines, and an optional button. */
const COACH = [
  { title: "WELCOME, FIGHTER", lines: () => [
    "Everyone here fights this one boss. Every hit counts.",
    state.me?.name_chosen ? "Hit [ ATTACK ] below. More of the game opens up as you play."
      : "Hit [ ATTACK ] below: you pick a name first, then your hit lands. More opens up as you play."] },
  { title: "NICE HIT", lines: () => [
    `You hold up to ${maxAttacks()}, and one comes back ${every(state.me?.recharge_seconds ?? 60)}: spend them, come back, spend again.`,
    "Keep hitting. Loot drops as you go."] },
  { title: "LOOT", go: ["inventory", "OPEN YOUR INVENTORY"], lines: () => (state.me?.items_found
    ? ["You found gear! [ YOU ] > [ INVENTORY ] is open: tap an item and EQUIP it.", "Better gear means bigger hits."]
    : ["Your [ INVENTORY ] is open ([ YOU ] menu): the loot you find lands there.", "Wear it to hit harder."]) },
  { title: "GEARED UP", go: ["bag", "TAKE THE FREE CRATE"], lines: () => [
    "[ SHOP ] (in WORLD) and [ CHAT ] are open. Sell spare loot for shards (<>), spend them on chests and scrolls.",
    "One more free WOODEN CRATE: take it, then open it in your BAG."] },
  { title: "YOUR ULTIMATE", lines: () => [
    "Your CHARM is your [ ULTIMATE ] (U): every charm does something different. Use it whenever it says READY.",
    "[ RANKS ] and [ HISTORY ] are open in the LEADERBOARD menu: who's on top, and every boss so far."] },
  { title: "THE TOWN", lines: () => [
    "Claim your [ DAILY ] reward up top.",
    "New in WORLD: CITY, AUCTION HOUSE. In YOU: ACHIEVEMENTS, CLAN. In GAME: POLLS, TICKETS (found a bug? tell us)."] },
  { title: "YOU'VE SEEN IT ALL", lines: () => [
    "THE FORGE (WORLD) and DESIGN A BOSS (GAME > COMMUNITY) are open. That's everything.", "Good luck out there."] },
];

/** What gets you to the next step. @param {number} s */
function nextHint(s) {
  const t = state.me?.tutorial;
  const need = t?.attacks?.[s];
  if (need === undefined) return "";
  const doing = ["", "find an item (open your free crate!)", "equip an item", "open a chest", "", ""][s];
  const at = state.me?.total_attacks ?? 0;
  const attacks = `${fmt(need)} attacks (you're at ${fmt(at)})`;
  return s === 0 ? "" : `NEXT: ${doing ? `${doing}, or ` : ""}${attacks}`;
}

let busy = false;
let skipArmed = false;
let shown = -1; // the step the box last drew (a new one pulses)

function render() {
  const box = document.getElementById("coach");
  if (!box) return;
  const t = state.me?.tutorial;
  const s = t?.stage ?? DONE;
  const seen = t?.seen ?? DONE;
  // Done and seen: gone. Step 0 shows until the first attack; later steps until [ GOT IT ].
  if (!t || (s >= DONE && seen >= DONE) || (s > 0 && seen >= s)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (shown !== s) {
    box.classList.remove("coach-new");
    void box.offsetWidth;
    box.classList.add("coach-new");
    shown = s;
  }
  box.replaceChildren(...coachParts(s, null));
  // Later steps also pop up mid-screen, once a visit, so they can't be missed.
  // The first steps (hit it, recharge, first loot) stay in the box: no pop-up
  // between a new player and their first few hits.
  if (!popped.has(s) && s > QUIET_UNTIL) {
    popped.add(s);
    popUp(s);
  }
}

/** Steps already popped up this visit. */
const popped = new Set();

/** The coach as a pop-up (queued behind a loot drop, say). Its buttons wait a
 * moment, so attack clicks still flying can't dismiss it unread. @param {number} s */
function popUp(s) {
  showOverlay((inner, close) => {
    const t = state.me?.tutorial;
    if (!t || (s > 0 && t.seen >= s) || t.stage !== s) { // seen (or passed) while it waited in the queue
      setTimeout(close, 0);
      return;
    }
    inner.classList.add("coach-pop");
    inner.append(...coachParts(s, close));
    const buttons = [...inner.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    setTimeout(() => buttons.forEach((b) => (b.disabled = false)), 700);
  }, { mustChoose: true });
}

/** The coach's title, lines, next goal and buttons. ``close``: it's the pop-up
 * (adds [ LATER ], and any choice closes it). @param {number} s @param {(() => void) | null} close */
function coachParts(s, close) {
  const c = COACH[Math.min(s, COACH.length - 1)];
  const head = el("div", "coach-head");
  head.append(el("b", "", c.title), ...(s ? [el("span", "dim", `  STEP ${s}/${DONE}`)] : []));
  const body = el("div", "coach-body");
  for (const line of c.lines()) body.append(el("div", "", line));
  const hint = nextHint(s);
  if (hint && s < DONE) body.append(el("div", "dim coach-next", hint));
  const actions = el("div", "coach-actions");
  if (s > 0) {
    const [tab, label] = c.go ?? ["", "GOT IT"];
    const ok = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", `[ ${label} ]`));
    ok.type = "button";
    ok.disabled = busy;
    ok.addEventListener("click", () => {
      close?.();
      seen_(s, tab);
    });
    actions.append(ok);
  }
  if (close) {
    // Step 0 has nothing to mark seen (the first attack moves it on): just [ LET'S GO ].
    const later = /** @type {HTMLButtonElement} */ (el("button", s ? "btn-text coach-skip" : "inline-btn",
      s ? "[ LATER ]" : "[ LET'S GO ]"));
    later.type = "button";
    later.title = s ? "close this; it stays in the box above FIGHT" : "go hit it";
    later.addEventListener("click", close);
    actions.append(later);
  }
  if (s < DONE) {
    let armed = !close && skipArmed;
    const skip = /** @type {HTMLButtonElement} */ (el("button", "btn-text coach-skip"));
    const paint = () => {
      skip.textContent = armed ? "[ SURE? OPEN EVERYTHING ]" : "[ SKIP TUTORIAL ]";
      skip.classList.toggle("armed", armed);
    };
    paint();
    skip.type = "button";
    skip.title = "unlock every tab now (for players who already know the game)";
    skip.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        if (!close) skipArmed = true;
        paint();
        setTimeout(() => {
          armed = false;
          if (!close) skipArmed = false;
          paint();
        }, 4000);
      } else {
        close?.();
        skipAll();
      }
    });
    actions.append(skip);
  }
  return [head, body, actions];
}

/** [ GOT IT ] (and maybe open a tab). @param {number} s @param {string} tab */
async function seen_(s, tab) {
  if (busy) return;
  busy = true;
  try {
    const out = await api.tutorialAction("seen", s);
    state.me = out.me;
    emit("me");
    if (tab) /** @type {HTMLElement | null} */ (document.querySelector(`#tabs [data-tab="${tab}"]`))?.click();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    render();
  }
}

async function skipAll() {
  skipArmed = false;
  if (busy) return;
  busy = true;
  try {
    const out = await api.tutorialAction("skip");
    state.me = out.me;
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    render();
  }
}

/** GAME > [ TUTORIAL ]: every coach message again, one at a time ([ < BACK ] /
 * [ NEXT > ]). Only a read-through: nothing is locked again, and the real
 * tutorial (if still running) carries on where it was. */
export function replayTutorial() {
  let at = 0;
  showOverlay((inner, close) => {
    inner.classList.add("coach-pop");
    const draw = () => {
      const c = COACH[at];
      const head = el("div", "coach-head");
      head.append(el("b", "", c.title), el("span", "dim", `  ${at + 1}/${COACH.length}`));
      const body = el("div", "coach-body");
      for (const line of c.lines()) body.append(el("div", "", line));
      const actions = el("div", "coach-actions");
      /** @param {string} label @param {() => void} fn @param {string} [cls] */
      const btn = (label, fn, cls = "inline-btn") => {
        const b = /** @type {HTMLButtonElement} */ (el("button", cls, label));
        b.type = "button";
        b.addEventListener("click", fn);
        return b;
      };
      const last = at === COACH.length - 1;
      const next = last ? btn("[ DONE ]", close) : btn("[ NEXT > ]", () => { at++; draw(); });
      if (at > 0) actions.append(btn("[ < BACK ]", () => { at--; draw(); }));
      actions.append(next);
      if (!last) actions.append(btn("[ CLOSE ]", close, "btn-text coach-skip"));
      inner.replaceChildren(head, body, actions);
      next.focus({ preventScroll: true }); // Enter steps through it
    };
    draw();
  });
}

export function initTutorial() {
  on("me", render);
  render();
  document.getElementById("tutorial-replay")?.addEventListener("click", replayTutorial);
}
