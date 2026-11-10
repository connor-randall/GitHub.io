// Name entry, shared by the first-visit prompt and the [ YOU ] rename form.
// Errors (taken, not allowed, bad characters) appear right under the input.

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { showOverlay } from "./fx.js?v=b6664395f3";
import { revealAmbient } from "./ambient.js?v=b6664395f3";
import { startMist } from "./mist.js?v=b6664395f3";
import { openAccount } from "./save.js?v=b6664395f3";

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
 * withPassword: also ask for a password and create an account (name + password) in one go.
 * @param {{value?: string, submitLabel: string, withRoll?: boolean, withPassword?: boolean, onSaved: () => void}} opts
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
  const hint = el("div", "name-hint dim", "3-16 letters, numbers or _ . keep it clean."
    + (state.me?.login ? " this is also your login name." : ""));
  const save = el("button", "inline-btn", opts.submitLabel);
  row.append(el("span", "dim", ">"), input);
  if (opts.withRoll) {
    const roll = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ ROLL ]"));
    roll.type = "button";
    roll.title = "random name";
    // The server rolls (server/omhp/rollnames.py): ~28,000 names, and it only
    // hands out ones nobody has. Offline, the small local list will do.
    roll.addEventListener("click", async () => {
      roll.disabled = true;
      try {
        input.value = (await api.rollName()).name;
      } catch {
        input.value = randomName();
      } finally {
        roll.disabled = false;
      }
      err.textContent = "";
      input.focus();
    });
    row.append(roll);
  }
  /** @type {HTMLInputElement | null} */
  let pass = null;
  /** @type {HTMLInputElement | null} */
  let again = null;
  if (opts.withPassword) {
    input.placeholder = "USERNAME";
    input.setAttribute("aria-label", "Username");
    input.autocomplete = "username";
    pass = /** @type {HTMLInputElement} */ (el("input"));
    pass.type = "password";
    pass.placeholder = "PASSWORD";
    pass.maxLength = 128;
    pass.autocomplete = "new-password";
    pass.setAttribute("aria-label", "Password");
    pass.addEventListener("input", () => (err.textContent = ""));
    // Ticket #78: a typo in the only copy of a password locks you out for good.
    again = /** @type {HTMLInputElement} */ (el("input"));
    again.type = "password";
    again.placeholder = "PASSWORD AGAIN";
    again.maxLength = 128;
    again.autocomplete = "new-password";
    again.setAttribute("aria-label", "Password again");
    again.addEventListener("input", () => (err.textContent = ""));
    hint.textContent = "username: 3-16 letters, numbers or _ . password: 6+ characters.";
  }
  if (pass) {
    const passRow = el("div", "name-row");
    passRow.append(el("span", "dim", ">"), pass);
    const againRow = el("div", "name-row");
    againRow.append(el("span", "dim", ">"), /** @type {HTMLInputElement} */ (again));
    save.classList.add("acct-submit");
    form.append(row, passRow, againRow, save, err, hint);
  } else {
    row.append(save);
    form.append(row, err, hint);
  }
  input.addEventListener("input", () => (err.textContent = ""));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) {
      err.textContent = "> a name, wanderer. any name.";
      return;
    }
    if (pass && pass.value.length < 6) {
      err.textContent = "> pick a password: 6+ characters.";
      pass.focus();
      return;
    }
    if (pass && again && pass.value !== again.value) {
      err.textContent = "> those two passwords don't match.";
      again.focus();
      return;
    }
    try {
      const res = pass ? await api.createAccount(input.value, pass.value) : await api.rename(input.value);
      state.me = res;
      emit("me");
      opts.onSaved(); // the welcome crate waits for the first hit (controls.js)
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
      "Your attacks recharge over time. Later you unlock an ULTIMATE: a much bigger hit that recharges on its own timer. Hits can drop weapons, charms and loot boxes.",
      "Whoever lands the final blow goes on the record. Then the next boss arrives.",
    ];
    const text = el("div", "intro-text");
    for (const line of lines) text.append(el("p", "", line));
    const fight = /** @type {HTMLButtonElement} */ (el("button", "btn-big intro-fight", ""));
    fight.innerHTML = '<span class="br">[</span> F I G H T ! <span class="br">]</span>';
    fight.type = "button";
    fight.addEventListener("click", leave);
    const have = /** @type {HTMLButtonElement} */ (el("button", "inline-btn intro-save", "[ have an account? log in ]"));
    have.type = "button";
    have.addEventListener("click", async () => {
      await leave();
      openAccount("login");
    });
    eye.append(text, fight, have);
    requestAnimationFrame(() => fight.focus({ preventScroll: true }));
  }, instant);
}

/** No new account today (too many from this network): what happened, [ LOG IN ]
 * to an account you already have, or [ JUST WATCH ]. */
/** @param {boolean} [cloud] the server refused a cloud server / hosted VPN (CLOUD_BLOCKED) */
export function showSignupFull(cloud = false) {
  return mistOverlay((eye, _inner, leave) => {
    eye.classList.add("intro");
    eye.append(el("h2", "identify-title", cloud ? "THE GATE IS SHUT" : "THE GATE IS FULL"));
    const text = el("div", "intro-text");
    for (const line of cloud ? [
      "New accounts can't be made from a cloud server or a VPN running on one (bots live there).",
      "Already have an account? Log in and fight. Otherwise turn the VPN off, or use your home or phone connection.",
    ] : [
      "Too many new players have joined from your network today. (A school, an office or a phone carrier can put lots of people on one.)",
      "Already have an account? Log in and fight. Otherwise come back tomorrow, or watch the fight for now.",
    ]) text.append(el("p", "", line));
    const login = /** @type {HTMLButtonElement} */ (el("button", "btn-big intro-fight", ""));
    login.innerHTML = '<span class="br">[</span> L O G &nbsp;I N <span class="br">]</span>';
    login.type = "button";
    login.addEventListener("click", async () => {
      await leave();
      openAccount("login");
    });
    const watch = /** @type {HTMLButtonElement} */ (el("button", "inline-btn intro-save", "[ JUST WATCH ]"));
    watch.type = "button";
    watch.addEventListener("click", leave);
    eye.append(text, login, watch);
    requestAnimationFrame(() => login.focus({ preventScroll: true }));
  });
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
    const title = el("h2", "identify-title", "CREATE YOUR ACCOUNT");
    const sub = el("div", "dim bag-note", "pick a username + password to fight (log in with them on any device). your hit lands as soon as you're in.");
    const { form, input } = nameForm({
      submitLabel: "[ ENTER ]",
      withRoll: true,
      withPassword: true,
      onSaved: () => {
        named = true;
        leave();
      },
    });
    form.classList.add("prompt");
    eye.append(title, sub, form);
    const later = el("div", "actions");
    const b = el("button", "", "[ just looking ]");
    b.addEventListener("click", leave);
    const have = el("button", "", "[ have an account? log in ]");
    have.addEventListener("click", async () => {
      await leave();
      openAccount("login");
    });
    later.append(have, b);
    inner.append(later);
    requestAnimationFrame(() => input.focus());
  }).then(() => {
    prompting = false;
    if (named && then) then();
  });
}
