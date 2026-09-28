// The death animation, played once before the death scoreboard:
//
//   1. the boss lifts off the page and glides to the middle of the screen,
//      twitching between its normal and hurt frames;
//   2. the mist rolls in and swirls around it, then closes over it while the
//      art crumbles into mist characters;
//   3. the mist parts again on its death image (decoded character by
//      character), with its name and death line.
//
// Tap anywhere to skip. Reduced motion gets a short fade to the death image.

import { el } from "../ascii.js?v=c9274a97a7";
import { showOverlay } from "./fx.js?v=c9274a97a7";
import { startMist } from "./mist.js?v=c9274a97a7";

const MIST = " .'`,:;-~=+*";
const GLYPHS = "#%&@$*+=-:;.'~^";

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {number} t */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Animate ``fn(progress 0..1)`` over ``ms``; resolves early if ``skip()`` says so.
 * @param {number} ms @param {(p: number) => void} fn @param {() => boolean} skip */
function tween(ms, fn, skip) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      const p = skip() ? 1 : Math.min(1, (performance.now() - start) / ms);
      fn(p);
      if (p < 1) requestAnimationFrame(step);
      else resolve(undefined);
    };
    requestAnimationFrame(step);
  });
}

/** The art with a share ``p`` of its characters crumbled into mist. @param {string[]} lines @param {number} p */
function crumble(lines, p) {
  return lines
    .map((line) =>
      [...line].map((ch) => (ch !== " " && Math.random() < p ? MIST[1 + Math.floor(Math.random() * (MIST.length - 1))] : ch)).join(""),
    )
    .join("\n");
}

/** The art decoding in: each character settles at its own moment. @param {string[]} lines @param {number[][]} at @param {number} p */
function decode(lines, at, p) {
  return lines
    .map((line, y) =>
      [...line].map((ch, x) => (ch === " " || at[y][x] <= p ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""),
    )
    .join("\n");
}

/**
 * Play the death animation.
 * @param {{name: string, tint?: string | null, death_line?: string, dead_art: string[],
 *          phases: {art: string[], hurt_art: string[]}[]}} def  the boss definition
 * @param {{rect?: DOMRect | null, lines?: string[] | null}} [from]  where the boss was on screen
 */
export function playDeath(def, from = {}) {
  const last = def.phases[def.phases.length - 1];
  const lines = from.lines ?? last.art;
  const hurtLines = last.hurt_art?.length ? last.hurt_art : lines;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return showOverlay(
    (inner, close) => {
      const overlay = /** @type {HTMLElement} */ (inner.parentElement);
      overlay.classList.add("death");
      if (def.tint) overlay.style.setProperty("--death-tint", def.tint);
      let skipped = false;
      const skip = () => skipped;
      overlay.onclick = () => (skipped = true);

      const mistEl = el("pre", "death-mist");
      mistEl.setAttribute("aria-hidden", "true");
      const art = el("pre", "death-art");
      art.setAttribute("aria-hidden", "true");
      const title = el("div", "death-title");
      const line = el("div", "death-line");
      const hint = el("div", "death-skip", "tap to skip");
      overlay.prepend(mistEl);
      inner.append(art, title, line, hint);
      inner.classList.add("death-inner");

      // Size the art to ~80% of the screen width (it's 36 columns wide).
      const cols = Math.max(...lines.map((l) => l.length), 36);
      const target = Math.min(window.innerWidth * 0.82, 560);
      const fontPx = Math.max(6, Math.min(22, target / (cols * 0.6)));
      art.style.fontSize = `${fontPx}px`;
      art.textContent = lines.join("\n");

      // Mist: eye = the art; shrink it to swallow the boss, grow it to reveal.
      let eyeScale = 1.4;
      let density = 0;
      let fill = 0;
      const mist = startMist(mistEl, {
        eye: () => art.getBoundingClientRect(),
        eyeScale: () => eyeScale,
        density: () => density,
        fill: () => fill,
        maxEyeFrac: 0.48,
      });

      const finish = () => {
        mist.stop();
        overlay.classList.remove("death");
        overlay.style.removeProperty("--death-tint");
        mistEl.remove();
        close();
      };

      (async () => {
        if (reduced) {
          art.textContent = def.dead_art.join("\n");
          title.textContent = `${def.name} HAS FALLEN`;
          line.textContent = def.death_line ?? "";
          density = 0.6;
          await sleep(1800);
          finish();
          return;
        }
        // 1. Lift off: start where the boss was on the page, glide to the middle.
        const end = art.getBoundingClientRect();
        const start = from.rect && from.rect.width > 0 && from.rect.bottom > 0 && from.rect.top < window.innerHeight ? from.rect : null;
        const dx = start ? start.left + start.width / 2 - (end.left + end.width / 2) : 0;
        const dy = start ? start.top + start.height / 2 - (end.top + end.height / 2) : window.innerHeight * 0.08;
        const s0 = start ? start.width / end.width : 0.6;
        let flick = 0;
        await tween(1300, (p) => {
          const e = ease(p);
          art.style.transform = `translate(${dx * (1 - e)}px, ${dy * (1 - e)}px) scale(${s0 + (1 - s0) * e})`;
          art.style.opacity = String(start ? 1 : e);
          overlay.style.setProperty("--death-dim", String(0.97 * Math.min(1, p * 3))); // dark fast, glide slow
          if (++flick % 5 === 0) art.textContent = (flick % 10 === 0 ? hurtLines : lines).join("\n");
        }, skip);
        art.textContent = lines.join("\n");

        // 2. The mist rolls in and circles it, the boss convulsing...
        await tween(1500, (p) => {
          density = 0.25 + p * 0.9;
          fill = p * 0.3;
          eyeScale = 1.4 - p * 0.35;
          if (Math.random() < 0.18) {
            art.textContent = (Math.random() < 0.5 ? hurtLines : lines).join("\n");
            art.classList.toggle("jolt");
          }
          if (Math.random() < 0.08) mist.pulse(0.6);
        }, skip);
        art.classList.remove("jolt");

        // ...then closes over it while it crumbles away.
        await tween(1500, (p) => {
          eyeScale = 1.05 * (1 - ease(p)) + 0.02;
          density = 1.15 + p * 0.4;
          fill = 0.3 + ease(p) * 0.75;
          art.textContent = crumble(lines, ease(p));
          art.style.opacity = String(1 - ease(p) * 0.85);
        }, skip);
        art.textContent = "";
        if (!skipped) await sleep(450);

        // 3. The mist parts on the death image.
        const dead = def.dead_art;
        const at = dead.map((l) => [...l].map(() => Math.random()));
        art.style.opacity = "1";
        art.classList.add("dead");
        mist.pulse(1.2);
        await tween(1700, (p) => {
          eyeScale = 0.02 + ease(p) * 1.25;
          density = 1.55 - p * 0.85;
          fill = 1.05 - ease(p) * 0.85;
          art.textContent = decode(dead, at, Math.min(1, p * 1.25));
        }, skip);
        art.textContent = dead.join("\n");
        title.textContent = `${def.name} HAS FALLEN`;
        title.classList.add("in");
        await sleep(skipped ? 0 : 500);
        line.textContent = def.death_line ?? "";
        line.classList.add("in");
        hint.textContent = "tap to continue";
        // Hold on the death image. A tap during the animation only skipped to
        // here; it takes a fresh tap (or a few seconds) to move on.
        skipped = false;
        await tween(3500, () => {}, skip);
        await mist.dissipate(skipped ? 150 : 700);
        finish();
      })();
    },
    { dismissable: false },
  );
}
