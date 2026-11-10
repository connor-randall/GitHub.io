// Server API client + anonymous identity.
//
// Identity = a random bearer token the server issues on first visit, kept in
// localStorage. The token never leaves this origin except to the API.

const TOKEN_KEY = "omhp.token";

export const getAchievements = () => request("/api/me/achievements", { auth: true });
/** Your lifetime numbers for [ STATS ]. */
export const getStats = () => request("/api/me/stats", { auth: true });
export const getPrestige = () => request("/api/prestige", { auth: true });
export const buyPrestige = () => request("/api/prestige", { method: "POST", auth: true, body: {} });
/** @param {string} achievementId */
export const claimAchievements = (achievementId) => request("/api/me/achievements/claim", {
  method: "POST", auth: true, body: { achievement_id: achievementId },
});

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
      // A stalled request must not leave buttons disabled until a reload.
      // Retries are safe: attacks and chest opens replay on their request ids.
      signal: AbortSignal.timeout?.(15000),
    });
  } catch (err) {
    if (/** @type {any} */ (err)?.name === "TimeoutError") {
      throw new ApiError("NETWORK", "The dungeon is slow to answer. Try again.", 0);
    }
    throw new ApiError("NETWORK", "The dungeon is unreachable. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    // A proxy's own error page (Cloudflare 502/503/504, 429) has no JSON: say what it means.
    const fallback = res.status === 429 ? "Slow down a moment."
      : res.status >= 500 ? "The dungeon is restarting. Try again in a few seconds." : `Error ${res.status}`;
    throw new ApiError(e.code ?? "HTTP_" + res.status, e.message ?? fallback, res.status);
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
  try {
    // Lost the stored login (Safari clears it after a week away)? The server
    // kept a cookie backup.
    const back = await request("/api/me/restore", { method: "POST" });
    saveToken(back.token);
    return back.me;
  } catch {
    /* nothing to restore: new player */
  }
  const out = await request("/api/players", { method: "POST", body: {} });
  saveToken(out.token);
  return out.me;
}

export const getContent = () => request("/api/content");
export const getState = () => request("/api/state");
/** Feed events older than the given one (newest first); ``mine``: only your own (ONLY ME).
 * @param {number} t @param {number} id @param {number} [limit] @param {boolean} [mine] */
export const getOlderFeed = (t, id, limit = 100, mine = false) =>
  request(`/api/feed?before_t=${t}&before_id=${id}&limit=${Math.max(1, Math.min(100, limit))}${mine ? "&mine=1" : ""}`,
    mine ? { auth: true } : {});
export const getMe = () => request("/api/me", { auth: true });
/** Report a player. @param {string} player @param {string} reason @param {string} note @param {number} [chatId] */
export const sendReport = (player, reason, note, chatId) => request("/api/report", {
  method: "POST", auth: true, body: { player, reason, note, ...(chatId === undefined ? {} : { chat_id: chatId }) },
});
/** A banned player's appeal. @param {string} text */
export const sendAppeal = (text) => request("/api/appeal", { method: "POST", auth: true, body: { text } });
/** Answer the admin's "are you human?" check. @param {number} answer the clicked cell */
export const solveCaptcha = (answer) => request("/api/captcha", { method: "POST", auth: true, body: { answer } });
/** CHARM ULTS: the answer to a CAPTCHA EYE. @param {number} answer the clicked cell */
export const answerUlt = (answer) => request("/api/ult/answer", { method: "POST", auth: true, body: { answer } });
/** @param {string} scope "today", "all" or "boss:<number>" */
export const getLeaderboard = (scope) =>
  request(`/api/leaderboard?scope=${encodeURIComponent(scope)}`, { auth: true }); // auth: includes your own rank
export const getHistory = () => request("/api/history");
/** What someone's badges are for (the hover box). @param {string} playerId */
export const getPlayerBadges = (playerId) => request(`/api/players/${encodeURIComponent(playerId)}/badges`);
/** What someone is wearing (the card CHAT opens from a name). @param {string} playerId */
export const getPlayerGear = (playerId) => request(`/api/players/${encodeURIComponent(playerId)}/gear`);
/** The same card from a player's name (a shared #p=NAME link, ticket #67). @param {string} name */
export const getGearByName = (name) => request(`/api/gear?${new URLSearchParams({ name })}`);
/** Who has the game open: [{player_id, name, badges, level}] and the connection count. */
export const getOnline = () => request("/api/online");
/** How the admin's badges look (symbol, colour, rainbow). */
export const getBadgeDefs = () => request("/api/badges");
/** Your earned badges and which ones show. */
export const getMyBadges = () => request("/api/me/badges", { auth: true });
/** @param {string[] | null} pick which badges show, in order (null = automatic) */
export const setMyBadges = (pick) => request("/api/me/badges", { method: "POST", auth: true, body: { pick } });
/** The city: stage, bar, donors, point values. */
export const getCity = () => request("/api/city", { auth: true });
/** [ CITY ] > [ HISTORY ]: every finished building's donors (ticket #207). */
export const getCityHistory = () => request("/api/city/history", { auth: true });
export const getForge = () => request("/api/forge", { auth: true });
/** Melt gear into a piece (ticket #138). @param {string} itemId the piece @param {"item"} kind
 * @param {string} ref the gear's or chest's id @param {number} count */
export const giveForge = (itemId, kind, ref, count) =>
  request("/api/forge/give", { method: "POST", auth: true, body: { item_id: itemId, kind, ref, count } });
/** @param {string} itemId @param {number} amount */
export const pourForge = (itemId, amount) =>
  request("/api/forge/pour", { method: "POST", auth: true, body: { item_id: itemId, amount } });
/** @param {string} kind @param {string} ref @param {number} count */
export const donateCity = (kind, ref, count) =>
  request("/api/city/donate", { method: "POST", auth: true, body: { kind, ref, count } });
/** City rewards whose pop-up you haven't seen. */
/** [ ROLL ]: a random name nobody has yet. */
export const rollName = () => request("/api/names/roll");
/** The tutorial's coach box: "seen" a step, or "skip" it all. @param {"seen" | "skip"} action @param {number} [stage] */
export const tutorialAction = (action, stage) =>
  request("/api/me/tutorial", { method: "POST", auth: true, body: { action, stage } });
/** CLANS: every clan and how it looks (brackets, colour). */
export const getClans = () => request("/api/clans");
/** LEADERBOARD > [ HALL OF FAME ]: every posted card, newest boss first. */
export const getHof = () => request("/api/hof");
/** LEADERBOARD [ CLANS ]: totals per clan. @param {string} sort damage | healing | levels | members */
export const getClanRanks = (sort) => request(`/api/clans/ranks?sort=${encodeURIComponent(sort)}`);
/** [ CLAN ]: yours (members), or the ones to join and how to found one. */
export const getMyClan = () => request("/api/me/clan", { auth: true });
/** A clan's public member list (ticket #349). @param {number | string} id */
export const getClanMembers = (id) => request(`/api/clans/${encodeURIComponent(String(id))}/members`);
/** Found / join / leave / kick / restyle. @param {string} action @param {Record<string, any>} [body] */
export const clanAction = (action, body = {}) =>
  request("/api/me/clan", { method: "POST", auth: true, body: { do: action, ...body } });
/** Say something in your clan's chat. @param {string} text */
export const postClanChat = (text) => request("/api/me/clan/chat", { method: "POST", auth: true, body: { text } });
/** Older clan chat. @param {number} before older than this message id */
export const getClanChatOlder = (before) => request(`/api/me/clan/chat?before=${before}`, { auth: true });
/** [ MESSAGES ]: your conversations, one thread, send, block. */
export const getDms = () => request("/api/me/dms", { auth: true });
/** @param {string} playerId @param {number} [before] older than this message id */
export const getDmThread = (playerId, before) =>
  request(`/api/me/dms/${encodeURIComponent(playerId)}${before ? `?before=${before}` : ""}`, { auth: true });
/** @param {string} to player id @param {string} text */
export const sendDm = (to, text) => request("/api/me/dms", { method: "POST", auth: true, body: { to, text } });
/** @param {string} playerId @param {boolean} blocked */
export const blockDm = (playerId, blocked) =>
  request("/api/me/dms/block", { method: "POST", auth: true, body: { player_id: playerId, blocked } });
/** CHAT: every stored message (up to 300, oldest first), and say something. */
export const getChat = () => request("/api/chat");
/** @param {string} text */
export const postChat = (text) => request("/api/chat", { method: "POST", auth: true, body: { text } });
/** [ DAILY ]: your 30-day login track, and open today's reward. */
/** Auction listings. @param {{slot?: string, rarity?: string, sort?: string, q?: string, unowned?: string, refined?: string, effect?: string, page?: number}} f */
export const getAuction = (f) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") qs.set(k, String(v));
  return request(`/api/auction?${qs}`, { auth: true });
};
/** Ticket #324: an item's open listings, copies and price range. @param {string} itemId @param {boolean} [refined] */
export const getAuctionMarket = (itemId, refined = false) =>
  request(`/api/auction/market?${new URLSearchParams({ item: itemId, refined: refined ? "1" : "0" })}`);
/** ``refined``: list your refined copy (THE BLACKSMITH) instead of spares.
 * @param {string} itemId @param {number} count @param {number} price @param {boolean} [refined] */
export const listAuction = (itemId, count, price, refined = false) =>
  request("/api/auction/list", { method: "POST", auth: true, body: { item_id: itemId, count, price, refined } });
/** @param {number} listingId */
export const cancelAuction = (listingId) =>
  request("/api/auction/cancel", { method: "POST", auth: true, body: { listing_id: listingId } });
/** Ticket #157: lower an open listing's price. @param {number} listingId @param {number} price */
export const repriceAuction = (listingId, price) =>
  request("/api/auction/reprice", { method: "POST", auth: true, body: { listing_id: listingId, price } });
/** @param {number} listingId @param {number} count */
export const buyAuction = (listingId, count) =>
  request("/api/auction/buy", { method: "POST", auth: true, body: { listing_id: listingId, count } });
export const getDaily = () => request("/api/daily", { auth: true });
export const claimDaily = () => request("/api/daily/claim", { method: "POST", auth: true });
export const getCityRewards = () => request("/api/city/rewards", { auth: true });
/** @param {number} stage */
export const seenCityReward = (stage) =>
  request("/api/city/rewards/seen", { method: "POST", auth: true, body: { stage } });
/** +1 a ticket (1), -1 it (-1) or take your vote back (0). @param {number} ticketId @param {number} vote */
export const voteTicket = (ticketId, vote) =>
  request("/api/tickets/vote", { method: "POST", auth: true, body: { ticket_id: ticketId, vote } });
/** Take down your own ticket. @param {number} ticketId */
export const deleteTicket = (ticketId) =>
  request("/api/tickets/delete", { method: "POST", auth: true, body: { ticket_id: ticketId } });
/** Comment on a ticket (5 per ticket in all); returns the ticket. @param {number} ticketId @param {string} body */
export const commentTicket = (ticketId, body) =>
  request("/api/tickets/comment", { method: "POST", auth: true, body: { ticket_id: ticketId, body } });
/** Take down your own comment; returns its ticket. @param {number} commentId */
export const deleteTicketComment = (commentId) =>
  request("/api/tickets/comment/delete", { method: "POST", auth: true, body: { comment_id: commentId } });
/** Every ticket, newest first (yours marked ``mine``). */
export const getTickets = () => request("/api/tickets", { auth: true });
/** File a ticket; ``kind`` is "issue" or "feature".
 * @param {string} title @param {string} body @param {string} kind */
export const submitTicket = (title, body, kind) =>
  request("/api/tickets", { method: "POST", auth: true, body: { title, body, kind } });
/** Every poll, with your vote if you have a player. */
export const getPolls = () => request("/api/polls", { auth: true });
/** @param {number} pollId @param {"yes" | "no"} choice */
export const votePoll = (pollId, choice) =>
  request("/api/polls/vote", { method: "POST", auth: true, body: { poll_id: pollId, choice } });
/** Explain your vote (5 per poll each); returns the poll. @param {number} pollId @param {string} body */
export const commentPoll = (pollId, body) =>
  request("/api/polls/comment", { method: "POST", auth: true, body: { poll_id: pollId, body } });
/** Take down your own poll comment; returns its poll. @param {number} commentId */
export const deletePollComment = (commentId) =>
  request("/api/polls/comment/delete", { method: "POST", auth: true, body: { comment_id: commentId } });
/** KEEP ONE OF EACH (EVERYWHERE) on / off (ticket #110); returns your player. @param {boolean} on */
export const setKeepOne = (on) => request("/api/me/keep-one", { method: "POST", auth: true, body: { on } });
/** VOTE ON BOSSES: open designs (first frame only), your votes, recent results. */
export const getBossVotes = () => request("/api/design-votes", { auth: true });
/** @param {string} designId @param {"yes" | "no"} choice */
export const voteBoss = (designId, choice) =>
  request("/api/design-votes/vote", { method: "POST", auth: true, body: { design_id: designId, choice } });
/** Scoreboard for one boss (with your rank if you have a player). @param {number} seq */
export const getBossResults = (seq) => request(`/api/bosses/${seq}/results`, { auth: true });
/** @param {number} seq @param {number} cols */
export const getBossGraph = (seq, cols) => request(`/api/bosses/${seq}/graph?cols=${cols}`);
/** @param {string} name */
export const rename = (name) => request("/api/me/name", { method: "POST", auth: true, body: { name } });
/** Equip an owned item (its own slot), or pass null + slot to empty a slot.
 * @param {string | null} itemId @param {string} [slot] */
/** Ticket #305: the charm your ULTIMATE uses (null = the worn one). @param {string | null} itemId */
export const setUltCharm = (itemId) =>
  request("/api/me/ult_charm", { method: "POST", auth: true, body: { item_id: itemId } });

/** Save / wear / rename / clear one of your 3 loadouts. @param {string} action @param {number} index @param {string} [name] */
export const loadout = (action, index, name) =>
  request("/api/me/loadout", { method: "POST", auth: true, body: { action, index, name } });
export const equip = (itemId, slot) =>
  request("/api/me/equip", { method: "POST", auth: true, body: { item_id: itemId, slot } });

/** Sell copies of one item for shards. @param {string} itemId @param {number} count */
export const sellItem = (itemId, count) =>
  request("/api/shop/sell", { method: "POST", auth: true, body: { item_id: itemId, count } });
/** Sell every copy beyond the first of everything. */
/** Lock an item so it can't be sold (or unlock it). @param {string} itemId @param {boolean} locked */
export const lockItem = (itemId, locked) =>
  request("/api/inventory/lock", { method: "POST", auth: true, body: { item_id: itemId, locked } });
/** Ticket #76: mark an item to sell (or unmark it). @param {string} itemId @param {boolean} on */
export const markItem = (itemId, on) =>
  request("/api/inventory/mark", { method: "POST", auth: true, body: { item_id: itemId, on } });
/** Take THE DEAL on offer right now. */
export const takeDeal = () => request("/api/event/deal", { method: "POST", auth: true, body: {} });
/** Buy one of THE MERCHANT's offers. @param {string} offer */
export const buyOffer = (offer) => request("/api/event/buy", { method: "POST", auth: true, body: { offer } });
/** Throw shards into THE WISHING WELL. @param {number} amount */
export const throwShards = (amount) => request("/api/event/throw", { method: "POST", auth: true, body: { amount } });
/** MEOW MODE: pet one of the cats (0-9). @param {number} cat */
export const petCat = (cat) => request("/api/event/pet", { method: "POST", auth: true, body: { cat } });
/** Sell every duplicate, or only those of some rarities (ticket #227). @param {string[]} [rarities] */
export const sellDuplicates = (rarities) =>
  request("/api/shop/sell", { method: "POST", auth: true, body: { duplicates: true, ...(rarities ? { rarities } : {}) } });
/** Rarities to sell the moment they drop. ``now``: what a newly ticked rarity does to the copies you
 * own ("all" / "dupes" / "none"); ``keepOne``: KEEP ONE OF EACH on/off (undefined = unchanged).
 * @param {string[]} rarities @param {"all" | "dupes" | "none"} [now] @param {boolean} [keepOne] */
export const setAutosell = (rarities, now = "all", keepOne = undefined) =>
  request("/api/shop/autosell", { method: "POST", auth: true, body: { rarities, now, keep_one: keepOne } });
/** @param {string} boxId */
export const buyBox = (boxId, count = 1) =>
  request("/api/shop/buy", { method: "POST", auth: true, body: { box_id: boxId, count } });
/** @param {string} scrollId */
export const buyScroll = (scrollId, count = 1) =>
  request("/api/shop/buy", { method: "POST", auth: true, body: { scroll_id: scrollId, count } });
/** Sell scrolls back to the SHOP (ticket #302). @param {string} scrollId @param {number} count */
export const sellScroll = (scrollId, count) =>
  request("/api/shop/sell", { method: "POST", auth: true, body: { scroll_id: scrollId, count } });
export const getSaveCode = () => request("/api/me/save-code", { auth: true });
/** SPREAD THE WORD: your posted links and the rate. */
export const getBounty = () => request("/api/bounty", { auth: true });
/** @param {string} url a Reddit post */
export const postBounty = (url) => request("/api/bounty", { method: "POST", auth: true, body: { url } });
export const getBossDesign = () => request("/api/boss-design", { auth: true });
/** A design from its share link (ticket #237). @param {string} id */
export const getSharedDesign = (id) => request(`/api/design-share/${encodeURIComponent(id)}`);
/** Send a unique for your own live boss that has none (ticket #315). @param {string} bossId @param {any} unique */
export const proposeBossUnique = (bossId, unique) =>
  request("/api/boss-design/unique", { method: "POST", auth: true, body: { boss_id: bossId, unique } });
/** @param {any} design */
export const saveBossDesign = (design) =>
  request("/api/boss-design", { method: "POST", auth: true, body: design });

/** Give this player a password; their in-game name is the username. @param {string} password */
export const setLogin = (password) => request("/api/me/login", { method: "POST", auth: true, body: { password } });
/** New account in one step: name + password. @param {string} name @param {string} password */
export const createAccount = (name, password) =>
  request("/api/me/account", { method: "POST", auth: true, body: { name, password } });
/** The admin's thank-you pop-up was shown. */
/** @param {boolean} [tickets] the accepted-ticket pop-up (#141), not the designer one */
export const ackThanks = (tickets = false) =>
  request("/api/me/thanks", { method: "POST", auth: true, ...(tickets ? { body: { tickets: true } } : {}) });
/** Share codes: yours (made on first ask), use a friend's, and "seen" for the pop-up. */
export const getReferral = () => request("/api/me/referral", { auth: true });
/** @param {string} code */
export const useReferral = (code) => request("/api/me/referral", { method: "POST", auth: true, body: { code } });
export const ackReferrals = () => request("/api/me/referral/seen", { method: "POST", auth: true });
/** @param {string} old @param {string} next */
export const changePassword = (old, next) =>
  request("/api/me/password", { method: "POST", auth: true, body: { old, new: next } });

/** Swap this browser over to the player behind an in-game name + password.
 * @param {string} username @param {string} password */
export async function login(username, password) {
  const out = await request("/api/login", { method: "POST", body: { username, password } });
  saveToken(out.token);
  return out.me;
}

/** Swap this browser over to the player behind a save code. @param {string} code */
export async function loadSave(code) {
  const out = await request("/api/load-save", { method: "POST", body: { code } });
  saveToken(out.token);
  return out.me;
}

function requestId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** THE BLACKSMITH: your refinable items, with ranks, prices and ranges. */
export const getBlacksmith = () => request("/api/blacksmith", { auth: true });

/** A request id for one merge / respec: the page keeps it across retries so a
 * lost reply never charges twice. */
export const craftRequestId = () => requestId();

/** Merge, respec or grind. ``body`` carries its own request_id: a network blip retries
 * the SAME request (the server answers a repeat with the first result).
 * @param {"merge" | "respec" | "grind" | "affix"} action @param {Record<string, unknown>} body */
export async function craft(action, body) {
  for (let tries = 0; ; tries++) {
    try {
      return await request(`/api/blacksmith/${action}`, { method: "POST", auth: true, body });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "NETWORK") || tries >= 2) throw e;
      await new Promise((r) => setTimeout(r, 900 * (tries + 1)));
    }
  }
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

/** Open every listed loot box, in retry-safe batches. @param {{box_id: string, count: number}[]} boxes */
export async function openAllBoxes(boxes) {
  const pending = boxes.map((row) => ({ ...row }));
  /** @type {{results: any[], events: any[], me: any}} */
  const combined = { results: [], events: [], me: null };
  while (pending.some((row) => row.count > 0)) {
    let room = 250;
    const batch = [];
    for (const row of pending) {
      const count = Math.min(row.count, room);
      if (count > 0) {
        batch.push({ box_id: row.box_id, count });
        row.count -= count;
        room -= count;
      }
      if (!room) break;
    }
    const body = { boxes: batch, request_id: requestId() };
    let opened;
    try {
      opened = await request("/api/boxes/open-all", { method: "POST", auth: true, body });
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "NETWORK") throw e;
      await new Promise((resolve) => setTimeout(resolve, 900));
      opened = await request("/api/boxes/open-all", { method: "POST", auth: true, body });
    }
    combined.results.push(...opened.results);
    combined.events.push(...(opened.events ?? []));
    combined.me = opened.me;
  }
  return combined;
}

/**
 * Attack. The request id makes retries safe: if the response is lost and we
 * resend, the server returns the original result instead of attacking twice.
 * @param {"normal"|"ultimate"} kind
 */
/** This browser's own random id, kept across visits. The bot scan counts
 * accounts per browser with it (several accounts in one browser are listed
 * for the admin; nothing is limited by it). */
let deviceId = "";
function device() {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem("omhp.device") ?? "";
  } catch {
    /* storage blocked: a fresh id for this visit */
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    deviceId = requestId();
    try {
      localStorage.setItem("omhp.device", deviceId);
    } catch {
      /* ignore */
    }
  }
  return deviceId;
}

/** How an attack was clicked, for the bot scan: input type (m)ouse, (t)ouch,
 * (p)en, (k)ey or unknown (x), where on the target, pointer moves since the
 * last attack, and whether the browser marked the event as real.
 * @typedef {{s: string, x: number, y: number, mv: number, tr: boolean}} AttackInput */

/** @param {"normal"|"ultimate"} kind @param {number} [aim] THE HUNT: the zone this hit went for
 * @param {AttackInput} [input] */
export async function attack(kind, aim, input) {
  const body = { request_id: requestId(), kind, device: device(), ...(input ? { input } : {}),
    ...(aim === undefined ? {} : { aim }) };
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

/** Consume one owned global-effect scroll. @param {string} scrollId */
export const useScroll = (scrollId) =>
  request("/api/scrolls/use", { method: "POST", auth: true, body: { scroll_id: scrollId } });

export function liveUrl() {
  const base = API_BASE || location.origin;
  return base.replace(/^http/, "ws") + "/api/live";
}
