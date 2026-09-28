// Server API client + anonymous identity.
//
// Identity = a random bearer token the server issues on first visit, kept in
// localStorage. The token never leaves this origin except to the API.

const TOKEN_KEY = "omhp.token";

/** API origin: <meta name="omhp-api"> or same origin. */
export const API_BASE = (() => {
  const meta = document.querySelector('meta[name="omhp-api"]');
  const v = meta?.getAttribute("content")?.trim();
  return v ? v.replace(/\/$/, "") : "";
})();

export class ApiError extends Error {
  /** @param {string} code @param {string} message @param {number} status */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** @type {string | null} */
let memToken = null;

function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memToken;
  } catch {
    return memToken;
  }
}

/** The token this browser plays with (null if none yet). */
export const currentToken = () => loadToken();

/** Use a token handed over from an old address, unless we already have one.
 * @param {string} t */
export function adoptToken(t) {
  if (!loadToken() && /^[A-Za-z0-9_-]{20,100}$/.test(t)) saveToken(t);
}

/** @param {string | null} t */
function saveToken(t) {
  memToken = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: token lives for this tab only */
  }
}

/**
 * @param {string} path
 * @param {{method?: string, body?: unknown, auth?: boolean}} [opts]
 * @returns {Promise<any>}
 */
async function request(path, opts = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth) {
    const t = loadToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError("NETWORK", "The dungeon is unreachable. Retrying...", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(e.code ?? "HTTP_" + res.status, e.message ?? `Error ${res.status}`, res.status);
  }
  return data;
}

/** Fetch our profile, creating an anonymous player if we have none. */
export async function ensurePlayer() {
  if (loadToken()) {
    try {
      return await request("/api/me", { auth: true });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      saveToken(null); // token unknown to server (e.g. dev reset): start over
    }
  }
  const out = await request("/api/players", { method: "POST", body: {} });
  saveToken(out.token);
  return out.me;
}

export const getContent = () => request("/api/content");
export const getState = () => request("/api/state");
/** Feed events older than the given one (newest first). @param {number} t @param {number} id */
export const getOlderFeed = (t, id) => request(`/api/feed?before_t=${t}&before_id=${id}&limit=100`);
export const getMe = () => request("/api/me", { auth: true });
/** @param {"today"|"all"} scope */
export const getLeaderboard = (scope) => request(`/api/leaderboard?scope=${scope}`);
export const getHistory = () => request("/api/history");
/** Scoreboard for one boss (with your rank if you have a player). @param {number} seq */
export const getBossResults = (seq) => request(`/api/bosses/${seq}/results`, { auth: true });
/** @param {string} name */
export const rename = (name) => request("/api/me/name", { method: "POST", auth: true, body: { name } });
/** Equip an owned item (its own slot), or pass null + slot to empty a slot.
 * @param {string | null} itemId @param {string} [slot] */
export const equip = (itemId, slot) =>
  request("/api/me/equip", { method: "POST", auth: true, body: { item_id: itemId, slot } });

function requestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Open one loot box. Retry-safe like attacks. @param {string} boxId */
export async function openBox(boxId) {
  const body = { box_id: boxId, request_id: requestId() };
  try {
    return await request("/api/boxes/open", { method: "POST", auth: true, body });
  } catch (e) {
    if (e instanceof ApiError && e.code === "NETWORK") {
      await new Promise((r) => setTimeout(r, 900));
      return request("/api/boxes/open", { method: "POST", auth: true, body });
    }
    throw e;
  }
}

/**
 * Attack. The request id makes retries safe: if the response is lost and we
 * resend, the server returns the original result instead of attacking twice.
 * @param {"normal"|"ultimate"} kind
 */
export async function attack(kind) {
  const body = { request_id: requestId(), kind };
  try {
    return await request("/api/attack", { method: "POST", auth: true, body });
  } catch (e) {
    if (e instanceof ApiError && e.code === "NETWORK") {
      await new Promise((r) => setTimeout(r, 900));
      return request("/api/attack", { method: "POST", auth: true, body });
    }
    throw e;
  }
}

export function liveUrl() {
  const base = API_BASE || location.origin;
  return base.replace(/^http/, "ws") + "/api/live";
}
