import * as api from "../api.js?v=b7420735b5";
import { center, centerBlock, el, fitArt } from "../ascii.js?v=b7420735b5";
import { SCROLLS, applyBoss, emit, mergeFeed, state } from "../store.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";
import { addFreshEvents } from "./feed.js?v=b7420735b5";
import { showOverlay } from "./fx.js?v=b7420735b5";
import { bossHealEffect } from "./boss.js?v=b7420735b5";

/** @param {any} def @param {number} count */
function menuCard(def, count) {
  const width = 38;
  const inside = width - 2;
  const line = (s) => `|${String(s).slice(0, inside).padEnd(inside)}|`;
  const centered = (s) => {
    const text = String(s).slice(0, inside);
    const left = Math.floor((inside - text.length) / 2);
    return line(" ".repeat(left) + text);
  };
  return [
    `+${"-".repeat(inside)}+`,
    centered(def.mini ?? "~~~"),
    centered(def.name),
    centered(`OWNED x${count}  ::  [ DEPLOY ]`),
    `+${"-".repeat(inside)}+`,
  ].join("\n");
}

/** @param {string} id @param {boolean} [found] */
export function scrollReveal(id, found = false) {
  const def = SCROLLS[id];
  if (!def) return Promise.resolve();
  return showOverlay((inner, close) => {
    inner.classList.add("scroll-reveal");
    inner.style.setProperty("--scroll-color", def.color);
    const pre = el("pre", "art scroll-art");
    pre.textContent = [...centerBlock(def.art, 34), "", center(def.name, 34)].join("\n");
    pre.dataset.cols = "34";
    const title = el("div", "scroll-title", found ? "SCROLL FOUND" : "SCROLL READY");
    const note = el("div", "flavor", def.description);
    const actions = el("div", "actions");
    const use = /** @type {HTMLButtonElement} */ (el("button", "scroll-use", "[ DEPLOY SCROLL ]"));
    use.addEventListener("click", async () => {
      use.disabled = true;
      try {
        const res = await api.useScroll(id);
        state.me = res.me;
        if (applyBoss(res.boss)) emit("boss");
        if (res.events) addFreshEvents(mergeFeed(res.events));
        emit("me");
        close();
        if (id === "boss_heal") bossHealEffect(state.me?.name ?? "YOU", res.amount ?? 0, res.shards ?? 100);
      } catch (e) {
        use.disabled = false;
        showError(/** @type {Error} */ (e).message);
      }
    });
    const later = el("button", "", "[ SAVE FOR LATER ]");
    later.addEventListener("click", close);
    actions.append(use, later);
    inner.append(title, pre, note, actions);
    fitArt(pre, 16);
  }, { mustChoose: true });
}

export function chooseScroll() {
  const owned = state.me?.scrolls ?? [];
  if (!owned.length) return;
  if (owned.length === 1) return void scrollReveal(owned[0].scroll_id);
  showOverlay((inner, close) => {
    const title = el("pre", "art scroll-menu-title", "+------------------------------------+\n|      C H O O S E   A   S C R O L L |\n+------------------------------------+");
    inner.append(title);
    const choices = el("div", "scroll-choices");
    for (const row of owned) {
      const def = SCROLLS[row.scroll_id];
      if (!def) continue;
      const b = el("button", "scroll-choice");
      b.setAttribute("aria-label", `${def.name}, owned ${row.count}, deploy`);
      const card = el("pre", "art ascii-scroll-choice", menuCard(def, row.count));
      card.style.setProperty("color", def.color);
      b.append(card);
      b.addEventListener("click", () => { close(); scrollReveal(row.scroll_id); });
      choices.append(b);
    }
    inner.append(choices);
  });
}
