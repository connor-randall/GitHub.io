// [ DAILY ]: a login reward every day, from midnight Mountain time
// (server/omhp/daily.py). A 30-day track of little ASCII tiles: the days
// you've opened show what they gave, the next few (the admin sets how many)
// show what's coming, every other day is a [?]. The first visit of
// the day pops it up; [DAILY] in the top bar opens it again.

import * as api from "../api.js?v=b6664395f3";
import { RARITY_STYLE, box, dedent, duration, el, fmt } from "../ascii.js?v=b6664395f3";
import { SCROLLS, boxById, emit, itemById, on, rarityById, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";
import { featureOpen } from "./tutorial.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const W = 10; // tile inner width
const NOISE = "?#@%&*+=<>[]/\\$";
/** Chest tint by its place in the shop (cheapest first). */
const BOX_TINT = ["uncommon", "rare", "epic", "legendary", "mythic", "ascended"];

/** @type {any} */
let daily = null;
/** Server time when a new day starts and the pop-up should show again. */
let checkAgainAt = 0;
let checking = false;
let opening = false;

const center = (/** @type {string} */ s) => {
  const t = s.slice(0, W);
  const left = Math.floor((W - t.length) / 2);
  return " ".repeat(left) + t + " ".repeat(W - t.length - left);
};

const shortNum = (/** @type {number} */ n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));
/** "2x WOODEN": a count (if more than 1) and the first word, to fit a tile. @param {number} count @param {string} name */
const fitName = (count, name) => `${count > 1 ? `${count}x ` : ""}${name.split(/[\s_]/)[0]}`.slice(0, W);

/** @param {string} id */
const boxTint = (id) => BOX_TINT[Math.max(0, (state.content?.boxes ?? []).findIndex((/** @type {any} */ b) => b.id === id))] ?? "rare";

/** The tile's picture and caption for a day's first gift. @param {any} g */
function glyph(g) {
  if (g.shards) return { icon: "<>", label: `${shortNum(g.shards)} SHARDS`, cls: "dl-shards" };
  if (g.box) return { icon: "[=]", label: fitName(g.count, boxById(g.box)?.name ?? g.box), cls: `r-${boxTint(g.box)}` };
  if (g.item) {
    const item = itemById(g.item);
    return { icon: "/#\\", label: (rarityById(item?.rarity)?.label ?? "ITEM"), cls: `r-${item?.rarity ?? "common"}` };
  }
  const s = /** @type {any} */ (SCROLLS)[g.scroll];
  return { icon: s?.mini ?? "~@~", label: fitName(g.count, s?.name ?? g.scroll), cls: "dl-scroll", color: s?.color };
}

/** Full words for one gift. @param {any} g */
function giftName(g) {
  if (g.shards) return `<> ${fmt(g.shards)} shards`;
  if (g.box) return `${g.count > 1 ? `${g.count} x ` : ""}${boxById(g.box)?.name ?? g.box}`;
  if (g.item) return itemById(g.item)?.name ?? g.item;
  const name = /** @type {any} */ (SCROLLS)[g.scroll]?.name ?? g.scroll;
  return `${g.count > 1 ? `${g.count} x ` : ""}${name}`;
}

/** One day's ASCII tile. @param {any} d */
function tile(d) {
  const shown = d.gives?.length ? glyph(d.gives[0]) : null;
  const more = (d.gives?.length ?? 0) > 1;
  const icon = shown ? shown.icon + (more ? "+" : "") : "[?]";
  const lines = [`.${"-".repeat(W)}.`, `|${center(`Day ${d.n}`)}|`,
    `|${center(icon)}|`, `|${center(shown ? shown.label : "")}|`, `'${"-".repeat(W)}'`];
  const pre = el("pre", `dl-tile dl-${d.state}${d.today ? " dl-just" : ""}`, lines.join("\n"));
  if (shown && d.state !== "hidden") {
    pre.classList.add(shown.cls);
    if (shown.color) pre.style.color = shown.color;
  }
  pre.title = d.state === "hidden" ? `Day ${d.n}: ???`
    : d.state === "today" ? `Day ${d.n}: open it!`
      : `Day ${d.n}: ${(d.gives ?? []).map(giftName).join(" + ") || "nothing"}`;
  return pre;
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const pick = (/** @type {string} */ chars) => chars[Math.floor(Math.random() * chars.length)];

/** One frame of an ASCII shockwave: a ring of - | / \ at radius ``r``,
 * sparks behind it, dust behind those. @param {number} r */
function boomFrame(r) {
  const cols = 41, rows = 15, cx = 20, cy = 7;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  const put = (/** @type {number[]} */ [x, y], /** @type {string} */ c) => {
    if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = c;
  };
  if (r < 1) put([cx, cy], "@");
  for (let deg = 0; deg < 360; deg += 12) {
    const a = (deg * Math.PI) / 180;
    const at = (/** @type {number} */ rr) => [cx + Math.round(Math.cos(a) * rr * 2.2), cy + Math.round(Math.sin(a) * rr)];
    if (r - 3 > 0 && Math.random() < 0.3) put(at(r - 3), pick(".'`,"));
    if (r - 1.5 > 0 && Math.random() < 0.45) put(at(r - 1.5), pick("*+x"));
    if (r <= 5) {
      const d = deg % 180;
      put(at(r), d < 23 || d > 157 ? "-" : d < 68 ? "\\" : d < 113 ? "|" : "/");
    } else if (Math.random() < 0.4) put(at(r), ".");
  }
  return grid.map((row) => row.join("")).join("\n");
}

/** Open today's tile, in characters only: it jitters, fills up, cracks,
 * blows apart in a ring of - | / \, and the reward prints in line by line.
 * @param {HTMLElement} pre the [?] tile @param {HTMLElement} final the revealed tile @param {HTMLElement} host */
async function openSequence(pre, final, host) {
  if (reduced) {
    pre.replaceWith(final);
    return;
  }
  const lines = (pre.textContent ?? "").split("\n");
  const blank = `|${" ".repeat(W)}|`;
  /** @param {string} edge @param {string[]} mid the 3 inside rows @param {number} [shift] jitter: -1, 0, 1 */
  const frame = (edge, mid, shift = 0) => {
    const rows = [`.${edge.repeat(W)}.`, ...mid.map((m) => `|${center(m)}|`), `'${edge.repeat(W)}'`];
    return rows.map((row, i) => ((i + (shift > 0 ? 1 : 0)) % 2 && shift ? ` ${row}` : `${row} `)).join("\n");
  };
  const day = lines[1].slice(1, -1).trim();
  // 1. it jitters, whole characters at a time, faster and faster
  for (let i = 0; i < 12; i++) {
    pre.textContent = frame("-=~"[i % 3], [day, i % 2 ? "[!]" : "[?]", ""], i % 2 ? 1 : -1);
    await wait(120 - i * 7);
  }
  // 2. it fills up from the bottom: . : * # @
  const levels = " .:*#@";
  for (let i = 1; i <= 8; i++) {
    const row = (/** @type {number} */ k) => levels[Math.max(0, Math.min(5, Math.floor(i - k)))].repeat(W);
    pre.textContent = frame("=", [row(3), row(1.5), row(0)], i % 2 ? 1 : -1);
    await wait(55);
  }
  // 3. it cracks
  pre.textContent = frame("#", ["\\/\\/\\/\\/\\/", "/\\/\\/\\/\\/\\", "\\/\\/\\/\\/\\/"]);
  await wait(140);
  // 4. it blows apart: a shockwave over the grid, debris where the tile was
  const boom = el("pre", "dl-boom");
  boom.style.color = getComputedStyle(final).color;
  boom.style.left = `${pre.offsetLeft + pre.offsetWidth / 2}px`;
  boom.style.top = `${pre.offsetTop + pre.offsetHeight / 2}px`;
  host.append(boom);
  for (let r = 0; r <= 8; r++) {
    boom.textContent = boomFrame(r);
    pre.textContent = frame(r < 3 ? pick(".'`") : " ",
      [r < 4 ? pick(NOISE).repeat(2) : "", r < 2 ? "@@" : r < 5 ? pick("*+.") : "", ""]);
    await wait(65);
  }
  boom.remove();
  // 5. the reward prints in, top line first
  const end = (final.textContent ?? "").split("\n");
  final.textContent = [end[0], blank, blank, blank, end[4]].join("\n");
  pre.replaceWith(final);
  for (let i = 1; i <= 3; i++) {
    await wait(90);
    final.textContent = end.map((l, k) => (k === 0 || k === 4 || k <= i ? l : blank)).join("\n");
  }
}

/** Type a line out letter by letter. @param {HTMLElement} node @param {string} text */
async function typeOut(node, text) {
  if (reduced) {
    node.textContent = text;
    return;
  }
  for (let i = 1; i <= text.length; i++) {
    node.textContent = text.slice(0, i);
    await wait(18);
  }
}

/** An item won, as its framed card. @param {any} item */
function itemCard(item) {
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const label = style.deco[0] + (rarityById(item.rarity)?.label ?? item.rarity.toUpperCase()) + style.deco[1];
  return el("pre", `art dl-item-art r-${item.rarity}`, box([...dedent(item.art), "", label, item.name], { style, width: 26 }).join("\n"));
}

function untilReset() {
  const left = (daily?.next_reset ?? 0) - (Date.now() / 1000 + (state.serverSkew ?? 0));
  return duration(left);
}

/** The pop-up: when the next reward is, the 30 tiles, today's [ OPEN ] button, what you got. */
function openTrack() {
  if (!daily) return Promise.resolve();
  return showOverlay((inner, close) => {
    inner.classList.add("daily");
    const head = el("pre", "art daily-head", box(["D A I L Y   L O O T", `day ${daily.day} of 30${daily.lap > 1 ? `  ::  lap ${daily.lap}` : ""}`], { width: 34 }).join("\n"));
    // Right under the title: open now, or how long until the next one (ticks every second).
    const timer = el("div", "dl-timer");
    const paintTimer = () => {
      timer.classList.toggle("ready", !daily.claimed_today);
      timer.textContent = daily.claimed_today
        ? `NEXT REWARD IN ${untilReset()}`
        : `>> DAY ${daily.day} IS READY. open it before midnight MT (${untilReset()} left) <<`;
    };
    paintTimer();
    const tick = setInterval(() => {
      if (!timer.isConnected) clearInterval(tick);
      else paintTimer();
    }, 1000);
    const grid = el("div", "dl-grid");
    /** @type {HTMLElement[]} */
    const tiles = daily.days.map((/** @type {any} */ d) => tile(d));
    grid.append(...tiles);
    const got = el("div", "dl-got");
    const foot = el("div", "dim dl-foot");
    const actions = el("div", "actions");
    const closeBtn = /** @type {HTMLButtonElement} */ (el("button", "", "[ CLOSE ]"));
    closeBtn.addEventListener("click", close);

    // The days you can peek at, in full words (tiles only fit a short label).
    const comingUp = () => {
      const next = daily.days.filter((/** @type {any} */ d) => d.state === "next");
      foot.replaceChildren(el("div", "dl-sub", next.length ? "COMING UP" : "a new lap starts after day 30"));
      for (const d of next) {
        foot.append(el("div", "", `Day ${d.n}: ${d.gives.map(giftName).join(" + ")}`));
      }
    };
    comingUp();

    if (daily.claimed_today) {
      actions.append(closeBtn);
    } else {
      const open = /** @type {HTMLButtonElement} */ (el("button", "dl-open", `[ OPEN DAY ${daily.day} ]`));
      open.addEventListener("click", async () => {
        if (opening) return;
        opening = true;
        open.disabled = true;
        closeBtn.hidden = true;
        try {
          const res = await api.claimDaily();
          const fresh = tile(res.daily.days[res.n - 1]);
          await openSequence(tiles[res.n - 1], fresh, grid);
          daily = res.daily; // only now: the timer flips to "next reward in" after the reveal
          tiles[res.n - 1] = fresh;
          state.me = res.me;
          emit("me");
          paintTimer();
          comingUp();
          got.replaceChildren(el("div", "dim dl-sub", `DAY ${res.n}: YOU GOT`));
          for (const g of res.gives) {
            const item = g.item ? itemById(g.item) : null;
            if (item) got.append(itemCard(item));
            const line = el("div", "dl-gift");
            const name = el("span", glyph(g).cls);
            line.append(el("span", "dim", "+ "), name);
            got.append(line);
            await typeOut(name, giftName(g));
          }
          if (!res.gives.length) got.append(el("div", "dim", "nothing today. odd."));
          got.append(el("div", "dim dl-note", "it's already in your bag."));
          open.remove();
          closeBtn.textContent = "[ NICE! ]";
          closeBtn.hidden = false;
          closeBtn.focus({ preventScroll: true });
          paintButton();
        } catch (e) {
          showError(/** @type {Error} */ (e).message);
          open.disabled = false;
          closeBtn.hidden = false;
        } finally {
          opening = false;
        }
      });
      actions.append(open, closeBtn);
      closeBtn.textContent = "[ LATER ]";
    }
    inner.append(head, timer, grid, got, foot, actions);
  });
}

function paintButton() {
  const b = document.getElementById("daily-btn");
  if (!b) return;
  const ready = Boolean(daily && !daily.claimed_today);
  $("daily-wrap").hidden = !state.me?.name_chosen || !featureOpen("daily"); // the tutorial opens it at step 5
  b.textContent = ready ? "[DAILY*]" : "[DAILY]";
  b.classList.toggle("on", ready);
  b.title = ready ? "today's login reward is waiting" : "your 30-day login rewards";
}

async function load() {
  try {
    daily = await api.getDaily();
  } catch {
    daily = null;
  }
  paintButton();
}

export function initDaily() {
  const btn = $("daily-btn");
  btn.addEventListener("click", async () => {
    await load();
    if (daily) openTrack();
  });
  // Once per day per tab (the server says when the next day starts): the
  // first time we know you're named, check and pop it up.
  on("me", async () => {
    paintButton();
    if (!state.me?.name_chosen || !featureOpen("daily") || checking) return;
    if (Date.now() / 1000 + (state.serverSkew ?? 0) < checkAgainAt) return;
    checking = true;
    await load();
    checking = false;
    checkAgainAt = daily?.next_reset ?? 0;
    if (daily && !daily.claimed_today) openTrack();
  });
}
