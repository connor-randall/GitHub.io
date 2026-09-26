// The boss: art per phase, HP bar, globals, reactions and the death screen.

import { bar, box, center, duration, el, fmt, setArt } from "../ascii.js";
import { bossDef, bossText, state } from "../store.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const artEl = $("boss-art");
let lastHp = -1;
let lastPhase = 0;
let hurtUntil = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let hurtTimer;

function phaseDef() {
  const b = state.boss;
  const def = b && bossDef(b.def_id);
  if (!def) return null;
  return def.phases.find((/** @type {any} */ p) => p.phase === b.phase) ?? def.phases[0];
}

function drawArt() {
  const ph = phaseDef();
  if (!ph) return;
  const hurt = performance.now() < hurtUntil;
  setArt(artEl, hurt ? ph.hurt_art : ph.art, 15);
  artEl.classList.toggle("glitch", Boolean(ph.glitch));
  artEl.classList.toggle("phase-2", ph.phase === 2);
  artEl.classList.toggle("phase-3", ph.phase >= 3);
}

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

function hpCells() {
  const w = $("hp-bar").parentElement?.clientWidth ?? 320;
  return Math.max(12, Math.min(40, Math.floor(w / 9.2) - 2));
}

export function renderBoss() {
  const b = state.boss;
  const def = b && bossDef(b.def_id);
  if (!b || !def) return;
  const num = `BOSS #${String(b.seq).padStart(3, "0")}`;
  $("st-boss").textContent = num;
  $("boss-num").textContent = num;

  const dead = b.status === "defeated";
  $("boss-alive").hidden = dead;
  $("boss-dead").hidden = !dead;
  if (dead) {
    renderDeath(b, def);
    return;
  }

  $("boss-name").textContent = b.name;
  $("boss-sub").textContent = b.subtitle;
  if (b.phase !== lastPhase) {
    lastPhase = b.phase;
    drawArt();
  }
  const frac = b.hp / b.max_hp;
  const hpBar = $("hp-bar");
  hpBar.textContent = "HP " + bar(frac, hpCells());
  hpBar.classList.toggle("low", frac <= 0.1);
  const now = $("hp-now");
  now.textContent = fmt(b.hp);
  if (lastHp >= 0 && b.hp < lastHp) {
    now.classList.remove("tick");
    void now.offsetWidth;
    now.classList.add("tick");
  }
  lastHp = b.hp;
  $("hp-max").textContent = fmt(b.max_hp);
  $("hp-pct").textContent = `(${(frac * 100).toFixed(frac < 0.01 ? 3 : 2)}%)`;
  const phase = $("phase");
  const ph = phaseDef();
  phase.textContent = ph?.label ?? `PHASE ${b.phase}`;
  phase.classList.toggle("p3", b.phase >= 3);
  $("g-attacks").textContent = fmt(b.total_attacks);
  $("g-damage").textContent = fmt(b.total_damage);
  $("g-players").textContent = fmt(b.unique_players);
}

/** @param {any} b @param {any} def */
function renderDeath(b, def) {
  const host = $("boss-dead");
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
  lastPhase = 0;
  renderBoss();
});
