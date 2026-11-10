// What the ATTACKS bar's colours mean: hover (or tap) the bar in FIGHT for an
// ASCII box, the same look as the loot box odds (boxodds.js). The numbers are
// the player's own: their max, what the CITY adds, any bonus above it.

import { el } from "../ascii.js?v=b6664395f3";
import { on, state } from "../store.js?v=b6664395f3";
import { every } from "./tutorial.js?v=b6664395f3";

/** @type {HTMLElement | null} */
let tip = null;
let showing = false;
let pointerAt = 0; // a tap focuses the bar and then clicks it: let the click decide

const pips = () => /** @type {HTMLElement} */ (document.getElementById("pips"));

/** The legend, with this player's numbers. */
function legend() {
  const me = state.me;
  const per = me?.attacks_per_day ?? 5;
  const base = Math.min(per, me?.attacks_base ?? per);
  const extra = Math.max(0, (me?.attacks_left ?? 0) - per);
  /** @type {[string, string, string][]} [mark, its class, what it means] */
  const rows = [
    ["*", "pips-amber", `an attack, ready (${base} max)`],
    ...(per > base ? /** @type {[string, string, string][]} */ ([["*", "pips-blue", `+${per - base} max from the CITY's perks`]]) : []),
    ["*", "pips-green", `bonus above your max${extra ? ` (+${extra} now)` : ""}`],
    ["-", "dim", `used: +1 back ${every(me?.recharge_seconds ?? 60)}`],
  ];
  const notes = ["bonus attacks (chests and such) don't", "recharge: spend them, they're gone."];
  const title = "ATTACKS :: WHAT THE COLOURS MEAN";
  const w = Math.max(title.length, ...rows.map((r) => r[2].length + 2), ...notes.map((n) => n.length));
  const pre = el("pre", "badge-tip-box");
  const edge = `+${"-".repeat(w + 2)}+\n`;
  pre.append(edge);
  const line = (/** @type {(Node | string)[]} */ ...nodes) => {
    const span = el("span");
    span.append("| ", ...nodes, " |\n");
    pre.append(span);
  };
  line(el("span", "tip-title", title.padEnd(w)));
  line(" ".repeat(w));
  for (const [mark, cls, text] of rows) line(el("span", cls, mark), ` ${text.padEnd(w - 2)}`);
  line(" ".repeat(w));
  for (const n of notes) line(el("span", "dim", n.padEnd(w)));
  pre.append(edge.trimEnd());
  return pre;
}

function show() {
  const bar = pips();
  showing = true;
  tip ??= document.body.appendChild(el("div", "badge-tip"));
  tip.setAttribute("role", "tooltip");
  tip.replaceChildren(legend());
  tip.hidden = false;
  // Below the bar (above it if there's no room), kept on screen.
  const r = bar.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + (r.width - box.width) / 2, window.innerWidth - box.width - 8));
  const below = r.bottom + 6;
  const top = below + box.height > window.innerHeight - 8 ? Math.max(8, r.top - box.height - 6) : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hide() {
  showing = false;
  if (tip) tip.hidden = true;
}

/** Hover, taps and keyboard focus on the ATTACKS bar. */
export function initPipsTip() {
  const bar = pips();
  bar.tabIndex = 0;
  bar.setAttribute("role", "button");
  bar.setAttribute("aria-label", "what the attack bar's colours mean");
  bar.classList.add("has-odds");
  const inBar = (/** @type {EventTarget | null} */ t) => t instanceof Node && bar.contains(t);
  document.addEventListener("pointerdown", () => (pointerAt = Date.now()), { capture: true });
  bar.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") show();
  });
  bar.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hide();
  });
  document.addEventListener("click", (e) => {
    if (inBar(e.target)) {
      if (showing) hide();
      else show();
    } else if (showing) hide();
  });
  bar.addEventListener("focus", () => {
    if (Date.now() - pointerAt > 500) show();
  });
  bar.addEventListener("blur", () => {
    if (Date.now() - pointerAt > 500) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener("scroll", hide, { passive: true });
  on("me", () => { // an attack spent or back while it's open: keep the numbers true
    if (showing) show();
  });
}
