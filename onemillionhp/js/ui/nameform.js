// Name entry, shared by the first-visit prompt and the [ YOU ] rename form.
// Errors (taken, not allowed, bad characters) appear right under the input.

import * as api from "../api.js?v=1dcd1bdd6e";
import { el } from "../ascii.js?v=1dcd1bdd6e";
import { boxById, emit, state } from "../store.js?v=1dcd1bdd6e";
import { openBox } from "./bag.js?v=1dcd1bdd6e";
import { boxDropReveal, showOverlay } from "./fx.js?v=1dcd1bdd6e";
import { revealAmbient } from "./ambient.js?v=1dcd1bdd6e";
import { startMist } from "./mist.js?v=1dcd1bdd6e";

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
      const res = await api.rename(input.value);
      state.me = res;
      emit("me");
      opts.onSaved();
      // First name ever: a thank-you crate. Overlays queue, so this shows
      // right after the name prompt's mist clears.
      const gift = res.gift_box ? boxById(res.gift_box) : null;
      if (gift) boxDropReveal(gift, () => openBox(gift), "THANK YOU! HERE IS A LOOT BOX");
    } catch (ex) {
      err.textContent = "> " + /** @type {Error} */ (ex).message;
      input.focus();
      input.select();
    }
  });
  return { form, input };
}

/**
 * Full-screen mist overlay: dark screen, ASCII mist swirling around the
 * content (the "eye"). leave() blows the mist away and reveals the game.
 * @param {(eye: HTMLElement, inner: HTMLElement, leave: () => Promise<void>) => void} build
 */
function mistOverlay(build, instant = false) {
  return showOverlay(
    (inner, close) => {
      const overlay = /** @type {HTMLElement} */ (inner.parentElement);
      overlay.classList.add("identify");
      // First thing on screen: start fully dark (no fade from the page).
      overlay.classList.toggle("instant", instant);
      const mistEl = el("pre", "mist");
      mistEl.setAttribute("aria-hidden", "true");
      overlay.prepend(mistEl);
      const eye = el("div", "identify-eye");
      inner.append(eye);
      const mist = startMist(mistEl, { eye: () => eye.getBoundingClientRect() });
      let leaving = false;
      const leave = async () => {
        if (leaving) return;
        leaving = true;
        overlay.classList.add("leaving");
        revealAmbient();
        await mist.dissipate(1100);
        close();
      };
      build(eye, inner, leave);
    },
    { dismissable: false },
  ).then(() => {
    document.getElementById("overlay")?.classList.remove("identify", "leaving", "instant");
  });
}

/** First visit: what this place is, then [ FIGHT! ]. No naming yet.
 * @param {boolean} [instant] start fully dark (used on the very first frame) */
export function showIntro(instant = false) {
  return mistOverlay((eye, _inner, leave) => {
    eye.classList.add("intro");
    eye.append(el("h2", "identify-title", "ONE MILLION HP"));
    const lines = [
      "Everyone on this site is fighting the same boss.",
      "It has 1,000,000 HP. Every hit, from every player, comes off the same health bar.",
      "You get 5 attacks a day and one ultimate per boss. Hits can drop weapons, charms and loot boxes.",
      "Whoever lands the final blow goes on the record. Then the next boss arrives.",
    ];
    const text = el("div", "intro-text");
    for (const line of lines) text.append(el("p", "", line));
    const fight = /** @type {HTMLButtonElement} */ (el("button", "btn-big intro-fight", ""));
    fight.innerHTML = '<span class="br">[</span> F I G H T ! <span class="br">]</span>';
    fight.type = "button";
    fight.addEventListener("click", leave);
    eye.append(text, fight);
    requestAnimationFrame(() => fight.focus({ preventScroll: true }));
  }, instant);
}

let prompting = false;

/** "Name yourself before fighting", in the same mist. Shown when an unnamed
 * player first tries to attack. ``then`` (optional) runs after a name is saved.
 * @param {() => void} [then] */
export function promptForName(then) {
  if (prompting || !state.me || state.me.name_chosen) return;
  prompting = true;
  let named = false;
  mistOverlay((eye, inner, leave) => {
    const title = el("h2", "identify-title", "NAME YOURSELF BEFORE FIGHTING");
    const { form, input } = nameForm({
      submitLabel: "[ ENTER ]",
      withRoll: true,
      onSaved: () => {
        named = true;
        leave();
      },
    });
    form.classList.add("prompt");
    eye.append(title, form);
    const later = el("div", "actions");
    const b = el("button", "", "[ just looking ]");
    b.addEventListener("click", leave);
    later.append(b);
    inner.append(later);
    requestAnimationFrame(() => input.focus());
  }).then(() => {
    prompting = false;
    if (named && then) then();
  });
}
