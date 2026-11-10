// A boss relic (Boss Unique) drop: about one attack in a million, so it gets
// its own moment. Sparks are pulled in from the edges, the boss's name tears
// through, the screen flashes cyan and violet, rays burst out, and then the
// item card shows as usual. Everyone else online gets a banner.

import { center, el, fitArt } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { bossDef, itemById, rarityById } from "../store.js?v=b6664395f3";
import { shake, showOverlay } from "./fx.js?v=b6664395f3";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const W = 44, H = 15;
const SPARKS = 46;

/** Sparks drawn toward the centre. @param {number} t 0..1 */
function gatherFrame(t) {
  const grid = Array.from({ length: H }, () => Array(W).fill(" "));
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let i = 0; i < SPARKS; i++) {
    const angle = (i / SPARKS) * Math.PI * 2 + i * 0.37;
    const start = 0.75 + ((i * 7) % 10) / 40; // staggered: some arrive first
    const r = Math.max(0, start - t * (1 + (i % 3) * 0.15));
    if (r <= 0.04) continue;
    const x = Math.round(cx + Math.cos(angle) * r * cx);
    const y = Math.round(cy + Math.sin(angle) * r * cy);
    if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = r > 0.6 ? "." : r > 0.35 ? "+" : r > 0.15 ? "*" : "@";
  }
  // The core brightens as they arrive.
  const core = t < 0.4 ? "." : t < 0.7 ? "o" : t < 0.9 ? "O" : "@";
  grid[Math.round(cy)][Math.round(cx)] = core;
  return grid.map((row) => row.join(""));
}

/** Rays bursting out of the centre. @param {number} t 0..1 */
function burstFrame(t) {
  const grid = Array.from({ length: H }, () => Array(W).fill(" "));
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  /** @type {Array<[string, number, number]>} */
  const rays = [["-", 1, 0], ["-", -1, 0], ["|", 0, 1], ["|", 0, -1],
    ["\\", 1, 1], ["\\", -1, -1], ["/", 1, -1], ["/", -1, 1]];
  const reach = t * cx;
  for (const [ch, dx, dy] of rays) {
    for (let s = Math.max(1, reach - 7); s <= reach; s += 0.5) {
      const x = Math.round(cx + dx * s * (dy ? 0.5 : 1) * 2);
      const y = Math.round(cy + dy * s * 0.5);
      if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = ch;
    }
  }
  const label = "<! BOSS RELIC !>";
  const row = grid[Math.round(cy)];
  const at = Math.round(cx - label.length / 2);
  for (let i = 0; i < label.length; i++) row[at + i] = label[i];
  return grid.map((r) => r.join(""));
}

/**
 * The big moment, before the normal item card. Resolves when it's done.
 * @param {any} item a boss_unique item
 */
export function relicSequence(item) {
  if (reduced) return Promise.resolve();
  const boss = bossDef(item.boss_only?.[0] ?? "")?.name ?? "THE BOSS";
  return showOverlay((inner, close) => {
    inner.classList.add("relic-seq");
    const stage = el("pre", "art relic-stage");
    stage.dataset.cols = String(W);
    const caption = el("div", "relic-caption");
    inner.append(stage, caption);
    requestAnimationFrame(() => fitArt(stage, 20)); // once the wide box is laid out
    const overlayEl = document.getElementById("overlay");
    const line = `${boss} DROPPED ITS RELIC`;
    let f = 0;
    const GATHER = 22, BURST = 14;
    sound.relic();
    const tick = () => {
      if (f < GATHER) {
        stage.textContent = gatherFrame((f + 1) / GATHER).join("\n");
        caption.textContent = line.slice(0, Math.ceil(((f + 1) / GATHER) * line.length));
        if (f === GATHER - 6) shake("s");
      } else if (f === GATHER) {
        overlayEl?.classList.add("relic-flash");
        shake("l");
        stage.classList.add("relic-burst");
      } else if (f <= GATHER + BURST) {
        stage.textContent = burstFrame((f - GATHER) / BURST).join("\n");
        if (f === GATHER + 3) overlayEl?.classList.remove("relic-flash");
      } else {
        stage.textContent = [...Array(Math.floor(H / 2)).fill(""), center(item.name, W)].join("\n");
        setTimeout(close, 650);
        return;
      }
      f++;
      setTimeout(tick, f <= GATHER ? 55 : 45);
    };
    tick();
  }, { dismissable: false });
}

let toastTimer = 0;

/** Someone else found a relic: a banner across the top for everyone online.
 * @param {any} e the loot feed event */
export function relicToast(e) {
  const item = itemById(e.item_id);
  if (!item) return;
  const boss = bossDef(item.boss_only?.[0] ?? "")?.name ?? "A BOSS";
  let host = document.getElementById("relic-toast");
  if (!host) {
    host = el("div", "relic-toast");
    host.id = "relic-toast";
    host.setAttribute("role", "status");
    document.body.append(host);
  }
  const label = rarityById("boss_unique")?.label ?? "BOSS UNIQUE";
  host.replaceChildren(el("span", "relic-toast-tag", `<! ${label} !>`), " ",
    el("b", "", e.name ?? "SOMEONE"), ` FOUND ${boss}'S RELIC: `, el("span", "r-boss_unique", item.name));
  host.classList.remove("leaving");
  host.hidden = false;
  sound.loot();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    host?.classList.add("leaving");
    toastTimer = window.setTimeout(() => host && (host.hidden = true), 600);
  }, 7000);
}
