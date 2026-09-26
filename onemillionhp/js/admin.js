// Admin panel. Every button is a <form data-action="..."> whose inputs become
// the action's parameters; the server validates everything.

import { API_BASE } from "./api.js?v=0267a0c4ee";
import { el, fmt, padR } from "./ascii.js?v=0267a0c4ee";

const KEY = "omhp.admin";
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

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
    `RULES  ${t.attacks_per_day} attacks/day  crit ${(t.crit_chance * 100).toFixed(2)}%  drops x${t.loot_mult}`,
  ].join("\n");

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

  const tune = /** @type {HTMLFormElement} */ (document.querySelector('[data-action="set_tuning"]'));
  /** @type {HTMLInputElement} */ (tune.elements.namedItem("attacks_per_day")).placeholder = String(t.attacks_per_day);
  /** @type {HTMLInputElement} */ (tune.elements.namedItem("crit_pct")).placeholder = (t.crit_chance * 100).toFixed(2);
  /** @type {HTMLInputElement} */ (tune.elements.namedItem("loot_mult")).placeholder = String(t.loot_mult);

  const sel = $("item-select");
  if (!sel.childElementCount) {
    for (const it of ov.items) {
      const o = /** @type {HTMLOptionElement} */ (el("option", "", `${it.name} [${it.rarity}]`));
      o.value = it.id;
      sel.append(o);
    }
  }
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
    const res = await call("/api/admin/action", { action, ...params(form) });
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

function wire() {
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

wire();
if (session()) refresh().catch(() => showLogin());
else showLogin();
setInterval(() => {
  if (!$("panel").hidden && document.visibilityState === "visible") refresh().catch(() => {});
}, 15000);
