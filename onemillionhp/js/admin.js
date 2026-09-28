// Admin panel. Every button is a <form data-action="..."> whose inputs become
// the action's parameters; the server validates everything.

import { API_BASE, getContent } from "./api.js?v=2870087685";
import { forwardToCanonical } from "./home.js?v=2870087685";
import { el, fmt, padR, setArt } from "./ascii.js?v=2870087685";
import { rarityById, state } from "./store.js?v=2870087685";
import { effectParts } from "./ui/effects.js?v=2870087685";
import { itemLines } from "./ui/fx.js?v=2870087685";

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
      parts.push(oddsRow(r.what.toUpperCase(), now, [el("span", "dim", "(adds up the rarities below)")]));
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
      const input = oddsInput(Math.round(r.chance * 10000) / 100, "any");
      parts.push(oddsRow(r.what.toUpperCase(), pct(r.chance), [input, el("span", "dim", " %")]));
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
    if (input.name === "crit_pct") out.crit_chance = Number(v) / 100;
    else out[input.name] = input.type === "number" ? Number(v) : v;
  }
  return out;
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
  if (btn && (form.hasAttribute("data-confirm") || btn.classList.contains("danger"))) {
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

function wireFold() {
  const fold = /** @type {HTMLDetailsElement} */ ($("gal-fold"));
  try {
    fold.open = localStorage.getItem("omhp.admin.gallery") === "open";
  } catch {
    /* ignore */
  }
  fold.addEventListener("toggle", () => {
    try {
      localStorage.setItem("omhp.admin.gallery", fold.open ? "open" : "closed");
    } catch {
      /* ignore */
    }
  });
}

function wire() {
  wireFold();
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
