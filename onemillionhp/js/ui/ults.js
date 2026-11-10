// CHARM ULTS (server/omhp/ults.py): the worn charm is the ultimate and none
// of them hurt the boss. This shows what one did (a banner over the fight,
// plus the extras some have: a coin flip, a fake crash, a mini-game), the
// world-wide ones running (DEEP WINTER's snow, ETERNAL SNOOZE's z's), and
// your LIGHTNING ROD's hits left.

import * as api from "../api.js?v=b6664395f3";
import { box, el } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { RARITY_STYLE } from "../ascii.js?v=b6664395f3";
import { boxById, emit, itemById, now, rarityById, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { popup, shake, showOverlay, ultBanner } from "./fx.js?v=b6664395f3";

/** Each ult's border character and colour class. */
const LOOK = /** @type {Record<string, [string, string]>} */ ({
  rich: ["$", "ult-gold"], rod: ["/", "ult-storm"], root: ["#", "ult-root"], winter: ["*", "ult-ice"],
  snooze: ["z", "ult-sleep"], flip: ["o", "ult-gold"], pizza: ["<", "ult-pizza"], captcha: ["?", "ult-storm"],
  key: ["-", "ult-gold"], appeal: ["+", "ult-death"], rewind: ["~", "ult-sleep"],
  mimic: ["W", "ult-death"], feed: [".", "ult-pizza"], sweep: ["#", "ult-storm"],
});

/** "STRIKE IT RICH" -> "S T R I K E   I T   R I C H". @param {string} s */
const spaced = (s) => s.split("").join(" ");

/** The ult just used (procs.ult from the attack reply). @param {any} res */
export function showUlt(res) {
  sound.ultimate();
  const [edge, cls] = LOOK[res.id] ?? ["!", ""];
  if (res.fizzled) {
    ultBanner(spaced(res.name), ["TAILS... THE DEAL ATE IT", "NOTHING HAPPENED"], "x", "ult-death");
    return;
  }
  const body = [String(res.summary ?? "").toUpperCase()];
  if (res.boost === 2) body.push("x2 STRONGER!");
  if (res.id === "rich") {
    // What you found, right in the banner (chat: "show me which items i get").
    for (const id of res.items) {
      const item = itemById(id);
      body.push(`+ ${item?.name ?? id} (${String(item?.rarity ?? "common").toUpperCase()})`);
    }
    res.items.forEach((/** @type {string} */ id, /** @type {number} */ i) => {
      const item = itemById(id);
      setTimeout(() => popup(["+ ", [item?.name ?? id, `r-${item?.rarity ?? "common"}`]], "loot"), 400 + i * 260);
    });
    if (res.items.length) setTimeout(() => sound.loot(), 400);
  }
  if (res.id === "flip") {
    coinFlip(spaced(res.name), res.heads, body, edge, cls);
    return;
  }
  if (res.id === "root") {
    fakeCrash(() => ultBanner(spaced(res.name), body, edge, cls));
    return;
  }
  // The mini-games are their own show: straight to the game, no banner under it.
  if (res.id === "captcha" && res.game) captchaGame(res.game);
  else ultBanner(spaced(res.name), body, edge, cls, res.id === "rich" ? 4200 : undefined); // time to read the finds
}

/** FLIP: the coin spins, then lands. @param {string} title @param {boolean} heads
 * @param {string[]} body @param {string} edge @param {string} cls */
function coinFlip(title, heads, body, edge, cls) {
  const frames = ["(  O  )", "(  0  )", "(  |  )", "(  0  )"];
  let i = 0;
  const spin = setInterval(() => {
    ultBanner(title, ["FLIPPING...", frames[i++ % frames.length]], edge, cls, 900);
    if (i >= 10) {
      clearInterval(spin);
      ultBanner(title, [heads ? "(  H  )  HEADS!" : "(  T  )  TAILS...", ...body], edge, cls);
      if (heads) sound.crit();
      else sound.hit();
    }
  }, 110);
}

/** ROOT ACCESS KEY: the boss's "terminal" crashes for a moment (it's just for show). @param {() => void} then */
function fakeCrash(then) {
  const name = state.boss?.name ?? "BOSS";
  const lines = [
    "$ whoami", "root",
    `$ sudo kill -9 $(pgrep ${name.replace(/\s+/g, "_")})`,
    `[    0.000000] ${name}.EXE: segmentation fault (core dumped)`,
    "[    0.000013] *** KERNEL PANIC: not syncing: boss went to the shadow realm ***",
    "[    0.000021] mounting LIGHTNING ROD at /dev/you ... ok",
    "", "rebooting reality in 3... 2... 1...",
  ];
  const layer = document.body.appendChild(el("div", "ult-crash"));
  layer.setAttribute("aria-hidden", "true");
  const pre = el("pre", "ult-crash-text");
  layer.append(pre);
  shake("l");
  let n = 0;
  const step = setInterval(() => {
    pre.textContent = lines.slice(0, ++n).join("\n") + (n < lines.length ? "\n_" : "");
    if (n >= lines.length) {
      clearInterval(step);
      setTimeout(() => {
        layer.remove();
        then();
      }, 500);
    }
  }, 170);
}

/** Seconds left on a mini-game. @param {any} game */
const secsLeft = (game) => Math.max(0, Math.ceil(game.until - now()));

/** CAPTCHA EYE: click the face it asks for before time runs out. @param {any} game */
function captchaGame(game) {
  showOverlay((inner, done) => {
    inner.classList.add("captcha", "ult-game");
    let over = false;
    const timer = el("div", "dim captcha-note", "");
    const finish = () => {
      over = true;
      clearInterval(tick);
      done();
    };
    const tick = setInterval(() => {
      const s = secsLeft(game);
      timer.textContent = `${s} s LEFT :: ONE TRY`;
      if (s <= 0 && !over) {
        finish();
        popup("TOO SLOW! THE EYE CLOSED", "proc");
      }
    }, 250);
    const ask = el("div", "captcha-ask");
    ask.append("the eye wants the ", el("b", "captcha-find", game.find), " box");
    const grid = el("div", "captcha-grid");
    game.cells.forEach((/** @type {string} */ face, /** @type {number} */ i) => {
      const b = /** @type {HTMLButtonElement} */ (el("button", "captcha-cell", `[ ${face} ]`));
      b.type = "button";
      b.addEventListener("click", () => {
        if (over) return;
        finish();
        answer(i);
      });
      grid.append(b);
    });
    inner.append(el("pre", "art captcha-head", box(["CAPTCHA EYE"], { width: 30 }).join("\n")), ask, grid, timer);
  }, { mustChoose: true });
}

/** @param {number} given */
async function answer(given) {
  try {
    const res = await api.answerUlt(given);
    state.me = res.me;
    emit("me");
    if (res.won) {
      const b = boxById(res.box_id);
      sound.loot();
      ultBanner("C O R R E C T", [`+${res.count ?? 1} ${b?.name ?? res.box_id}`], "+", "ult-gold", 1800);
    } else {
      sound.hit();
      ultBanner(res.late ? "T O O   S L O W" : "W R O N G", ["NO PRIZE THIS TIME"], "x", "ult-death", 1600);
    }
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

// ------------------------------------------------------------ explainer

/** "every 3 minutes" / "every 45 seconds". @param {number} secs */
function every(secs) {
  const s = Math.round(secs);
  return s % 60 === 0 ? `every ${s / 60 === 1 ? "minute" : `${s / 60} minutes`}` : `every ${s} seconds`;
}

/** Ticket #319: how strong the charm counts, on the COMMON (1) .. SOVEREIGN (9) ladder; a boss unique
 * counts as SOVEREIGN. @param {any} charm @param {any} u @returns {HTMLElement[]} */
function powerLines(charm, u) {
  if (!u.power) return [];
  const label = (/** @type {string} */ id) => (rarityById(id)?.label ?? id).toUpperCase();
  const as = u.counts_as !== charm.rarity ? ` (${label(charm.rarity)} COUNTS AS ${label(u.counts_as)}, THE TOP)` : "";
  return [el("div", "dim", `CHARM POWER: ${u.power} / ${u.power_max}${as}.`)];
}

/** [ ? WHAT DOES MY ULT DO ]: the worn charm, its ult, what it does, how often. */
export function explainUlt() {
  const u = state.me?.ult;
  const charm = itemById(state.me?.ult_charm ?? state.me?.worn?.charm); // ticket #305: the ult's own charm
  if (!u || !charm) return;
  showOverlay((inner, done) => {
    inner.classList.add("ult-explain");
    const st = RARITY_STYLE[charm.rarity] ?? RARITY_STYLE.common;
    const from = el("div", "ult-explain-from", "FROM YOUR CHARM: ");
    from.append(el("span", `r-${charm.rarity}`, `${st.deco[0]}${charm.name}${st.deco[1]}`));
    const ok = /** @type {HTMLButtonElement} */ (el("button", "btn", "[ GOT IT ]"));
    ok.type = "button";
    ok.addEventListener("click", done);
    inner.append(
      el("pre", "art captcha-head", box([u.name], { width: Math.max(30, u.name.length + 6) }).join("\n")),
      from,
      el("div", "ult-explain-what", u.text.toUpperCase()),
      el("div", "dim", `RECHARGES ${every(state.me?.ult_recharge ?? 180).toUpperCase()}. NEVER HITS THE BOSS.`),
      ...powerLines(charm, u),
      el("div", "dim ult-explain-note", "YOUR CHARM IS YOUR ULTIMATE. PICK ANY CHARM YOU OWN AS YOUR ULT CHARM IN YOU > INVENTORY (NO NEED TO WEAR IT)."),
      ok);
  });
}

// ------------------------------------------------------------ running ults

/** Lines for the one-line effects strip under the boss (same shape as scrolls'). */
export function ultEffects() {
  const out = [];
  const secs = (/** @type {number} */ until) => Math.max(0, Math.ceil(until - now()));
  for (const u of state.boss?.ults ?? []) {
    if (secs(u.until) <= 0) continue;
    if (u.kind === "winter") {
      out.push({ cls: "effect-winter", text: `* DEEP WINTER :: ${u.text} :: ${secs(u.until)}s *`,
        short: `* WINTER ${secs(u.until)}s` });
    } else if (u.kind === "snooze") {
      out.push({ cls: "effect-snooze", text: `zZ SNOOZE :: ${u.text} :: ${secs(u.until)}s Zz`,
        short: `zZ SNOOZE ${secs(u.until)}s` });
    } else if (u.kind === "warstar") { // APEX WARSTAR (ticket #303)
      out.push({ cls: "effect-warcry", text: `-*- WARSTAR BY ${u.by_name ?? "???"} :: ${u.text} :: ${secs(u.until)}s -*-`,
        short: `-*- +${secs(u.until)}s` });
    }
  }
  const free = state.me?.free_hits ?? 0; // PERPETUAL ORBIT (ticket #303)
  if (free > 0) out.push({ cls: "effect-frenzy", text: `( o ) ORBIT :: NEXT ${free} ATTACKS FREE ( o )`, short: `( o ) FREE x${free}` });
  const buff = state.me?.ult_buff;
  if (buff && (buff.kind === "rod" || buff.kind === "root") && buff.hits > 0) {
    const also = buff.also?.hits > 0 ? buff.also : null; // ticket #310: a ROD and a ROOT stack
    out.push(also
      ? { cls: "effect-rod", text: `/ RODS :: +${buff.shards} <> x${buff.hits} HITS + ${also.shards} <> x${also.hits} HITS /`,
        short: `/ RODS x${Math.max(buff.hits, also.hits)}` }
      : { cls: "effect-rod", text: `/ ROD :: +${buff.shards} <> PER HIT :: ${buff.hits} HITS LEFT /`,
        short: `/ ROD x${buff.hits}` });
  }
  return out;
}

let frame = 0;
/** Snow over the boss in DEEP WINTER, z's drifting up in ETERNAL SNOOZE (runs with the scroll effects). */
export function animateUltWorld() {
  const fx = document.getElementById("ult-world-fx");
  if (!fx) return;
  const live = (state.boss?.ults ?? []).filter((/** @type {any} */ u) => u.until > now());
  const winter = live.some((/** @type {any} */ u) => u.kind === "winter");
  const snooze = live.some((/** @type {any} */ u) => u.kind === "snooze");
  document.body.classList.toggle("ult-winter", winter);
  document.body.classList.toggle("ult-snooze", snooze);
  if (!winter && !snooze) {
    if (fx.textContent) fx.textContent = "";
    return;
  }
  frame++;
  const W = 34;
  const rows = [];
  for (let y = 0; y < 9; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const seed = (x * 7 + (y - (winter ? frame : -frame)) * 13 + x * y) % 23;
      row += winter && seed === 0 ? "*" : winter && seed === 11 ? "." : snooze && seed === 5 && x > W / 2 ? (y % 2 ? "z" : "Z") : " ";
    }
    rows.push(row);
  }
  fx.textContent = rows.join("\n");
}
