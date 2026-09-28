// The game's one official address (<meta name="omhp-canonical">). When set,
// every other copy (conradrandy.com/onemillionhp, world.conradrandy.com)
// forwards there. The player's token rides along in the URL fragment, which
// browsers never send to any server, so players keep their name, items and
// stats across the move. Empty = no forwarding.

import { adoptToken, currentToken } from "./api.js?v=b82192feda";

export const CANONICAL = (() => {
  const v = document.querySelector('meta[name="omhp-canonical"]')?.getAttribute("content")?.trim();
  return v ? v.replace(/\/$/, "") : "";
})();

const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

/** Send this visitor to the official address. Returns true if leaving.
 * @param {"game" | "admin"} page */
export function forwardToCanonical(page) {
  if (!CANONICAL || isLocal() || location.origin === CANONICAL) return false;
  const token = page === "game" ? currentToken() : null;
  const path = page === "admin" ? "/admin" : "/";
  location.replace(CANONICAL + path + (token ? `#claim=${encodeURIComponent(token)}` : ""));
  return true;
}

/** On the official address: keep a token handed over by an old copy, unless
 * this browser already has a player here. Then clean the address bar. */
export function acceptClaim() {
  const m = location.hash.match(/^#claim=([^&]+)/);
  if (!m) return;
  adoptToken(decodeURIComponent(m[1]));
  history.replaceState(null, "", location.pathname + location.search);
}
