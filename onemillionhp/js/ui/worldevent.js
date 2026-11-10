// World events: the bar under the boss, the ASCII effects over it, and the
// merchant / deal buttons. The server's boss snapshot carries the running
// event (boss.event); everything here is drawn from it, so every page shows
// the same thing. Transitions (start, the 2x window opening, the stash
// breaking...) are spotted by comparing each snapshot with the last one.

import * as api from "../api.js?v=b6664395f3";
import { RARITY_STYLE, bigText, center, centerBlock, el, fmt, padR, segText } from "../ascii.js?v=b6664395f3";
import * as sound from "../sound.js?v=b6664395f3";
import { bossDef, boxById, emit, itemById, now, rarityById, state } from "../store.js?v=b6664395f3";
import { openBox } from "./bag.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { boxDropReveal, button, critBanner, lootReveal, popup, shake, showOverlay } from "./fx.js?v=b6664395f3";
import { plainTitle, setFlashing } from "../title.js?v=b6664395f3";
import { syncMeowCats } from "./meowcats.js?v=b6664395f3";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Inner width of the panel's content. It grows with the header box (fitPanel) so the
// panel spans it edge to edge; text lines are written for at least MIN_W.
const MIN_W = 52;
let W = 56;
const ROWS = 5; // marching top border with the title, 3 lines, marching bottom border

/** @type {HTMLElement | null} */
let host = null;
/** @type {HTMLElement | null} */
let fxEl = null;
let frame = 0;
/** The event we drew last time (to spot transitions). */
let last = { key: "", /** @type {any} */ ev: null };
/** A result line that stays a few seconds after an event ends. @type {{title: string, lines: string[], cls: string, until: number} | null} */
let linger = null;
/** A one-off animation over the boss. @type {{kind: string, start: number, dur: number, data?: any} | null} */
let anim = null;
let spinUntil = 0; // SWAP MEET slot machine
let walkStart = 0; // THE MERCHANT walking in
let lastStashHp = -1;
let jiggleUntil = 0;
let lastCombo = 0;
let brokenUntil = 0;
let brokenAt = 0;
let dismissedDeal = 0; // started_at of a deal the player waved off
let actionsKey = "";
/** THE DEAL's outcome, flipped in the panel: a coin for FLIP_MS, then what you got.
 * @type {{start: number, title: string, lines: string[], cls: string} | null} */
let dealResult = null;
const FLIP_MS = 1300;
const RESULT_MS = 5000;
let busy = false;

// ------------------------------------------------------------------ helpers

/** COMBO's damage multiplier on normal hits at ``n`` links (server: worldevents.combo_mult). @param {number} n */
const comboMult = (n) => Math.round((1 + Math.min(n, 90) * 0.1) * 10) / 10;
const secsLeft = (/** @type {any} */ ev) => Math.max(0, Math.ceil((ev.until ?? 0) - now()));
/** A taken DEAL still waiting on this player's ultimate (gone once deal_until passes). @param {any} me */
const dealPending = (me) => !!me?.event?.deal_pending && (!me.event.deal_until || now() < me.event.deal_until);
const mmss = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** THE HUNT running now? Then {spot, cols, rows} (spot = your own; null until known); else null. */
function hunt() {
  const ev = state.boss?.status === "alive" ? state.boss.event : null;
  if (ev?.kind !== "hunt" || now() >= (ev.until ?? 0)) return null;
  return { spot: state.me?.event?.spot ?? null, cols: ev.cols ?? 5, rows: ev.rows ?? 4 };
}

/** Which zone a tap on the boss went for during THE HUNT (undefined otherwise).
 * @param {number} clientX @param {number} clientY @param {HTMLElement} stage */
export function huntAim(clientX, clientY, stage) {
  const h = hunt();
  if (!h) return undefined;
  const r = stage.getBoundingClientRect();
  const col = Math.max(0, Math.min(h.cols - 1, Math.floor(((clientX - r.left) / Math.max(1, r.width)) * h.cols)));
  const row = Math.max(0, Math.min(h.rows - 1, Math.floor(((clientY - r.top) / Math.max(1, r.height)) * h.rows)));
  return row * h.cols + col;
}

/** The <@> over the boss marking THE HUNT's weak spot (it jumps after every hit). */
function paintHunt() {
  const stage = document.getElementById("boss-stage");
  if (!stage) return;
  let mark = /** @type {HTMLElement | null} */ (stage.querySelector(".hunt-mark"));
  const h = hunt();
  stage.classList.toggle("hunting", Boolean(h));
  if (!h) {
    mark?.remove();
    return;
  }
  if (!mark) {
    mark = el("div", "hunt-mark", "");
    mark.setAttribute("aria-hidden", "true");
    stage.append(mark);
  }
  mark.hidden = h.spot === null;
  const col = (h.spot ?? 0) % h.cols;
  const row = Math.floor((h.spot ?? 0) / h.cols);
  mark.style.setProperty("left", `${((col + 0.5) / h.cols) * 100}%`);
  mark.style.setProperty("top", `${((row + 0.5) / h.rows) * 100}%`);
  mark.textContent = frame % 4 < 2 ? "<@>" : "< @ >";
}
/** "=[ TITLE ]=========[ 0:24 ]=" @param {string} title @param {string} [right] */
function header(title, right = "") {
  const l = `=[ ${title} ]`;
  const r = right ? `[ ${right} ]=` : "=";
  return l + "=".repeat(Math.max(1, W - l.length - r.length)) + r;
}
/** The frame's top/bottom edge: "=-=-" marching (top right, bottom left) with a spark running along.
 * @param {string} line @param {number} dir */
function march(line, dir) {
  const n = line.length;
  const step = Math.floor(frame / 3); // one step every ~360 ms
  const spark = ((frame * dir) % n + n) % n;
  return [...line].map((ch, i) => {
    if (ch !== "=") return ch;
    if (i === spark) return "*";
    return "=-"[((i - step * dir) % 2 + 2) % 2];
  }).join("");
}
/** Wrap the panel (title line + up to 3 lines) in its animated ASCII frame. @param {string[]} lines */
function frameLines(lines) {
  const outer = W + 4;
  const top = march(padR(lines[0] ?? "", W).replace(/ +$/, (sp) => "=".repeat(sp.length)), 1);
  const body = lines.slice(1, 4);
  while (body.length < 3) body.push("");
  const rails = (/** @type {number} */ i) => ((i + Math.floor(frame / 3)) % 2 ? "|" : ":");
  return [
    padR(`==${top}==`, outer),
    ...body.map((l, i) => `${rails(i)} ${padR(l, W)} ${rails(i + 1)}`),
    march("=".repeat(outer), -1),
  ];
}
const COLORS = /** @type {Record<string, string>} */ ({
  windup: "#ffd45c", overload: "#74c7ff", merchant: "#ffd45c", stash: "#ffd45c", replay: "#ff7a6a",
  combo: "#9bff7a", fog: "#b9c2c9", swap: "#c99bff", deal: "#ff6ad5", second_wind: "#ff5340",
  shard_rain: "#ffd45c", shield: "#74c7ff", hunt: "#9bff7a", hill: "#ffd45c", teams: "#ff6ad5",
  well: "#74c7ff", laststand: "#ff5340", possess: "#c99bff", meow: "#ffd34d",
});
/** Who's possessed, short enough for one panel line: "AAA, BBB +3 MORE". @param {any} ev */
function possessedText(ev) {
  const names = ev.victims ?? [];
  const n = ev.possessed ?? names.length;
  const shown = names.slice(0, 2).join(", ");
  return n > 2 ? `${shown} +${n - 2} MORE` : shown || "SOMEONE";
}

/** TEAMS: colour the tug-of-war bar's red half and blue half.
 * @param {HTMLElement} pre @param {[number, number]} tug red and blue cell counts */
function paintTug(pre, [red, blue]) {
  const text = pre.textContent ?? "";
  const bar = `[${"#".repeat(red)}|${"#".repeat(blue)}]`;
  const at = text.indexOf(bar);
  if (at < 0) return;
  pre.replaceChildren(text.slice(0, at + 1), el("span", "tug-red", "#".repeat(red)), "|",
    el("span", "tug-blue", "#".repeat(blue)), text.slice(at + bar.length - 1));
}

/** TEAMS: each side's colour (the event box, and names in CHAT). */
export const TEAM_COLORS = /** @type {Record<string, string>} */ ({ red: "#ff5340", blue: "#4fa8ff" });
/** @param {number} frac @param {number} cells @param {string} [full] @param {string} [empty] */
function meter(frac, cells, full = "#", empty = ".") {
  const n = Math.max(0, Math.min(cells, Math.round(frac * cells)));
  return full.repeat(n) + empty.repeat(cells - n);
}
const pick = (/** @type {string} */ chars) => chars[Math.floor(Math.random() * chars.length)];
/** Lay text beside a small sprite. @param {string[]} sprite @param {string[]} text @param {number} [gap] */
function beside(sprite, text, gap = 2, tw = 40, minSw = 0) {
  // Fixed-size block, centred once: changing text never shifts it sideways.
  const sw = Math.max(minSw, ...sprite.map((l) => l.length));
  const rows = Math.max(sprite.length, text.length);
  const pad = " ".repeat(Math.max(0, Math.floor((W - sw - gap - tw) / 2)));
  const out = [];
  for (let i = 0; i < rows; i++) out.push(pad + padR(sprite[i] ?? "", sw + gap) + padR(text[i] ?? "", tw));
  return out;
}

// Block letters for the big words (digits come from bigText).
const LETTERS = /** @type {Record<string, string[]>} */ ({
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  " ": ["  ", "  ", "  ", "  ", "  "],
});
/** @param {string} text */
function bigWord(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text) {
    const g = LETTERS[ch] ?? bigText(ch);
    if (!g.length) continue;
    for (let r = 0; r < 5; r++) rows[r] += (g[r] ?? "") + " ";
  }
  return rows.map((r) => r.replace(/\s+$/, ""));
}

// ------------------------------------------------------------------ fog over the HP

/** During FOG the HP readout lies. boss.js asks here before drawing it.
 * @returns {{now: string, pct: string, frac: number | null} | null} */
export function fogHp() {
  const ev = state.boss?.event;
  if (!ev || ev.kind !== "fog" || state.boss.status !== "alive") return null;
  const max = state.boss.max_hp;
  if (ev.mode === "hidden") return { now: "???,???", pct: "(??%)", frac: null };
  if (ev.mode === "frozen") {
    const frac = ev.shown_hp / max;
    return { now: fmt(ev.shown_hp), pct: `(${(frac * 100).toFixed(2)}%)`, frac };
  }
  // Scrambled: a new fake reading once a second (the same everywhere it's drawn that second).
  const sec = Math.floor(now());
  const noise = (/** @type {number} */ k) => {
    const x = Math.sin(sec * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { now: fmt(Math.floor(noise(1) * max)), pct: `(${(noise(2) * 100).toFixed(2)}%)`, frac: noise(3) };
}

// ------------------------------------------------------------------ the bar

/** Called on every boss / me update. */
export function renderWorldEvent() {
  syncMeowCats();
  host ??= document.getElementById("wev");
  fxEl ??= document.getElementById("wev-fx");
  const b = state.boss;
  const ev = b && b.status === "alive" ? b.event : null;
  const key = ev ? `${ev.kind}:${ev.stage}:${ev.started_at}` : "";
  if (key !== last.key) {
    transition(last.ev, ev);
    last = { key, ev };
  } else last.ev = ev;
  if (ev?.kind === "stash") {
    if (lastStashHp >= 0 && ev.hp < lastStashHp) jiggleUntil = performance.now() + 220;
    lastStashHp = ev.hp;
  } else lastStashHp = -1;
  if (ev?.kind === "combo") {
    if (ev.count === 0 && lastCombo >= 3) {
      brokenUntil = performance.now() + 1400;
      brokenAt = lastCombo;
      sound.hit();
    }
    lastCombo = ev.count;
  } else lastCombo = 0;
  draw();
}

/** @param {any} prev @param {any} ev */
function transition(prev, ev) {
  const t = performance.now();
  if (ev && (!prev || prev.kind !== ev.kind || prev.started_at !== ev.started_at)) {
    linger = null;
    announce(dropText(ev) ?? `${ev.name ?? "AN EVENT"} STARTED`);
    if (ev.kind === "second_wind") playSecondWind(ev.round ?? 2);
    else {
      sound.eventStart();
      host?.classList.remove("wev-in");
      void host?.offsetWidth;
      host?.classList.add("wev-in");
    }
    if (ev.kind === "swap") spinUntil = t + (reduced ? 0 : 2400);
    if (ev.kind === "merchant") walkStart = t;
    // Your own part lives in `me` (your weak spot, your side, whether you're the
    // possessed one): fetch it now, spread out so every page doesn't ask at once.
    if (["hunt", "teams", "possess", "well"].includes(ev.kind)) {
      setTimeout(() => api.getMe().then((m) => {
        state.me = m;
        emit("me");
      }).catch(() => {}), Math.random() * 1500);
    }
    return;
  }
  if (ev && prev && prev.kind === ev.kind) {
    if (ev.kind === "windup" && ev.stage === "live") {
      announce("!! THE OPENING: ULTIMATES 2x STRONGER FOR 10s !!");
      anim = { kind: "burst", start: t, dur: 900 };
      shake("l");
      sound.crit();
    } else if (ev.kind === "overload" && ev.stage === "stagger") {
      anim = { kind: "bolt", start: t, dur: 1400 };
      shake("l");
      sound.ultimate();
    } else if (ev.kind === "stash" && ev.stage === "broken") {
      anim = { kind: "coins", start: t, dur: 1600 };
      shake("l");
      sound.loot();
    } else if ((ev.kind === "shield" && ev.stage === "broken") || (ev.kind === "well" && ev.stage === "granted")
      || (ev.kind === "laststand" && ev.stage === "calm") || (ev.kind === "possess" && ev.stage === "freed")) {
      anim = { kind: "coins", start: t, dur: 1600 };
      shake("l");
      sound.loot();
    } else if (ev.kind === "replay" && ev.stage === "payout") {
      anim = { kind: "rewind", start: t, dur: 1100 };
      sound.ultimate();
      if (ev.payout > 0) setTimeout(() => critBanner(ev.payout, "> > R E P L A Y"), reduced ? 0 : 700);
    }
    return;
  }
  if (!ev && prev) ended(prev, t);
}

/** An event just disappeared from the snapshot: show how it went.
 * @param {any} prev @param {number} t */
function ended(prev, t) {
  // Ended before its time = stopped by the admin (or the boss died): go quietly.
  if (now() < (prev.until ?? Infinity) - 0.5) return;
  const show = (/** @type {string} */ title, /** @type {string[]} */ lines, cls = "") => {
    linger = { title, lines, cls, until: t + 4500 };
  };
  if (prev.kind === "stash") {
    if (prev.stage === "live") show("THE STASH GOT AWAY", ["...it scuttled off with the loot."], "wev-dim");
  } else if (prev.kind === "overload" && prev.stage === "live") {
    show("OVERLOAD FIZZLED", ["...the meter sputters out."], "wev-dim");
  } else if (prev.kind === "combo") {
    show("COMBO OVER", [`BEST CHAIN ${prev.best ?? 0} HITS  (x${comboMult(prev.best ?? 0)} DAMAGE AT ITS PEAK)`]);
  } else if (prev.kind === "merchant") {
    show("THE MERCHANT PACKED UP", ['"PLEASURE DOING BUSINESS."'], "wev-dim");
  } else if (prev.kind === "fog") {
    show("THE FOG LIFTS", ["the HP bar is honest again."], "wev-dim");
  } else if (prev.kind === "swap") {
    show("SWAP MEET OVER", ["everyone's back in their own gear."], "wev-dim");
  } else if (prev.kind === "deal") {
    show("THE DEALER VANISHED", ["..."], "wev-dim");
  } else if (prev.kind === "shield" && prev.stage === "live") {
    show("THE SHIELD HELD", ["...and crumbles away by itself."], "wev-dim");
  } else if (prev.kind === "hunt") {
    show("THE HUNT IS OVER", [`${fmt(prev.spot_hits ?? 0)} HITS ON THE WEAK SPOT`, prev.top ? `TOP HUNTER ${prev.top} GETS A BOX` : ""]);
  } else if (prev.kind === "hill") {
    const top = prev.leaders?.[0];
    show("KING OF THE HILL", [top ? `${top.name} IS KING WITH ${fmt(top.hits)} HITS` : "NOBODY CLIMBED IT.", "THE TOP 3 GET A BOX"]);
  } else if (prev.kind === "teams") {
    const winner = prev.red === prev.blue ? "IT'S A TIE!" : prev.red > prev.blue ? "RED WINS!" : "BLUE WINS!";
    show(winner, [`RED ${fmt(prev.red ?? 0)}  ::  BLUE ${fmt(prev.blue ?? 0)}`, "THE WINNERS GET A BOX EACH"]);
  } else if (prev.kind === "well" && prev.stage === "live") {
    show("THE WELL RAN DRY", [`${fmt(prev.filled ?? 0)} / ${fmt(prev.goal ?? 0)}: THE SHARDS ARE GONE.`], "wev-dim");
  } else if (prev.kind === "laststand" && prev.stage === "live") {
    show("ITS RAGE BOILED OVER", ["THE BOSS HEALED 10%."], "wev-broken");
  } else if (prev.kind === "possess" && prev.stage === "live") {
    show("THE SPIRITS LEFT", [`${possessedText(prev)} ${prev.possessed === 1 ? "IS" : "ARE"} THEMSELVES AGAIN.`,
      `THEY HEALED THE BOSS ${fmt(prev.healed ?? 0)}`], "wev-dim");
  }
}

/** Redraw the bar (and its buttons when they change). */
function draw() {
  if (!host) return;
  const b = state.boss;
  const ev = b && b.status === "alive" ? b.event : null;
  const me = state.me;
  document.body.classList.toggle("wev-windup-warn", ev?.kind === "windup" && ev.stage === "warn");
  document.body.classList.toggle("wev-windup-hot", ev?.kind === "windup" && ev.stage === "warn" && secsLeft(ev) <= 5);
  document.body.classList.toggle("wev-windup-live", ev?.kind === "windup" && ev.stage === "live");
  document.body.classList.toggle("wev-stagger", ev?.kind === "overload" && ev.stage === "stagger");
  document.body.classList.toggle("wev-fog", ev?.kind === "fog");
  document.body.classList.toggle("wev-round2", ev?.kind === "second_wind");
  /** @type {string[]} */
  let lines = [];
  let cls = "";
  /** @type {[string, () => void][]} */
  let actions = [];
  const flip = dealPanel();
  const px = sizePanel(!flip && (ev?.kind === "merchant" || (ev?.kind === "deal" && !me?.event?.deal_taken)
    || (ev?.kind === "well" && ev.stage === "live")));
  /** @type {[number, number] | undefined} */
  let tug;
  if (flip) {
    ({ lines, cls } = flip);
  } else if (ev) {
    ({ lines, cls, actions, tug } = body(ev, me));
  } else if (dealPending(me)) {
    const left = me.event.deal_until ? `  ::  EXPIRES IN ${mmss(secsLeft({ until: me.event.deal_until }))}` : "";
    lines = [header("? DEAL PENDING"), center("YOUR NEXT ULTIMATE: 2x ... OR A FIZZLE", W),
      center(`USE YOUR ULT SOON${left}`, W)];
    cls = "wev-deal";
  } else if (linger && performance.now() < linger.until) {
    lines = [header(linger.title), ...linger.lines.filter(Boolean).map((l) => center(l, W))];
    cls = linger.cls;
  }
  host.hidden = !lines.length;
  document.body.classList.toggle("wev-on", lines.length > 0);
  if (!lines.length) {
    actionsKey = "";
    host.replaceChildren();
    return;
  }
  let pre = /** @type {HTMLElement | null} */ (host.querySelector("pre.wev-art"));
  if (!pre) {
    pre = el("pre", "wev-art art");
    host.prepend(pre);
  }
  // Every line the same width, left-aligned in a centred box: block letters keep their shape.
  pre.textContent = frameLines(lines).join("\n");
  if (tug) paintTug(pre, tug);
  pre.style.setProperty("font-size", `${px.toFixed(2)}px`);
  pre.style.setProperty("line-height", "1.18");
  // TEAMS: the box takes your side's colour.
  const side = ev?.kind === "teams" ? me?.event?.team : null;
  document.body.style.setProperty("--wev-c", side ? TEAM_COLORS[side] : COLORS[ev?.kind ?? (flip ? "deal" : "")] ?? "#ffb000");
  host.className = `wev ${cls}${host.classList.contains("wev-in") ? " wev-in" : ""}`;
  const key = actions.map((a) => a[0]).join("|") + (busy ? "*" : "");
  if (key !== actionsKey) {
    actionsKey = key;
    host.querySelector(".wev-actions")?.remove();
    if (actions.length) {
      const row = el("div", "wev-actions");
      for (const [label, fn] of actions) {
        const btn = /** @type {HTMLButtonElement} */ (el("button", "inline-btn wev-btn", label));
        btn.type = "button";
        btn.disabled = busy;
        btn.addEventListener("click", fn);
        row.append(btn);
      }
      host.append(row);
    }
  }
}

/** The lines and buttons for the running event (``tug``: TEAMS' red / blue cell counts).
 * @param {any} ev @param {any} me
 * @returns {{lines: string[], cls: string, actions: [string, () => void][], tug?: [number, number]}} */
function body(ev, me) {
  const left = mmss(secsLeft(ev));
  /** @type {[string, () => void][]} */
  const actions = [];
  // Every panel is a title line + at most 3 lines: it plays inside the logo's box.
  switch (ev.kind) {
    case "windup": {
      if (ev.stage === "warn") {
        const s = secsLeft(ev);
        const frac = Math.max(0, Math.min(1, 1 - ((ev.until ?? 0) - now()) / 30));
        const cells = W - 14;
        const head = Math.round(frac * cells);
        const barTxt = "=".repeat(Math.max(0, head - 1)) + (head > 0 ? ">" : "") + ".".repeat(Math.max(0, cells - head));
        // Ticket #241: no colour change before zero (red read as "fire"); the last
        // seconds only say WAIT louder. The box turns green when 2x is live.
        const msg = s <= 5 ? (frame % 4 < 2 ? "WAIT... NOT YET!" : "HOLD YOUR ULTIMATE")
          : frame % 12 < 8 ? "AT ZERO, ULTIMATES GO 2x" : "HOLD YOUR ULTIMATE...";
        return {
          cls: "wev-windup",
          lines: [header("/!\\ WIND-UP", left), ...beside(segText(String(s)).map((l) => padR(l, 7)), [msg, "", `[${barTxt}]`], 3, W - 12)],
          actions,
        };
      }
      const flash = frame % 2 === 0;
      return {
        cls: "wev-windup wev-open wev-go",
        lines: [header("!! OPENING !!", left),
          center(flash ? ">>>  ULTIMATES 2x STRONGER  <<<" : " >>  ULTIMATES 2x STRONGER  << ", W),
          center(flash ? "F I R E   N O W" : "", W)],
        actions,
      };
    }
    case "overload": {
      if (ev.stage === "stagger") {
        return {
          cls: "wev-overload wev-open",
          lines: [header("#! OVERLOADED !#", left),
            center(frame % 2 ? "STAGGERED!  ALL DAMAGE x1.5" : "STAGGERED!  ALL DAMAGE x1.5 ", W),
            center(`${fmt(ev.helpers)} FIGHTER${ev.helpers === 1 ? "" : "S"} GOT THEIR ULTIMATE BACK`, W)],
          actions,
        };
      }
      const frac = ev.fill / ev.goal;
      const cells = W - 9;
      const n = Math.round(frac * cells);
      const sparks = n < cells ? pick("~*'") + pick("~ .") : "";
      const gauge = padR("#".repeat(Math.max(0, n - 1)) + sparks, cells).slice(0, cells).replace(/ /g, ".");
      return {
        cls: "wev-overload",
        lines: [header("#! OVERLOAD", left), ` [${gauge}] ${String(Math.floor(frac * 100)).padStart(3)}%`,
          center(`${fmt(ev.fill)} / ${fmt(ev.goal)}  ::  ${fmt(ev.helpers)} CHARGING`, W),
          center("FILL IT: HELPERS GET THEIR ULTIMATE BACK", W)],
        actions,
      };
    }
    case "merchant": {
      const walk = reduced ? 1 : Math.min(1, (performance.now() - walkStart) / 1600);
      const legs = walk < 1 ? (frame % 2 ? "_/ \\_" : " /|\\ ") : "_/ \\_";
      const sprite = ["(o.o)", "/|$|\\", legs];
      const shift = " ".repeat(Math.round((1 - walk) * 8)); // walks in within its own column
      const text = walk < 1 ? [] : ['"WARES FOR SALE. NO REFUNDS."', stockLine(ev),
        (me?.event?.bought ?? []).length ? "THANKS FOR YOUR BUSINESS." : "STOCK IS SHARED. ONE EACH."];
      if (walk >= 1) actions.push(["[ BROWSE WARES ]", () => openMerchant()]);
      return {
        cls: "wev-merchant",
        lines: [header("$ THE MERCHANT", left), ...beside(sprite.map((l) => shift + l), text, 3, 40, 13)],
        actions,
      };
    }
    case "stash": {
      if (ev.stage === "broken") {
        return {
          cls: "wev-stash wev-good",
          lines: [header("$ STASH BROKEN! $"), center(`${fmt(ev.hitters ?? 0)} FIGHTER${ev.hitters === 1 ? "" : "S"} GET A BOX`, W),
            center(ev.top ? `TOP HITTER ${ev.top} GETS AN EXTRA` : "", W),
            [...Array(W)].map(() => (Math.random() < 0.18 ? pick("$<>*o.") : " ")).join("")],
          actions,
        };
      }
      const jig = performance.now() < jiggleUntil ? (frame % 2 ? " " : "") : "";
      const chest = [`${jig}.-----.`, `${jig}| [$] |`, `${jig}'-----'`];
      const cells = W - 22;
      const text = ["BREAK IT: EVERY HITTER GETS A BOX",
        `[${meter(ev.hp / ev.max, cells)}] ${fmt(ev.hp)}`,
        `${fmt(ev.hitters)} HITTING${ev.top ? `  ::  TOP ${ev.top}` : ""}`];
      return { cls: "wev-stash", lines: [header("$ STASH", left), ...beside(chest, text, 2, W - 12)], actions };
    }
    case "replay": {
      const holes = (/** @type {number} */ off) => [...Array(W)].map((_, i) => ((i + off) % 4 === 0 ? "#" : "=")).join("");
      if (ev.stage === "payout") {
        const sweep = [...Array(W)].map((_, i) => ((i + frame * 3) % 9 < 2 ? "<" : " ")).join("");
        return {
          cls: "wev-replay wev-open",
          lines: [header("> > REPLAY"), center(`+${fmt(ev.payout ?? 0)} DAMAGE LANDED AGAIN`, W),
            center(`${fmt(ev.helpers)} FIGHTER${ev.helpers === 1 ? "" : "S"} HIT TWICE`, W), sweep],
          actions,
        };
      }
      const dot = frame % 6 < 3 ? "(*) REC" : "( ) REC";
      return {
        cls: "wev-replay",
        lines: [header(dot, left), holes(frame),
          center(`RECORDED ${fmt(ev.recorded)}  ::  IT ALL LANDS AGAIN (20%)`, W), holes(-frame)],
        actions,
      };
    }
    case "combo": {
      const t = performance.now();
      if (t < brokenUntil) {
        const word = "C O M B O   B R O K E N".split("").map((ch) => (ch !== " " && Math.random() < 0.25 ? pick("#%&*?") : ch)).join("");
        return { cls: "wev-combo wev-broken", lines: [header("COMBO", left), center(word, W),
          center(`the chain fell at ${brokenAt} hits`, W)], actions };
      }
      const n = ev.count ?? 0;
      if (!n) {
        return { cls: "wev-combo", lines: [header("COMBO", left), center("HIT TO START THE CHAIN", W),
          center("EACH HIT WITHIN 2s (ANYONE'S): +10% NORMAL-HIT DAMAGE", W), center(`BEST CHAIN ${ev.best}`, W)], actions };
      }
      const fuseLeft = Math.max(0, 1 - (now() - ev.last) / 2);
      const fuse = `[${padR("~".repeat(Math.round(fuseLeft * 9)) + (fuseLeft > 0 ? pick("*'") : ""), 10)}]`;
      const hits = segNum(String(n));
      const mult = segNum(comboMult(n).toFixed(1)).map((l, i) => (i === 2 ? "\\/ " : i === 1 ? "/\\ " : "   ") + l);
      const hw = Math.max(...hits.map((l) => l.length));
      const mw = Math.max(...mult.map((l) => l.length));
      const labelsL = ["", " HITS", ""];
      const labelsR = ["", " DAMAGE", " NORMAL HITS"];
      const row = (/** @type {number} */ i) => padR(hits[i], hw) + padR(labelsL[i], 7) + "   ::   " + padR(mult[i], mw) + labelsR[i];
      const rows = [0, 1, 2].map(row);
      const bw = Math.max(...rows.map((l) => l.length));
      const pad = " ".repeat(Math.max(0, Math.floor((W - bw) / 2)));
      const title = `=[ COMBO ]=[ FUSE ${fuse} ]`;
      const right = `[ BEST ${ev.best} ]=[ ${left} ]=`;
      return {
        cls: `wev-combo${n >= 40 ? " wev-hot" : ""}`,
        lines: [title + "=".repeat(Math.max(1, W - title.length - right.length)) + right, ...rows.map((l) => pad + l)],
        actions,
      };
    }
    case "fog": {
      // A fixed bank of fog that slides one column every ~0.7 s (calm, not flickering).
      const bank = " .~~.  ~:~.   .~ ~~.  :~~~.   .~.  ~~ ";
      const off = Math.floor(frame / 6) % bank.length;
      const drift = (bank.repeat(Math.ceil(W / bank.length) + 2)).slice(off, off + W);
      const why = ev.mode === "hidden" ? "YOU CAN'T SEE ITS HP" : ev.mode === "frozen" ? "THE BAR IS STUCK. IT ISN'T." : "THE NUMBERS ARE LYING";
      return {
        cls: "wev-fog",
        lines: [header("~ FOG", left), drift, center(why, W), center("THE FEED IS LOST IN IT  ::  BOX FIND +50%", W)],
        actions,
      };
    }
    case "swap": {
      if (performance.now() < spinUntil) {
        const names = (ev.pairs ?? []).map((/** @type {any} */ p) => p.name);
        const beat = Math.floor(frame / 2); // reels click over on a steady beat
        const reel = (/** @type {number} */ k) => center(names.length ? names[(beat + k * 3) % names.length] : "???", 12);
        return {
          cls: "wev-swap",
          lines: [header("<> SWAP MEET", left), center("> SHUFFLING LOADOUTS <", W),
            center(`[${reel(0)}] [${reel(1)}] [${reel(2)}]`, W)],
          actions,
        };
      }
      const from = me?.event?.swap_from;
      const pairs = (ev.pairs ?? []).map((/** @type {any} */ p) => `${p.name} <- ${p.from}`);
      const ticker = pairs.length ? pairs.join("   ") + "   " : "";
      const off = ticker ? Math.floor(frame / 3) % ticker.length : 0; // one column every ~0.36 s
      const tape = ticker ? ticker.repeat(Math.ceil((W * 2) / ticker.length) + 1) : "";
      return {
        cls: "wev-swap",
        lines: [header("<> SWAP MEET", left),
          center(from ? `YOU'RE WEARING ${from}'S GEAR` : "YOUR NEXT HIT BORROWS SOMEONE'S GEAR", W),
          ticker ? tape.slice(off, off + W) : "",
          center("STATS ONLY: NOTHING LEAVES ANYONE'S BAG", W)],
        actions,
      };
    }
    case "deal": {
      const taken = me?.event?.deal_taken;
      const eyes = frame % 12 < 9 ? "(- -)" : frame % 12 < 10 ? "(o o)" : "(> <)";
      const sprite = [eyes, "/|_|\\", " / \\ "];
      const text = ev.offer === "double"
        ? ['"PSST. DOUBLE OR NOTHING?"', "YOUR NEXT ULTIMATE: 2x, OR IT FIZZLES."]
        : ['"5 ATTACKS. ONE MYSTERY BOX."', "COULD BE A VOID RELIQUARY. COULD BE A CRATE."];
      text.push(taken ? (ev.offer === "double" ? "DEAL TAKEN. FIRE YOUR ULTIMATE." : "DEAL DONE.") : `${fmt(ev.takers)} TOOK IT`);
      if (!taken && dismissedDeal !== ev.started_at && me?.name_chosen) {
        actions.push(["[ TAKE THE DEAL ]", () => takeDeal()]);
        actions.push(["[ NO THANKS ]", () => {
          dismissedDeal = ev.started_at;
          draw();
        }]);
      }
      return { cls: "wev-deal", lines: [header("? THE DEAL", left), ...beside(sprite, text, 3, 44)], actions };
    }
    case "shard_rain": {
      const drops = [...Array(W)].map((_, i) => {
        const k = (i * 37 + Math.floor(frame / 2) * 11) % 23;
        return k === 0 ? "<" : k === 1 ? ">" : k === 7 ? "." : " ";
      }).join("");
      return {
        cls: "wev-rain",
        lines: [header("<> SHARD RAIN <>", left), drops, center("EVERY ATTACK = +1 SHARD. HIT EVERYTHING!", W),
          center(`${fmt(ev.given ?? 0)} SHARDS RAINED SO FAR`, W)],
        actions,
      };
    }
    case "shield": {
      if (ev.stage === "broken") {
        return {
          cls: "wev-shield wev-good",
          lines: [header("# SHIELD BROKEN! #"), center(`${fmt(ev.hitters ?? 0)} BREAKER${ev.hitters === 1 ? "" : "S"} GET A BOX`, W),
            center(ev.top ? `TOP BREAKER ${ev.top} GETS AN EXTRA` : "", W),
            [...Array(W)].map(() => (Math.random() < 0.18 ? pick("#/\\|-") : " ")).join("")],
          actions,
        };
      }
      const wall = ["|#|#|#|", "|#|#|#|", "|#|#|#|"];
      const text = ["IT BLOCKS EVERY HIT. BREAK IT: A BOX EACH",
        `[${meter(ev.hp / ev.max, W - 24)}] ${fmt(ev.hp)}`,
        `${fmt(ev.hitters)} HITTING${ev.top ? `  ::  TOP ${ev.top}` : ""}`];
      return { cls: "wev-shield", lines: [header("# SHIELD WALL", left), ...beside(wall, text, 2, W - 12)], actions };
    }
    case "meow": {
      const cats = ev.cats ?? 10;
      const todo = cats - (me?.event?.petted?.length ?? 0);
      const cat = frame % 10 < 8 ? "~=^o^=" : "~=^-^=";
      const sprite = ["", ` ${cat}`, ""];
      const text = [todo > 0 ? `${todo} CAT${todo === 1 ? "" : "S"} IN YOUR WAY. TAP EACH ONE TO PET IT` : "ALL YOUR CATS ARE PETTED. GO GET IT!",
        "1-10 <> A CAT  ::  CHAT IS (meow)",
        `${fmt(ev.done ?? 0)} DONE  ::  ${fmt(ev.petted ?? 0)} CATS PETTED IN ALL`];
      return { cls: "wev-meow", lines: [header("=^.^= MEOW MODE", left), ...beside(sprite, text, 3, W - 12)], actions };
    }
    case "hunt": {
      const mine = me?.event?.hits ?? 0;
      const target = frame % 4 < 2 ? "<@>" : "< @ >";
      return {
        cls: "wev-hunt",
        lines: [header("<@> THE HUNT", left),
          center(`YOUR OWN WEAK SPOT ${target} IS SOMEWHERE ON THE BOSS`, W),
          center("TAP IT: 3x LOOT, THEN IT MOVES. (ATTACK BUTTON = NO AIM)", W),
          center(`YOU FOUND IT ${fmt(mine)}x  ::  ${fmt(ev.spot_hits ?? 0)} FOUND IN ALL${ev.top ? `  ::  TOP ${ev.top}` : ""}`, W)],
        actions,
      };
    }
    case "hill": {
      const rows = (ev.leaders ?? []).slice(0, 3);
      const crown = ["  ^  ", " /_\\ ", "/___\\"];
      const text = rows.length
        ? rows.map((/** @type {any} */ r, /** @type {number} */ i) => `${i + 1}. ${r.name} ${fmt(r.hits)} HIT${r.hits === 1 ? "" : "S"}${r.player_id === me?.id ? " <" : ""}`)
        : ["MOST HITS IN 2 MINUTES WINS.", "TOP 3 GET A BOX. 1ST GETS THE BEST.", "NOBODY ON THE HILL YET."];
      while (text.length < 3) text.push("");
      return { cls: "wev-hill", lines: [header("^ KING OF THE HILL", left), ...beside(crown, text, 3, W - 10)], actions };
    }
    case "teams": {
      const red = ev.red ?? 0;
      const blue = ev.blue ?? 0;
      const cells = W - 3; // [ + red cells + | + blue cells + ]
      const redCells = red + blue ? Math.round((red / (red + blue)) * cells) : Math.floor(cells / 2);
      const mine = me?.event?.team;
      // A tug of war: red #s pull from the left, blue #s from the right (draw() colours them).
      const bar = `[${"#".repeat(redCells)}|${"#".repeat(Math.max(0, cells - redCells))}]`;
      return {
        cls: `wev-teams${mine ? ` wev-team-${mine}` : ""}`,
        lines: [header("RED vs BLUE", left),
          center(`RED ${fmt(red)}  (${fmt(ev.red_size ?? 0)})        (${fmt(ev.blue_size ?? 0)})  ${fmt(blue)} BLUE`, W),
          bar,
          center(mine ? `YOU'RE ${mine.toUpperCase()}. HIT IT: MORE HITS WINS A BOX EACH` : "HIT IT TO JOIN A TEAM. MORE HITS WINS A BOX EACH", W)],
        actions,
        tug: [redCells, Math.max(0, cells - redCells)],
      };
    }
    case "well": {
      if (ev.stage === "granted") {
        return {
          cls: "wev-well wev-good",
          lines: [header("~ THE WISH IS GRANTED ~"), center(`${fmt(ev.throwers ?? 0)} THROWER${ev.throwers === 1 ? "" : "S"} GET 2x BACK`, W),
            center("CHECK YOUR SHARDS", W), [...Array(W)].map(() => (Math.random() < 0.15 ? pick("<>*.~") : " ")).join("")],
          actions,
        };
      }
      const well = [" .-~-. ", "|  ~  |", "'-___-'"];
      const mine = me?.event?.thrown ?? 0;
      const text = ["THROW SHARDS IN. FILL IT: EVERY THROWER GETS 2x",
        `[${meter(ev.filled / Math.max(1, ev.goal), W - 26)}] ${fmt(ev.filled)}/${fmt(ev.goal)}`,
        mine ? `YOU THREW ${fmt(mine)} <> (ONE THROW EACH)  ::  ${fmt(ev.throwers)} THREW`
          : `${fmt(ev.throwers)} THREW  ::  ONE THROW EACH  ::  MISS IT AND IT'S GONE`];
      // One throw each. Offered until you've thrown; a click that can't work says why
      // (pick a name / not enough shards).
      if (!mine) for (const n of [10, 100]) actions.push([`[ THROW ${fmt(n)}<> ]`, () => throwShards(n)]);
      return { cls: "wev-well", lines: [header("~ WISHING WELL", left), ...beside(well, text, 2, W - 12)], actions };
    }
    case "laststand": {
      if (ev.stage === "calm") {
        return {
          cls: "wev-laststand wev-good",
          lines: [header("THE LAST STAND HELD"), center("THE RAGE IS SPENT. IT'S STUNNED.", W),
            center(`${fmt(ev.hitters ?? 0)} FIGHTER${ev.hitters === 1 ? "" : "S"} GET A BOX`, W), ""],
          actions,
        };
      }
      const s = secsLeft(ev);
      return {
        cls: s <= 15 ? "wev-laststand wev-hot" : "wev-laststand",
        lines: [header("!! LAST STAND", left), center(`RAGE [${meter(ev.rage / Math.max(1, ev.max), W - 22, "!", " ")}] ${fmt(ev.rage)}`, W),
          center("EVERY HIT DRAINS IT. EMPTY IT: A BOX EACH", W),
          center("RUN OUT OF TIME AND IT HEALS 10%", W)],
        actions,
      };
    }
    case "possess": {
      if (ev.stage === "freed") {
        return {
          cls: "wev-possess wev-good",
          lines: [header("EXORCISED!"), center(`${possessedText(ev)} ${ev.possessed === 1 ? "IS" : "ARE"} FREE`, W),
            center(`${fmt(ev.helpers ?? 0)} EXORCIST${ev.helpers === 1 ? "" : "S"} GET A BOX`, W), ""],
          actions,
        };
      }
      const you = me?.event?.possessed;
      const pct = Math.min(100, Math.floor((100 * (ev.fill ?? 0)) / Math.max(1, ev.goal)));
      const bar = `EXORCISM [${meter((ev.fill ?? 0) / Math.max(1, ev.goal), W - 20, "+", ".")}] ${pct}%`;
      return {
        cls: you ? "wev-possess wev-hot" : "wev-possess",
        lines: [header(`~ POSSESSION :: EXORCISM ${pct}%`, left),
          center(you ? "YOU ARE POSSESSED! YOUR HITS HEAL THE BOSS"
            : `${possessedText(ev)} ${ev.possessed === 1 ? "IS" : "ARE"} POSSESSED: THEIR HITS HEAL IT`, W),
          center(bar, W),
          center(you ? `HEALED ${fmt(ev.healed ?? 0)}  ::  WAIT FOR THEM TO FREE YOU`
            : `HIT IT TO FREE THEM  ::  ${fmt(ev.helpers ?? 0)} EXORCISING  ::  HEALED ${fmt(ev.healed ?? 0)}`, W)],
        actions,
      };
    }
    case "second_wind": {
      const rnd = ev.round ?? 2; // ticket #268: THIRD (3) and FOURTH (4) WIND
      const wind = ["", "", "SECOND WIND", "THIRD WIND", "FOURTH WIND"][rnd] ?? "SECOND WIND";
      return {
        cls: "wev-round2",
        lines: [header(wind), center(frame % 4 < 2 ? `!!  R O U N D   ${rnd}  !!` : `    R O U N D   ${rnd}    `, W),
          center(`${rnd > 2 ? "IT GOT BACK UP AGAIN!" : "IT GOT BACK UP!"}  FREE ATTACKS + ${ev.loot ?? 5}x LOOT. SPAM IT!`, W),
          center(`${fmt(ev.round2 ?? 0)} FIGHTER${ev.round2 === 1 ? "" : "S"} IN ROUND ${rnd}`, W)],
        actions,
      };
    }
    default:
      return { cls: "", lines: [header(ev.name ?? ev.kind.toUpperCase(), left)], actions };
  }
}

/** Fit the panel to the header box: the font as big as the height allows, then
 * the width (W) stretched so the frame spans the box. Returns the font size.
 * @param {boolean} hasActions */
function sizePanel(hasActions) {
  if (!host) return 12;
  const narrow = window.matchMedia("(max-width: 640px)").matches;
  const availW = (host.parentElement?.clientWidth ?? 400) - 16 - (hasActions && !narrow ? 200 : 0);
  const availH = (host.parentElement?.clientHeight ?? 100) - 8 - (hasActions && narrow ? 34 : 0);
  let px = Math.min(18, availH / (ROWS * 1.18));
  W = Math.max(MIN_W, Math.min(120, Math.floor(availW / (px * 0.602)) - 4));
  px = Math.max(6, Math.min(px, availW / ((W + 4) * 0.602)));
  return px;
}

// ------------------------------------------------------------------ "it's live!" for people scrolled away

const DROP = /** @type {Record<string, string>} */ ({
  windup: "/!\\ WIND-UP: ULTIMATES GO 2x IN 30s", overload: "#! OVERLOAD: FILL THE METER, GET YOUR ULT BACK",
  merchant: "$ THE MERCHANT IS HERE FOR 3 MINUTES", stash: "$ A STASH APPEARED: BREAK IT FOR A BOX",
  replay: "(*) RECORDING: EVERY HIT LANDS AGAIN", combo: "COMBO! CHAIN HITS FOR UP TO 10x DAMAGE",
  fog: "~ THE FOG ROLLED IN: YOU CAN'T SEE A THING", swap: "<> SWAP MEET: YOU'RE IN SOMEONE ELSE'S GEAR",
  deal: "? A STRANGER OFFERS A DEAL (30s)", second_wind: "!! ROUND 2: FREE ATTACKS + 5x LOOT. SPAM IT !!",
  shard_rain: "<> SHARD RAIN: EVERY ATTACK = +1 SHARD (30s)",
  shield: "# SHIELD WALL: BREAK IT FOR A BOX", hunt: "<@> THE HUNT: TAP THE WEAK SPOT FOR 3x LOOT",
  hill: "^ KING OF THE HILL: MOST HITS IN 2 MINUTES", teams: "RED vs BLUE: MORE HITS WINS",
  well: "~ WISHING WELL: FILL IT, GET 2x BACK", laststand: "!! LAST STAND: DRAIN ITS RAGE OR IT HEALS 10%",
  possess: "~ POSSESSION: SOME FIGHTERS' HITS ARE HEALING IT",
  meow: "=^.^= MEOW MODE: PET ALL 10 CATS TO ATTACK",
});
let headerSeen = true;
let titleTimer = 0;
/** A one-off line for the banner (e.g. THE OPENING), shown for a few seconds over the event's own. */
let dropNote = { text: "", until: 0 };
/** The event (kind:started_at) whose banner was tapped away: it stays away for that event. */
let dropDismissed = "";

/** Flash the tab title when the tab is hidden, and put the line on the banner for a few seconds.
 * @param {string} text */
function announce(text) {
  if (document.hidden) {
    clearInterval(titleTimer);
    setFlashing(true);
    let on = false;
    titleTimer = window.setInterval(() => {
      on = !on;
      document.title = on ? `(!) ${text}` : plainTitle();
    }, 1000);
  }
  dropNote = { text, until: performance.now() + 7000 };
  paintDrop();
}

/** The drop-down line for an event (ROUND 3 / 4 name their own loot: ticket #268).
 * @param {any} ev @returns {string | undefined} */
function dropText(ev) {
  if (ev.kind === "second_wind" && (ev.round ?? 2) > 2) {
    return `!! ROUND ${ev.round}: FREE ATTACKS + ${ev.loot ?? 5}x LOOT. SPAM IT !!`;
  }
  return DROP[ev.kind];
}

/** Ticket #290: while an event runs and the boss header is scrolled away, a banner
 * hangs from the top with the time left, until the event ends, you tap it, or
 * you scroll back up. Runs every tick. */
function paintDrop() {
  const drop = document.getElementById("wev-drop");
  if (!drop) return;
  const ev = state.boss?.status === "alive" ? state.boss.event : null;
  const key = ev ? `${ev.kind}:${ev.started_at}` : "";
  const note = performance.now() < dropNote.until ? dropNote.text : "";
  let text = "";
  if (!headerSeen && ev && key !== dropDismissed) {
    const left = ev.until ? Math.max(0, Math.round(ev.until - now())) : 0;
    const clock = left ? `  ::  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} LEFT` : "";
    text = `${note || (dropText(ev) ?? `${ev.name ?? "AN EVENT"} IS ON`)}${clock}  [ TAP ]`;
  } else if (!headerSeen && note && dropDismissed !== `note:${dropNote.until}`) text = `${note}  [ TAP ]`;
  if (!text) {
    hideDrop();
    return;
  }
  if (drop.textContent !== text) drop.textContent = text;
  if (drop.hidden || drop.classList.contains("leaving")) {
    drop.classList.remove("leaving");
    drop.hidden = false;
    drop.style.animation = "none";
    void drop.offsetWidth;
    drop.style.removeProperty("animation");
  }
}

let dropLeaving = 0;
function hideDrop() {
  const drop = document.getElementById("wev-drop");
  if (!drop || drop.hidden || drop.classList.contains("leaving")) return;
  drop.classList.add("leaving");
  clearTimeout(dropLeaving);
  dropLeaving = window.setTimeout(() => {
    if (drop.classList.contains("leaving")) drop.hidden = true;
  }, 300);
}

/** The coin flip, then the deal's result (or null when there's nothing to show). */
function dealPanel() {
  if (!dealResult) return null;
  const t = performance.now() - dealResult.start;
  if (t > FLIP_MS + RESULT_MS) {
    dealResult = null;
    return null;
  }
  if (t < FLIP_MS && !reduced) {
    const faces = ["( O )", "( | )", "( o )", "( | )"];
    const face = faces[Math.floor(t / 70) % faces.length];
    const k = t / FLIP_MS;
    const row = Math.round(Math.sin(k * Math.PI)); // up and back down
    const rows = ["", ""].map((_, i) => (1 - i === row ? center(face, W) : ""));
    return { cls: "wev-deal", lines: [header("? THE DEAL"), ...rows, center("the coin is in the air...", W)] };
  }
  return { cls: dealResult.cls, lines: [header(dealResult.title), ...dealResult.lines.map((l) => center(l, W))] };
}

/** Start the flip; the sound lands with the coin. @param {string} title @param {string[]} lines @param {boolean} good */
function flipDeal(title, lines, good) {
  dealResult = { start: performance.now(), title, lines, cls: good ? "wev-deal wev-good" : "wev-deal wev-broken" };
  setTimeout(() => (good ? sound.crit() : sound.hit()), reduced ? 0 : FLIP_MS);
  draw();
}

/** @param {any} ev */
function stockLine(ev) {
  const offers = ev.offers ?? [];
  const boxes = offers.filter((/** @type {any} */ o) => o.kind === "box" && o.stock > 0).length;
  const items = offers.filter((/** @type {any} */ o) => o.kind === "item" && o.stock > 0).length;
  const wild = offers.some((/** @type {any} */ o) => o.kind === "wild" && o.stock > 0);
  return [boxes && `${boxes} BOX${boxes > 1 ? "ES" : ""} @ HALF`, items && "1 ITEM", wild && "1 ???"]
    .filter(Boolean).join(" :: ") || "SOLD OUT!";
}

// ------------------------------------------------------------------ the effects layer

/** Every ~120 ms: animate the bar and whatever is playing over the boss. */
function tick() {
  frame++;
  const ev = state.boss?.status === "alive" ? state.boss.event : null;
  if (ev || linger || anim || state.me?.event?.deal_pending) draw();
  if (ev?.kind === "fog" && ev.mode === "scrambled") {
    const fog = fogHp();
    const now_ = document.getElementById("hp-now");
    const pct = document.getElementById("hp-pct");
    if (fog && now_ && pct) {
      now_.textContent = fog.now;
      pct.textContent = fog.pct;
    }
  }
  paintFx(ev);
  paintFeedFog(ev?.kind === "fog");
  paintFeedRain(ev?.kind === "shard_rain");
  paintHunt();
  paintDrop();
}

/** Shards (<>) falling down a grid: each column has its own speed and start. @returns {string[][]}
 * @param {number} cols @param {number} rows @param {number} t */
function rainField(cols, rows, t) {
  const f = Array.from({ length: rows }, () => Array(cols).fill(" "));
  for (let c = 0; c < cols - 1; c += 3) {
    const seed = (c * 7919) % 97;
    if (seed % 3 === 0) continue; // gaps between the streams
    const speed = 0.35 + (seed % 5) * 0.08;
    const y = Math.floor((t * speed + seed) % (rows + 5)) - 2;
    if (y >= 0 && y < rows) {
      f[y][c] = "<";
      f[y][c + 1] = ">";
    }
    if (y - 1 >= 0 && y - 1 < rows) f[y - 1][c] = "'";
    if (y - 2 >= 0 && y - 2 < rows) f[y - 2][c] = ".";
  }
  return f;
}

/** SHARD RAIN over the feed: see-through, the feed stays readable. @param {boolean} on */
function paintFeedRain(on) {
  const rain = document.getElementById("feed-rain");
  if (!rain) return;
  // Runs 8x a second: touch the page only when something changes (an
  // unchanged write still makes the browser recheck styles).
  const hide = !on || reduced;
  if (rain.hidden !== hide) rain.hidden = hide;
  if (hide) return;
  const cols = Math.ceil(rain.clientWidth / (12 * 0.602)) + 1;
  const rows = Math.ceil(rain.clientHeight / 13.2) + 1;
  if (cols < 3 || rows < 2) return;
  rain.textContent = rainField(cols, rows, frame).map((r) => r.join("")).join("\n");
}

/** Seven-segment digits with a decimal point ("3.1"). @param {string} text */
function segNum(text) {
  const rows = ["", "", ""];
  for (const ch of text) {
    const g = ch === "." ? [" ", " ", "."] : segText(ch);
    for (let r = 0; r < 3; r++) rows[r] += (g[r] ?? "") + (ch === "." ? "" : " ");
  }
  return rows.map((r) => r.replace(/\s+$/, ""));
}

/** FOG: a dense ASCII fog over the whole feed (nobody can read it), drifting slowly. @param {boolean} on */
function paintFeedFog(on) {
  const fog = document.getElementById("feed-fog");
  if (!fog) return;
  if (fog.hidden !== !on) fog.hidden = !on;
  if (!on) return;
  const cols = Math.ceil(fog.clientWidth / (12 * 0.602)) + 1;
  const rows = Math.ceil(fog.clientHeight / 13.2) + 1;
  if (cols < 2 || rows < 2) return;
  const t = reduced ? 0 : frame * 0.18;
  const shades = " .:-~=+*#";
  const out = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const n = Math.sin((x + t * 1.6) / 5.3 + y * 0.7) + Math.sin((x - t) / 9.1 - y * 0.45)
        + Math.sin((x + y * 2.1 + t * 0.7) / 3.7) * 0.6;
      const k = Math.max(0, Math.min(shades.length - 1, Math.floor((n + 2.6) / 5.2 * shades.length)));
      line += shades[Math.max(2, k)]; // never blank: nothing shows through
    }
    out.push(line);
  }
  const label = "  THE FOG HAS SWALLOWED THE FEED  ";
  const mid = Math.floor(rows / 2);
  if (cols > label.length + 2) {
    const at = Math.floor((cols - label.length) / 2);
    out[mid] = out[mid].slice(0, at) + label + out[mid].slice(at + label.length);
  }
  fog.textContent = out.join("\n");
}

/** @param {any} ev */
function paintFx(ev) {
  if (!fxEl) return;
  const t = performance.now();
  const Wf = 48, H = 14;
  if (anim && t - anim.start > anim.dur) anim = null;
  /** @type {string[][] | null} */
  let field = null;
  const blank = () => Array.from({ length: H }, () => Array(Wf).fill(" "));
  const put = (/** @type {string[][]} */ f, /** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ ch) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (yi >= 0 && yi < H && xi >= 0 && xi < Wf) f[yi][xi] = ch;
  };
  if (anim && !reduced) {
    const k = (t - anim.start) / anim.dur;
    const f = blank();
    field = f;
    const cx = Wf / 2, cy = H / 2;
    if (anim.kind === "burst") {
      for (const [lag, ch] of /** @type {[number, string][]} */ ([[0, "*"], [0.18, "+"], [0.34, "."]])) {
        const r = Math.max(0, k - lag) * 16;
        if (r <= 0) continue;
        for (let a = 0; a < 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          put(f, cx + Math.cos(ang) * r * 1.5, cy + Math.sin(ang) * r * 0.5, ch);
        }
      }
      if (k < 0.6) [..."2 x !"].forEach((ch, i) => put(f, cx - 2 + i, cy, ch));
      fxEl.className = "wev-fx wev-fx-burst";
    } else if (anim.kind === "bolt") {
      for (let b = 0; b < 3; b++) {
        if (Math.random() < 0.5) continue;
        let x = 6 + Math.random() * (Wf - 12);
        for (let y = 0; y < H; y++) {
          x += Math.random() < 0.5 ? -1 : 1;
          put(f, x, y, Math.random() < 0.5 ? "/" : "\\");
        }
      }
      fxEl.className = "wev-fx wev-fx-bolt";
    } else if (anim.kind === "coins") {
      anim.data ??= Array.from({ length: 26 }, () => ({ a: Math.random() * Math.PI * 2, v: 8 + Math.random() * 18, ch: pick("$$<>*o.") }));
      for (const p of anim.data) {
        const d = p.v * k;
        put(f, cx + Math.cos(p.a) * d * 1.6, cy + Math.sin(p.a) * d * 0.55 + k * k * 6, p.ch);
      }
      fxEl.className = "wev-fx wev-fx-coins";
    } else if (anim.kind === "rewind") {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < Wf; x++) if ((x + Math.floor(k * 60) + y) % 11 < 2) f[y][x] = "<";
      }
      fxEl.className = "wev-fx wev-fx-rewind";
    } else if (anim.kind === "round2") {
      fxEl.className = "wev-fx wev-fx-round2";
      field = round2Frame(t - anim.start);
    }
  } else if (ev?.kind === "shard_rain" && !reduced) {
    field = rainField(Wf, H, frame);
    fxEl.className = "wev-fx wev-fx-rain";
  } else if (ev?.kind === "fog" && !reduced) {
    field = blank();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < Wf; x++) {
        const n = Math.sin((x + frame * 0.6) / 4.2 + y * 0.9) + Math.sin((x - frame * 0.35) / 7 + y * 0.4);
        if (n > 0.9) field[y][x] = n > 1.5 ? ":" : n > 1.2 ? "~" : ".";
      }
    }
    fxEl.className = "wev-fx wev-fx-fog";
  } else if (ev?.kind === "overload" && ev.stage === "stagger" && !reduced && frame % 6 === 0) {
    anim = { kind: "bolt", start: t, dur: 260 };
  }
  const text = field ? field.map((r) => r.join("")).join("\n") : "";
  if (fxEl.textContent !== text) fxEl.textContent = text;
  if (fxEl.hidden !== !field) fxEl.hidden = !field;
}

// ------------------------------------------------------------------ second wind

/** The boss "dies", lies there, then gets back up: ROUND 2 (or 3, 4: ticket #268). */
let windRound = 2;
/** @param {number} rnd */
function playSecondWind(rnd) {
  const t = performance.now();
  windRound = rnd;
  anim = { kind: "round2", start: t, dur: reduced ? 400 : 4200 };
  document.body.classList.add("wev-fakedeath");
  setTimeout(() => {
    shake("s");
    sound.hit();
  }, reduced ? 0 : 1700);
  setTimeout(() => {
    shake("s");
    sound.hit();
  }, reduced ? 0 : 2300);
  setTimeout(() => {
    document.body.classList.remove("wev-fakedeath");
    shake("l");
    sound.ultimate();
  }, reduced ? 0 : 2900);
}

/** @param {number} ms */
function round2Frame(ms) {
  const Wf = 48, H = 14;
  const lines = Array.from({ length: H }, () => "");
  const def = state.boss ? bossDef(state.boss.def_id) : null;
  const dead = (def?.dead_art ?? ["  x_x  "]).slice(0, H - 2);
  if (ms < 1500) {
    const block = centerBlock(dead, Wf);
    block.forEach((l, i) => (lines[i + 1] = l));
    lines[H - 1] = center("K . O .", Wf);
  } else if (ms < 2900) {
    const beat = ms < 1900 || (ms > 2300 && ms < 2600) ? "ba-DUMP" : "  ...  ";
    lines[5] = center(beat, Wf);
    lines[7] = center(ms > 2300 ? "WAIT." : "", Wf);
  } else {
    const word = centerBlock(bigWord(`ROUND ${windRound}`), Wf);
    word.forEach((l, i) => (lines[i + 4] = l));
    lines[11] = center(windRound > 2 ? "IT GOT BACK UP AGAIN!" : "IT GOT BACK UP!", Wf);
  }
  return lines.map((l) => [...padR(l, Wf)]);
}

// ------------------------------------------------------------------ attack hooks

/** Callouts for an attack's world-event procs. A double-or-nothing ultimate
 * flips its coin in the event panel instead.
 * @param {any} procs @returns {string[]} */
export function eventCallouts(procs) {
  if (procs.deal === "won") flipDeal("HEADS!", ["YOUR ULTIMATE WENT 2x"], true);
  else if (procs.deal === "lost") flipDeal("TAILS...", ["YOUR ULTIMATE FIZZLED"], false);
  return [
    procs.fire && "2X DAMAGE!",
    procs.event === "windup" && "2x WIND-UP!",
    procs.event === "stagger" && "x1.5 STAGGER!",
    procs.combo >= 2 && `${procs.combo}-HIT COMBO`,
    procs.shard && `+${procs.shard} <>`,
    procs.second_wind && "IT GOT BACK UP?!",
    procs.shield && "BLOCKED BY THE SHIELD",
    procs.possessed && `POSSESSED! YOU HEALED IT +${fmt(procs.heal ?? 0)}`,
    procs.spot && "WEAK SPOT! 3x LOOT",
  ].filter((s) => typeof s === "string");
}

/** A pop-up message for this player only (OVERLOAD handing back ultimates). @param {any} msg */
export function onEventReward(msg) {
  sound.loot();
  popup(msg.text ?? "ULTIMATE READY!", "proc");
  api.getMe().then((m) => {
    state.me = m;
    emit("me");
  }).catch(() => {});
}

// ------------------------------------------------------------------ the deal

async function takeDeal() {
  if (busy) return;
  busy = true;
  draw();
  try {
    const res = await api.takeDeal();
    state.me = res.me;
    emit("me");
    if (res.box_id) {
      const name = boxById(res.box_id)?.name ?? res.box_id;
      const good = ["occult_ossuary", "void_reliquary"].includes(res.box_id);
      flipDeal(good ? "JACKPOT!" : "DEAL DONE", [`YOU GOT: ${name}`, "IT'S IN YOUR BAG"], true);
    }
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    draw();
  }
}

// ------------------------------------------------------------------ the wishing well

/** @param {number} amount */
async function throwShards(amount) {
  if (busy) return;
  if (!state.me?.name_chosen) {
    showError("Make your account first (hit [ ATTACK ]), then throw.");
    return;
  }
  if ((state.me.shards ?? 0) < 1) {
    showError("You don't have any shards to throw.");
    return;
  }
  busy = true;
  draw();
  try {
    const res = await api.throwShards(Math.min(amount, state.me?.shards ?? amount)); // short? throw what you have
    state.me = res.me;
    emit("me");
    popup(`-${fmt(res.thrown)} <> INTO THE WELL`, "proc");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
    draw();
  }
}

// ------------------------------------------------------------------ the merchant

function openMerchant() {
  showOverlay((inner, close) => {
    const title = el("pre", "art merchant-title", ["  _\\_      THE MERCHANT", " (o.o)     \"TAKE YOUR TIME.", " /|$|\\      NOT TOO MUCH TIME.\"", " _/ \\_"].join("\n"));
    const list = el("div", "merchant-list");
    const foot = el("div", "actions");
    inner.append(title, list, foot);
    foot.append(button("[ LEAVE ]", close));
    /** @type {HTMLElement[]} */
    const wilds = [];
    const paint = () => {
      const ev = state.boss?.event;
      if (!ev || ev.kind !== "merchant") {
        list.replaceChildren(el("p", "dim", "he's gone."));
        return;
      }
      wilds.length = 0;
      const bought = new Set(state.me?.event?.bought ?? []);
      list.replaceChildren(...ev.offers.map((/** @type {any} */ o) => {
        const row = el("div", "merchant-row");
        let name;
        if (o.kind === "box") name = el("span", "box-tag", boxById(o.box_id)?.name ?? o.box_id);
        else if (o.item_id) {
          const st = RARITY_STYLE[o.rarity] ?? RARITY_STYLE.common;
          name = el("span", `r-${o.rarity}`, `${st.deco[0]}${rarityById(o.rarity)?.label ?? o.rarity}${st.deco[1]} ${itemById(o.item_id)?.name ?? o.item_id}`);
        } else {
          name = el("span", "merchant-wild", "? ? ? ? ?");
          wilds.push(name);
        }
        const what = el("span", "merchant-what");
        const note = o.kind === "box" ? "  (half price)" : o.kind !== "wild" ? "" : o.item_id ? "  (was the ???)" : "  (could be anything)";
        what.append(name, el("span", "dim", note));
        const price = el("span", "shard-tag", `<> ${fmt(o.price)}`);
        const stock = el("span", "dim", o.stock > 0 ? `${o.stock} LEFT` : "SOLD OUT");
        const can = o.stock > 0 && !bought.has(o.id) && (state.me?.shards ?? 0) >= o.price;
        const label = bought.has(o.id) ? "BOUGHT" : o.stock < 1 ? "GONE" : (state.me?.shards ?? 0) < o.price ? "TOO PRICEY" : "[ BUY ]";
        const btn = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", label));
        btn.disabled = !can || busy;
        btn.addEventListener("click", () => buyOffer(o.id, close));
        row.append(what, price, stock, btn);
        return row;
      }), el("div", "dim merchant-note", `you have <> ${fmt(state.me?.shards ?? 0)} shards. one of each per customer.`));
    };
    paint();
    const timer = setInterval(() => {
      if (!inner.isConnected) {
        clearInterval(timer);
        return;
      }
      for (const w of wilds) w.textContent = [...Array(9)].map((_, i) => (i % 2 ? " " : pick("?#$%&*@"))).join("");
      if (frame % 8 === 0) paint();
    }, 110);
  }, { dismissable: true });
}

/** @param {string} offerId @param {() => void} close */
async function buyOffer(offerId, close) {
  if (busy) return;
  busy = true;
  try {
    const res = await api.buyOffer(offerId);
    state.me = res.me;
    emit("me");
    close();
    sound.loot();
    const equip = async (/** @type {string} */ id) => {
      try {
        state.me = await api.equip(id);
        emit("me");
      } catch (e) {
        showError(/** @type {Error} */ (e).message);
      }
    };
    if (res.box_id) {
      const boxDef = boxById(res.box_id);
      if (boxDef) await boxDropReveal(boxDef, () => openBox(boxDef), "BOUGHT FROM THE MERCHANT");
    } else if (res.item_id) {
      const item = itemById(res.item_id);
      if (!item) return;
      if (res.kind === "wild") await wildReveal(item);
      await lootReveal(item, equip, res.kind === "wild" ? `THE ??? WAS ${rarityById(item.rarity)?.label ?? item.rarity}!` : "BOUGHT FROM THE MERCHANT");
    }
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  } finally {
    busy = false;
  }
}

/** The ??? spins through rarities and lands on what it really is. @param {any} item */
function wildReveal(item) {
  const order = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC", "GODLY", "ASCENDED"];
  const real = rarityById(item.rarity)?.label ?? item.rarity.toUpperCase();
  return showOverlay((inner, close) => {
    const pre = el("pre", "art wild-reveal");
    inner.append(pre);
    let i = 0;
    const steps = reduced ? 1 : 18;
    const spin = () => {
      const label = i < steps - 1 ? order[i % order.length] : real;
      pre.className = `art wild-reveal r-${i < steps - 1 ? order[i % order.length].toLowerCase() : item.rarity}`;
      pre.textContent = ["+--------------------+", `|${center("THE ??? IS...", 20)}|`, `|${" ".repeat(20)}|`,
        `|${center(label, 20)}|`, "+--------------------+"].join("\n");
      i++;
      if (i < steps) setTimeout(spin, 60 + i * i * 1.2);
      else {
        shake("l");
        sound.crit();
        setTimeout(close, reduced ? 300 : 900);
      }
    };
    spin();
  }, { autoCloseMs: 6000 });
}

export function initWorldEvents() {
  host = document.getElementById("wev");
  const drop = document.getElementById("wev-drop");
  drop?.addEventListener("click", () => {
    const ev = state.boss?.status === "alive" ? state.boss.event : null;
    dropDismissed = ev ? `${ev.kind}:${ev.started_at}` : `note:${dropNote.until}`;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    hideDrop();
  });
  const top = document.querySelector("header.top");
  if (top && "IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      headerSeen = entries[0]?.isIntersecting ?? true;
      paintDrop();
    }, { threshold: 0.4 }).observe(top);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    clearInterval(titleTimer);
    setFlashing(false);
  });
  window.addEventListener("resize", () => draw());
  fxEl = document.getElementById("wev-fx");
  setInterval(tick, 120);
}
