// Animated badges and rarity glows cost a repaint every step, so only the
// feed / CHAT lines you can actually see animate: each line gets .in-view
// while it's on screen (style.css switches animations off for the rest).
// Scrolled down through history, the lines you're reading animate; the ones
// scrolled away rest.

/** @type {IntersectionObserver | null} */
let io = null;

/** @param {Element} li */
const watch = (li) => io?.observe(li);

/** Watch every line in these lists, now and as lines come and go. @param {...(HTMLElement | null)} lists */
export function animateInView(...lists) {
  if (!("IntersectionObserver" in window)) {
    for (const list of lists) list?.classList.add("all-in-view"); // old browser: everything animates
    return;
  }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle("in-view", e.isIntersecting);
  }, { rootMargin: "60px 0px" });
  for (const list of lists) {
    if (!list) continue;
    list.querySelectorAll(":scope > li").forEach(watch);
    new MutationObserver((changes) => {
      for (const c of changes) {
        c.addedNodes.forEach((n) => n instanceof HTMLLIElement && watch(n));
        c.removedNodes.forEach((n) => n instanceof HTMLLIElement && io?.unobserve(n));
      }
    }).observe(list, { childList: true });
  }
}
