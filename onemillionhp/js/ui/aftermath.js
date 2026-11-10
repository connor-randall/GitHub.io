// After the death scoreboard: a nervous little monologue, typed out, then
// the next boss's name slammed across the whole screen in big block letters.

import { el } from "../ascii.js?v=b6664395f3";
import { bossDef, now, state } from "../store.js?v=b6664395f3";
import { onSkipDeath, shake, showOverlay } from "./fx.js?v=b6664395f3";

const LINES = ["Yay we did it.....", "uh guys do you hear that?.......", "Its right behind me isnt it?"];

/** 5-row block font (A-Z, 0-9 and a little punctuation). */
const FONT = /** @type {Record<string, string[]>} */ ({
  A: [" ### ", "#   #", "#####", "#   #", "#   #"], B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", " ####"], D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"], F: ["#####", "#    ", "#### ", "#    ", "#    "],
  G: [" ####", "#    ", "#  ##", "#   #", " ####"], H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  I: ["###", " # ", " # ", " # ", "###"], J: ["  ###", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"], L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"], N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "], P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  Q: [" ### ", "#   #", "# # #", "#  # ", " ## #"], R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "], T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "], V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"], X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "], Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
  0: [" ### ", "#  ##", "# # #", "##  #", " ### "], 1: [" # ", "## ", " # ", " # ", "###"],
  2: [" ### ", "#   #", "  ## ", " #   ", "#####"], 3: ["#### ", "    #", " ### ", "    #", "#### "],
  4: ["#  # ", "#  # ", "#####", "   # ", "   # "], 5: ["#####", "#    ", "#### ", "    #", "#### "],
  6: [" ### ", "#    ", "#### ", "#   #", " ### "], 7: ["#####", "   # ", "  #  ", " #   ", " #   "],
  8: [" ### ", "#   #", " ### ", "#   #", " ### "], 9: [" ### ", "#   #", " ####", "    #", " ### "],
  "!": ["#", "#", "#", " ", "#"], "'": ["#", "#", " ", " ", " "], ".": [" ", " ", " ", " ", "#"],
  "-": ["    ", "    ", "####", "    ", "    "], " ": ["  ", "  ", "  ", "  ", "  "],
});

/** One word/line in block letters. @param {string} text */
export function blockLetters(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 5; r++) rows[r] += g[r] + " ";
  }
  return rows.map((r) => r.replace(/\s+$/, ""));
}

/** Split a name into lines of at most ``max`` characters (by word). @param {string} name @param {number} max */
function wrap(name, max) {
  const out = [];
  let line = "";
  for (const word of name.split(/\s+/)) {
    if (line && (line + " " + word).length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** The boss that comes (or came) after the defeated ``dead``, exactly as the
 * server picks it (manual queue, then the random plan or the numbered order).
 * The next boss arrives 60 s after a kill, often while the ceremony is still
 * playing, so once it's live, use the live boss itself; until then the
 * server's latest ``next_definition`` (refreshed if the admin reorders the
 * queue). Never guess by boss number: that ignores the queue.
 * @param {any} dead  the defeated boss's snapshot */
export function nextBossAfter(dead) {
  const live = state.boss;
  if (live && live.seq === dead.seq + 1) {
    const def = live.definition ?? bossDef(live.def_id);
    return def ? { ...def, name: live.name } : null;
  }
  if (live && live.seq === dead.seq) return live.next_definition ?? null;
  return dead.next_definition ?? null;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRAMBLE = "#%&@$*+=:;";

/** @typedef {{back: HTMLElement, front: HTMLElement}} Layer */

/** One block of big letters in ``stage``: the letters, and a dark copy
 * offset behind them for depth. @param {HTMLElement} stage @param {string} cls */
export function stackLayer(stage, cls) {
  const wrapEl = el("div", `stack ${cls}`);
  const back = el("pre", "stack-shadow");
  const front = el("pre", "stack-front");
  wrapEl.append(back, front);
  stage.append(wrapEl);
  return { back, front };
}

/** Block letters sweep in left to right, scrambling as they land.
 * @param {Layer} pre @param {string[]} lines @param {number} ms @param {() => boolean} fast */
export async function stampLetters(pre, lines, ms, fast) {
  const w = Math.max(...lines.map((l) => l.length));
  const at = lines.map((l) => [...l].map((_, x) => x / w + Math.random() * 0.12));
  const start = performance.now();
  for (;;) {
    const p = fast() ? 2 : (performance.now() - start) / ms;
    const text = lines
      .map((l, y) => [...l].map((ch, x) => (ch === " " || at[y][x] <= p - 0.12 ? ch
        : at[y][x] <= p ? SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)] : " ")).join(""))
      .join("\n");
    pre.front.textContent = text;
    pre.back.textContent = text;
    if (p >= 1.24) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
  pre.front.textContent = pre.back.textContent = lines.join("\n"); // fully settled
}

/**
 * The monologue + "<NEXT BOSS> HAS APPEARED!" screen.
 * @param {any} next  the next boss's definition
 * @param {number | null} nextAt  when it arrives (server time), for the countdown
 */
export function nextBossScreen(next, nextAt) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return showOverlay(
    (inner, close) => {
      const overlay = /** @type {HTMLElement} */ (inner.parentElement);
      overlay.classList.add("aftermath");
      inner.classList.add("aftermath-inner");
      let fast = reduced;
      overlay.onclick = (e) => {
        if (!(e.target instanceof HTMLButtonElement)) fast = true; // tap: finish the typing
      };
      const talk = el("pre", "monologue");
      const cursor = el("span", "type-cursor", "_");
      talk.append(cursor);
      inner.append(talk);

      const finish = onSkipDeath(() => {
        overlay.classList.remove("aftermath");
        overlay.style.removeProperty("--next-tint");
        close();
      });

      (async () => {
        // 1. The monologue, typed. Dots crawl.
        await sleep(fast ? 0 : 500);
        for (const [i, line] of LINES.entries()) {
          if (i) cursor.before("\n");
          cursor.before("> ");
          for (const ch of line) {
            cursor.before(ch);
            if (!fast) await sleep(ch === "." ? 230 : ch === "?" ? 380 : 42 + Math.random() * 40);
          }
          if (!fast) await sleep(i === LINES.length - 1 ? 1100 : 750);
        }

        // 2. It's right behind you (a shake; the white flash was too bright).
        shake("l");
        await sleep(fast ? 60 : 180);
        talk.remove();
        if (next.tint) overlay.style.setProperty("--next-tint", next.tint);

        // Every line of big letters is centered on its own. The name wraps
        // by word; "HAS APPEARED!" is one line if it fits, else two.
        const budget = Math.max(40, Math.floor(window.innerWidth / 9)); // columns that stay readable
        const nameLines = wrap(next.name, Math.max(8, Math.floor(budget / 6))).map(blockLetters);
        const oneLine = blockLetters("HAS APPEARED!");
        const tail = oneLine[0].length <= budget ? [oneLine] : [blockLetters("HAS"), blockLetters("APPEARED!")];
        const cols = Math.max(...[...nameLines, ...tail].flat().map((l) => l.length));
        const rows = (nameLines.length + tail.length) * 6;
        const px = Math.max(5, Math.min(30, (window.innerWidth * 0.92) / (cols * 0.6), (window.innerHeight * 0.62) / rows));
        const stage = el("div", "appeared");
        stage.style.fontSize = `${px}px`;
        const layer = (/** @type {string} */ cls) => stackLayer(stage, cls);
        const nameLayers = nameLines.map(() => layer("appeared-name"));
        const tailLayers = tail.map(() => layer("appeared-tail"));
        const count = el("div", "panic-count", "");
        const actions = el("div", "actions");
        const ok = el("button", "", "[ BRACE YOURSELF ]");
        ok.addEventListener("click", finish);
        inner.append(stage, count, actions);

        // 3. Block letters sweep in left to right, scrambling as they land.
        const stamp = (/** @type {Layer} */ pre, /** @type {string[]} */ lines, /** @type {number} */ ms) =>
          stampLetters(pre, lines, ms, () => fast);
        for (const [i, lines] of nameLines.entries()) await stamp(nameLayers[i], lines, 1100 / nameLines.length);
        shake("s");
        await sleep(fast ? 0 : 250);
        for (const [i, lines] of tail.entries()) await stamp(tailLayers[i], lines, 800 / tail.length);
        shake("l");
        stage.classList.add("landed");

        const tick = () => {
          if (!count.isConnected || nextAt === null) return;
          const left = Math.max(0, Math.round(nextAt - now()));
          count.textContent = left > 0 ? `ARRIVES IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "IT'S HERE.";
          setTimeout(tick, 1000);
        };
        tick();
        actions.append(ok);
        ok.focus({ preventScroll: true });
      })();
    },
    { dismissable: false },
  );
}
