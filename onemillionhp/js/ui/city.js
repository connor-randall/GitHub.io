// [ CITY ] panel: the city everyone is saving from the bosses. A
// "DONATIONS NEEDED!" bar coloured by who gave the most this stage, the city
// itself (very zoomed out) with a speech bubble, and ways to give shards,
// items, loot boxes and scrolls. Each stage adds a building; the one being
// built rises out of its scaffolding as the bar fills.

import * as api from "../api.js?v=b6664395f3";
import { RARITY_STYLE, ago, box, dedent, el, fitArt, fmt } from "../ascii.js?v=b6664395f3";
import { SCROLLS, boxById, emit, itemById, now, on, rarityById, state } from "../store.js?v=b6664395f3";
import { isWorn } from "./bag.js?v=b6664395f3";
import { effectLine } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";
import { loadoutTag, loadoutsWith } from "./loadouts.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const BAR = 44;          // bar cells
const PLEA_EVERY = 7000; // ms per speech-bubble line
const ITEMS_SHOWN = 10;
const MAX_COUNT = 10_000;        // city.py: most boxes / scrolls per donation
const MAX_SHARDS = 100_000_000;  // and shards
/** Bar colours for this stage's top donors, biggest first (then everyone else). */
const DONOR_CLASSES = ["d1", "d2", "d3", "d4", "d5", "d6"];

/** @type {any} */
let city = null;
let loadedAt = 0;
let loading = false;
let busy = false;
let showAllItems = false;
/** A big donation waiting for its second click: "kind:ref:count". */
let armed = "";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let disarmTimer;
/** @type {ReturnType<typeof setInterval> | undefined} */
let ticker;
let pleaIndex = 0;

const visible = () => !$("panel-city").hidden;

// Content and your bag arrive after the tab first draws (and change as you
// play): redraw, unless a big gift is waiting for its second click.
on("me", () => {
  if (visible() && !armed) render();
});

/** @param {boolean} [force] */
export async function loadCity(force = false) {
  if (visible()) render();
  if (loading || (!force && city && Date.now() - loadedAt < 10000)) return;
  loading = true;
  try {
    city = await api.getCity();
    loadedAt = Date.now();
    if (visible()) render();
  } catch (e) {
    if (visible()) showError(/** @type {Error} */ (e).message);
  } finally {
    loading = false;
  }
}

// ------------------------------------------------------------------- the bar

/** Split ``filled`` cells between the donors by points (largest remainder),
 * so every colour on the bar is someone's share. @param {any[]} shares @param {number} filled */
function allot(shares, filled) {
  const total = shares.reduce((s, x) => s + x.points, 0);
  if (!total || !filled) return shares.map(() => 0);
  const exact = shares.map((x) => (x.points / total) * filled);
  const cells = exact.map(Math.floor);
  let left = filled - cells.reduce((s, n) => s + n, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    cells[i] += 1;
    left -= 1;
  }
  return cells;
}

function donationBar() {
  const { stage, top, others } = city;
  const wrap = el("div", "city-bar-wrap");
  const done = stage.progress / stage.goal;
  const head = el("div", "city-need");
  head.append(el("span", "city-need-word", "!! DONATIONS NEEDED !!"), el("span", "dim", `  building ${stage.name}`));
  const pre = el("pre", "art city-bar");
  const filled = Math.min(BAR, Math.floor(done * BAR + (stage.progress > 0 ? 0.999 : 0)));
  const shares = [...top, ...(others ? [{ name: "everyone else", points: others, rest: true }] : [])];
  const cells = allot(shares, filled);
  pre.append("[");
  shares.forEach((s, i) => {
    if (cells[i]) pre.append(el("span", s.rest ? "d-rest" : DONOR_CLASSES[i], "█".repeat(cells[i])));
  });
  pre.append(el("span", "d-empty", "·".repeat(BAR - filled)), "]");
  pre.dataset.cols = String(BAR + 2);
  const nums = el("div", "city-nums");
  nums.append(el("b", "", fmt(stage.progress)), el("span", "dim", ` / ${fmt(stage.goal)} points  (${Math.floor(done * 100)}%)`),
    el("span", "dim", `  ::  ${fmt(city.donors)} donor${city.donors === 1 ? "" : "s"}`));
  const legend = el("div", "city-legend");
  shares.forEach((s, i) => {
    const key = el("span", "city-key");
    key.append(el("span", s.rest ? "d-rest" : DONOR_CLASSES[i], "█ "), el("span", s.player_id === state.me?.id ? "city-you" : "", s.name),
      el("span", "dim", ` ${fmt(s.points)}`));
    legend.append(key);
  });
  if (!shares.length) legend.append(el("span", "dim", "> nobody has given yet. be the first, and the bar takes your colour."));
  wrap.append(head, pre, nums, legend);
  requestAnimationFrame(() => fitArt(pre, 16));
  return wrap;
}

// ------------------------------------------------------------------ the city
// Drawn on a grid of [char, class] cells, very zoomed out: mountains, the
// city between its walls, the boss lurking at the edge. Sprites stand on
// the ground row; ``x`` is their left edge.

const W = 84;
const H = 9;
const GROUND = H - 1;
/** @type {Record<string, {x: number, art: string[]}>} */
const BUILDINGS = {
  wall: { x: 14, art: ["n_n", "|#|", "|#|"] },
  well: { x: 21, art: [" _ ", "(o)"] },
  market: { x: 26, art: ["/~~\\/~~\\", "|..||..|"] },
  forge: { x: 36, art: [" ~  ", " |  ", "[##]"] },
  temple: { x: 42, art: ["  /\\  ", " /__\\ ", " |||| "] },
  tower: { x: 50, art: [" ^ ", "|o|", "| |", "| |", "|_|"] },
  castle: { x: 55, art: ["n_n   n_n", "| |___| |", "|  _ _  |", "|_|_|_|_|"] },
  beacon: { x: 50, art: ["\\*/", " ' "] }, // sits on top of the tower
};
const WALL_RIGHT = 67;
/** Rows of tiny houses behind everything, between the walls: the city from far away. */
const TOWN = { x: 17, rows: [
  " n   ^  n ^   n  ^ n   ^   n ^  n   ^ n  ^   n  ",
  "|_| |_||_|_| |_||_|_||_| |_||_||_| |_|_| |_| |_| ",
] };
const MOUNTAINS_LEFT = [
  "     /\\       ",
  "    /  \\  /\\  ",
  " /\\/    \\/  \\ ",
  "/            \\",
];
const MOUNTAINS_RIGHT = [
  "       /\\     ",
  "  /\\  /  \\    ",
  " /  \\/    \\/\\ ",
  "/            \\",
];

/** @param {any} boss */
function cityArt(boss) {
  /** @type {[string, string][][]} */
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => /** @type {[string, string]} */ ([" ", ""])));
  const put = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ ch, /** @type {string} */ cls) => {
    if (x >= 0 && x < W && y >= 0 && y < H && ch !== " ") grid[y][x] = [ch, cls];
  };
  /** Stamp a sprite standing on the ground; ``solidRows`` from the bottom are solid, the rest scaffolding. */
  const stamp = (/** @type {{x: number, art: string[]}} */ b, /** @type {string} */ cls, solidRows = Infinity, /** @type {number} */ base = GROUND - 1) => {
    const rows = b.art.length;
    b.art.forEach((line, r) => {
      const fromBottom = rows - 1 - r;
      const solid = fromBottom < solidRows;
      [...line].forEach((ch, i) => put(b.x + i, base - fromBottom, solid ? ch : ".", solid ? cls : "c-scaffold"));
    });
  };
  // Mountains far off on both sides, the ground, the town behind it all.
  MOUNTAINS_LEFT.forEach((line, r) => [...line].forEach((ch, i) => put(i, GROUND - 4 + r, ch, "c-mtn")));
  MOUNTAINS_RIGHT.forEach((line, r) => [...line].forEach((ch, i) => put(W - line.length + i, GROUND - 4 + r, ch, "c-mtn")));
  const walled = city.built.some((/** @type {any} */ b) => b.id === "wall");
  for (let x = 0; x < W; x++) {
    const inside = walled && x >= BUILDINGS.wall.x && x <= WALL_RIGHT + 2;
    put(x, GROUND, inside ? "=" : "_", inside ? "c-wall" : "c-ground");
  }
  TOWN.rows.forEach((line, r) => [...line].forEach((ch, i) => put(TOWN.x + i, GROUND - TOWN.rows.length + r, ch, "c-town")));
  const built = new Set(city.built.map((/** @type {any} */ b) => b.id));
  const sprite = (/** @type {string} */ id) => {
    if (id === "wall") return [BUILDINGS.wall, { x: WALL_RIGHT, art: BUILDINGS.wall.art }];
    return [BUILDINGS[id]];
  };
  const baseOf = (/** @type {string} */ id) => (id === "beacon" ? GROUND - 1 - BUILDINGS.tower.art.length : GROUND - 1);
  for (const id of built) for (const b of sprite(id)) stamp(b, `c-${id}`, Infinity, baseOf(id));
  const current = city.stage.id;
  if (BUILDINGS[current] && !built.has(current)) {
    const rows = BUILDINGS[current].art.filter(Boolean).length;
    const solid = Math.floor((city.stage.progress / city.stage.goal) * rows);
    for (const b of sprite(current)) stamp(b, `c-${current}`, solid, baseOf(current));
  }
  // The boss, lurking just outside on the right.
  const lurk = boss && boss.status === "alive" ? "(oo)" : "";
  [...lurk].forEach((ch, i) => put(WALL_RIGHT + 5 + i, GROUND - 1, ch, "c-boss"));
  return grid;
}

/** The speech bubble (its own block, so it stays readable when the city is
 * tiny), wrapped to lines of at most ``max`` characters, tail in the middle.
 * @param {string} text @param {number} max */
function bubbleLines(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const w = Math.max(...lines.map((l) => l.length)) + 2;
  const t = Math.floor(w / 2);
  return { tail: t + 1, lines: [
    ` .${"-".repeat(w)}.`,
    ...lines.map((l) => `( ${l.padEnd(w - 2)} )`),
    ` '${"-".repeat(t)}.${"-".repeat(w - t - 1)}'`,
    `  ${" ".repeat(t)}|`,
  ] };
}

/** What the city says right now: its stage's pleas, plus how much is left and a thank-you. */
function pleas() {
  const { stage, top } = city;
  const left = Math.max(0, stage.goal - stage.progress);
  const lines = [...stage.pleas, `${fmt(left)} more points and we'll have ${stage.name.toLowerCase()}!`];
  if (top[0]) lines.push(`thank you, ${top[0].name}! you're our biggest hero.`);
  return lines;
}

function cityScene() {
  const scene = el("div", "city-scene");
  const lines = pleas();
  const say = lines[pleaIndex % lines.length];
  const narrow = scene.ownerDocument.documentElement.clientWidth < 520;
  const bubble = bubbleLines(say, narrow ? 26 : 44);
  // Ticket #232: as tall as the longest plea, so a long one doesn't push the city down.
  const rows = Math.max(...lines.map((line) => bubbleLines(line, narrow ? 26 : 44).lines.length));
  const talk = el("pre", "art city-bubble", "\n".repeat(rows - bubble.lines.length) + bubble.lines.join("\n"));
  const pre = el("pre", "art city-art");
  const full = cityArt(state.boss);
  const top = full.findIndex((row) => row.some(([ch]) => ch !== " "));
  const grid = full.slice(Math.max(0, top)); // no empty sky under the bubble
  grid.forEach((row, y) => {
    let run = "";
    let cls = "";
    for (const [ch, c] of row) {
      if (c !== cls && run) {
        pre.append(cls ? el("span", cls, run) : run);
        run = "";
      }
      cls = c;
      run += ch;
    }
    if (run) pre.append(cls ? el("span", cls, run) : run);
    if (y < grid.length - 1) pre.append("\n");
  });
  pre.dataset.cols = String(W);
  scene.append(talk, pre);
  // Size both, then slide the bubble so its tail sits over the building going up.
  const focus = BUILDINGS[city.stage.id] ?? BUILDINGS.castle;
  const focusCol = focus.x + Math.floor(Math.max(...focus.art.map((l) => l.length)) / 2);
  requestAnimationFrame(() => {
    fitArt(pre, 12);
    talk.style.fontSize = `${Math.min(13, Math.max(9, parseFloat(pre.style.fontSize || "12") * 1.6))}px`;
    const artW = pre.getBoundingClientRect().width;
    const artLeft = pre.offsetLeft;
    const bubbleW = talk.getBoundingClientRect().width;
    const ch = bubbleW / Math.max(...bubble.lines.map((l) => l.length));
    const want = artLeft + (focusCol / W) * artW - bubble.tail * ch;
    const room = scene.clientWidth - bubbleW;
    talk.style.marginLeft = `${Math.max(0, Math.min(room, want))}px`;
  });
  const track = el("div", "city-track");
  city.stages.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
    const state_ = i < city.stage.index ? "built" : i === city.stage.index ? "now" : "later";
    const step = el("span", `city-step step-${state_}`, state_ === "built" ? `[x] ${s.name}` : state_ === "now" ? `[>] ${s.name}` : `[ ] ${s.name}`);
    if (s.perk) step.title = `when built: ${s.perk}, for everyone`;
    track.append(step);
  });
  scene.append(track);
  return scene;
}

// ------------------------------------------------------------------ donating

/** @param {string} kind @param {string} ref @param {number} count @param {number} points @param {HTMLButtonElement} btn */
async function give(kind, ref, count, points, btn) {
  if (busy || count < 1) return;
  const key = `${kind}:${ref}:${count}`;
  if ((points >= 100 || kind === "dupes" || kind.startsWith("rarity")) && armed !== key) { // big / bulk gifts take a second click
    armed = key;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => {
      armed = "";
      render();
    }, 3000);
    render();
    return;
  }
  armed = "";
  busy = true;
  btn.disabled = true;
  try {
    const res = await api.donateCity(kind, ref, count);
    // Ticket #339: a gift stops where the city ends; the rest stays yours.
    if (res.count < count && kind !== "dupes" && !kind.startsWith("rarity")) {
      showError(`The city only needed ${fmt(res.count)} of that. The rest is still yours.`);
    }
    delete typed[`${kind}:${ref}`];
    city = res.city;
    loadedAt = Date.now();
    state.me = res.me;
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    render();
  }
}

/** A donation row: what it is on the left, its buttons on the right.
 * @param {(Node | string)[]} what @param {HTMLElement[]} buttons */
function row(what, buttons) {
  const r = el("div", "city-row");
  const left = el("span", "city-row-what");
  left.append(...what);
  const right = el("span", "city-row-btns");
  right.append(...buttons);
  r.append(left, right);
  return r;
}

/** A give button; shows "[ SURE? +N ]" while armed. @param {string} label @param {string} kind @param {string} ref @param {number} count @param {number} points */
function giveBtn(label, kind, ref, count, points) {
  const key = `${kind}:${ref}:${count}`;
  const b = /** @type {HTMLButtonElement} */ (el("button", `inline-btn city-give${armed === key ? " armed" : ""}`,
    armed === key ? `[ SURE? +${fmt(points)} ]` : label));
  b.type = "button";
  b.disabled = busy || count < 1;
  b.addEventListener("click", () => give(kind, ref, count, points, b));
  return b;
}

/** What's typed in the GIVE X boxes, by "kind:ref" (kept across redraws). @type {Record<string, string>} */
const typed = {};

/** GIVE X (tickets #62 / #193): type how many, then [ GIVE ] (big gifts still ask twice).
 * @param {string} kind @param {string} ref @param {number} max @param {number} each */
function giveSome(kind, ref, max, each) {
  const key = `${kind}:${ref}`;
  const input = /** @type {HTMLInputElement} */ (el("input", "loadout-input city-count"));
  input.type = "number";
  input.min = "1";
  input.max = String(max);
  input.inputMode = "numeric";
  input.placeholder = "qty";
  input.title = `give any number, up to ${fmt(max)}`;
  input.value = typed[key] ?? "";
  input.dataset.key = key;
  const count = () => Math.min(max, Math.max(0, Math.floor(Number(input.value) || 0)));
  const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn city-give", "[ GIVE ]"));
  b.type = "button";
  const paint = () => {
    const sure = armed === `${key}:${count()}`;
    b.classList.toggle("armed", sure);
    b.textContent = sure ? `[ SURE? +${fmt(count() * each)} ]` : "[ GIVE ]";
    b.disabled = busy || count() < 1;
  };
  paint();
  input.addEventListener("input", () => {
    typed[key] = input.value;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") b.click();
  });
  b.addEventListener("click", () => give(kind, ref, count(), count() * each, b));
  const wrap = el("span", "city-some");
  wrap.append(input, b);
  return wrap;
}

/** Name a reward gift: an item (in its rarity colour), a box, or shards. @param {any} g */
function giftLabel(g) {
  if (g.item) {
    const item = itemById(g.item);
    return el("span", item ? `r-${item.rarity}` : "", item?.name ?? g.item);
  }
  if (g.box) return el("span", "box-tag", `${g.count > 1 ? `${g.count} x ` : ""}${boxById(g.box)?.name ?? g.box}`);
  return el("span", "shard-tag", `<> ${fmt(g.shards)} shards`);
}

/** @param {any} t */
const rankText = (t) => (t.ranks[0] === t.ranks[1] ? ["", "gave the most", "gave the 2nd most", "gave the 3rd most"][t.ranks[0]] ?? `rank #${t.ranks[0]}`
  : t.ranks[1] >= 1e8 ? `rank #${t.ranks[0]} and below` : `ranks #${t.ranks[0]}-${t.ranks[1]}`);
const tierById = (/** @type {string | null} */ id) => city.rewards.find((/** @type {any} */ t) => t.id === id);

/** "YOU: #4 this building" box under the city. */
function standingBox() {
  const box = el("div", "city-standing");
  const me = state.me;
  const name = city.stage.name;
  if (!me?.name_chosen) {
    box.append(el("span", "dim", "> make your account first (hit [ ATTACK ]) and you can help build the city."));
    return box;
  }
  const you = city.you;
  if (!you) {
    const lowest = city.rewards[city.rewards.length - 1];
    box.append(el("span", "", `> you haven't given to ${name} yet. `),
      el("span", "dim", lowest ? `give anything and you'll get the ${lowest.label} reward when it's built.` : ""));
    return box;
  }
  const tier = tierById(you.tier);
  const next = tierById(you.next_tier);
  box.append(el("span", "city-standing-rank", `YOU: #${you.rank}`), el("span", "", ` on ${name} with ${fmt(you.points)} pts`));
  if (tier) box.append(el("span", "dim", "  ::  reward right now: "), el("b", `tier-${tier.id}`, tier.label));
  if (next && you.gap > 0) box.append(el("div", "dim city-standing-next", `> ${fmt(you.gap)} more pts to reach ${next.label}.`));
  box.append(cityStanding());
  return box;
}

const finaleById = (/** @type {string | null} */ id) => city.city.finale.find((/** @type {any} */ t) => t.id === id);

/** Your place among everyone who gave to this whole city (the finale rewards). */
function cityStanding() {
  const line = el("div", "dim city-standing-next");
  const you = city.city.you;
  const last = city.city.finale[city.city.finale.length - 1];
  if (!you) {
    line.append(`> whole city: the top ${last?.ranks[1] ?? 25} donors to ${city.city.name} get big rewards when it's finished.`);
    return line;
  }
  const tier = finaleById(you.tier);
  const next = finaleById(you.next_tier);
  line.append(`> whole city: #${you.rank} with ${fmt(you.points)} pts`);
  if (tier) line.append("  ::  ", el("b", `tier-${tier.id}`, tier.label));
  if (next && you.gap > 0) line.append(`  ::  ${fmt(you.gap)} more to reach ${next.label}`);
  else if (!tier && last) line.append(`  ::  top ${last.ranks[1]} get rewarded`);
  return line;
}

/** CITY PERKS: what every finished building gives everyone. */
function perksBox() {
  const p = city.perks;
  const box_ = el("div", `city-perks${p.doubled ? " city-perks-doubled" : ""}`);
  const head = el("div", "city-perks-h");
  head.append(el("span", "city-card-title", "CITY PERKS"), el("span", "dim", " for everyone playing"));
  if (p.doubled) {
    head.append(el("span", "city-perks-x2",
      `  x2! ${p.city} IS FINISHED  ::  ${ago(Math.max(0, p.until - now()))} left`));
  }
  box_.append(head);
  const list = el("div", "city-perks-list");
  for (const k of p.perks) {
    const row = el("span", `city-perk${k.on ? " on" : ""}`);
    row.append(k.on ? "[x] " : "[ ] ", el("span", "city-perk-text", k.text),
      el("span", "dim", ` (${k.building.replace(/^THE /, "")})`));
    list.append(row);
  }
  box_.append(list);
  const hours = city.celebrate_hours ?? 24;
  box_.append(el("div", "dim city-perks-note", p.doubled
    ? `every perk is doubled until the timer runs out${p.locked ? " (and nobody can donate)" : ""}. `
      + "then the new city's buildings start earning them back."
    : `every building the city finishes turns its perk on. finish the whole city and it celebrates for ${hours} hours: `
      + "every perk doubles and nobody can donate."));
  return box_;
}

/** @type {"donate" | "rewards" | "heroes" | "history"} */
let view = (() => {
  try {
    const v = localStorage.getItem("omhp.city.view");
    return v === "rewards" || v === "heroes" || v === "history" ? v : "donate";
  } catch {
    return "donate";
  }
})();

function subTabs() {
  const bar = el("div", "city-tabs");
  bar.setAttribute("role", "tablist");
  for (const [id, label] of /** @type {const} */ ([["donate", "DONATE"], ["rewards", "REWARDS"], ["heroes", "HEROES"], ["history", "HISTORY"]])) {
    const b = el("button", "city-tab", `[ ${label} ]`);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(view === id));
    b.addEventListener("click", () => {
      view = id;
      try {
        localStorage.setItem("omhp.city.view", id);
      } catch {
        /* ignore */
      }
      render();
    });
    bar.append(b);
  }
  return bar;
}

/** One donation section: a titled box with a line on what it's worth. @param {string} title @param {string} worth */
function section(title, worth) {
  const box = el("div", "city-card");
  const head = el("div", "city-card-h");
  head.append(el("span", "city-card-title", title), el("span", "dim city-card-worth", worth));
  box.append(head);
  return box;
}

function donatePanel() {
  const me = state.me;
  const v = city.values;
  const wrap = el("div", "city-donate");
  wrap.append(el("div", "city-how", "pick something you can spare, click GIVE. it turns into points, the points fill the bar, "
    + "and when the bar is full the building goes up and every donor gets a reward (see REWARDS)."));
  if (!me?.name_chosen) return wrap;
  if (city.perks.locked) { // a city was just finished: it celebrates, nobody builds
    wrap.append(el("div", "city-perks-x2", `> ${city.perks.city} IS CELEBRATING. donations open again in `
      + `${ago(Math.max(0, city.perks.until - now()))}, when the new city starts.`));
    return wrap;
  }

  // Shards
  const shards = me.shards ?? 0;
  const sc = section("SHARDS", `1 shard = ${v.shard} pt`);
  /** @type {HTMLElement[]} */
  const sbtns = [10, 100, 1000].filter((n) => shards >= n).map((n) => giveBtn(`[ GIVE ${fmt(n)} ]`, "shards", "", n, n * v.shard));
  if (shards) sbtns.push(giveSome("shards", "", Math.min(shards, MAX_SHARDS), v.shard),
    giveBtn(`[ GIVE ALL ${fmt(shards)} ]`, "shards", "", shards, shards * v.shard));
  sc.append(row([el("span", "", "you have "), el("b", "shard-tag", `<> ${fmt(shards)}`)],
    sbtns.length ? sbtns : [el("span", "dim", "none to give")]));
  wrap.append(sc);

  // Loot boxes
  const boxes = (me.boxes ?? []).filter((/** @type {any} */ b) => b.count > 0 && v.box[b.box_id]);
  const bc = section("LOOT BOXES", "worth what the shop charges");
  if (!boxes.length) bc.append(el("div", "dim city-empty", "you have no unopened boxes."));
  for (const b of boxes) {
    /** @type {HTMLElement[]} */
    const btns = [giveBtn("[ GIVE 1 ]", "box", b.box_id, 1, v.box[b.box_id])];
    if (b.count > 1) {
      btns.push(giveSome("box", b.box_id, Math.min(b.count, MAX_COUNT), v.box[b.box_id]),
        giveBtn(`[ GIVE ALL ${fmt(b.count)} ]`, "box", b.box_id, b.count, b.count * v.box[b.box_id]));
    }
    bc.append(row([el("span", "box-tag", boxById(b.box_id)?.name ?? b.box_id), el("span", "dim", ` x${fmt(b.count)}`),
      el("span", "city-pts-each", `  +${fmt(v.box[b.box_id])} pts each`)], btns));
  }
  wrap.append(bc);

  // Scrolls
  const scrolls = (me.scrolls ?? []).filter((/** @type {any} */ s) => s.count > 0);
  const scc = section("SCROLLS", `${fmt(v.scroll)} pts each${Object.keys(v.scrolls ?? {}).length ? " (some are worth more)" : ""}`);
  if (!scrolls.length) scc.append(el("div", "dim city-empty", "you have no scrolls."));
  for (const s of scrolls) {
    const def = SCROLLS[s.scroll_id];
    const name = el("span", "", def?.name ?? s.scroll_id);
    if (def) name.style.color = def.color;
    const each = v.scrolls?.[s.scroll_id] ?? v.scroll; // ticket #206: BOSS HEAL is worth 100
    /** @type {HTMLElement[]} */
    const btns = [giveBtn("[ GIVE 1 ]", "scroll", s.scroll_id, 1, each)];
    if (s.count > 1) {
      btns.push(giveSome("scroll", s.scroll_id, Math.min(s.count, MAX_COUNT), each),
        giveBtn(`[ GIVE ALL ${fmt(s.count)} ]`, "scroll", s.scroll_id, s.count, s.count * each));
    }
    const worth = each !== v.scroll ? [el("span", "dim", ` · ${fmt(each)} pts each`)] : [];
    scc.append(row([name, el("span", "dim", ` x${fmt(s.count)}`), ...worth], btns));
  }
  wrap.append(scc);

  // Items: spare copies only (not locked; one copy of what you wear or have in a loadout stays).
  const keep = (/** @type {string} */ id) => isWorn(me, id) || loadoutsWith(id).length > 0;
  const spare = (me.inventory ?? []).map((/** @type {any} */ inv) => {
    const item = itemById(inv.item_id);
    const each = item ? v.item[item.rarity] : undefined;
    const n = inv.locked ? 0 : inv.count - (keep(inv.item_id) ? 1 : 0);
    return { item, each, n, dupes: inv.locked ? 0 : inv.count - 1 };
  }).filter((/** @type {any} */ x) => x.item && !x.item.city_only && x.item.droppable !== false && x.each && x.n > 0)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.each - a.each || a.item.name.localeCompare(b.item.name));
  const ic = section("SPARE ITEMS", "worth 2x what the shop pays");
  ic.append(el("div", "dim city-note", "locked items, and one copy of what you wear or have in a loadout, are never given."));
  if (!spare.length) ic.append(el("div", "dim city-empty", "nothing spare right now."));
  // Every copy beyond the first of each item (the one kept is the one you wear).
  const dupes = spare.reduce((/** @type {any} */ t, /** @type {any} */ x) => ({ n: t.n + x.dupes, pts: t.pts + x.dupes * x.each }), { n: 0, pts: 0 });
  if (dupes.n > 0) {
    ic.append(row([el("b", "", "ALL DUPLICATES"), el("span", "dim", ` x${fmt(dupes.n)}  (keeps one of each)`),
      el("span", "city-pts-each", `  +${fmt(dupes.pts)} pts`)],
    [giveBtn("[ GIVE ALL DUPLICATES ]", "dupes", "", 1, dupes.pts)]));
  }
  // A whole rarity at once: everything of it, or all but one of each.
  for (const r of [...(state.content?.rarities ?? [])].reverse()) {
    const of = spare.filter((/** @type {any} */ x) => x.item.rarity === r.id);
    if (!of.length) continue;
    const each = v.item[r.id];
    const all = of.reduce((/** @type {number} */ t, /** @type {any} */ x) => t + x.n, 0);
    const extra = of.reduce((/** @type {number} */ t, /** @type {any} */ x) => t + x.dupes, 0);
    const btns = [giveBtn(`[ GIVE ALL x${fmt(all)} ]`, "rarity", r.id, all, all * each)];
    if (extra > 0 && extra < all) btns.push(giveBtn(`[ KEEP 1 EACH x${fmt(extra)} ]`, "rarity_spares", r.id, extra, extra * each));
    ic.append(row([el("b", `r-${r.id}`, `ALL ${r.label}`), el("span", "dim", ` x${fmt(all)}`),
      el("span", "city-pts-each", `  +${fmt(all * each)} pts`)], btns));
  }
  for (const x of spare.slice(0, showAllItems ? spare.length : ITEMS_SHOWN)) {
    const btns = [giveBtn("[ GIVE 1 ]", "item", x.item.id, 1, x.each)];
    if (x.n > 1) btns.push(giveBtn(`[ GIVE ALL ${fmt(x.n)} ]`, "item", x.item.id, x.n, x.n * x.each));
    const tag = loadoutTag(x.item.id);
    ic.append(row([el("span", `r-${x.item.rarity}`, x.item.name), el("span", "dim", ` x${fmt(x.n)}`),
      ...(tag ? [el("span", "item-loadouts", ` ${tag}`)] : []),
      el("span", "city-pts-each", `  +${fmt(x.each)} pts each`)], btns));
  }
  if (spare.length > ITEMS_SHOWN) {
    const more = el("button", "inline-btn city-more", showAllItems ? "[ SHOW FEWER ]" : `[ SHOW ALL ${spare.length} SPARE ITEMS ]`);
    more.addEventListener("click", () => {
      showAllItems = !showAllItems;
      render();
    });
    ic.append(more);
  }
  wrap.append(ic);
  return wrap;
}

/** A city item's card: its art in a frame of its rarity, label and name
 * underneath. ``locked``: a dotted silhouette and "? ? ?" (a building that
 * isn't unlocked yet keeps its rewards secret). @param {any} item @param {boolean} [locked] */
function itemCard(item, locked = false) {
  const style = RARITY_STYLE[item.rarity] ?? RARITY_STYLE.common;
  const label = style.deco[0] + (rarityById(item.rarity)?.label ?? item.rarity.toUpperCase()) + style.deco[1];
  const art = dedent(item.art).map((l) => (locked ? l.replace(/[^ ]/g, ".") : l));
  const pre = el("pre", `art city-item-art r-${item.rarity}${locked ? " city-item-locked" : ""}`,
    box([...art, "", label, locked ? "? ? ? ? ?" : item.name], { style, width: 26 }).join("\n"));
  return pre;
}

/** Which building's rewards the REWARDS view shows (default: the one being built). */
let browsing = /** @type {number | null} */ (null);

/** @param {number} stage */
const setOf = (stage) => city.stages[stage % city.stages.length];

/** "HOW DONATING PAYS": the three ways the city pays you back, in one glance. */
function payGuide() {
  const wrap = el("div", "city-guide");
  wrap.append(el("div", "panel-h", "HOW DONATING PAYS"));
  const last = city.city.finale[city.city.finale.length - 1];
  const hours = city.celebrate_hours ?? 0;
  const parts = [
    ["1", "EACH BUILDING", "when a building goes up, everyone who gave to it gets a reward. the more you gave, the "
      + "better your tier. every building starts a fresh donor list."],
    ["2", "CITY PERKS", "every finished building turns on a perk for EVERYONE playing, donor or not. "
      + (hours > 0 ? `finish all ${city.stages.length} and the city celebrates for ${hours} hours: every perk doubles `
        + "and nobody can donate. then everything resets." : "they last until the city is finished, then reset.")],
    ["3", "THE WHOLE CITY", `your points from every building add up. when the last one is built, the top `
      + `${last?.ranks[1] ?? 25} donors of the whole city get the biggest rewards in the game.`],
  ];
  const grid = el("div", "city-guide-grid");
  for (const [n, title, text] of parts) {
    const card = el("div", "city-guide-step");
    card.append(el("div", "city-guide-h", `[${n}] ${title}`), el("div", "city-guide-text", text));
    grid.append(card);
  }
  wrap.append(grid, el("div", "dim city-guide-after",
    `then a new, bigger city starts from ${city.stages[0].name.replace(/ [IVXLC]+$/, "")} and the perks are earned all over again.`));
  return wrap;
}

/** Every building's perk: on now?, and what it becomes when the whole city is finished. */
function perksTable() {
  const wrap = el("div", "city-perk-table");
  wrap.append(el("div", "panel-h city-earned-h", "[2] CITY PERKS"),
    el("div", "city-how", "a perk switches on the moment its building is finished and stays on until the city is "
      + (city.celebrate_hours > 0
        ? `finished. then the city celebrates for ${city.celebrate_hours} hours (every perk doubled, no donating), `
          + "and the next city starts with none."
        : "finished. then they all reset and the next city earns them again from nothing.")));
  const table = el("div", "city-ptable");
  const head = el("div", "city-prow city-prow-h");
  head.append(el("span", "", "BUILDING"), el("span", "", "PERK FOR EVERYONE"));
  table.append(head);
  const live = new Map(city.perks.perks.map((/** @type {any} */ k) => [k.id, k]));
  city.stages.forEach((/** @type {any} */ st, /** @type {number} */ i) => {
    const on = Boolean(live.get(st.id)?.on);
    const now_ = i === city.stage.index && !city.perks.doubled;
    const row = el("div", `city-prow${on ? " on" : ""}${now_ ? " now" : ""}`);
    row.append(el("span", "city-prow-b", `${on ? "[x]" : now_ ? "[>]" : "[ ]"} ${st.name.replace(/^THE /, "")}`),
      el("span", "city-prow-perk", st.perk || "-"), el("span", "city-prow-x2", st.perk_x2 ? `city finished: ${st.perk_x2}` : ""));
    table.append(row);
  });
  wrap.append(table);
  if (city.perks.doubled) {
    wrap.append(el("div", "city-perks-x2", `> ${city.perks.city} is finished: every perk is x2 for `
      + `${ago(Math.max(0, city.perks.until - now()))} more.`));
  }
  return wrap;
}

function rewardsPanel() {
  const wrap = el("div", "city-rewards");
  wrap.append(payGuide());
  wrap.append(el("div", "panel-h city-earned-h", "[1] EACH BUILDING"));
  const current = city.stage.index;
  const shown = browsing ?? current;
  const set = setOf(shown);
  const isNow = shown === current || (current >= city.stages.length && set.id === setOf(current).id);
  // Buildings past the one being built keep their rewards secret until they unlock.
  const locked = shown > current;
  // Building picker: what each part of the city pays.
  const pick = el("div", "city-pick");
  city.stages.forEach((/** @type {any} */ st, /** @type {number} */ i) => {
    const state_ = i < current ? "built" : i === current ? "now" : "later";
    const b = el("button", `city-pick-btn step-${state_}`, `${st.name.replace(/^THE /, "")}${state_ === "later" ? " ?" : ""}`);
    if (state_ === "later") b.title = "locked: its rewards show once the city starts building it";
    b.setAttribute("aria-pressed", String(set.id === st.id));
    b.addEventListener("click", () => {
      browsing = i === current ? null : i;
      render();
    });
    pick.append(b);
  });
  wrap.append(pick);
  const name = shown >= city.stages.length ? city.stage.name : set.name;
  wrap.append(el("div", "city-how", isNow
    ? `when ${name} is built, everyone who gave to it gets the reward for their place on its donor list (most points `
      + "first). you get your best tier only. every new building starts a fresh list."
    : locked ? `${set.name} is locked. its rewards are a secret until the city finishes ${city.stages[shown - 1].name}.`
      : `${set.name}'s rewards: already built. its donors got these.`));
  // Another building: its own tiers, as paid if it's built (ticket #262), not this one's.
  const tiers = isNow ? city.rewards : city.stage_rewards?.[shown % city.stages.length] ?? city.rewards;
  for (const t of tiers) {
    const mine = isNow && city.you?.tier === t.id;
    const card = el("div", `city-card city-tier tier-card-${t.id}${mine ? " city-tier-mine" : ""}`);
    const head = el("div", "city-card-h");
    head.append(el("span", `city-card-title tier-${t.id}`, t.label), el("span", "dim city-card-worth", rankText(t)));
    if (mine) head.append(el("span", "city-you city-tier-you", "  < you, right now"));
    card.append(head);
    const body = el("div", "city-tier-body");
    const item = t.item_rarity ? itemById(`city_${set.id}_${t.item_rarity}`) : null;
    // A city-built unique (#1 only, once per city) takes the spotlight; the
    // building's own piece becomes the "+ also" line under it.
    const uniques = t.gives.filter((/** @type {any} */ g) => g.item && g.item !== item?.id)
      .map((/** @type {any} */ g) => itemById(g.item)).filter(Boolean);
    const star = uniques[0] ?? item;
    const also = uniques.length ? [item, ...uniques.slice(1)].filter(Boolean) : [];
    if (uniques.length) card.classList.add("city-tier-unique");
    if (star) body.append(itemCard(star, locked));
    const info = el("div", "city-tier-info");
    if (star && uniques.length) {
      info.append(el("div", "city-tier-unique-tag", `* CITY UNIQUE * only for the #1 donor of ${set.name}, once per city`));
    }
    if (star && locked) {
      info.append(el("div", `city-tier-item r-${star.rarity}`, "? ? ? ? ?"),
        el("div", "dim city-tier-slot", `${rarityById(star.rarity)?.label ?? star.rarity.toUpperCase()}  ::  LOCKED`),
        el("div", "city-tier-flavor", `unlocks when ${city.stages[shown - 1].name} is built.`));
    } else if (star) {
      info.append(el("div", `city-tier-item r-${star.rarity}`, star.name),
        el("div", "dim city-tier-slot", `${star.slot.toUpperCase()}${star.theme ? ` (${star.theme})` : ""}  ::  only from ${set.name}`),
        effectLine(star), el("div", "city-tier-flavor", `"${star.flavor}"`));
    }
    for (const x of also) {
      const line = el("div", "city-tier-also");
      const st = RARITY_STYLE[x.rarity] ?? RARITY_STYLE.common;
      const label = `${st.deco[0]}${rarityById(x.rarity)?.label ?? x.rarity.toUpperCase()}${st.deco[1]}`;
      line.append(el("span", "dim", "+ ALSO: "), el("span", `r-${x.rarity}`, locked ? `${label} ? ? ? ? ?` : `${label} ${x.name}`));
      if (!locked) line.append(el("div", "dim city-tier-slot", `${x.slot.toUpperCase()}  ::  only from ${set.name}`), effectLine(x));
      info.append(line);
    }
    const chests = t.gives.filter((/** @type {any} */ g) => !g.item);
    if (chests.length) {
      const plus = el("div", "city-tier-chests");
      plus.append(el("span", "dim", "+ "));
      chests.forEach((/** @type {any} */ g, /** @type {number} */ i) => {
        if (i) plus.append(el("span", "dim", "  +  "));
        plus.append(giftLabel(g));
      });
      info.append(plus);
    }
    if (!item && !chests.length) info.append(el("span", "dim", "(reward coming soon)"));
    body.append(info);
    card.append(body);
    wrap.append(card);
  }
  wrap.append(perksTable(), finaleSection());
  if (city.earned?.length) {
    wrap.append(el("div", "panel-h city-earned-h", "YOUR REWARDS SO FAR"));
    for (const r of city.earned) {
      const line = el("div", "city-row");
      const left = el("span", "city-row-what");
      left.append(el("span", "", `${r.building}: `), el("span", `tier-${r.tier}`, r.label ?? r.tier),
        el("span", "dim", ` (#${r.rank})  `));
      r.gives.forEach((/** @type {any} */ g, /** @type {number} */ i) => {
        if (i) left.append(el("span", "dim", " + "));
        left.append(giftLabel(g));
      });
      line.append(left);
      wrap.append(line);
    }
  }
  return wrap;
}

/** The whole city's rewards: its top donors (points across all its buildings). */
function finaleSection() {
  const wrap = el("div", "city-finale");
  wrap.append(el("div", "panel-h city-earned-h", `[3] WHEN ${city.city.name} IS FINISHED`),
    el("div", "city-how", `every point you give to any of its buildings counts here. when the last building is built, `
      + `the top donors of the whole city get these on top of each building's rewards.`));
  for (const t of city.city.finale) {
    const mine = city.city.you?.tier === t.id;
    const card = el("div", `city-card city-tier${mine ? " city-tier-mine" : ""}`);
    const head = el("div", "city-card-h");
    head.append(el("span", `city-card-title tier-${t.id}`, t.label), el("span", "dim city-card-worth", rankText(t)));
    if (mine) head.append(el("span", "city-you city-tier-you", "  < you, right now"));
    const gifts = el("div", "city-tier-chests");
    const rarity = rarityById(t.piece_rarity);
    gifts.append(el("span", "dim", "+ "), el("span", `r-${t.piece_rarity}`,
      `${t.city_pieces > 1 ? `${t.city_pieces} x ` : "a "}${rarity?.label ?? t.piece_rarity.toUpperCase()} city piece`),
    el("span", "dim", " (one you don't have yet)"));
    for (const g of t.gives) gifts.append(el("span", "dim", "  +  "), giftLabel(g));
    card.append(head, gifts);
    wrap.append(card);
  }
  return wrap;
}

/** @param {string} title @param {any[]} list @param {string} empty */
function heroList(title, list, empty) {
  const wrap = el("div", "city-card");
  wrap.append(el("div", "city-card-h city-card-title", title));
  if (!list.length) wrap.append(el("div", "dim city-empty", empty));
  list.forEach((/** @type {any} */ l, /** @type {number} */ i) => {
    const line = el("div", `city-hero${l.player_id === state.me?.id ? " city-you" : ""}`);
    line.append(el("span", "dim", `${String(i + 1).padStart(2)}. `), el("span", "", l.name.padEnd(17)), el("span", "dim", `${fmt(l.points)} pts`));
    wrap.append(line);
  });
  return wrap;
}

/** [ HISTORY ] (ticket #207): every finished building, newest first. @type {any[] | null} */
let history = null;
let historyAt = 0;

async function loadHistory() {
  if (history && Date.now() - historyAt < 60_000) return;
  historyAt = Date.now();
  try {
    history = (await api.getCityHistory()).history;
    if (visible() && view === "history") render();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

function historyPanel() {
  const wrap = el("div", "city-heroes");
  if (!history) {
    void loadHistory();
    wrap.append(el("div", "dim city-empty", "> reading the old records..."));
    return wrap;
  }
  void loadHistory(); // refreshes at most once a minute
  if (!history.length) wrap.append(el("div", "dim city-empty", "no building has been finished yet."));
  for (const h of history) {
    const card = heroList(`${h.name} :: ${h.city}`, h.top, "nobody gave to it.");
    const when = h.finished_at ? `finished ${ago(now() - h.finished_at)} ago · ` : "";
    card.insertBefore(el("div", "dim", `${when}${fmt(h.points)} pts from ${fmt(h.donors)} donor${h.donors === 1 ? "" : "s"}`),
      card.children[1] ?? null);
    if (h.you && h.you.rank > h.top.length) {
      card.append(el("div", "city-hero city-you", `you: #${h.you.rank} · ${fmt(h.you.points)} pts`));
    }
    wrap.append(card);
  }
  return wrap;
}

function render() {
  const host = $("panel-city");
  if (!city || !state.content) {
    host.replaceChildren(el("div", "dim", "> walking to the city..."));
    return;
  }
  const y = window.scrollY;
  const body = view === "rewards" ? rewardsPanel()
    : view === "heroes" ? el("div", "city-heroes") : view === "history" ? historyPanel() : donatePanel();
  if (view === "heroes") {
    body.append(heroList(`${city.stage.name}: TOP DONORS`, city.ranking, "nobody has given to it yet."),
      heroList(`${city.city.name}: TOP ${city.city.ranking.length || 25}`, city.city.ranking, "nobody has given yet."),
      heroList("ALL TIME", city.legends, "no heroes yet."));
  }
  // A GIVE X box being typed in keeps its focus (and caret) through the redraw.
  const typing = document.activeElement instanceof HTMLInputElement && host.contains(document.activeElement)
    ? document.activeElement.dataset.key : undefined;
  host.replaceChildren(el("div", "panel-h", city.city.name), donationBar(), cityScene(), standingBox(), perksBox(),
    subTabs(), body);
  if (typing) /** @type {HTMLInputElement | null} */ (host.querySelector(`input[data-key="${CSS.escape(typing)}"]`))
    ?.focus({ preventScroll: true });
  window.scrollTo({ top: y });
  startTicker();
}

/** While open: the bubble changes line, and the city refreshes now and then. */
function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!visible() || document.visibilityState !== "visible" || !city) return;
    if (Date.now() - loadedAt > 15000) loadCity(true);
    if (reduced || armed) return;
    pleaIndex += 1;
    const pre = document.querySelector("#panel-city .city-art");
    const scene = pre?.parentElement;
    if (scene) scene.replaceWith(cityScene());
  }, PLEA_EVERY);
}

// ------------------------------------------------------------- reward pop-up
// A building went up: everyone who gave to it gets their tier's reward. The
// server pings donors who are online; anyone else sees it on their next visit.

let checking = false;

/** Show any city rewards this player hasn't seen yet, one pop-up each. */
export async function checkCityRewards() {
  if (checking || !state.me?.name_chosen) return;
  checking = true;
  try {
    const { rewards } = await api.getCityRewards();
    for (const r of rewards ?? []) await rewardPopup(r);
    if (rewards?.length) {
      state.me = await api.getMe(); // the boxes / items / shards just landed
      emit("me");
      if (visible()) loadCity(true);
    }
  } catch {
    /* next visit */
  } finally {
    checking = false;
  }
}

/** @param {any} r */
function rewardPopup(r) {
  return showOverlay((inner, close) => {
    inner.classList.add("city-reward");
    const head = el("pre", "art city-reward-head",
      box(r.finale ? [`${r.building} IS`, "FINISHED!"] : ["THE CITY BUILT", `${r.building}!`], { width: 34 }).join("\n"));
    const place = el("div", "city-reward-place");
    place.append(el("span", "", `you were #${r.rank} of ${fmt(r.donors)} donor${r.donors === 1 ? "" : "s"}  ::  `),
      el("b", `tier-${r.tier}`, r.label));
    const list = el("div", "city-reward-gives");
    list.append(el("div", "dim city-reward-sub", "YOUR REWARD"));
    // Lead with the best item won (a city-built Ascended outranks the building's own piece).
    const won = r.gives.map((/** @type {any} */ g) => (g.item ? itemById(g.item) : null)).filter(Boolean)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => (rarityById(b.rarity)?.rank ?? 0) - (rarityById(a.rarity)?.rank ?? 0))[0];
    for (const g of r.gives) {
      const line = el("div", "city-reward-gift");
      line.append(el("span", "dim", "+ "), giftLabel(g));
      list.append(line);
    }
    if (won) list.prepend(itemCard(won));
    if (!r.gives.length) list.append(el("div", "dim", "the city's eternal thanks."));
    const ok = /** @type {HTMLButtonElement} */ (el("button", "city-reward-ok", "[ THANK YOU, CITY! ]"));
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      try {
        await api.seenCityReward(r.stage);
      } catch {
        /* shown again next time */
      }
      close();
    });
    inner.append(head, place, list, el("div", "dim city-reward-note", "it's already in your bag."), ok);
    requestAnimationFrame(() => {
      fitArt(head, 16);
      ok.focus({ preventScroll: true });
    });
  }, { mustChoose: true });
}
