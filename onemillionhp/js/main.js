// Boot + wiring. Server state flows in through api.js (our own actions)
// and live.js (everyone's actions); both land in store.js, and views
// re-render from there.

import { showSharedDesign } from "./ui/designshare.js?v=b6664395f3";
import * as api from "./api.js?v=b6664395f3";
import { updateAchievementBadge } from "./ui/achievements.js?v=b6664395f3";
import { acceptClaim, forwardToCanonical } from "./home.js?v=b6664395f3";
import { LOGO_STACK, LOGO_WIDE, autoFit, fmt, setArt } from "./ascii.js?v=b6664395f3";
import { connectLive } from "./live.js?v=b6664395f3";
import * as sound from "./sound.js?v=b6664395f3";
import { paintTitle, plainTitle, setFlashing } from "./title.js?v=b6664395f3";
import { applyBoss, bossDef, boxById, emit, itemById, mergeFeed, on, state } from "./store.js?v=b6664395f3";
import { captureRefLink, onMe as referralOnMe } from "./ui/referral.js?v=b6664395f3";
import { openAccount } from "./ui/save.js?v=b6664395f3";
import { openBox } from "./ui/bag.js?v=b6664395f3";
import { fxAutoLow, fxLow, revealAmbient, setFxLow, setMood, startAmbient, watchFrameRate } from "./ui/ambient.js?v=b6664395f3";
import { bossHealEffect, hurt, renderBoss, startTaunts, tickNextBoss } from "./ui/boss.js?v=b6664395f3";
import { maybeShowDeath, previewDeath } from "./ui/ceremony.js?v=b6664395f3";
import { initControls, renderControls, tickCountdown } from "./ui/controls.js?v=b6664395f3";
import { addFreshEvents, paintCrowns, renderFeed, resetFeedHistory, streamEvents, tickAges } from "./ui/feed.js?v=b6664395f3";
import { playForgeScene } from "./ui/forgescene.js?v=b6664395f3";
import { playCatFall } from "./ui/catfall.js?v=b6664395f3";
import { setFire } from "./ui/fire.js?v=b6664395f3";
import { showGearByName, showOnline } from "./ui/gear.js?v=b6664395f3";
import { animateInView } from "./ui/inview.js?v=b6664395f3";
import { boxDropReveal, busyOverlay, lootReveal, popup, setShake, shake, shakeOn, shardsReveal, stolenReveal } from "./ui/fx.js?v=b6664395f3";
import { scrollReveal } from "./ui/scrolls.js?v=b6664395f3";
import { relicSequence, relicToast } from "./ui/relic.js?v=b6664395f3";
import { showError } from "./ui/errors.js?v=b6664395f3";
import { showIntro, showSignupFull } from "./ui/nameform.js?v=b6664395f3";
import { setPinned, setRotating, showNotice } from "./ui/notice.js?v=b6664395f3";
import { loadHistory } from "./ui/history.js?v=b6664395f3";
import { forgetBadges, initBadges, loadBadgeDefs, loadClanDefs } from "./ui/badges.js?v=b6664395f3";
import { clanChatMessage, clansChanged } from "./ui/clan.js?v=b6664395f3";
import { dmMessage } from "./ui/dms.js?v=b6664395f3";
import { initBoxOdds, refreshOddsTip } from "./ui/boxodds.js?v=b6664395f3";
import { initPipsTip } from "./ui/pipstip.js?v=b6664395f3";
import { paintBan } from "./ui/appeal.js?v=b6664395f3";
import { maybeCaptcha } from "./ui/captcha.js?v=b6664395f3";
import { auctionChanged, auctionSold, redrawAuction } from "./ui/auction.js?v=b6664395f3";
import { checkCityRewards } from "./ui/city.js?v=b6664395f3";
import { OPEN_TOWN, chatDelete, chatMeow, chatMessage, chatMode, chatSnapshot, initChat } from "./ui/chat.js?v=b6664395f3";
import { initChatSwitch } from "./ui/chatswitch.js?v=b6664395f3";
import { initChatPop } from "./ui/chatpop.js?v=b6664395f3";
import { initDaily } from "./ui/daily.js?v=b6664395f3";
import { initTutorial } from "./ui/tutorial.js?v=b6664395f3";
import { loadPolls, showPoll } from "./ui/polls.js?v=b6664395f3";
import { showTicket } from "./ui/tickets.js?v=b6664395f3";
import { loadBossVotes } from "./ui/bossvote.js?v=b6664395f3";
import { loadRanks, redrawRanks, showBossRanks } from "./ui/ranks.js?v=b6664395f3";
import { currentTab, initTabs, openTab, refreshTab, renderPanels, setForgeOpen } from "./ui/tabs.js?v=b6664395f3";
import { initWorldEvents, onEventReward, renderWorldEvent } from "./ui/worldevent.js?v=b6664395f3";
import { initLimited } from "./ui/limited.js?v=b6664395f3";
import { renderLoadoutQuick } from "./ui/loadouts.js?v=b6664395f3";

/** This page's own build stamp (main.js?v=...), empty for an unbuilt dev copy. */
const MY_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "";

/** When the player last tapped or typed (performance.now()). */
let lastTouch = 0;
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, () => (lastTouch = performance.now()), { capture: true, passive: true });
}

/** A deploy changed the page: reload so everyone runs the new code. Waits
 * while someone is typing, watching a pop-up or still tapping (no reload in
 * the middle of an attack or an ultimate), and tries each new version only
 * once (no reload loops if a cache serves the old page).
 * @param {string | null | undefined} serverVersion */
function reloadIfOutdated(serverVersion) {
  if (!serverVersion || !MY_VERSION || serverVersion === MY_VERSION) return;
  try {
    if (sessionStorage.getItem("omhp.reloaded_for") === serverVersion) return;
  } catch {
    return;
  }
  const typing = () => {
    const a = document.activeElement;
    return (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) && a.value !== "";
  };
  const busy = () => busyOverlay() || typing() || performance.now() - lastTouch < 10000;
  const go = () => {
    if (busy()) {
      setTimeout(go, 3000);
      return;
    }
    try {
      sessionStorage.setItem("omhp.reloaded_for", serverVersion);
      sessionStorage.setItem(RELOAD_SCROLL_KEY, String(Math.round(window.scrollY))); // come back to the same spot
    } catch {
      /* ignore */
    }
    location.reload();
  };
  setTimeout(go, 500 + Math.random() * 4000); // don't have every tab hit the server at once
}

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const RELOAD_SCROLL_KEY = "omhp.reload_scroll";
/** After a deploy reload: back to where the page was scrolled, once it's tall
 * enough again (the panels fill in after load), instead of jumping to the top.
 * Scrolling or tapping yourself first cancels it. */
function restoreReloadScroll() {
  let y = 0;
  try {
    y = Number(sessionStorage.getItem(RELOAD_SCROLL_KEY)) || 0;
    sessionStorage.removeItem(RELOAD_SCROLL_KEY);
  } catch {
    return;
  }
  if (y <= 0) return;
  history.scrollRestoration = "manual";
  let cancelled = false;
  const cancel = () => (cancelled = true);
  for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) window.addEventListener(ev, cancel, { once: true, passive: true });
  const until = performance.now() + 10000; // right after a restart the panels can take a while
  const step = () => {
    if (cancelled) return;
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (room >= y || performance.now() > until) {
      window.scrollTo(0, Math.min(y, room));
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** @param {"live"|"poll"|"down"} mode */
function setLink(mode) {
  // Just a dot (it used to be LINK LIVE / POLL / DOWN, and the swaps moved the line):
  // green = live, orange = polling or down. The words are in the hover box.
  const l = $("st-link");
  const label = mode === "live" ? "link live: updates arrive instantly" : mode === "poll" ? "link polling: updates every few seconds" : "link down: reconnecting...";
  l.title = label;
  l.setAttribute("aria-label", label);
  l.className = "link-dot " + (mode === "live" ? "on" : "off");
}

function setOnline(/** @type {number} */ n) {
  state.online = n;
  $("st-online").textContent = `[${n} ONLINE]`;
}

let lastReact = 0;
/** Small reactions to other players' attacks. Throttled so a busy boss
 * doesn't turn into a strobe light. @param {any[]} events */
function reactToOthers(events) {
  const t = performance.now();
  // Other players' hits flinch the boss, but only your own ripple the background mist.
  // LOW effects: other players' hits don't animate anything (no number, no flinch).
  const quiet = fxLow();
  for (const e of events) {
    if (e.player_id && e.player_id === state.me?.id) continue; // your own forge plays from the FORGE tab
    if (e.kind === "loot" && e.rarity === "boss_unique") relicToast(e);
    if (e.kind === "forge") playForgeScene(e);
    if (e.kind === "scroll_use" && e.scroll_id === "boss_heal") {
      bossHealEffect(e.name ?? "SOMEONE", e.amount ?? 0, e.shards ?? 100);
    }
    if (quiet) {
      /* LOW effects: nothing to draw for someone else's hit */
    } else if (e.kind === "ultimate" || (e.kind === "crit" && t - lastReact > 200)) {
      // Crits pile up at the end of a fight (saved charges): at most 5 a second, or phones choke (ticket #178).
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
    if (e.kind === "scroll_use") {
      api.getMe().then((m) => { state.me = m; emit("me"); }).catch(() => {});
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
  restoreReloadScroll();
  if (forwardToCanonical("game")) return; // moving to the official address (curtain stays up)
  acceptClaim();
  captureRefLink(); // #ref=CODE from a friend's share link
  // A browser with no saved player is a first-time visitor: show the intro
  // mist right away, before anything else has loaded.
  // Admin previews (a boss's death, a relic drop): straight to the show.
  const previewing = /^#preview-(death|relic)/.test(location.hash);
  if (!api.currentToken() && !introShown && !previewing) {
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
    paintCrowns();
    renderControls();
    renderWorldEvent();
    setFire(Boolean(state.boss?.double_damage)); // the admin's 2X DAMAGE switch
    chatMeow(); // and MEOW MODE: the chat box's hint
    if (state.boss) {
      setMood(state.boss.phase, state.boss.status !== "alive", bossDef(state.boss.def_id)?.tint ?? null);
      maybeShowDeath(state.boss); // the scoreboard + "another boss is coming", once per boss
    }
  });
  on("me", () => {
    renderControls();
    renderWorldEvent();
    renderLoadoutQuick();
    const m = state.me;
    if (m) {
      const every = m.recharge_seconds >= 120 ? `${Math.round(m.recharge_seconds / 60)} minutes`
        : m.recharge_seconds === 60 ? "minute" : `${m.recharge_seconds} seconds`;
      $("rules-line").textContent =
        `every attack, on every terminal, hits the same boss. hold up to ${m.attacks_per_day} attacks; one recharges every ${every}.`;
    }
    updateAchievementBadge();
    if (["player", "inventory", "bag", "blacksmith", "collection", "shop", "achievements"].includes(currentTab())) renderPanels();
    if (currentTab() === "ranks") redrawRanks(); // highlight "you" once we know who that is
    if (currentTab() === "auction") redrawAuction(); // shards changed: BUY buttons; first load: draw at all
    maybeCaptcha(m);
    paintBan();
    referralOnMe(m);
  });
  on("feed", () => renderFeed());
  let feedDrawn = false;

  initControls();
  initWorldEvents();
  initLimited();
  initTabs();
  initBadges();
  initBoxOdds();
  initPipsTip();
  initDaily();
  initTutorial();
  initChat();
  // "ticket #12" / "poll #3" in chat (ticket #326).
  document.addEventListener(OPEN_TOWN, (e) => {
    const { tab, id } = /** @type {CustomEvent} */ (e).detail;
    if (tab === "polls") showPoll(id);
    else showTicket(id);
    openTab(tab);
  });
  initChatSwitch();
  initChatPop(refreshTab); // ticket #181: desktop chat pop-out
  startAmbient();

  // A designer's boss made it into the game: the admin's thank-you, shown
  // once (now if they're here, else the next time they visit).
  let thanking = false;
  on("me", () => {
    const amount = state.me?.thanks_pending ?? 0;
    if (thanking || amount <= 0) return;
    thanking = true;
    api.ackThanks().catch(() => {});
    sound.loot();
    shardsReveal(amount, "A GIFT FROM ***ADMIN***",
      `"THANK YOU! your boss made it into the game. +${amount.toLocaleString("en-US")} <> and the rainbow & badge are yours."`)
      .then(() => (thanking = false));
  });
  // Ticket #141: some of your tickets were accepted (100 <> each), shown once.
  let ticketThanks = false;
  on("me", () => {
    const amount = state.me?.ticket_thanks ?? 0;
    if (ticketThanks || amount <= 0) return;
    ticketThanks = true;
    api.ackThanks(true).catch(() => {});
    sound.loot();
    const n = Math.round(amount / 100);
    shardsReveal(amount, "A GIFT FROM ***ADMIN***",
      `"THANK YOU! ${n === 1 ? "your ticket was" : `${n} of your tickets were`} accepted. +${amount.toLocaleString("en-US")} <>"`)
      .then(() => (ticketThanks = false));
  });

  const acct = $("acct");
  const paintAcct = () => {
    const login = state.me?.login;
    acct.textContent = login ? `[${login}]` : "[LOG IN]";
    acct.title = login ? "your account: change password or switch account" : "create an account, or log in";
    acct.classList.toggle("on", Boolean(login));
  };
  paintAcct();
  on("me", paintAcct);
  acct.addEventListener("click", () => openAccount());

  // Your shards, always in sight (ticket #179: the toggles moved to GAME > SETTINGS).
  const paintShards = () => {
    const me = state.me;
    $("shards-wrap").hidden = !me;
    if (me) $("st-shards").textContent = `<> ${fmt(me.shards ?? 0)}`;
  };
  paintShards();
  on("me", paintShards);
  // Tickets #219 / #233: attacks in the tab title, and a chime the moment they're full.
  /** @type {number | null} */
  let lastLeft = null;
  on("me", () => {
    paintTitle();
    const me = state.me;
    if (!me?.name_chosen) return;
    const left = me.attacks_left ?? 0;
    const per = me.attacks_per_day ?? 5;
    if (lastLeft !== null && lastLeft < per && left >= per) {
      sound.attacksFull();
      fullAway(); // ticket #7 (2026-11-06): don't waste a full pool while looking away
    }
    lastLeft = left;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) stopFullAway();
  });
  // Ticket #232: on a narrow screen the status line can wrap to two rows and back as
  // its numbers change. Once it's been that tall it stays that tall (until the width
  // changes), so everything under it stops bobbing.
  const statusline = $("statusline");
  let lineWidth = window.innerWidth;
  new ResizeObserver(() => {
    if (statusline.offsetHeight > (parseFloat(statusline.style.minHeight) || 0)) {
      statusline.style.minHeight = `${statusline.offsetHeight}px`;
    }
  }).observe(statusline);
  window.addEventListener("resize", () => {
    if (window.innerWidth === lineWidth) return; // a phone's URL bar sliding: same width
    lineWidth = window.innerWidth;
    statusline.style.removeProperty("min-height");
  });
  $("st-shards").addEventListener("click", () => openTab("shop"));

  $("st-online").addEventListener("click", () => showOnline());
  // Ticket #115: the fight's leaderboard without going through the menus.
  $("boss-ranks").addEventListener("click", () => {
    if (state.boss) showBossRanks(state.boss.seq);
    openTab("ranks");
  });
  animateInView($("feed"), $("chat-list"));
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

  const shakeBtn = $("shake-btn");
  const paintShake = () => {
    shakeBtn.textContent = shakeOn() ? "[SHAKE:ON]" : "[SHAKE:OFF]";
    shakeBtn.setAttribute("aria-pressed", String(shakeOn()));
  };
  paintShake();
  shakeBtn.addEventListener("click", () => {
    setShake(!shakeOn());
    paintShake();
  });

  const fullBtn = $("full-alert");
  const paintFull = () => {
    fullBtn.textContent = sound.fullAlertOn() ? "[FULL ALERT:ON]" : "[FULL ALERT:OFF]";
    fullBtn.setAttribute("aria-pressed", String(sound.fullAlertOn()));
  };
  paintFull();
  fullBtn.addEventListener("click", () => {
    if (sound.toggleFullAlert() && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    paintFull();
  });

  const fxBtn = $("fx");
  const paintFx = () => {
    fxBtn.textContent = fxLow() ? (fxAutoLow() ? "[FX:LOW*]" : "[FX:LOW]") : "[FX:FULL]";
    fxBtn.setAttribute("aria-pressed", String(fxLow()));
    fxBtn.title = fxAutoLow()
      ? "effects turned LOW automatically: this computer was struggling. click for FULL."
      : "effects: LOW keeps the background still and stops the glows (for slower computers)";
  };
  fxBtn.addEventListener("click", () => {
    setFxLow(!fxLow());
    paintFx();
  });
  watchFrameRate(paintFx);
  paintFx();

  // Retry only the fetch: everything above is wired once. (Re-running boot()
  // wired every button twice, so one failed load during a deploy made each
  // ATTACK click send two attacks.)
  for (;;) {
    try {
      state.content = await api.getContent();
      setForgeOpen(Boolean(state.content.forge_open));
      break;
    } catch (e) {
      dropCurtain();
      showError(/** @type {Error} */ (e).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  const live = connectLive({
    onSnapshot: (s) => {
      if (s.server_time) state.serverSkew = s.server_time - Date.now() / 1000;
      reloadIfOutdated(s.web_version);
      if ("pinned" in s) setPinned(s.pinned);
      if ("rotating" in s) setRotating(s.rotating);
      chatSnapshot(s.chat);
      if (applyBoss(s.boss)) emit("boss");
      const fresh = mergeFeed(s.feed ?? []);
      if (!feedDrawn) {
        feedDrawn = true;
        renderFeed();
      } else addFreshEvents(fresh);
      setOnline(s.online ?? 0);
    },
    onUpdate: (u) => {
      if (applyBoss(u.boss)) emit("boss");
      // Lines stream in at a steady pace (bursts don't land in one lump); the
      // boss reacts to each as it appears.
      streamEvents(u.events ?? [], reactToOthers);
      setOnline(u.online ?? state.online);
    },
    onOnline: setOnline,
    // The admin gifted everyone online a loot box: pop it up right here.
    // Ticket #186: someone found a BOSS UNIQUE and everyone online got a few shards.
    // Quiet on purpose: a notice, no pop-up.
    onUniqueGift: (g) => {
      if (state.me) {
        state.me = { ...state.me, shards: (state.me.shards ?? 0) + g.amount };
        emit("me");
      }
      showNotice(`+${g.amount} SHARDS :: ${g.name} found ${itemById(g.item_id)?.name ?? "a BOSS UNIQUE"}!`, false);
    },
    onShards: (s) => {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
      sound.loot();
      shardsReveal(s.amount);
    },
    // The admin's SPAM PARTY tops everyone up every 2 s: set the count here
    // instead of every open page refetching its player each time.
    onRefill: (r) => {
      const me = state.me;
      if (!me || (me.attacks_left ?? 0) >= r.attacks) return;
      state.me = { ...me, attacks_left: r.attacks, next_attack_at: null };
      emit("me");
    },
    onThanks: () => {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    },
    // A city building went up and this player gave to it: their reward pop-up.
    onCityReward: () => checkCityRewards(),
    // The admin answered this player's ban appeal: the banner shows it (or goes, if accepted).
    onAppeal: () => {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    },
    // The bot scan pushed this player a captcha: fetch it (maybeCaptcha shows it).
    onCaptcha: () => {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
    },
    onEventReward,
    onScrollNotice: (s) => {
      api.getMe().then((m) => { state.me = m; emit("me"); }).catch(() => {});
      sound.loot();
      stolenReveal(s.name, s.amount);
    },
    onGift: (g) => {
      const box = g.box_id ? boxById(g.box_id) : null;
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
      const title = g.title ?? "A GIFT FROM ***ADMIN***";
      const item = g.item_id ? itemById(g.item_id) : null;
      if (box) boxDropReveal(box, () => openBox(box), title);
      else if (item) {
        const show = item.rarity === "boss_unique" ? relicSequence(item) : Promise.resolve();
        show.then(() => lootReveal(item, async (id) => {
          try {
            state.me = await api.equip(id);
            emit("me");
          } catch (e) {
            showError(/** @type {Error} */ (e).message);
          }
        }, title));
      } else if (g.scroll_id) scrollReveal(g.scroll_id, true, title);
    },
    // The admin changed something: take the server's word for everything,
    // even if it "goes backwards" (a reset lowers HP totals).
    onNotice: (n) => showNotice(n.text),
    // The admin's forge teaser: the smith scene with their line.
    onForgeTeaser: (t) => playForgeScene({ item_id: "", text: t.text }),
    // The admin flipped MEOW MODE: the chat box says so right away.
    onChatMeow: (m) => {
      if (state.boss) state.boss.chat_meow = m.on;
      chatMeow();
    },
    // The admin's [ CUTSCENES ] tab: play one on this page.
    onCutscene: (m) => {
      if (m.name === "catfall") playCatFall(Number(m.seconds) || 600);
    },
    // The admin flipped 2X DAMAGE: light (or put out) the fire right away.
    onDoubleDamage: (m) => {
      if (state.boss) state.boss.double_damage = m.on;
      setFire(m.on);
    },
    onChat: chatMessage,
    onDm: dmMessage,
    onClanChat: clanChatMessage,
    onClans: () => {
      forgetBadges(); // hover boxes say who leads / how many members
      // Spread out: every open page gets this at once. (Whoever made the change
      // already reloaded theirs, clan.js act().)
      setTimeout(() => {
        loadClanDefs(true);
        clansChanged();
      }, Math.random() * 3000);
    },
    onChatDelete: chatDelete,
    onAuction: auctionChanged,
    onAuctionSold: (s) => {
      api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {});
      auctionSold(s);
    },
    onRefresh: (r) => {
      setPinned(r.pinned);
      setRotating(r.rotating);
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
      // A new or deleted poll / badge: refetch (spread out, so every open page doesn't ask at once).
      setTimeout(() => {
        loadPolls(true);
        loadBadgeDefs(true);
        loadClanDefs(true);
        clansChanged(); // e.g. the admin broke a clan up: its chat goes from open [ CLAN ] tabs
      }, Math.random() * 3000);
      // New odds: refetch drop rates and chest contents, then redraw the
      // shop / bag (and an odds box that's open right now).
      const forgeFlipped = "forge_open" in r && Boolean(r.forge_open) !== Boolean(state.content?.forge_open);
      if ((r.content_version && r.content_version !== state.content?.version) || forgeFlipped) {
        setTimeout(() => {
          api.getContent().then((c) => {
            state.content = c;
            setForgeOpen(Boolean(c.forge_open));
            renderPanels();
            refreshOddsTip();
          }).catch(() => {});
        }, Math.random() * 3000);
      }
    },
    onMode: (m) => {
      setLink(m);
      chatMode(m);
    },
  });

  try {
    // A blip (a deploy restarting the server, a 502) must not make a returning
    // player look logged out: retry a few times before giving up.
    for (let tries = 0; ; tries++) {
      try {
        state.me = await api.ensurePlayer();
        break;
      } catch (e) {
        const err = /** @type {any} */ (e);
        if (tries >= 5 || !(err.code === "NETWORK" || err.status >= 500)) throw e;
        showError("reconnecting...");
        await new Promise((r) => setTimeout(r, 2000 * (tries + 1)));
      }
    }
    emit("me");
    loadPolls(true); // for the [ POLLS n ] badge
    loadBossVotes(true); // and [ VOTE ON BOSSES ]'s
    checkCityRewards(); // a building finished while they were away
    live.identify(); // a brand-new player's token exists only now
    maybeShowDeath(state.boss); // came back after a boss died: show what happened
    // Named players go straight in; first-timers get the intro (naming
    // waits until their first attack).
    if (state.me?.name_chosen || previewing) revealAmbient();
    else if (!introShown) {
      introShown = true;
      showIntro();
    }
    dropCurtain(introShown);
    prefetchPanels();
    // A shared player link, #p=NAME (ticket #67): their gear card and loadouts.
    const openShared = () => {
      const design = location.hash.match(/^#design=([a-f0-9]+)$/); // a shared boss design (ticket #237)
      if (design) {
        history.replaceState(null, "", location.pathname + location.search);
        showSharedDesign(design[1]);
        return;
      }
      const shared = location.hash.match(/^#p=(.+)$/);
      if (!shared) return;
      history.replaceState(null, "", location.pathname + location.search);
      showGearByName(decodeURIComponent(shared[1]));
    };
    setTimeout(openShared, 600);
    window.addEventListener("hashchange", openShared);
    // Admin panel's [ PREVIEW DEATH ]: play a boss's death on this screen only.
    const preview = location.hash.match(/^#preview-death(?:=([a-z0-9_]+))?$/);
    if (preview) {
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => previewDeath(preview[1] ?? state.boss?.def_id ?? ""), 600);
    }
    // #preview-catfall[=SECONDS]: THE CAT WILL FALL, on this screen only
    // (2x damage counts down SECONDS once the words land; 600 = 10 min when left out).
    const catfall = location.hash.match(/^#preview-catfall(?:=(\d+))?$/);
    if (catfall) {
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(() => playCatFall(Number(catfall[1] ?? 600)), 600);
    }
    // Admin panel's relic [ PREVIEW ]: the drop sequence and card on this
    // screen only. Nothing is given; EQUIP just closes it.
    const relicPreview = location.hash.match(/^#preview-relic=([a-z0-9_]+)$/);
    const relic = relicPreview ? itemById(relicPreview[1]) : null;
    if (relic) {
      history.replaceState(null, "", location.pathname + location.search);
      setTimeout(async () => {
        await relicSequence(relic);
        await lootReveal(relic, async () => {}, "PREVIEW :: NOTHING GIVEN");
        relicToast({ item_id: relic.id, name: "SOMEONE" }); // what everyone else sees
      }, 600);
    }
  } catch (e) {
    dropCurtain();
    // The network's new accounts for today are used up (Game.register_player's
    // cap): say so properly, with a way to log in, instead of a page that can't play.
    if (/** @type {any} */ (e).code === "TOO_MANY_PLAYERS") showSignupFull();
    else if (/** @type {any} */ (e).code === "CLOUD_BLOCKED") showSignupFull(true);
    else showError(/** @type {Error} */ (e).message);
  }
  startTaunts();
  refit();

  setInterval(() => { tickCountdown(); renderControls(); renderBoss(); }, 1000);
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

// 2026-11-06 (players kept losing time with a full pool while the tab was in the
// background): a hidden tab flashes "(!) ATTACKS FULL" in its title until you
// come back, and with [FULL ALERT] on a desktop notification goes out too.
let fullTimer = 0;
function fullAway() {
  if (!document.hidden) return;
  clearInterval(fullTimer);
  setFlashing(true);
  let on = false;
  fullTimer = window.setInterval(() => {
    on = !on;
    document.title = on ? "(!) ATTACKS FULL" : plainTitle();
  }, 1000);
  if (sound.fullAlertOn() && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("ONE MILLION HP", { body: "Your attacks are full.", tag: "omhp-full", silent: true });
    } catch {
      /* some phones only allow notifications from a service worker */
    }
  }
}
function stopFullAway() {
  if (!fullTimer) return;
  clearInterval(fullTimer);
  fullTimer = 0;
  setFlashing(false);
}
