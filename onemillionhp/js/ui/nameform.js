// Name entry, shared by the first-visit prompt and the [ YOU ] rename form.
// Errors (taken, not allowed, bad characters) appear right under the input.

import * as api from "../api.js";
import { box, el, setArt } from "../ascii.js";
import { emit, state } from "../store.js";
import { showOverlay } from "./fx.js";

const ADJ = ["MOSSY", "FERAL", "RUSTY", "GLOOMY", "SOGGY", "GRIM", "TINY", "NEON", "VOID", "FUZZY",
  "SNEAKY", "CURSED", "HOLLOW", "FERVENT", "DAMP", "GILDED", "FROSTY", "SPOOKY", "MIGHTY", "WEARY"];
const NOUN = ["GOBLIN", "WIZARD", "CRAB", "TOAD", "KNIGHT", "MOTH", "GREMLIN", "SLIME", "RAT", "BARD",
  "IMP", "OWL", "GHOUL", "SQUIRE", "BEETLE", "WYRM", "HERMIT", "LICH", "GOAT", "BADGER"];

const pick = (/** @type {string[]} */ a) => a[Math.floor(Math.random() * a.length)];

/** A random ADJ_NOUN name, always within the 16-character limit. */
export function randomName() {
  for (;;) {
    const n = `${pick(ADJ)}_${pick(NOUN)}`;
    if (n.length <= 16) return n;
  }
}

/**
 * @param {{value?: string, submitLabel: string, withRoll?: boolean, onSaved: () => void}} opts
 * @returns {{form: HTMLFormElement, input: HTMLInputElement}}
 */
export function nameForm(opts) {
  const form = /** @type {HTMLFormElement} */ (el("form", "name-form"));
  const row = el("div", "name-row");
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.value = opts.value ?? "";
  input.placeholder = "YOUR NAME";
  input.maxLength = 16;
  input.autocapitalize = "characters";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Your name");
  const err = el("div", "name-err");
  err.setAttribute("role", "alert");
  input.setAttribute("aria-describedby", "name-err");
  err.id = "name-err";
  const hint = el("div", "name-hint dim", "3-16 letters, numbers or _ . keep it clean.");
  const save = el("button", "inline-btn", opts.submitLabel);
  row.append(el("span", "dim", ">"), input);
  if (opts.withRoll) {
    const roll = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ ROLL ]"));
    roll.type = "button";
    roll.title = "random name";
    roll.addEventListener("click", () => {
      input.value = randomName();
      err.textContent = "";
      input.focus();
    });
    row.append(roll);
  }
  row.append(save);
  form.append(row, err, hint);
  input.addEventListener("input", () => (err.textContent = ""));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) {
      err.textContent = "> a name, wanderer. any name.";
      return;
    }
    try {
      state.me = await api.rename(input.value);
      emit("me");
      opts.onSaved();
    } catch (ex) {
      err.textContent = "> " + /** @type {Error} */ (ex).message;
      input.focus();
      input.select();
    }
  });
  return { form, input };
}

let prompting = false;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const INTRO = [
  "> A NEW TERMINAL HAS CONNECTED...",
  "",
  "> GORTHAK DOES NOT FIGHT STRANGERS.",
  "",
  "> NAME YOURSELF BEFORE YOU FIGHT.",
];
const FRAME_W = 40;

/** The framed terminal with the first `chars` characters of INTRO typed. @param {number} chars */
function introFrame(chars, cursor = true) {
  let left = chars;
  const lines = INTRO.map((line) => {
    const shown = line.slice(0, Math.max(0, left));
    left -= line.length;
    return shown;
  });
  // Cursor goes after the last character typed so far.
  const cursorLine = Math.min(lines.length - 1, lines.findIndex((l, i) => l.length < INTRO[i].length));
  const at = cursorLine < 0 ? lines.length - 1 : cursorLine;
  if (cursor) lines[at] += "_";
  const title = "[ ONE MILLION HP :: IDENTIFY ]";
  const body = box(["", ...lines, ""], { width: FRAME_W, align: "left", padX: 2 });
  body[0] = "+" + title.padEnd(FRAME_W - 2, "-").slice(0, FRAME_W - 2) + "+";
  return body;
}

/** "Name yourself" - a dimmed screen, a typed-out message, then the name box. */
export function promptForName() {
  if (prompting || !state.me || state.me.name_chosen) return;
  prompting = true;
  const flat = INTRO.join("");
  const total = flat.length;
  // Indices where a line finishes: pause there like a terminal would.
  const lineEnds = new Set(INTRO.map((_, i) => INTRO.slice(0, i + 1).join("").length));
  showOverlay(
    (inner, close) => {
      inner.parentElement?.classList.add("identify");
      const pre = el("pre", "art identify-text");
      const rest = el("div", "identify-form");
      rest.hidden = true;
      inner.append(pre, rest);
      const { form, input } = nameForm({ submitLabel: "[ ENTER ]", withRoll: true, onSaved: close });
      form.classList.add("prompt");
      const later = el("div", "actions");
      const b = el("button", "", "[ just looking ]");
      b.addEventListener("click", close);
      later.append(b);
      rest.append(form, later);

      let typed = reduced ? total : 0;
      /** @type {number} */
      let timer = 0;
      let blink = 0;
      const reveal = () => {
        if (!rest.hidden) return;
        rest.hidden = false;
        input.focus();
        // The cursor keeps blinking at the end of the message.
        blink = window.setInterval(() => {
          if (!pre.isConnected) return clearInterval(blink);
          setArt(pre, introFrame(total, Date.now() % 1000 < 500), 16);
        }, 250);
      };
      const tick = () => {
        setArt(pre, introFrame(typed), 16);
        if (typed >= total) return reveal();
        typed += 1;
        const delay = lineEnds.has(typed) ? 380 : flat[typed - 1] === "." ? 90 : 28;
        timer = window.setTimeout(tick, delay);
      };
      // Tap/click/key skips the typing straight to the name box.
      const skip = () => {
        if (typed >= total) return;
        clearTimeout(timer);
        typed = total;
        tick();
      };
      pre.addEventListener("click", skip);
      document.addEventListener("keydown", skip, { once: true });
      tick();
    },
    { dismissable: false },
  ).then(() => {
    prompting = false;
    document.getElementById("overlay")?.classList.remove("identify");
  });
}
