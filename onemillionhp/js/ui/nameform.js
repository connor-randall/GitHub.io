// Name entry, shared by the first-visit prompt and the [ YOU ] rename form.
// Errors (taken, not allowed, bad characters) appear right under the input.

import * as api from "../api.js";
import { el } from "../ascii.js";
import { emit, state } from "../store.js";
import { showOverlay } from "./fx.js";
import { startMist } from "./mist.js";

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

/** "Name yourself before fighting", wrapped in drifting ASCII mist. */
export function promptForName() {
  if (prompting || !state.me || state.me.name_chosen) return;
  prompting = true;
  /** @type {() => void} */
  let stopMist = () => {};
  showOverlay(
    (inner, close) => {
      const overlay = inner.parentElement;
      overlay?.classList.add("identify");
      const mist = el("pre", "mist");
      mist.setAttribute("aria-hidden", "true");
      overlay?.prepend(mist);

      const eye = el("div", "identify-eye");
      const title = el("h2", "identify-title", "NAME YOURSELF BEFORE FIGHTING");
      const { form, input } = nameForm({ submitLabel: "[ ENTER ]", withRoll: true, onSaved: close });
      form.classList.add("prompt");
      eye.append(title, form);
      const later = el("div", "actions");
      const b = el("button", "", "[ just looking ]");
      b.addEventListener("click", close);
      later.append(b);
      inner.append(eye, later);

      stopMist = startMist(mist, () => eye.getBoundingClientRect());
      requestAnimationFrame(() => input.focus());
    },
    { dismissable: false },
  ).then(() => {
    stopMist();
    prompting = false;
    const overlay = document.getElementById("overlay");
    overlay?.classList.remove("identify");
  });
}
