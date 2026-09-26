// Live connection: WebSocket push, with short polling as a fallback while
// the socket is down. Either way the server's boss state is the only truth.

import { getState, liveUrl } from "./api.js";

const POLL_MS = 5000;
const MAX_BACKOFF_MS = 30000;

/**
 * @typedef {{
 *   onSnapshot: (s: {boss: any, feed: any[], online: number, server_time?: number}) => void,
 *   onUpdate: (u: {boss: any, events: any[], online: number}) => void,
 *   onOnline: (n: number) => void,
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

  poll();
  open();

  // Browsers throttle background tabs; resync the moment we're visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
}
