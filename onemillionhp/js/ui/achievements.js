// Private achievement progress and one-time shard claims.
import * as api from "../api.js?v=b6664395f3";
import { el, fmt } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";

/** @type {any} */
let data = null;

/** Ticket #307: how many players have it (out of everyone who's unlocked any). @param {number} pct */
const rarityText = (pct) => (pct <= 0 ? "NOBODY HAS THIS YET"
  : pct < 0.1 ? "UNDER 0.1% OF PLAYERS HAVE THIS"
    : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% OF PLAYERS HAVE THIS`);
let owner = "";
let loading = false;
let claiming = false;
let filter = "all";
let category = "all";
let message = "";
let failed = false;
/** Ticket #284: list order, "default" (the game's) or "done" (closest to done first); remembered here. */
const SORT_KEY = "omhp.achievements.sort";
let sortBy = (() => {
  try {
    return localStorage.getItem(SORT_KEY) === "done" ? "done" : "default";
  } catch {
    return "default";
  }
})();
/** New progress arrived while the category dropdown was open: draw it once it closes. */
let stale = false;
const host = () => document.getElementById("panel-achievements");
/** Ticket #170: achievements you pinned sit at the top of the list (this browser only). */
const PIN_KEY = "omhp.achievements.pinned";
const MAX_PINS = 10;
/** @type {string[]} */
let pinned = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((x) => typeof x === "string").slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
})();

/** @param {string} id */
function togglePin(id) {
  if (pinned.includes(id)) pinned = pinned.filter((x) => x !== id);
  else if (pinned.length >= MAX_PINS) {
    showError(`You can pin ${MAX_PINS} at most. Unpin one first.`);
    return;
  } else pinned = [...pinned, id];
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(pinned));
  } catch {
    /* ignore */
  }
  render();
}

export function updateAchievementBadge() {
  const button = document.querySelector('[data-tab="achievements"]');
  if (!button) return;
  const ready = state.me?.achievements?.ready ?? 0;
  button.textContent = ready ? `[ ACHIEVEMENTS ${ready} ]` : "[ ACHIEVEMENTS ]";
  button.setAttribute("aria-label", ready ? `Achievements, ${ready} rewards ready` : "Achievements");
}

export async function loadAchievements() {
  const panel = host();
  const id = state.me?.id;
  if (!panel || panel.hidden || !id || loading || claiming) return;
  if (owner !== id) {
    data = null;
    message = "";
    owner = id;
  }
  loading = true;
  failed = false;
  if (!data) render();
  let changed = true;
  try {
    const result = await api.getAchievements();
    if (state.me?.id !== id) return;
    // This reloads every few seconds while the tab is open: only redraw when
    // something changed, so an open category dropdown isn't closed under you.
    changed = !data || JSON.stringify(result) !== JSON.stringify(data);
    data = result;
  } catch (e) {
    if (state.me?.id === id) {
      failed = true;
      showError(/** @type {Error} */ (e).message);
    }
  } finally {
    loading = false;
    if (state.me?.id !== id) loadAchievements();
    else if (changed && pickerOpen()) stale = true;
    else if (changed) render();
  }
}

/** The category dropdown has focus (it may be open): a redraw would close it. */
function pickerOpen() {
  const active = document.activeElement;
  return active instanceof HTMLSelectElement && Boolean(host()?.contains(active));
}

/** @param {string} id */
async function claim(id) {
  if (claiming || loading) return;
  const player = state.me?.id;
  claiming = true;
  render();
  try {
    const result = await api.claimAchievements(id);
    if (state.me?.id !== player) return;
    data = result;
    state.me = result.me;
    message = result.shards_gained
      ? `+${fmt(result.shards_gained)} shards added to your balance.`
      : "These rewards have already been claimed.";
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    claiming = false;
    if (state.me?.id === player) render();
    else loadAchievements();
  }
}

function render() {
  const panel = host();
  if (!panel || panel.hidden) return;
  stale = false;
  if (!data) {
    const note = el("div", "dim", failed ? "> couldn't load achievements." : "> loading achievements...");
    panel.replaceChildren(note);
    if (failed) {
      const retry = el("button", "inline-btn", "[ RETRY ]");
      retry.addEventListener("click", loadAchievements);
      panel.append(retry);
    }
    return;
  }
  const head = el("div", "panel-h", `ACHIEVEMENTS  ${data.unlocked} / ${data.total}`);
  const summary = el("div", "achievement-summary",
    `${fmt(data.claimed_shards)} shards claimed :: ${fmt(data.available_shards)} ready`);
  const note = el("p", "dim achievement-note",
    "One reward per achievement. Progress stays unlocked, and what you did before an achievement existed counts where the game kept a record. SECRETS show as ??? until you find them.");
  const controls = el("div", "achievement-controls");
  const all = /** @type {HTMLButtonElement} */ (el("button", "achievement-claim", `[ CLAIM ALL +${fmt(data.available_shards)} ]`));
  all.disabled = claiming || !data.ready;
  all.addEventListener("click", () => claim("all"));
  controls.append(all);
  const filters = el("div", "achievement-filters");
  for (const [value, label] of [["all", "ALL"], ["ready", "READY"], ["locked", "IN PROGRESS"], ["claimed", "CLAIMED"]]) {
    const b = el("button", "chip", `[ ${label} ]`);
    b.setAttribute("aria-pressed", String(filter === value));
    if (filter === value) b.classList.add("on");
    b.addEventListener("click", () => { filter = value; render(); });
    filters.append(b);
  }
  const pick = /** @type {HTMLSelectElement} */ (el("select", "own-select"));
  pick.setAttribute("aria-label", "Achievement category");
  const categories = [...new Set(data.achievements.map((/** @type {any} */ a) => a.category))];
  for (const value of ["all", ...categories]) {
    const option = /** @type {HTMLOptionElement} */ (el("option", "", value === "all" ? "Every category" : value));
    option.value = value;
    pick.append(option);
  }
  pick.value = category;
  pick.addEventListener("change", () => { category = pick.value; render(); });
  pick.addEventListener("blur", () => { if (stale) render(); });
  const order = /** @type {HTMLSelectElement} */ (el("select", "own-select"));
  order.setAttribute("aria-label", "Sort achievements");
  for (const [value, label] of [["default", "Sort: default"], ["done", "Sort: closest to done"]]) {
    const option = /** @type {HTMLOptionElement} */ (el("option", "", label));
    option.value = value;
    order.append(option);
  }
  order.value = sortBy;
  order.addEventListener("change", () => {
    sortBy = order.value === "done" ? "done" : "default";
    try {
      localStorage.setItem(SORT_KEY, sortBy);
    } catch {
      /* ignore */
    }
    render();
  });
  order.addEventListener("blur", () => { if (stale) render(); });
  filters.append(pick, order);
  const status = el("div", "achievement-message", message);
  status.setAttribute("role", "status");
  const list = el("div", "achievement-list");
  const shown = data.achievements.filter((/** @type {any} */ a) =>
    (filter === "all" || a.status === filter) && (category === "all" || a.category === category));
  // CLAIMED: the newest claims first.
  if (filter === "claimed") shown.sort((/** @type {any} */ a, /** @type {any} */ b) => (b.claimed_at ?? 0) - (a.claimed_at ?? 0));
  // Closest to done first: ready to claim, then by how far along; claimed and
  // undiscovered secrets (no progress shown) go last.
  if (sortBy === "done" && filter !== "claimed") {
    const done = (/** @type {any} */ a) => (a.status === "claimed" || (a.hidden && a.status === "locked") ? -1
      : a.status === "ready" ? 2 : a.target ? Math.min(1, a.progress / a.target) : 0);
    shown.sort((/** @type {any} */ a, /** @type {any} */ b) => done(b) - done(a));
  }
  // Pinned first, in the order you pinned them (the sort is stable for the rest).
  const pinAt = (/** @type {any} */ a) => (pinned.includes(a.id) ? pinned.indexOf(a.id) : MAX_PINS);
  shown.sort((/** @type {any} */ a, /** @type {any} */ b) => pinAt(a) - pinAt(b));
  for (const a of shown) {
    const secret = a.hidden && a.status === "locked";
    const isPinned = pinned.includes(a.id);
    const card = el("article", `achievement-card ${a.status}${a.hidden ? " secret" : ""}${isPinned ? " pinned" : ""}`);
    const top = el("div", "dim achievement-category", `${isPinned ? "* PINNED :: " : ""}${a.hidden ? "SECRET" : a.category}`);
    if (!secret && (isPinned || a.status !== "claimed")) {
      const pin = el("button", "inline-btn achievement-pin", isPinned ? "[ UNPIN ]" : "[ PIN ]");
      pin.setAttribute("aria-label", `${isPinned ? "Unpin" : "Pin"} ${a.title}`);
      pin.addEventListener("click", () => togglePin(a.id));
      top.append(pin);
    }
    card.append(top,
      el("h3", "achievement-title", a.title), el("p", "achievement-description", a.description));
    if (!secret) card.append(el("div", "dim achievement-rarity", rarityText(data.rarity?.[a.id] ?? 0)));
    if (!secret) {
      const progress = /** @type {HTMLProgressElement} */ (el("progress", "achievement-progress"));
      progress.max = a.target;
      progress.value = a.progress;
      progress.setAttribute("aria-label", `${a.title}: ${fmt(a.progress)} of ${fmt(a.target)}`);
      card.append(progress, el("div", "dim", `${fmt(a.progress)} / ${fmt(a.target)}`));
    }
    const bottom = el("div", "achievement-bottom");
    bottom.append(el("span", "achievement-reward", secret ? "+??? shards" : `+${fmt(a.shards)} shards`));
    if (a.status === "ready") {
      const button = /** @type {HTMLButtonElement} */ (el("button", "achievement-claim", "[ CLAIM ]"));
      button.setAttribute("aria-label", `Claim ${a.title}, ${fmt(a.shards)} shards`);
      button.disabled = claiming;
      button.addEventListener("click", () => claim(a.id));
      bottom.append(button);
    } else bottom.append(el("span", "dim", a.status === "claimed" ? "CLAIMED" : "IN PROGRESS"));
    card.append(bottom);
    list.append(card);
  }
  if (!shown.length) list.append(el("p", "dim", "No achievements match these filters."));
  panel.replaceChildren(head, summary, note, controls, filters, status, list);
}
