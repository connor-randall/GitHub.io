// The boss: art per phase, HP bar, globals, reactions and the death screen.

import { bar, box, center, duration, el, fitArt, fmt, holdHeight, setArt, widthOf } from "../ascii.js?v=b6664395f3";
import { bossDef, bossText, now, state } from "../store.js?v=b6664395f3";
import { fogHp } from "./worldevent.js?v=b6664395f3";
import { shake, ultBanner } from "./fx.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const artEl = $("boss-art");
let lastHp = -1;
let lastPhase = 0;
let lastSeq = 0;
// Ticket #353: a resize (phones fire one whenever scrolling hides the address
// bar) must redraw the art without looking like the boss went a phase deeper.
let redrawArt = false;
let hurtUntil = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let hurtTimer;

function phaseDef() {
  const b = state.boss;
  const def = b && bossDef(b.def_id);
  if (!def) return null;
  return def.phases.find((/** @type {any} */ p) => p.phase === b.phase) ?? def.phases[0];
}

/** Pad a frame to the phase's box: as many lines as its tallest frame and
 * as wide as its widest, so swapping to the hurt frame (often a line taller
 * or a few columns wider) never resizes the art or shoves the page around.
 * @param {any} ph @param {readonly string[]} lines @returns {{lines: string[], cols: number}} */
function boxed(ph, lines) {
  const frames = [ph.art, ph.hurt_art ?? ph.art];
  const rows = Math.max(...frames.map((f) => f.length));
  const cols = Math.max(...frames.map(widthOf));
  const out = lines.map((l) => l.replace(/\s+$/, "").padEnd(cols));
  while (out.length < rows) out.push(" ".repeat(cols));
  return { lines: out, cols };
}

function drawArt() {
  const ph = phaseDef();
  if (!ph) return;
  const hurt = performance.now() < hurtUntil;
  const frame = boxed(ph, hurt ? ph.hurt_art ?? ph.art : ph.art);
  setArt(artEl, frame.lines, 13);
  // setArt sizes the text to the visible width; size it to the box instead
  // so every frame of the phase gets the same font size.
  artEl.dataset.cols = String(frame.cols);
  fitArt(artEl, 13);
  artEl.classList.toggle("phase-2", ph.phase === 2);
  artEl.classList.toggle("phase-3", ph.phase >= 3);
  // Some bosses have their own colour (GLORBO is blue).
  const tint = state.boss ? bossDef(state.boss.def_id)?.tint : null;
  if (tint) artEl.style.setProperty("--boss-tint", tint);
  else artEl.style.removeProperty("--boss-tint");
  artEl.classList.toggle("tinted", Boolean(tint));
}

/** @type {{seq: number, rect: DOMRect, lines: string[] | null} | null} */
let deathFrom = null;
/** Where the boss was on screen when it died (null if we didn't see it die). @param {number} seq */
export const deathOrigin = (seq) => (deathFrom && deathFrom.seq === seq ? deathFrom : null);

/** Flinch: swap to the hurt frame briefly. @param {number} ms */
export function hurt(ms = 240) {
  hurtUntil = performance.now() + ms;
  artEl.classList.remove("hurt");
  void artEl.offsetWidth;
  artEl.classList.add("hurt");
  drawArt();
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => {
    artEl.classList.remove("hurt");
    drawArt();
  }, ms);
}

/** Temporarily replace the normal taunt cycle with a direct boss response.
 * @param {string} text @param {number} [ms] */
export function bossSay(text, ms = 4000) {
  clearInterval(tauntTimer);
  const node = $("taunt");
  node.textContent = `"${text}"`;
  window.setTimeout(startTaunts, ms);
}

/** Boss Heal scroll: ASCII hearts rise over the boss with caster credit.
 * @param {string} name @param {number} amount @param {number} [shards] */
export function bossHealEffect(name, amount, shards = 100) {
  bossSay("Thank you kind soul");
  const stage = $("boss-stage");
  stage.querySelector(".boss-heal-fx")?.remove();
  const fx = el("div", "boss-heal-fx");
  const title = el("div", "boss-heal-title",
    `${name} HEALED THE BOSS  +${fmt(amount)} HP  ·  +${fmt(shards)} SHARDS`);
  const canvas = el("pre", "ascii-hearts");
  fx.append(canvas, title);
  stage.append(fx);
  const sprite = [" .::. .::. ", ":::::::::::", " ':::::::' ", "   ':::'   ", "     :     "];
  const width = 60, height = 20;
  const seeds = [[1, 0, 1], [17, 8, -1], [33, 3, 1], [47, 11, -1]];
  let frame = 0;
  const draw = () => {
    if (!fx.isConnected) return false;
    const field = Array.from({ length: height }, () => Array(width).fill(" "));
    for (const [baseX, delay, drift] of seeds) {
      const age = frame - delay;
      if (age < 0) continue;
      const y = height - 5 - Math.floor(age * .72);
      const x = baseX + Math.round(Math.sin(age / 3) * 2) * drift;
      sprite.forEach((line, sy) => [...line].forEach((ch, sx) => {
        const yy = y + sy, xx = x + sx;
        if (ch !== " " && yy >= 0 && yy < height && xx >= 0 && xx < width) field[yy][xx] = ch;
      }));
    }
    canvas.textContent = field.map((row) => row.join("")).join("\n");
    frame++;
    return frame < 30;
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    frame = 10;
    draw();
    setTimeout(() => fx.remove(), 3000);
    return;
  }
  draw();
  const timer = setInterval(() => {
    if (!draw()) {
      clearInterval(timer);
      fx.remove();
    }
  }, 90);
}

function hpCells() {
  const w = $("hp-bar").parentElement?.clientWidth ?? 320;
  return Math.max(12, Math.min(40, Math.floor(w / 9.2) - 2));
}

/** Write text only when it changed: the panel redraws every second, and an
 * unchanged write still makes the browser recheck the page.
 * @param {Element} node @param {string} text */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
/** @param {HTMLElement} node @param {boolean} hidden */
function setHidden(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function renderBoss() {
  const b = state.boss;
  const def = b && bossDef(b.def_id);
  if (!b || !def) return;
  const num = `BOSS #${String(b.seq).padStart(3, "0")}`;
  setText($("st-boss"), num);
  setText($("boss-num"), num);

  const dead = b.status === "defeated";
  if (dead && !$("boss-alive").hidden && lastSeq === b.seq) {
    // It just died in front of us: remember where it stood, for the death animation.
    const ph = phaseDef();
    deathFrom = { seq: b.seq, rect: artEl.getBoundingClientRect(), lines: ph ? ph.art : null };
  }
  // Swapping the live boss for the death box: hold the panel's height for a
  // moment so the page under a phone's scroll position doesn't shrink and jump.
  if ($("boss-dead").hidden === dead) holdHeight($("boss"));
  setHidden($("boss-alive"), dead);
  setHidden($("boss-dead"), !dead);
  setHidden($("fight"), dead);
  if (dead) {
    renderDeath(b, def);
    return;
  }

  setText($("boss-name"), b.name);
  setText($("boss-sub"), b.subtitle);
  if (redrawArt && b.phase === lastPhase && b.seq === lastSeq) {
    redrawArt = false;
    drawArt();
  } else if (b.phase !== lastPhase || b.seq !== lastSeq) {
    redrawArt = false;
    // The same boss going deeper (not a reload, not a new boss): a beat everyone
    // shares. It uses the see-through banner layer, so nobody's fight is paused.
    const deeper = b.seq === lastSeq && b.phase > lastPhase;
    lastPhase = b.phase;
    lastSeq = b.seq; // a new boss always redraws, even in the same phase number
    drawArt();
    startTaunts();
    if (deeper) {
      const ph = phaseDef();
      const line = ph?.taunts?.[0] ? bossText(ph.taunts[0]) : "";
      ultBanner(`${b.name} :: ${ph?.label ?? `PHASE ${b.phase}`}`, line ? [line] : [], "#", "", 1800);
      shake("l");
      sound.phase();
      hurt(600);
    }
  }
  const frac = b.hp / b.max_hp;
  const poisoned = Boolean(b.effects?.poison_until && now() < b.effects.poison_until);
  const frozen = Boolean(b.effects?.frozen_until && now() < b.effects.frozen_until);
  artEl.classList.toggle("poisoned", poisoned);
  artEl.classList.toggle("frozen", frozen);
  const hpBar = $("hp-bar");
  // FOG: the readout lies (or hides) for a few minutes.
  const fog = fogHp();
  setText(hpBar, "HP " + (fog && fog.frac === null ? "[" + "?".repeat(hpCells()) + "]" : bar(fog ? fog.frac ?? frac : frac, hpCells())));
  hpBar.classList.toggle("low", !fog && frac <= 0.1);
  hpBar.classList.toggle("fogged", Boolean(fog));
  const hpNow = $("hp-now");
  setText(hpNow, fog ? fog.now : fmt(b.hp));
  if (lastHp >= 0 && b.hp < lastHp) {
    hpNow.classList.remove("tick");
    void hpNow.offsetWidth;
    hpNow.classList.add("tick");
  }
  lastHp = b.hp;
  setText($("hp-max"), fmt(b.max_hp));
  setText($("hp-pct"), fog ? fog.pct : `(${(frac * 100).toFixed(frac < 0.01 ? 3 : 2)}%)`);
  const phase = $("phase");
  const ph = phaseDef();
  setText(phase, ph?.label ?? `PHASE ${b.phase}`);
  phase.classList.toggle("p3", b.phase >= 3);
  setText($("g-attacks"), fmt(b.total_attacks));
  setText($("g-damage"), fmt(b.total_damage));
  setText($("g-players"), fmt(b.unique_players));
}

/** What the death box shows; it's only rebuilt when this changes. */
let deathKey = "";

/** The death box, built once per dead boss (and on resize). Rebuilding it every
 * second emptied it for an instant, the page got shorter, and phones scrolled. The
 * countdown in it ticks on its own (tickNextBoss).
 * @param {any} b @param {any} def */
function renderDeath(b, def) {
  const host = $("boss-dead");
  const key = [b.seq, b.name, b.killer_name, b.total_damage, b.total_attacks, b.unique_players, b.defeated_at,
    window.innerWidth].join("|");
  if (key === deathKey && host.childElementCount) {
    tickNextBoss();
    return;
  }
  deathKey = key;
  holdHeight(host);
  const W = 37;
  const banner = [
    "#".repeat(W),
    "#" + " ".repeat(W - 2) + "#",
    "#" + center(`${b.name} DEFEATED`, W - 2) + "#",
    "#" + " ".repeat(W - 2) + "#",
    "#".repeat(W),
  ];
  const alive = (b.defeated_at ?? b.started_at) - b.started_at;
  const dmg = fmt(b.total_damage) + (b.overkill > 0 ? "+" : "");
  const stats = [
    `BOSS #${String(b.seq).padStart(3, "0")}`,
    "",
    `KILLING BLOW   ${b.killer_name ?? "?"}`,
    `TOTAL ATTACKS  ${fmt(b.total_attacks)}`,
    `TOTAL PLAYERS  ${fmt(b.unique_players)}`,
    `TOTAL DAMAGE   ${dmg}`,
    `TIME ALIVE     ${duration(alive)}`,
  ];
  const wrap = el("div", "dead-box");
  const top = el("pre", "art");
  const art = el("pre", "art");
  const info = el("pre", "art");
  info.style.setProperty("color", "var(--fg)");
  wrap.append(top, art, info);
  wrap.append(el("div", "epitaph", bossText(def.death_line ?? "")));
  const teaser = el("div", "teaser", state.content?.next_boss_teaser ?? "SOMETHING LARGER IS APPROACHING...");
  teaser.append(el("span", "blink", "_"));
  wrap.append(teaser);
  // Countdown to the next boss (only if one is coming).
  wrap.append(el("div", "next-count", ""));
  tickNextBoss();
  host.replaceChildren(wrap);
  setArt(top, banner, 15);
  setArt(art, def.dead_art, 14);
  setArt(info, box(stats, { align: "left", padX: 2 }), 14);
}

let tauntTimer = 0;
export function startTaunts() {
  const show = () => {
    const ph = phaseDef();
    const t = $("taunt");
    if (!ph?.taunts?.length || state.boss?.status !== "alive") {
      t.textContent = "";
      return;
    }
    t.textContent = `"${bossText(ph.taunts[Math.floor(Math.random() * ph.taunts.length)])}"`;
  };
  show();
  clearInterval(tauntTimer);
  tauntTimer = window.setInterval(show, 14000);
}

/** Re-render on resize (bar width depends on it). */
window.addEventListener("resize", () => {
  redrawArt = true;
  renderBoss();
});

/** Update the "next boss in 4:59" line on the death screen (every second). */
export function tickNextBoss() {
  const node = document.querySelector("#boss-dead .next-count");
  const b = state.boss;
  if (!node || !b) return;
  if (!b.next_at) {
    setText(node, "");
    return;
  }
  const left = Math.max(0, Math.round(b.next_at - now()));
  const m = Math.floor(left / 60), sec = String(left % 60).padStart(2, "0");
  setText(node, left > 0 ? `ARRIVES IN ${m}:${sec}` : "IT'S HERE...");
}
