// Live connection: WebSocket push, with short polling as a fallback while
// the socket is down. Either way the server's boss state is the only truth.

import { currentToken, getState, liveUrl } from "./api.js?v=b6664395f3";

const POLL_MS = 5000;
const MAX_BACKOFF_MS = 30000;

/**
 * @typedef {{
 *   onSnapshot: (s: {boss: any, feed: any[], online: number, server_time?: number, pinned?: any, rotating?: any, chat?: any[], web_version?: string | null}) => void,
 *   onUpdate: (u: {boss: any, events: any[], online: number}) => void,
 *   onOnline: (n: number) => void,
 *   onRefresh: (r: {boss: any, feed: any[], pinned?: any, rotating?: any, content_version?: string}) => void,
 *   onGift: (g: {box_id?: string, item_id?: string, scroll_id?: string, title?: string}) => void,
 *   onShards: (s: {amount: number}) => void,
 *   onUniqueGift: (g: {amount: number, name: string, item_id: string}) => void,
 *   onRefill: (r: {attacks: number}) => void,
 *   onThanks: () => void,
 *   onCaptcha: () => void,
 *   onAppeal: () => void,
 *   onCityReward: () => void,
 *   onScrollNotice: (s: {scroll_id: string, name: string, amount: number}) => void,
 *   onEventReward: (m: {ev: string, text: string}) => void,
 *   onNotice: (n: {text: string}) => void,
 *   onForgeTeaser: (t: {text: string}) => void,
 *   onDoubleDamage: (m: {on: boolean}) => void,
 *   onCutscene: (m: {name: string, seconds?: number}) => void,
 *   onChatMeow: (m: {on: boolean}) => void,
 *   onChat: (m: any) => void,
 *   onDm: (m: any) => void,
 *   onClans: () => void,
 *   onClanChat: (m: any) => void,
 *   onChatDelete: (d: {id?: number, all?: boolean}) => void,
 *   onAuction: () => void,
 *   onAuctionSold: (s: any) => void,
 *   onMode: (mode: "live"|"poll"|"down") => void,
 * }} LiveHandlers
 */

/** @param {LiveHandlers} h */
export function connectLive(h) {
  /** @type {WebSocket | null} */
  let ws = null;
  let backoff = 1000;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;

  const poll = async () => {
    try {
      const s = await getState();
      h.onSnapshot(s);
      if (!ws || ws.readyState !== WebSocket.OPEN) h.onMode("poll");
    } catch {
      h.onMode("down");
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const open = () => {
    try {
      ws = new WebSocket(liveUrl());
    } catch {
      startPolling();
      return;
    }
    ws.onopen = () => {
      backoff = 1000;
      stopPolling();
      h.onMode("live");
      identify();
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "snapshot") h.onSnapshot(msg);
      else if (msg.type === "update") h.onUpdate(msg);
      else if (msg.type === "heartbeat") h.onOnline(msg.online);
      else if (msg.type === "refresh") h.onRefresh(msg);
      else if (msg.type === "gift") h.onGift(msg);
      else if (msg.type === "shards") h.onShards(msg);
      else if (msg.type === "unique_gift") h.onUniqueGift(msg);
      else if (msg.type === "refill") h.onRefill(msg);
      else if (msg.type === "thanks") h.onThanks();
      else if (msg.type === "captcha") h.onCaptcha();
      else if (msg.type === "appeal") h.onAppeal();
      else if (msg.type === "event_reward") h.onEventReward(msg);
      else if (msg.type === "city_reward") h.onCityReward();
      else if (msg.type === "scroll_notice") h.onScrollNotice(msg);
      else if (msg.type === "notice") h.onNotice(msg);
      else if (msg.type === "forge_teaser") h.onForgeTeaser(msg);
      else if (msg.type === "double_damage") h.onDoubleDamage(msg);
      else if (msg.type === "cutscene") h.onCutscene(msg);
      else if (msg.type === "chat_meow") h.onChatMeow(msg);
      else if (msg.type === "chat") h.onChat(msg.message);
      else if (msg.type === "dm") h.onDm(msg.message);
      else if (msg.type === "clans") h.onClans();
      else if (msg.type === "clan_chat") h.onClanChat(msg.message);
      else if (msg.type === "chat_delete") h.onChatDelete(msg);
      else if (msg.type === "auction") h.onAuction();
      else if (msg.type === "auction_sold") h.onAuctionSold(msg);
    };
    ws.onclose = () => {
      ws = null;
      startPolling();
      h.onMode("poll");
      setTimeout(open, backoff);
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    };
    ws.onerror = () => ws?.close();
  };

  /** Tell the server which player this page is (so admin gifts reach us).
   * Safe to call again, e.g. right after a brand-new player is created. */
  const identify = () => {
    const token = currentToken();
    if (token && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "auth", token }));
  };

  poll();
  open();

  // Browsers throttle background tabs; resync the moment we're visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
  return { identify };
}
