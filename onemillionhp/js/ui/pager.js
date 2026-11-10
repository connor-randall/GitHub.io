// "[ < NEWER ]  PAGE 2 / 11  [ OLDER > ]" for long lists (bosses keep piling up).

import { el } from "../ascii.js?v=b6664395f3";

/** The slice of ``items`` on page ``page`` (0-based, clamped), and the page count.
 * @template T @param {T[]} items @param {number} page @param {number} size */
export function pageOf(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { page: at, pages, items: items.slice(at * size, at * size + size) };
}

/** Pager buttons; nothing when everything fits on one page.
 * @param {number} page @param {number} pages @param {(page: number) => void} go
 * @param {[string, string]} [labels] */
export function pager(page, pages, go, labels = ["< NEWER", "OLDER >"]) {
  const bar = el("div", "pager");
  if (pages <= 1) return bar;
  /** @param {string} label @param {number} to @param {boolean} off */
  const btn = (label, to, off) => {
    const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn pager-btn", `[ ${label} ]`));
    b.type = "button";
    b.disabled = off;
    b.addEventListener("click", () => go(to));
    return b;
  };
  bar.append(btn("<<", 0, page === 0), btn(labels[0], page - 1, page === 0),
    el("span", "pager-at", `PAGE ${page + 1} / ${pages}`),
    btn(labels[1], page + 1, page >= pages - 1), btn(">>", pages - 1, page >= pages - 1));
  return bar;
}
