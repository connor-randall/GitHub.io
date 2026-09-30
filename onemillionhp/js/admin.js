// Admin panel. Every button is a <form data-action="..."> whose inputs become
// the action's parameters; the server validates everything.

import { API_BASE, getContent } from "./api.js?v=c30f4a427c";
import { forwardToCanonical } from "./home.js?v=c30f4a427c";
import { duration, el, fmt, padR, setArt } from "./ascii.js?v=c30f4a427c";
import { rarityById, SCROLLS, state } from "./store.js?v=c30f4a427c";
import { effectParts } from "./ui/effects.js?v=c30f4a427c";
import { itemLines } from "./ui/fx.js?v=c30f4a427c";

const KEY = "omhp.admin";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Whether actions should be announced in the public feed as ***ADMIN***. */
const announcing = () => /** @type {HTMLInputElement} */ ($("announce")).checked;

function session() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
/** @param {string} t */
function setSession(t) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** @param {string} path @param {unknown} [body] @returns {Promise<any>} */
async function call(path, body) {
  const res = await fetch(API_BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Session": session() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) throw new Error("Server unreachable.");
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) showLogin();
  if (!res.ok) throw new Error(data?.error?.message ?? `Error ${res.status}`);
  return data;
}

/** @param {string} msg @param {boolean} ok */
function log(msg, ok) {
  const li = el("li", ok ? "ok" : "bad", `${new Date().toLocaleTimeString()}  > ${msg}`);
  $("log").prepend(li);
}

/** @param {number} p */
const pct = (p) => `${(p * 100).toFixed(p >= 0.01 ? 2 : p >= 0.0001 ? 4 : 5)}%`;

/** A number input for the odds table. @param {number} value @param {string} step */
function oddsInput(value, step) {
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "number";
  input.min = "0";
  input.step = step;
  input.value = String(value);
  input.dataset.orig = input.value;
  input.addEventListener("input", () => input.classList.toggle("changed", input.value !== input.dataset.orig));
  return input;
}

/** @param {string} label @param {string} now @param {Node[]} [edit] */
function oddsRow(label, now, edit = []) {
  const row = el("div", "odds-row");
  row.append(el("span", "odds-what", label), el("span", "odds-now", now), el("span", "odds-set"));
  /** @type {HTMLElement} */ (row.lastChild).append(...edit);
  return row;
}

/** [x] / [ ] in front of a loot box reward: switch it off or on right away
 * (the others share its chance in proportion). @param {any} b @param {any} r */
function boxRowToggle(b, r) {
  const t = /** @type {HTMLButtonElement} */ (el("button", "odds-toggle", r.off ? "[ ]" : "[x]"));
  if (r.locked) {
    t.disabled = true;
    t.title = "Scroll rewards are locked by the master switch above.";
    return t;
  }
  t.type = "button";
  t.setAttribute("aria-pressed", String(!r.off));
  t.title = r.off ? "switched off: never rolled. click to switch back on" : "click to stop this being rolled";
  t.addEventListener("click", async () => {
    t.disabled = true;
    try {
      const res = await call("/api/admin/action",
        { action: "set_box_row", box_id: b.id, row: r.row, on: Boolean(r.off), announce: announcing() });
      log(res.message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
      t.disabled = false;
    }
  });
  return t;
}

/** Master launch switch used in both the chest gallery and detailed odds panel. @param {any} o */
function scrollLockControl(o) {
  const wrap = el("div", `scroll-lock ${o.scrolls_enabled ? "enabled" : "locked"}`);
  const toggle = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
    o.scrolls_enabled ? "[x] SCROLL DROPS + CHEST REWARDS: ON" : "[ ] SCROLL DROPS + CHEST REWARDS: OFF"));
  toggle.type = "button";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      const res = await call("/api/admin/action",
        { action: "set_scrolls", on: !o.scrolls_enabled, announce: announcing() });
      log(res.message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
      toggle.disabled = false;
    }
  });
  wrap.append(toggle, el("span", "hint", o.scrolls_enabled
    ? " players can find scrolls from attacks and random-scroll chest rewards"
    : " launch locked; admin gifting still works"));
  return wrap;
}

/** The editable [ ODDS ] table. @param {any} o */
function renderOdds(o) {
  const host = $("odds");
  /** @type {Array<() => void>} */
  const collect = [];
  /** @type {Record<string, any>} */
  let changes = {};
  const parts = [el("div", "odds-h", "EVERY ATTACK (each rolled separately)")];
  for (const r of o.per_attack) {
    const now = `${pct(r.chance)}  ${r.one_in}`;
    if (!r.key) {
      const note = r.what === "any scroll" ? "(master launch lock)" : "(adds up the rarities below)";
      parts.push(oddsRow(r.what.toUpperCase(), now, [el("span", "dim", note)]));
      continue;
    }
    const input = oddsInput(r.base, "any");
    collect.push(() => {
      if (input.value === input.dataset.orig) return;
      const n = Number(input.value);
      if (r.key === "crit") changes.crit_one_in = n;
      else if (r.key === "box") changes.box_one_in = n;
      else (changes.rarity_one_in ??= {})[r.key.slice(7)] = n;
    });
    parts.push(oddsRow(r.what.toUpperCase(), now, [el("span", "dim", "1 in "), input]));
  }
  const m = o.mults;
  if (m.loot !== 1 || m.box !== 1)
    parts.push(el("div", "hint", `"now" includes ITEM DROPS x${m.loot} and LOOT BOXES x${m.box} from RULES; the 1 in N you type is before those.`));

  parts.push(scrollLockControl(o));

  for (const b of o.boxes) {
    const share = oddsInput(Math.round(b.share * 10000) / 100, "any");
    collect.push(() => {
      if (share.value !== share.dataset.orig) (changes.box_pick ??= {})[b.id] = Number(share.value);
    });
    const head = el("div", "odds-h");
    head.append(`${b.name}  `, el("span", "dim", `drops ${pct(b.chance)} of attacks (${b.one_in})  ::  `), share,
      el("span", "dim", " % of boxes"));
    parts.push(head);
    const rows = b.rewards.map((/** @type {any} */ r) => {
      // The % box edits this reward's share with nothing switched off, so a
      // switched-off one keeps its number for when it comes back on.
      const input = oddsInput(Number(((r.base ?? r.chance) * 100).toFixed(6)), "any");
      input.disabled = Boolean(r.off);
      const row = oddsRow(r.what.toUpperCase(), r.off ? "off" : pct(r.chance), [input, el("span", "dim", " %")]);
      row.classList.toggle("odds-off", Boolean(r.off));
      row.firstElementChild?.prepend(boxRowToggle(b, r), " ");
      parts.push(row);
      return input;
    });
    collect.push(() => {
      if (rows.some((i) => i.value !== i.dataset.orig)) (changes.box_rewards ??= {})[b.id] = rows.map((i) => Number(i.value));
    });
  }
  const actions = el("div", "odds-actions");
  const save = el("button", "inline-btn", "[ SAVE ODDS ]");
  save.addEventListener("click", async () => {
    changes = {};
    collect.forEach((f) => f());
    if (!Object.keys(changes).length) {
      log("Nothing changed: edit a number first.", false);
      return;
    }
    try {
      log((await call("/api/admin/action", { action: "set_odds", ...changes, announce: announcing() })).message, true);
      await refresh();
    } catch (e) {
      log(/** @type {Error} */ (e).message, false);
    }
  });
  const reset = el("button", "inline-btn danger", "[ RESET TO DEFAULTS ]");
  reset.addEventListener("click", () => {
    const form = /** @type {HTMLFormElement} */ (el("form"));
    submit(form, "reset_odds", reset);
  });
  actions.append(save, reset, el("span", "hint", o.edited ? " odds are CUSTOM right now" : " odds are the defaults"));
  const d = o.damage;
  parts.push(actions, el("div", "hint",
    `DAMAGE  hit ${d.hit[0]}-${d.hit[1]}  crit ${d.crit[0]}-${d.crit[1]}  ultimate ${d.ultimate[0]}-${d.ultimate[1]}  ::  ` +
    `SHOP PAYS ${Object.entries(o.shop.sell).map(([k, v]) => `${k} ${v}`).join(", ")}  ::  ` +
    `BOXES COST ${o.boxes.map((/** @type {any} */ b) => `${b.name.toLowerCase()} ${o.shop.boxes[b.id] ?? "-"}`).join(", ")}`));
  host.replaceChildren(...parts);
}

function showLogin() {
  $("login").hidden = false;
  $("panel").hidden = true;
  $("logout").hidden = true;
  setSession("");
  $("passcode").focus();
}

/** @type {any} */
let ov = null;

const DESIGN_TINTS = {
  amber: "#ffb000", red: "#ff6e62", green: "#75e36d",
  cyan: "#8bdcff", purple: "#dc8cff", white: "#f0eadc",
};

/** @param {string} submissionId @param {string} decision */
function reviewDesignForm(submissionId, decision) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const submission = /** @type {HTMLInputElement} */ (el("input"));
  submission.type = "hidden";
  submission.name = "submission_id";
  submission.value = submissionId;
  const choice = /** @type {HTMLInputElement} */ (el("input"));
  choice.type = "hidden";
  choice.name = "decision";
  choice.value = decision;
  const button = el("button", `inline-btn${decision === "deny" ? " danger" : ""}`,
    decision === "approve" ? "[ APPROVE + QUEUE ]" : "[ DENY ]");
  form.append(submission, choice, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "review_boss_design", button);
  });
  return form;
}

/** @param {string} bossId */
function reuseBossForm(bossId) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.type = "hidden";
  input.name = "boss_id";
  input.value = bossId;
  const button = el("button", "inline-btn", "[ QUEUE AGAIN ]");
  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "reuse_community_boss", button);
  });
  return form;
}

/** @param {string} entryId @param {string} direction @param {boolean} disabled */
function moveBossForm(entryId, direction, disabled) {
  const form = /** @type {HTMLFormElement} */ (el("form"));
  const id = /** @type {HTMLInputElement} */ (el("input"));
  id.type = "hidden";
  id.name = "entry_id";
  id.value = entryId;
  const move = /** @type {HTMLInputElement} */ (el("input"));
  move.type = "hidden";
  move.name = "direction";
  move.value = direction;
  const button = /** @type {HTMLButtonElement} */ (el("button", "inline-btn",
    direction === "up" ? "[ UP ]" : "[ DOWN ]"));
  button.disabled = disabled;
  form.append(id, move, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "move_boss_queue_entry", button);
  });
  return form;
}

/** @param {any[]} choices */
function addBossForm(choices) {
  const form = /** @type {HTMLFormElement} */ (el("form", "boss-queue-add"));
  const boss = /** @type {HTMLSelectElement} */ (el("select"));
  boss.name = "boss_id";
  for (const choice of choices) {
    const label = choice.community
      ? `${choice.name} :: COMMUNITY BY ${choice.creator_name}` : `${choice.name} :: BUILT-IN`;
    const option = /** @type {HTMLOptionElement} */ (el("option", "", label));
    option.value = choice.id;
    boss.append(option);
  }
  const position = /** @type {HTMLSelectElement} */ (el("select"));
  position.name = "position";
  for (let i = 1; i <= 10; i += 1) {
    const option = /** @type {HTMLOptionElement} */ (el("option", "", `POSITION ${i}`));
    option.value = String(i);
    position.append(option);
  }
  const button = el("button", "inline-btn", "[ ADD BOSS ]");
  form.append(el("b", "", "ADD BOSS TO QUEUE"), boss, position, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form, "add_boss_to_queue", button);
  });
  return form;
}

/** @param {any[]} designs @param {any[]} queue @param {boolean} randomEnabled
 * @param {any[]} preview @param {any[]} choices @param {any} current */
function renderBossDesigns(designs, queue, randomEnabled = false, preview = [], choices = [], current = {}) {
  const queueHost = $("boss-queue");
  const libraryHost = $("boss-design-library");
  const used = queue.filter((/** @type {any} */ b) => b.status === "used");
  const mode = /** @type {HTMLFormElement} */ (el("form", "boss-queue-mode"));
  const random = /** @type {HTMLInputElement} */ (el("input"));
  random.type = "checkbox";
  random.name = "enabled";
  random.checked = randomEnabled;
  const randomLabel = el("label", "boss-random-label");
  randomLabel.append(random, " RANDOMIZE BOSS IF NONE IN MANUAL QUEUE");
  const saveMode = el("button", "inline-btn", "[ SAVE MODE ]");
  mode.append(randomLabel, saveMode);
  mode.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(mode, "set_community_queue_random", saveMode);
  });
  const queueList = el("div", "boss-queue-list");
  queueList.append(el("b", "", `CURRENT BOSS :: ${current.name ?? "UNKNOWN"}`),
    el("b", "", "NEXT 10 BOSSES"));
  preview.slice(0, 10).forEach((boss, index) => {
    const row = el("div", "boss-queue-row");
    const slot = index === 0 ? "NEXT BOSS" : String(index + 1);
    row.append(el("span", "", `${slot}: ${boss.name}${boss.community
      ? `  ::  BY ${boss.creator_name}` : "  ::  [ BUILT-IN ]"}${boss.fallback
      ? `  ::  [ ${randomEnabled ? "RANDOM FALLBACK" : "ROTATION FALLBACK"} ]` : ""}`));
    if (boss.queue_entry_id) {
      if (index > 0) row.append(moveBossForm(boss.queue_entry_id, "up", false));
      if (index < 9 && preview[index + 1]?.queue_entry_id) {
        row.append(moveBossForm(boss.queue_entry_id, "down", false));
      }
    }
    queueList.append(row);
  });
  if (!preview.length) queueList.append(el("div", "dim", "NO MORE BOSSES DEFINED"));
  const library = el("div", "boss-library-content");
  if (used.length) {
    library.append(el("b", "", "APPROVED BOSS LIBRARY"));
    for (const boss of used) {
      const row = el("div", "boss-library-row");
      row.append(el("span", "", `${boss.name} :: BY ${boss.creator_name}`), reuseBossForm(boss.id));
      library.append(row);
    }
  }
  queueHost.replaceChildren(queueList, addBossForm(choices), mode);
  libraryHost.hidden = !used.length;
  libraryHost.replaceChildren(library);
  const cards = designs.map((/** @type {any} */ design) => {
    const card = el("article", `boss-design-card ${design.status}`);
    const head = el("div", "boss-design-head");
    head.append(el("b", "", design.name), el("span", "", `[ ${design.status.toUpperCase()} ]`));
    const frames = el("div", "boss-design-frames");
    for (const [label, key] of [
      ["PHASE I", "phase1_art"], ["PHASE I HURT", "phase1_hurt_art"],
      ["PHASE II", "phase2_art"], ["PHASE II HURT", "phase2_hurt_art"],
      ["PHASE III", "phase3_art"], ["PHASE III HURT", "phase3_hurt_art"], ["DEATH", "death_art"],
    ]) {
      const frame = el("div", "boss-design-frame");
      if (key === "death_art") frame.classList.add("boss-design-death");
      frame.style.setProperty("--boss-design-color", DESIGN_TINTS[design.color] ?? DESIGN_TINTS.amber);
      frame.append(el("b", "", label), el("pre", "art", design[key]));
      frames.append(frame);
    }
    card.append(head,
      el("div", "boss-design-meta", `BY ${design.creator_name}  ::  COLOR ${design.color.toUpperCase()}`),
      el("div", "boss-design-flavor", `"${design.flavor}"`), frames);
    if (design.status === "pending") {
      const actions = el("div", "boss-design-actions");
      actions.append(reviewDesignForm(design.submission_id, "approve"),
        reviewDesignForm(design.submission_id, "deny"));
      card.append(actions);
    }
    return card;
  });
  $("boss-design-list").replaceChildren(...(cards.length ? cards : [el("p", "hint", "no boss submissions yet.")]));
}

async function refresh() {
  ov = await call("/api/admin/overview");
  $("login").hidden = true;
  $("panel").hidden = false;
  $("logout").hidden = false;
  const b = ov.boss;
  const t = ov.tuning;
  const c = ov.counts;
  $("status").textContent = [
    `BOSS #${String(b.seq).padStart(3, "0")}  ${b.name} / ${b.subtitle || "-"}  [${b.status.toUpperCase()}]`,
    `HP ${fmt(b.hp)} / ${fmt(b.max_hp)}  (${((100 * b.hp) / b.max_hp).toFixed(2)}%)  PHASE ${b.phase}`,
    `ATTACKS ${fmt(b.total_attacks)}  DAMAGE ${fmt(b.total_damage)}  FIGHTERS ${fmt(b.unique_players)}`,
    `PLAYERS ${fmt(c.players)} (${c.banned} banned)  ACTIVE TODAY ${fmt(c.active_today)}  ONLINE ${ov.online}  ITEMS HELD ${fmt(c.items_owned)}`,
    `RULES  max ${t.attacks_per_day} attacks, +1 every ${t.recharge_seconds}s  crit ${(t.crit_chance * 100).toFixed(2)}%  drops x${t.loot_mult}`,
  ].join("\n");

  $("pin-now").textContent = ov.pinned ? `PINNED NOW: ${ov.pinned.text}` : "nothing pinned.";
  $("unpin-btn").hidden = !ov.pinned;

  renderPolls(ov.polls ?? []);
  renderBadgeAdmin(ov.badges ?? []);
  renderBossDesigns(ov.boss_designs ?? [], ov.community_queue ?? [],
    ov.community_queue_random === true, ov.boss_queue_preview ?? [],
    ov.boss_queue_choices ?? [], ov.boss ?? {});

  // Rotation: fill the box with what's saved, unless you're mid-edit.
  const rot = ov.rotating?.messages ?? [];
  const box = /** @type {HTMLTextAreaElement} */ ($("rotate-text"));
  const saved = rot.join("\n");
  if (document.activeElement !== box && (box.value === "" || box.value === box.dataset.saved)) box.value = saved;
  box.dataset.saved = saved;
  $("rotate-stop").hidden = !rot.length;
  $("rotate-now").textContent = rot.length
    ? `ROTATING NOW (${rot.length}, 1 min each):\n` + rot.map((m, i) => `${i + 1}. ${m}`).join("\n")
    : "nothing rotating.";

  const hp = /** @type {HTMLInputElement} */ (document.querySelector('[data-action="set_hp"] [name="hp"]'));
  hp.max = String(b.max_hp);
  // Pre-fill with the current name so editing one field keeps the other.
  const rename = /** @type {HTMLFormElement} */ (document.querySelector('[data-action="rename_boss"]'));
  for (const [field, current, fallback] of [
    ["name", b.name, ov.boss_defaults.name],
    ["subtitle", b.subtitle, ov.boss_defaults.subtitle],
  ]) {
    const input = /** @type {HTMLInputElement} */ (rename.elements.namedItem(field));
    input.placeholder = `${fallback} (default)`;
    if (document.activeElement !== input) input.value = input.defaultValue = current ?? "";
  }

  // Show the current value of every rule as its placeholder.
  document.querySelectorAll('[data-action="set_tuning"] input').forEach((node) => {
    const input = /** @type {HTMLInputElement} */ (node);
    input.placeholder = input.name === "crit_pct" ? (t.crit_chance * 100).toFixed(2) : String(t[input.name] ?? "");
  });
  renderOdds(ov.odds);

  await renderGallery();
  fillPreviewBosses(state.content, b.def_id);
  $("players").replaceChildren(
    ...ov.recent_players.map((/** @type {any} */ p) => {
      const o = /** @type {HTMLOptionElement} */ (el("option"));
      o.value = p.name;
      return o;
    }),
  );
  $("recent").textContent = [
    "RECENT PLAYERS",
    ...ov.recent_players.map(
      (/** @type {any} */ p) =>
        `${padR(p.name, 17)} ${padR(fmt(p.total_damage), 9)} ${padR(String(p.total_attacks), 5)} ${p.banned ? "BANNED " : ""}${p.id}`,
    ),
  ].join("\n");
  await loadShards();
}

let shardPage = 0;
let shardQuery = "";
let shardRequest = 0;

async function loadShards() {
  const request = ++shardRequest;
  try {
    const data = await call(`/api/admin/shards?page=${shardPage}&q=${encodeURIComponent(shardQuery)}`);
    if (request !== shardRequest || $("panel").hidden) return;
    shardPage = data.page;
    $("shard-rows").replaceChildren(...data.players.map((/** @type {any} */ p) => {
      const row = el("tr", "");
      const name = el("td", "", p.name);
      name.title = p.id;
      row.append(name, el("td", "shard-balance", fmt(p.shards)), el("td", "dim", p.banned ? "BANNED" : "ACTIVE"));
      return row;
    }));
    const start = data.total ? data.page * data.page_size + 1 : 0;
    $("shard-summary").textContent = `${start}–${Math.min((data.page + 1) * data.page_size, data.total)} of ${fmt(data.total)} players :: ${fmt(data.total_shards)} shards${shardQuery ? " matching search" : " total"}`;
    /** @type {HTMLButtonElement} */ ($("shard-prev")).disabled = data.page === 0;
    /** @type {HTMLButtonElement} */ ($("shard-next")).disabled = (data.page + 1) * data.page_size >= data.total;
  } catch (e) {
    if (request === shardRequest) $("shard-summary").textContent = /** @type {Error} */ (e).message;
  }
}

// ------------------------------------------------------------ item gallery

let galleryReady = false;

async function renderGallery() {
  if (!state.content) state.content = await getContent();
  const content = state.content;
  if (!galleryReady) {
    galleryReady = true;
    const rsel = $("gal-rarity");
    for (const r of content.rarities) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", r.label.toLowerCase()));
      o.value = r.id;
      rsel.append(o);
    }
    for (const id of ["gal-rarity", "gal-slot", "gal-search", "gal-sort"]) $(id).addEventListener("input", drawGallery);
    // Boxes: one card each with a give button.
    $("gal-boxes").replaceChildren(
      ...content.boxes.map((/** @type {any} */ b) => {
        const card = el("div", "gal-card gal-box");
        const pre = el("pre", "art");
        const give = el("button", "inline-btn", "[ GIVE ]");
        give.addEventListener("click", () => give1("grant_box", { box_id: b.id }, b.name));
        const everyone = el("button", "inline-btn gift-all", "[ GIFT EVERYONE ONLINE ]");
        everyone.addEventListener("click", async () => {
          try {
            const res = await call("/api/admin/action", { action: "gift_online", box_id: b.id, announce: announcing() });
            log(res.message, true);
          } catch (e) {
            log(/** @type {Error} */ (e).message, false);
          }
        });
        const held = el("div", "gal-held");
        held.id = `held-${b.id}`;
        card.append(pre, el("div", "gal-name", b.name), held, give, everyone);
        requestAnimationFrame(() => setArt(pre, b.art, 10));
        return card;
      }),
    );
    $("gal-scrolls").replaceChildren(
      ...Object.entries(SCROLLS).map(([id, def]) => {
        const card = el("div", "gal-card gal-scroll");
        const pre = el("pre", "art");
        const give = el("button", "inline-btn", "[ GIVE ]");
        give.addEventListener("click", () => give1("grant_scroll", { scroll_id: id }, def.name));
        const held = el("div", "gal-held");
        held.id = `held-scroll-${id}`;
        card.append(pre, el("div", "gal-name", def.name), el("div", "gal-fx", def.description), held, give);
        requestAnimationFrame(() => setArt(pre, def.art, 10));
        return card;
      }),
    );
  }
  drawGallery();
}

function drawGallery() {
  const content = state.content;
  if (!content) return;
  const rarity = /** @type {HTMLSelectElement} */ ($("gal-rarity")).value;
  const slot = /** @type {HTMLSelectElement} */ ($("gal-slot")).value;
  const q = /** @type {HTMLInputElement} */ ($("gal-search")).value.trim().toUpperCase();
  const sort = /** @type {HTMLSelectElement} */ ($("gal-sort")).value;
  /** @type {Record<string, {players: number, copies: number}>} */
  const owned = ov?.ownership ?? {};
  $("gal-scroll-lock").replaceChildren(scrollLockControl(ov.odds));
  const held = (/** @type {any} */ i) => owned[i.id]?.players ?? 0;
  const items = content.items
    .filter((/** @type {any} */ i) => (!rarity || i.rarity === rarity) && (!slot || i.slot === slot))
    .filter((/** @type {any} */ i) => !q || i.name.includes(q) || effectParts(i.mods).join(" ").includes(q))
    .filter((/** @type {any} */ i) => sort !== "unowned" || !held(i))
    .sort((/** @type {any} */ a, /** @type {any} */ b) =>
      (sort === "owned" ? held(b) - held(a) : 0) ||
      (rarityById(b.rarity)?.rank ?? 0) - (rarityById(a.rarity)?.rank ?? 0) || a.name.localeCompare(b.name));
  const found = content.items.filter((/** @type {any} */ i) => held(i)).length;
  $("gal-count").textContent =
    `${items.length} of ${content.items.length} items shown  ::  ${found} of ${content.items.length} owned by someone`;
  for (const b of content.boxes) {
    const o = ov?.box_ownership?.[b.id];
    const line = document.getElementById(`held-${b.id}`);
    if (line) line.replaceChildren(heldLine(o, { box_id: b.id }));
  }
  for (const id of Object.keys(SCROLLS)) {
    const o = ov?.scroll_ownership?.[id];
    const line = document.getElementById(`held-scroll-${id}`);
    if (line) line.replaceChildren(heldLine(o, { scroll_id: id }));
  }
  $("gal-grid").replaceChildren(
    ...items.map((/** @type {any} */ item) => {
      const card = el("div", `gal-card r-${item.rarity}`);
      const pre = el("pre", "art");
      const fx = effectParts(item.mods);
      const give = el("button", "inline-btn", "[ GIVE ]");
      give.addEventListener("click", () => give1("grant_item", { item_id: item.id }, item.name));
      card.append(pre, el("div", "gal-fx", fx.length ? fx.join(" :: ") : "no bonus"),
        el("div", "gal-held"), give);
      /** @type {HTMLElement} */ (card.querySelector(".gal-held")).append(heldLine(owned[item.id], { item_id: item.id }));
      requestAnimationFrame(() => setArt(pre, itemLines(item, {}), 10));
      return card;
    }),
  );
}

/** "HELD BY 3 (5 copies) [ WHO? ]" for a gallery card.
 * @param {{players: number, copies: number} | undefined} o @param {Record<string, string>} ref */
function heldLine(o, ref) {
  const wrap = el("span", o ? "" : "dim", o ? `HELD BY ${fmt(o.players)}${o.copies > o.players ? ` (${fmt(o.copies)} copies)` : ""} ` : "nobody has one");
  if (o) {
    const who = el("button", "inline-btn", "[ WHO? ]");
    who.addEventListener("click", async () => {
      try {
        log((await call("/api/admin/action", { action: "who_has", ...ref })).message, true);
      } catch (e) {
        log(/** @type {Error} */ (e).message, false);
      }
    });
    wrap.append(who);
  }
  return wrap;
}

/** @param {string} action @param {Record<string, string>} extra @param {string} what */
async function give1(action, extra, what) {
  const player = /** @type {HTMLInputElement} */ ($("gal-player")).value.trim();
  if (!player) {
    log(`Type a player name in GIVE TO first (for ${what}).`, false);
    $("gal-player").focus();
    return;
  }
  try {
    const res = await call("/api/admin/action", { action, player, ...extra, announce: announcing() });
    log(res.message, true);
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** Turn a form's inputs into action params (blank fields are omitted).
 * @param {HTMLFormElement} form */
function params(form) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const node of Array.from(form.elements)) {
    const input = /** @type {HTMLInputElement} */ (node);
    if (!input.name) continue;
    const v = input.value.trim();
    if (v === "" && input.name !== "name" && input.name !== "subtitle") continue;
    if (input.type === "checkbox") out[input.name] = input.checked;
    else if (input.name === "crit_pct") out.crit_chance = Number(v) / 100;
    else out[input.name] = input.type === "number" ? Number(v) : v;
  }
  return out;
}

/** One badge star as it looks by names. @param {any} b */
function badgeStar(b) {
  const s = el("span", `badge${b.rainbow ? " badge-rainbow" : ""}`, b.symbol || "*");
  if (!b.rainbow) s.style.color = b.color;
  return s;
}

/** The admin's badges: the GIVE dropdown and the list (holders, [ DELETE ]). @param {any[]} badges */
function renderBadgeAdmin(badges) {
  const pick = /** @type {HTMLSelectElement} */ ($("badge-pick"));
  const was = pick.value;
  pick.replaceChildren(...badges.map((b) => {
    const o = /** @type {HTMLOptionElement} */ (el("option", "", `${b.symbol} ${b.title}`));
    o.value = String(b.id);
    return o;
  }));
  if (badges.some((b) => String(b.id) === was)) pick.value = was;
  const host = $("badge-list");
  if (host.querySelector(".armed")) return; // mid-confirm: don't redraw under the click
  host.replaceChildren(...(badges.length ? badges.map((b) => {
    const form = /** @type {HTMLFormElement} */ (el("form", "badge-admin"));
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "badge_id";
    id.value = String(b.id);
    const tag = el("span", "badges");
    tag.append("[", badgeStar(b), "]");
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    form.append(id, tag, el("span", "badge-admin-title", b.title), el("span", "hint", b.description || "--"),
      el("span", "hint", `${fmt(b.holders)} player${b.holders === 1 ? " has" : "s have"} it`), del);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(form, "delete_badge", del);
    });
    return form;
  }) : [el("p", "hint", "no badges made yet.")]));
}

/** The make-a-badge form's live preview: the star by a name, and its hover box. */
function drawBadgePreview() {
  const form = /** @type {HTMLFormElement} */ (document.querySelector('form[data-action="create_badge"]'));
  const val = (/** @type {string} */ n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value;
  const b = {
    symbol: val("symbol").trim() || "*",
    color: val("color"),
    rainbow: /** @type {HTMLInputElement} */ (form.elements.namedItem("rainbow")).checked,
  };
  const title = val("title").trim().toUpperCase() || "BADGE NAME";
  const says = val("description").trim();
  const lines = [title, ...(says ? [`  ${says}`] : []), "  given by the admin <date>"];
  const w = Math.max(...lines.map((l, i) => l.length + (i === 0 ? 2 : 0)));
  const pre = $("badge-preview");
  const tag = el("span", "badges");
  tag.append("[", badgeStar(b), "]");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.replaceChildren("PREVIEW  ", tag, " SOMEONE\n\n", edge);
  lines.forEach((l, i) => {
    const row = el("span", i === 0 ? "tip-title" : "");
    row.append("| ", ...(i === 0 ? [badgeStar(b), " "] : []), l.padEnd(w - (i === 0 ? 2 : 0)), " |\n");
    pre.append(row);
  });
  pre.append(edge.trimEnd());
}

/** Every poll with its counts and a [ DELETE ] (two clicks). @param {any[]} polls */
function renderPolls(polls) {
  const host = $("poll-list");
  if (host.querySelector(".armed")) return; // mid-confirm: don't redraw under the click
  const t = Date.now() / 1000;
  const rows = polls.map((p) => {
    const closed = p.closed || p.ends_at <= t;
    const total = p.yes + p.no;
    const pct = total ? Math.round((100 * p.yes) / total) : 0;
    const form = /** @type {HTMLFormElement} */ (el("form", "poll-admin"));
    form.dataset.action = "delete_poll";
    const id = /** @type {HTMLInputElement} */ (el("input"));
    id.type = "hidden";
    id.name = "poll_id";
    id.value = String(p.id);
    const status = closed ? (p.passed ? "PASSED" : "FAILED") : `OPEN ${duration(p.ends_at - t)} left`;
    const del = /** @type {HTMLButtonElement} */ (el("button", "inline-btn danger", "[ DELETE ]"));
    form.append(
      id,
      el("span", `poll-admin-state ${closed ? (p.passed ? "ok" : "dim") : "live"}`, `#${p.id} ${status}`),
      el("span", "poll-admin-q", p.question),
      el("span", "hint", `YES ${fmt(p.yes)} / NO ${fmt(p.no)} (${pct}% yes)`),
      del,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(form, "delete_poll", del);
    });
    return form;
  });
  host.replaceChildren(...(rows.length ? rows : [el("p", "hint", "no polls yet.")]));
}

/** Two-click confirm for destructive buttons: first click arms for 3 s.
 * @type {WeakMap<HTMLElement, {label: string, timer: number}>} */
const armed = new WeakMap();

/** @param {HTMLElement} btn */
function disarm(btn) {
  const a = armed.get(btn);
  if (!a) return;
  clearTimeout(a.timer);
  btn.classList.remove("armed");
  btn.textContent = a.label;
  armed.delete(btn);
}

/** @param {HTMLFormElement} form @param {string} action @param {HTMLElement | null} btn */
async function submit(form, action, btn) {
  // data-confirm-empty="field": ask twice only when that field is left empty (e.g. "everyone").
  const emptyField = form.dataset.confirmEmpty;
  const risky = emptyField
    ? !(/** @type {HTMLInputElement | null} */ (form.elements.namedItem(emptyField))?.value.trim())
    : false;
  if (btn && (form.hasAttribute("data-confirm") || btn.classList.contains("danger") || risky)) {
    if (!armed.has(btn)) {
      armed.set(btn, { label: btn.textContent ?? "", timer: window.setTimeout(() => disarm(btn), 3000) });
      btn.classList.add("armed");
      btn.textContent = "[ SURE? CLICK AGAIN ]";
      return;
    }
    disarm(btn);
  }
  try {
    const res = await call("/api/admin/action", { action, ...params(form), announce: announcing() });
    log(res.message, true);
    if (action === "set_passcode") {
      showLogin();
      return;
    }
    form.reset();
    await refresh();
  } catch (e) {
    log(/** @type {Error} */ (e).message, false);
  }
}

/** Every section folds open/closed; each remembers how you left it (POST starts open). */
function wireFold() {
  document.querySelectorAll("details.fold").forEach((node) => {
    const fold = /** @type {HTMLDetailsElement} */ (node);
    const key = `omhp.admin.fold.${fold.dataset.fold}`;
    try {
      const saved = localStorage.getItem(key) ?? (fold.dataset.fold === "items" ? localStorage.getItem("omhp.admin.gallery") : null);
      fold.open = saved ? saved === "open" : fold.dataset.fold === "post";
    } catch {
      fold.open = fold.dataset.fold === "post";
    }
    fold.addEventListener("toggle", () => {
      try {
        localStorage.setItem(key, fold.open ? "open" : "closed");
      } catch {
        /* ignore */
      }
    });
  });
}

function wirePreview() {
  $("preview-btn").addEventListener("click", () => {
    const id = /** @type {HTMLSelectElement} */ ($("preview-boss")).value;
    window.open(new URL(`./#preview-death=${id}`, location.href).href, "_blank", "noopener");
  });
}

/** Fill the preview boss list (current boss first selected). @param {any} content @param {string} current */
function fillPreviewBosses(content, current) {
  const sel = /** @type {HTMLSelectElement} */ ($("preview-boss"));
  if (sel.options.length) return;
  for (const b of content.bosses) {
    const community = String(b.id).startsWith("community_");
    const label = community
      ? `[COMMUNITY] ${b.name} · ${String(b.intro || "").replace("A COMMUNITY BOSS ", "")} · ${String(b.id).slice(-4).toUpperCase()}`
      : `#${String(b.number).padStart(2, "0")} ${b.name}`;
    const o = /** @type {HTMLOptionElement} */ (el("option", "", label));
    o.value = b.id;
    o.selected = b.id === current;
    sel.append(o);
  }
}

function wire() {
  wireFold();
  $("shard-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    shardQuery = /** @type {HTMLInputElement} */ ($("shard-search")).value.trim();
    shardPage = 0;
    void loadShards();
  });
  $("shard-prev").addEventListener("click", () => { shardPage = Math.max(0, shardPage - 1); void loadShards(); });
  $("shard-next").addEventListener("click", () => { shardPage++; void loadShards(); });
  const make = /** @type {HTMLFormElement} */ (document.querySelector('form[data-action="create_badge"]'));
  make.addEventListener("input", drawBadgePreview);
  make.addEventListener("reset", () => setTimeout(drawBadgePreview));
  drawBadgePreview();
  wirePreview();
  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ ($("passcode"));
    try {
      const { token } = await call("/api/admin/login", { passcode: input.value });
      setSession(token);
      input.value = "";
      await refresh();
      log("Logged in.", true);
    } catch (err) {
      log(/** @type {Error} */ (err).message, false);
    }
  });
  $("logout").addEventListener("click", async () => {
    await call("/api/admin/logout", {}).catch(() => {});
    showLogin();
  });
  document.querySelectorAll("form[data-action]").forEach((node) => {
    const form = /** @type {HTMLFormElement} */ (node);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = /** @type {HTMLElement | null} */ (/** @type {SubmitEvent} */ (e).submitter);
      submit(form, btn?.dataset.override ?? form.dataset.action ?? "", btn);
    });
  });
  document.querySelectorAll("[data-pct]").forEach((node) => {
    const b = /** @type {HTMLElement} */ (node);
    b.addEventListener("click", () => {
      if (!ov) return;
      const pct = Number(b.dataset.pct);
      const hp = pct >= 1 ? Math.round((ov.boss.max_hp * pct) / 100) : 1;
      const input = /** @type {HTMLInputElement} */ (document.querySelector('[data-action="set_hp"] [name="hp"]'));
      input.value = String(hp);
    });
  });
}

if (!forwardToCanonical("admin")) wire();
if (!forwardToCanonical("admin") && session()) refresh().catch(() => showLogin());
else showLogin();
setInterval(() => {
  if (!$("panel").hidden && document.visibilityState === "visible") refresh().catch(() => {});
}, 15000);
