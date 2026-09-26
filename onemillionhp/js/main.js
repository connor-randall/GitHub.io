// Boot + wiring. Server state flows in through api.js (our own actions)
// and live.js (everyone's actions); both land in store.js, and views
// re-render from there.

import * as api from "./api.js";
import { LOGO_STACK, LOGO_WIDE, autoFit, setArt } from "./ascii.js";
import { connectLive } from "./live.js";
import * as sound from "./sound.js";
import { applyBoss, emit, mergeFeed, on, state } from "./store.js";
import { hurt, renderBoss, startTaunts } from "./ui/boss.js";
import { initControls, renderControls, tickCountdown } from "./ui/controls.js";
import { renderFeed, tickAges } from "./ui/feed.js";
import { popup, shake } from "./ui/fx.js";
import { showError } from "./ui/errors.js";
import { currentTab, initTabs, renderPanels } from "./ui/tabs.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {"live"|"poll"|"down"} mode */
function setLink(mode) {
  const l = $("st-link");
  l.textContent = mode === "live" ? "LINK LIVE" : mode === "poll" ? "LINK POLL" : "LINK DOWN";
  l.className = "link-dot " + (mode === "live" ? "on" : mode === "poll" ? "poll" : "");
}

function setOnline(/** @type {number} */ n) {
  state.online = n;
  $("st-online").textContent = `${n} ONLINE`;
}

let lastReact = 0;
/** Small reactions to other players' attacks. Throttled so a busy boss
 * doesn't turn into a strobe light. @param {any[]} events */
function reactToOthers(events) {
  const t = performance.now();
  for (const e of events) {
    if (e.player_id && e.player_id === state.me?.id) continue;
    if (e.kind === "crit" || e.kind === "ultimate") {
      popup(`-${e.damage.toLocaleString("en-US")}`, "crit");
      hurt(300);
      if (e.kind === "ultimate") shake("s");
      lastReact = t;
    } else if (e.kind === "hit" && t - lastReact > 350) {
      popup(`-${e.damage}`, "small");
      hurt(160);
      lastReact = t;
    }
    if (e.kind === "spawn" || e.kind === "defeat") {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    }
  }
}

async function boot() {
  setArt($("boss-art"), ["", "", "", "   . . . summoning . . .", "", ""], 15);
  document.querySelectorAll(".logo-wide").forEach((n) => setArt(/** @type {HTMLElement} */ (n), LOGO_WIDE, 13));
  document.querySelectorAll(".logo-stack").forEach((n) => setArt(/** @type {HTMLElement} */ (n), LOGO_STACK, 13));
  const refit = autoFit();

  on("boss", () => {
    renderBoss();
    renderControls();
  });
  on("me", () => {
    renderControls();
    if (currentTab() === "player" || currentTab() === "bag") renderPanels();
  });
  on("feed", () => renderFeed());

  initControls();
  initTabs();

  const snd = $("snd");
  const paintSnd = () => {
    snd.textContent = sound.isOn() ? "[SND:ON]" : "[SND:OFF]";
    snd.setAttribute("aria-pressed", String(sound.isOn()));
  };
  paintSnd();
  snd.addEventListener("click", () => {
    sound.toggle();
    paintSnd();
  });

  try {
    state.content = await api.getContent();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    setTimeout(boot, 5000);
    return;
  }

  connectLive({
    onSnapshot: (s) => {
      if (s.server_time) state.serverSkew = s.server_time - Date.now() / 1000;
      if (applyBoss(s.boss)) emit("boss");
      const fresh = mergeFeed(s.feed ?? []);
      if (fresh.length) renderFeed();
      setOnline(s.online ?? 0);
    },
    onUpdate: (u) => {
      const fresh = mergeFeed(u.events);
      if (applyBoss(u.boss)) emit("boss");
      if (fresh.length) {
        renderFeed(new Set(fresh.map((e) => e.id)));
        reactToOthers(fresh);
      }
      setOnline(u.online ?? state.online);
    },
    onOnline: setOnline,
    // The admin changed something: take the server's word for everything,
    // even if it "goes backwards" (a reset lowers HP totals).
    onRefresh: (r) => {
      state.boss = null;
      state.feed = [];
      applyBoss(r.boss);
      mergeFeed(r.feed ?? []);
      emit("boss", "feed");
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
        renderPanels();
      }).catch(() => {});
    },
    onMode: setLink,
  });

  try {
    state.me = await api.ensurePlayer();
    emit("me");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
  startTaunts();
  refit();

  setInterval(tickCountdown, 1000);
  setInterval(tickAges, 10000);
  // Slow safety net: keep our own counters honest even if an event was missed.
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    api.getMe().then((m) => {
      state.me = m;
      emit("me");
    }).catch(() => {});
  }, 60000);
}

boot();
