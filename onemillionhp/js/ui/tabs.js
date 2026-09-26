// Tab bar for the side panels.

import { closeOverlay } from "./fx.js";
import { renderBag } from "./bag.js";
import { loadHistory } from "./history.js";
import { renderPlayer } from "./player.js";
import { loadRanks } from "./ranks.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const TABS = ["feed", "player", "bag", "ranks", "history"];
let activeTab = "feed";

/** @param {string} tab */
function selectTab(tab) {
  activeTab = tab;
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.tab === tab));
  });
  for (const name of TABS) $(`panel-${name}`).hidden = name !== tab;
  try {
    localStorage.setItem("omhp.tab", tab);
  } catch {
    /* ignore */
  }
  renderPanels();
}

export const currentTab = () => activeTab;

export function renderPanels() {
  if (activeTab === "player") renderPlayer();
  else if (activeTab === "bag") renderBag();
  else if (activeTab === "ranks") loadRanks();
  else if (activeTab === "history") loadHistory();
}

export function initTabs() {
  document.querySelectorAll("#tabs [role=tab]").forEach((b) => {
    b.addEventListener("click", () => selectTab(/** @type {HTMLElement} */ (b).dataset.tab ?? "feed"));
  });
  let saved = "feed";
  try {
    saved = localStorage.getItem("omhp.tab") ?? "feed";
  } catch {
    /* ignore */
  }
  selectTab(TABS.includes(saved) ? saved : "feed");
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay();
  });
}
