// Muted players (ticket #121): their CHAT messages are hidden for you. Kept in
// this browser only, like the feed's SHOW filters; nobody is told. Muting is
// done from a player's gear card (click their name in CHAT).

import { emit } from "./store.js?v=b6664395f3";

const KEY = "omhp.chat.muted";

/** player id -> the name they had when muted (to list them for unmuting). @type {Map<string, string>} */
const muted = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return new Map(Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, n]) => [id, String(n)]));
  } catch {
    return new Map();
  }
})();

/** @param {string | undefined | null} id */
export const isMuted = (id) => Boolean(id && muted.has(id));

/** Everyone muted, as [id, name]. */
export const mutedPlayers = () => [...muted];

/** Mute or unmute a player; CHAT redraws (emits "muted").
 * @param {string} id @param {string} name @param {boolean} on */
export function setMuted(id, name, on) {
  if (on) muted.set(id, name);
  else muted.delete(id);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(muted)));
  } catch {
    /* private mode: just for this visit */
  }
  emit("muted");
}
