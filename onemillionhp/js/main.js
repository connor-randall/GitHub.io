// Boot + wiring. Server state flows in through api.js (our own actions)
// and live.js (everyone's actions); both land in store.js, and views
// re-render from there.

import * as api from "./api.js?v=7763333b59";
import { acceptClaim, forwardToCanonical } from "./home.js?v=7763333b59";
import { LOGO_STACK, LOGO_WIDE, autoFit, setArt } from "./ascii.js?v=7763333b59";
import { connectLive } from "./live.js?v=7763333b59";
import * as sound from "./sound.js?v=7763333b59";
import { applyBoss, bossDef, boxById, emit, mergeFeed, on, state } from "./store.js?v=7763333b59";
import { openBox } from "./ui/bag.js?v=7763333b59";
import { pulse, revealAmbient, setMood, startAmbient } from "./ui/ambient.js?v=7763333b59";
import { hurt, renderBoss, startTaunts, tickNextBoss } from "./ui/boss.js?v=7763333b59";
import { maybeShowDeath } from "./ui/ceremony.js?v=7763333b59";
import { initControls, renderControls, tickCountdown } from "./ui/controls.js?v=7763333b59";
import { addFreshEvents, renderFeed, resetFeedHistory, tickAges } from "./ui/feed.js?v=7763333b59";
import { boxDropReveal, popup, shake } from "./ui/fx.js?v=7763333b59";
import { showError } from "./ui/errors.js?v=7763333b59";
import { showIntro } from "./ui/nameform.js?v=7763333b59";
import { setPinned, showNotice } from "./ui/notice.js?v=7763333b59";
import { loadHistory } from "./ui/history.js?v=7763333b59";
import { loadRanks, redrawRanks } from "./ui/ranks.js?v=7763333b59";
import { currentTab, initTabs, renderPanels } from "./ui/tabs.js?v=7763333b59";

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
      pulse(e.kind === "ultimate" ? 1.1 : 0.7);
      if (e.kind === "ultimate") shake("s");
      lastReact = t;
    } else if (e.kind === "hit" && t - lastReact > 350) {
      popup(`-${e.damage}`, "small");
      hurt(160);
      pulse(0.25);
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

/** Lift the dark cover. @param {boolean} [instant] */
function dropCurtain(instant = false) {
  const c = document.getElementById("curtain");
  if (!c) return;
  if (instant) c.remove();
  else {
    c.classList.add("gone");
    setTimeout(() => c.remove(), 800);
  }
}

let introShown = false;

/** Load RANKS and HISTORY in the background so opening them is instant. */
function prefetchPanels() {
  loadRanks(true).catch(() => {});
  loadHistory().catch(() => {});
}

async function boot() {
  if (forwardToCanonical("game")) return; // moving to the official address (curtain stays up)
  acceptClaim();
  // A browser with no saved player is a first-time visitor: show the intro
  // mist right away, before anything else has loaded.
  if (!api.currentToken() && !introShown) {
    introShown = true;
    showIntro(true);
    dropCurtain(true);
  }
  setArt($("boss-art"), ["", "", "", "   . . . summoning . . .", "", ""], 15);
  document.querySelectorAll(".logo-wide").forEach((n) => setArt(/** @type {HTMLElement} */ (n), LOGO_WIDE, 11));
  document.querySelectorAll(".logo-stack").forEach((n) => setArt(/** @type {HTMLElement} */ (n), LOGO_STACK, 11));
  const refit = autoFit();

  on("boss", () => {
    renderBoss();
    renderControls();
    if (state.boss) {
      setMood(state.boss.phase, state.boss.status !== "alive", bossDef(state.boss.def_id)?.tint ?? null);
      maybeShowDeath(state.boss); // the scoreboard + "another boss is coming", once per boss
    }
  });
  on("me", () => {
    renderControls();
    const m = state.me;
    if (m) {
      const every = m.recharge_seconds >= 120 ? `${Math.round(m.recharge_seconds / 60)} minutes`
        : m.recharge_seconds === 60 ? "minute" : `${m.recharge_seconds} seconds`;
      $("rules-line").textContent =
        `every attack, on every terminal, hits the same boss. hold up to ${m.attacks_per_day} attacks; one recharges every ${every}.`;
    }
    if (["player", "bag", "shop"].includes(currentTab())) renderPanels();
    if (currentTab() === "ranks") redrawRanks(); // highlight "you" once we know who that is
  });
  on("feed", () => renderFeed());
  let feedDrawn = false;

  initControls();
  initTabs();
  startAmbient();

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
    dropCurtain();
    showError(/** @type {Error} */ (e).message);
    setTimeout(boot, 5000);
    return;
  }

  const live = connectLive({
    onSnapshot: (s) => {
      if (s.server_time) state.serverSkew = s.server_time - Date.now() / 1000;
      if ("pinned" in s) setPinned(s.pinned);
      if (applyBoss(s.boss)) emit("boss");
      const fresh = mergeFeed(s.feed ?? []);
      if (!feedDrawn) {
        feedDrawn = true;
        renderFeed();
      } else addFreshEvents(fresh);
      setOnline(s.online ?? 0);
    },
    onUpdate: (u) => {
      const fresh = mergeFeed(u.events);
      if (applyBoss(u.boss)) emit("boss");
      if (fresh.length) {
        addFreshEvents(fresh);
        reactToOthers(fresh);
      }
      setOnline(u.online ?? state.online);
    },
    onOnline: setOnline,
    // The admin gifted everyone online a loot box: pop it up right here.
    onGift: (g) => {
      const box = boxById(g.box_id);
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
      if (box) boxDropReveal(box, () => openBox(box), "A GIFT FROM ***ADMIN***");
    },
    // The admin changed something: take the server's word for everything,
    // even if it "goes backwards" (a reset lowers HP totals).
    onNotice: (n) => showNotice(n.text),
    onRefresh: (r) => {
      setPinned(r.pinned);
      state.boss = null;
      state.feed = [];
      applyBoss(r.boss);
      mergeFeed(r.feed ?? []);
      emit("boss");
      resetFeedHistory();
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
    live.identify(); // a brand-new player's token exists only now
    maybeShowDeath(state.boss); // came back after a boss died: show what happened
    // Named players go straight in; first-timers get the intro (naming
    // waits until their first attack).
    if (state.me?.name_chosen) revealAmbient();
    else if (!introShown) {
      introShown = true;
      showIntro();
    }
    dropCurtain(introShown);
    prefetchPanels();
  } catch (e) {
    dropCurtain();
    showError(/** @type {Error} */ (e).message);
  }
  startTaunts();
  refit();

  setInterval(tickCountdown, 1000);
  setInterval(tickNextBoss, 1000);
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
