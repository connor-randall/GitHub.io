// Tab bar for the side panels, all in category menus (FEED: attacks / chat /
// both, WORLD: city / the forge / shop / auction house (ticket #152), YOU / LEADERBOARD / GAME). A category is highlighted
// while one of its tabs is open, and shows a count when its tabs want
// attention ("[ GAME [1] ]": a poll to vote on; achievements to claim).

import { closeOverlay } from "./fx.js?v=b6664395f3";
import { loadAchievements } from "./achievements.js?v=b6664395f3";
import { loadStats } from "./stats.js?v=b6664395f3";
import { loadPrestige } from "./prestige.js?v=b6664395f3";
import { loadClan } from "./clan.js?v=b6664395f3";
import { loadClanRanks } from "./clanranks.js?v=b6664395f3";
import { loadHof } from "./hof.js?v=b6664395f3";
import { loadDms } from "./dms.js?v=b6664395f3";
import { renderChangelog } from "./changelog.js?v=b6664395f3";
import { renderRarities } from "./rarities.js?v=b6664395f3";
import { loadAuction } from "./auction.js?v=b6664395f3";
import { leaveBlacksmith, loadBlacksmith } from "./blacksmith.js?v=b6664395f3";
import { bagOpened, renderBag, renderCollection } from "./bag.js?v=b6664395f3";
import { chatOpened } from "./chat.js?v=b6664395f3";
import { loadCity } from "./city.js?v=b6664395f3";
import { renderDesigner } from "./designer.js?v=b6664395f3";
import { loadForge } from "./forge.js?v=b6664395f3";
import { loadHistory } from "./history.js?v=b6664395f3";
import { renderInventory, renderPlayer } from "./player.js?v=b6664395f3";
import { loadPolls } from "./polls.js?v=b6664395f3";
import { loadBossVotes } from "./bossvote.js?v=b6664395f3";
import { loadRanks } from "./ranks.js?v=b6664395f3";
import { leaveShop, renderShop } from "./shop.js?v=b6664395f3";
import { loadTickets } from "./tickets.js?v=b6664395f3";
import { loadBounty } from "./bounty.js?v=b6664395f3";
import { tabOpen } from "./tutorial.js?v=b6664395f3";
import { on } from "../store.js?v=b6664395f3";
import { chatPopped } from "./chatpop.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const TABS = ["feed", "chat", "city", "player", "inventory", "bag", "blacksmith", "collection", "shop", "forge", "auction", "ranks", "history", "polls", "tickets", "designer", "bossvote", "achievements", "stats", "prestige", "clan", "clanranks", "hof", "dms", "changelog", "rarities", "settings", "bounty"];
let activeTab = "feed";

const groups = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#tabs .tab-group")]);
const catOf = (/** @type {HTMLElement} */ g) => /** @type {HTMLButtonElement} */ (g.querySelector(".tab-cat"));
const menuOf = (/** @type {HTMLElement} */ g) => /** @type {HTMLElement} */ (g.querySelector(".tab-menu"));
/** Sub-menus inside a menu (GAME > COMMUNITY / HELP): a heading that opens its own list. */
const subs = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#tabs .tab-sub")]);
const subcatOf = (/** @type {HTMLElement} */ s) => /** @type {HTMLButtonElement} */ (s.querySelector(".tab-subcat"));
const submenuOf = (/** @type {HTMLElement} */ s) => /** @type {HTMLElement} */ (s.querySelector(".tab-submenu"));

/** Open one sub-menu (null: none), closing the others in its menu. @param {HTMLElement | null} sub */
function openSub(sub) {
  for (const s of subs()) {
    if (sub && s.parentElement !== sub.parentElement) continue;
    const open = s === sub;
    submenuOf(s).hidden = !open;
    subcatOf(s).setAttribute("aria-expanded", String(open));
  }
  paintGroups();
}

/** @param {HTMLElement | null} [except] */
function closeMenus(except = null) {
  for (const g of groups()) {
    if (g === except) continue;
    menuOf(g).hidden = true;
    catOf(g).setAttribute("aria-expanded", "false");
  }
}

/** A tab label without its brackets: "[ BAG ]" -> "BAG". @param {Element} b */
const bare = (b) => (b.textContent ?? "").replace(/^\[\s*|\s*\]$/g, "");

/** Category labels: which tab is open inside, and whether anything inside wants attention. */
function paintGroups() {
  for (const g of groups()) {
    const cat = catOf(g);
    const tabs = [...g.querySelectorAll("[role=tab]:not([hidden])")];
    const open = tabs.find((b) => b.getAttribute("aria-selected") === "true");
    // A badge inside: polls mark .has-new, achievements put a count in the label.
    // How many things inside want attention: the counts in their labels
    // ("[ POLLS 2 ]", "[ ACHIEVEMENTS 3 ]").
    // A badge without a number (new chat messages) just says [!].
    const count = tabs.reduce((n, b) => {
      const m = (b.textContent ?? "").match(/(\d+)\s*\]$/);
      return n + (m ? Number(m[1]) : 0);
    }, 0);
    const bang = tabs.some((b) => b.classList.contains("has-new") && !/\d+\s*\]$/.test(b.textContent ?? ""));
    const waiting = count > 0 || bang;
    const mark = count > 0 ? String(count) : "!";
    // Tight: the bar must fit one row, even with FEED's "!" and YOU's count both up (ticket #275).
    const text = `[${cat.dataset.label}${waiting ? ` ${mark}` : ""}\u25BE]`;
    if (cat.textContent !== text) cat.textContent = text;
    cat.classList.toggle("active", Boolean(open));
    cat.title = open ? `${cat.dataset.label}: ${bare(open)}` : `${cat.dataset.label}: ${tabs.map(bare).join(", ")}`;
    cat.classList.toggle("has-new", waiting);
  }
  // Sub-menu headings the same way: "COMMUNITY 2 ▸" when POLLS has a vote waiting.
  for (const s of subs()) {
    const head = subcatOf(s);
    const tabs = [...s.querySelectorAll("[role=tab]:not([hidden])")];
    const count = tabs.reduce((n, b) => n + Number((b.textContent ?? "").match(/(\d+)\s*\]$/)?.[1] ?? 0), 0);
    const bang = tabs.some((b) => b.classList.contains("has-new"));
    const text = `${head.dataset.label}${count ? ` ${count}` : bang ? " !" : ""} ${submenuOf(s).hidden ? "\u25B8" : "\u25BE"}`;
    if (head.textContent !== text) head.textContent = text;
    head.classList.toggle("active", tabs.some((b) => b.getAttribute("aria-selected") === "true"));
    head.classList.toggle("has-new", count > 0 || bang);
  }
}

/** @param {string} tab */
function selectTab(tab) {
  // A tab the tutorial hasn't opened yet (or the closed FORGE): the feed instead.
  const btn = /** @type {HTMLElement | null} */ (document.querySelector(`#tabs [data-tab="${tab}"]`));
  if (btn?.hidden) tab = "feed";
  // Ticket #181: a popped-out chat is already on screen; [ CHAT ] just puts you in it.
  if (chatPopped() && (tab === "chat" || tab === "both")) {
    if (tab === "chat") document.getElementById("chat-input")?.focus();
    tab = activeTab && activeTab !== "chat" && activeTab !== "both" ? activeTab : "feed";
  }
  if (activeTab === "blacksmith" && tab !== "blacksmith") leaveBlacksmith(); // no timers left behind
  if (activeTab === "shop" && tab !== "shop") leaveShop();
  activeTab = tab;
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === tab));
  });
  // "both" (FEED + CHAT) is a view, not a panel: the feed on top, the chat under it.
  const shown = tab === "both" ? ["feed", "chat"] : [tab];
  for (const name of TABS) $(`panel-${name}`).hidden = !shown.includes(name) && !(name === "chat" && chatPopped());
  $("panel-feed").parentElement?.classList.toggle("feed-chat", tab === "both");
  if (tab === "bag" || tab === "collection") bagOpened();
  closeMenus();
  paintGroups();
  try {
    localStorage.setItem("omhp.tab", tab);
  } catch {
    /* ignore */
  }
  renderPanels();
}

export const currentTab = () => activeTab;
/** Show the current tab again (after the chat popped in or out, ticket #181). */
export const refreshTab = () => selectTab(activeTab || "feed");

/** Open a panel from elsewhere (the shards in the top bar, the boss's [ LEADERBOARD ]),
 * scrolled into view on phones where the panels sit under the boss. @param {string} tab */
export function openTab(tab) {
  selectTab(tab);
  $("tabs").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

let forgeLit = true;

/** THE FORGE stays hidden (and can't be opened) until the server says it's open. @param {boolean} open */
export function setForgeOpen(open) {
  forgeLit = open;
  paintHidden();
}

/** Which tabs show: the tutorial's unlocked ones (tutorial.js), minus a closed
 * FORGE. A menu with nothing left in it (no tabs, no links) hides too. */
function paintHidden() {
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => {
    const tab = /** @type {HTMLElement} */ (b).dataset.tab ?? "";
    /** @type {HTMLElement} */ (b).hidden = !tabOpen(tab) || (tab === "forge" && !forgeLit);
  });
  for (const s of subs()) {
    s.hidden = ![...submenuOf(s).querySelectorAll("[role=tab], .tab-link")].some((x) => !(/** @type {HTMLElement} */ (x).hidden));
  }
  for (const g of groups()) {
    g.hidden = ![...g.querySelectorAll("[role=tab], .tab-link")].some((x) => !(/** @type {HTMLElement} */ (x).hidden));
  }
  // Shortcuts to a tab the tutorial hasn't opened yet would do nothing: hide them too.
  $("boss-ranks").hidden = !tabOpen("ranks");
  const active = /** @type {HTMLElement | null} */ (document.querySelector(`#tabs [data-tab="${activeTab}"]`));
  if (active?.hidden) selectTab("feed");
  paintGroups();
}
on("me", paintHidden);

export function renderPanels() {
  if (activeTab === "forge" && document.querySelector('#tabs [data-tab="forge"]')?.hasAttribute("hidden")) return;
  if (activeTab === "player") renderPlayer();
  else if (activeTab === "inventory") renderInventory();
  else if (activeTab === "bag") renderBag();
  else if (activeTab === "blacksmith") loadBlacksmith();
  else if (activeTab === "collection") renderCollection();
  else if (activeTab === "shop") renderShop();
  else if (activeTab === "auction") loadAuction();
  else if (activeTab === "forge") loadForge();
  else if (activeTab === "ranks") loadRanks();
  else if (activeTab === "history") loadHistory();
  else if (activeTab === "polls") loadPolls();
  else if (activeTab === "bossvote") loadBossVotes();
  else if (activeTab === "tickets") loadTickets();
  else if (activeTab === "city") loadCity();
  else if (activeTab === "chat" || activeTab === "both") chatOpened();
  else if (activeTab === "designer") renderDesigner();
  else if (activeTab === "achievements") loadAchievements();
  else if (activeTab === "stats") loadStats();
  else if (activeTab === "prestige") loadPrestige();
  else if (activeTab === "clan") loadClan();
  else if (activeTab === "clanranks") loadClanRanks();
  else if (activeTab === "hof") loadHof();
  else if (activeTab === "dms") loadDms();
  else if (activeTab === "changelog") renderChangelog();
  else if (activeTab === "rarities") renderRarities();
  else if (activeTab === "bounty") loadBounty();
}

export function initTabs() {
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => {
    b.addEventListener("click", () => selectTab(/** @type {HTMLElement} */ (b).dataset.tab ?? "feed"));
  });
  for (const g of groups()) {
    catOf(g).addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = menuOf(g).hidden;
      closeMenus(g);
      menuOf(g).hidden = !opening;
      catOf(g).setAttribute("aria-expanded", String(opening));
      // Its sub-menus start shut, except the one holding the open tab.
      if (opening) {
        for (const s of g.querySelectorAll(".tab-sub")) {
          const here = Boolean(s.querySelector('[role=tab][aria-selected="true"]'));
          submenuOf(/** @type {HTMLElement} */ (s)).hidden = !here;
          subcatOf(/** @type {HTMLElement} */ (s)).setAttribute("aria-expanded", String(here));
        }
        paintGroups();
      }
      if (opening) /** @type {HTMLElement | null} */ (menuOf(g).querySelector("[role=tab]"))?.focus({ preventScroll: true });
    });
  }
  for (const s of subs()) {
    subcatOf(s).addEventListener("click", (e) => {
      e.stopPropagation(); // the menu stays open
      openSub(submenuOf(s).hidden ? s : null);
    });
  }
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Node) || !$("tabs").contains(e.target)) closeMenus();
  });
  // Links to other sites (WIKI) open a new tab: close the menu behind them.
  document.querySelectorAll("#tabs .tab-link").forEach((a) => a.addEventListener("click", () => closeMenus()));
  // Badges change inside the menus (poll counts, achievements): keep the category labels in step.
  new MutationObserver(() => paintGroups()).observe($("tabs"), {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"],
  });
  let saved = "feed";
  try {
    saved = localStorage.getItem("omhp.tab") ?? "feed";
  } catch {
    /* ignore */
  }
  // A hidden tab (THE FORGE before it opens) is never restored.
  const hidden = /** @type {HTMLElement | null} */ (document.querySelector(`#tabs [data-tab="${saved}"]`))?.hidden;
  selectTab((TABS.includes(saved) || saved === "both") && !hidden ? saved : "feed");
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenus();
    closeOverlay();
  });
}
