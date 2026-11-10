// Logins and save codes: the bag lives on the server; a username + password
// (or the save code) logs another device (or a wiped browser) back in as you.
// Login forms live in the [ LOG IN ] pop-up (top bar), not in a panel.

import * as api from "../api.js?v=b6664395f3";
import { el } from "../ascii.js?v=b6664395f3";
import { emit, state } from "../store.js?v=b6664395f3";
import { button, showOverlay } from "./fx.js?v=b6664395f3";
import { nameForm } from "./nameform.js?v=b6664395f3";

let shown = /** @type {string | null} */ (null);

/** @param {string} placeholder @param {string} label @param {boolean} [secret] */
function field(placeholder, label, secret = false) {
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.maxLength = secret ? 128 : 20;
  input.setAttribute("aria-label", label);
  input.setAttribute("autocapitalize", "off");
  if (secret) input.type = "password";
  return input;
}

/** A labelled form block for the account pop-up: title, note, inputs, button, error line.
 * @param {string} title @param {string} note @param {HTMLInputElement[]} inputs @param {string} label
 * @param {(err: HTMLElement, go: HTMLElement) => Promise<void>} submit */
function block(title, note, inputs, label, submit) {
  const form = /** @type {HTMLFormElement} */ (el("form", "name-form acct-form"));
  form.append(el("div", "panel-h", title));
  if (note) form.append(el("div", "dim bag-note", note));
  const row = el("div", "acct-inputs");
  row.append(...inputs);
  const go = el("button", "inline-btn", label);
  const err = el("div", "name-err", "");
  form.append(row, go, err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    await submit(err, go);
  });
  return form;
}

/** A small text link that switches what the pop-up shows. @param {string} label @param {() => void} fn */
function link(label, fn) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "inline-btn acct-link", label));
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

/** The account pop-up from the top bar: one job per screen. It lives in the
 * overlay, so the panels redrawing on live updates can't wipe what's typed.
 *   no name yet      -> CREATE AN ACCOUNT (username + password)
 *   name, no password -> SAVE YOUR ACCOUNT (just a password)
 *   has a password    -> LOGGED IN AS ... (change password)
 *   "login"           -> LOG IN (username + password, or a save code)
 * @param {"auto" | "login"} [start] */
export function openAccount(start = "auto") {
  showOverlay((inner, close) => {
    inner.classList.add("acct");
    inner.style.setProperty("width", "min(92vw, 440px)");
    /** @param {"auto" | "login" | "code"} mode */
    const render = (mode) => {
      const me = state.me;
      const parts = [];
      if (mode === "login" || mode === "code" || !me) {
        parts.push(el("h3", "acct-title", "LOG IN"));
        if (mode === "code") {
          parts.push(el("div", "dim bag-note", "> enter a save code from [ YOU ] on your other device."), loadSaveForm(),
            link("[ use username + password instead ]", () => render("login")));
        } else {
          parts.push(el("div", "dim bag-note", "> your username is your in-game name."), loginForm(),
            link("[ use a save code instead ]", () => render("code")));
        }
        if (me) parts.push(link(me.login ? "[ back ]" : "[ no account yet? make one ]", () => render("auto")));
      } else if (me.login) {
        parts.push(el("h3", "acct-title", "YOUR ACCOUNT"),
          el("div", "acct-row", `USERNAME  ${me.login}`),
          el("div", "dim bag-note", "> log in with this username + your password on any device. rename in [ YOU ] and your username changes with it."));
        const old = field("OLD PASSWORD", "Current password", true);
        old.autocomplete = "current-password";
        const next = field("NEW PASSWORD", "New password", true);
        next.autocomplete = "new-password";
        const again = field("NEW PASSWORD AGAIN", "New password again", true);
        again.autocomplete = "new-password";
        parts.push(block("CHANGE PASSWORD", "", [old, next, again], "[ SAVE ]", async (err) => {
          if (next.value !== again.value) { // ticket #78: a typo here locks you out
            err.textContent = "> those two passwords don't match.";
            return;
          }
          try {
            await api.changePassword(old.value, next.value);
            old.value = next.value = again.value = "";
            err.textContent = "> password changed.";
          } catch (ex) {
            err.textContent = "> " + /** @type {Error} */ (ex).message;
          }
        }));
        parts.push(link("[ log in to a different account ]", () => render("login")));
      } else if (me.name_chosen) {
        parts.push(el("h3", "acct-title", "SAVE YOUR ACCOUNT"),
          el("div", "dim bag-note", "> pick a password (6+ characters). then you can log in on any device with:"),
          el("div", "acct-row", `USERNAME  ${me.name}`));
        const pass = field("NEW PASSWORD", "New password", true);
        pass.autocomplete = "new-password";
        const again = field("PASSWORD AGAIN", "New password again", true);
        again.autocomplete = "new-password";
        parts.push(block("", "", [pass, again], "[ SAVE ACCOUNT ]", async (err) => {
          if (pass.value !== again.value) {
            err.textContent = "> those two passwords don't match.";
            return;
          }
          try {
            state.me = await api.setLogin(pass.value);
            emit("me");
            render("auto");
          } catch (ex) {
            err.textContent = "> " + /** @type {Error} */ (ex).message;
          }
        }));
        parts.push(link("[ already have an account? log in ]", () => render("login")));
      } else {
        parts.push(el("h3", "acct-title", "CREATE AN ACCOUNT"),
          el("div", "dim bag-note", "> your username is your name in the game. log in with it + your password on any device."));
        const { form } = nameForm({ submitLabel: "[ CREATE ACCOUNT ]", withRoll: true, withPassword: true,
          onSaved: () => render("auto") });
        parts.push(form, link("[ already have an account? log in ]", () => render("login")));
      }
      const actions = el("div", "actions");
      actions.append(button("[ CLOSE ]", close));
      inner.replaceChildren(...parts, actions);
      requestAnimationFrame(() => inner.querySelector("input")?.focus({ preventScroll: true }));
    };
    render(start);
  });
}

/** "Log in" form. Logging in switches this browser to that player.
 * @param {string} [title] */
export function loginForm(title = "") {
  const form = /** @type {HTMLFormElement} */ (el("form", "name-form load-save acct-form"));
  if (title) form.append(el("div", "panel-h", title));
  const row = el("div", "acct-inputs");
  const user = field("USERNAME", "Username");
  user.maxLength = 16;
  user.autocomplete = "username";
  const pass = field("PASSWORD", "Password", true);
  pass.autocomplete = "current-password";
  const go = el("button", "inline-btn", "[ LOG IN ]");
  row.append(user, pass);
  const err = el("div", "name-err", "");
  form.append(row, go, err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user.value.trim() || !pass.value) return;
    const me = state.me;
    const hasStuff = me && !me.login && me.name_chosen && (me.total_attacks > 0 || me.inventory.length > 0);
    if (hasStuff && go.dataset.sure !== "1") {
      go.dataset.sure = "1";
      go.textContent = "[ SURE? ]";
      err.textContent = `${me.name} has no password yet, so you couldn't get back to it. save it first (or press again to switch anyway).`;
      return;
    }
    go.textContent = "[ LOGGING IN... ]";
    try {
      await api.login(user.value, pass.value);
      location.reload();
    } catch (e2) {
      err.textContent = /** @type {Error} */ (e2).message;
      go.textContent = "[ LOG IN ]";
      go.dataset.sure = "";
    }
  });
  return form;
}

/** The LOGIN + SAVE CODE blocks for the [ YOU ] panel. @param {() => void} redraw */
export function saveSection(redraw) {
  const outer = el("div", "");
  const acct = el("div", "save-box");
  const open = el("button", "inline-btn", state.me?.login ? `[ LOGGED IN AS ${state.me.login} ]` : "[ SAVE YOUR ACCOUNT ]");
  open.addEventListener("click", () => openAccount());
  acct.append(el("div", "panel-h", "ACCOUNT"), open);
  const wrap = el("div", "save-box");
  outer.append(acct, wrap);
  wrap.append(el("div", "panel-h", "SAVE CODE"));
  wrap.append(el("div", "dim bag-note", "> your bag and progress are saved on the server. to play as you on another device, enter this code there."));
  if (shown) {
    const code = el("div", "save-code", shown);
    const copy = el("button", "inline-btn", "[ COPY ]");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shown ?? "");
        copy.textContent = "[ COPIED ]";
      } catch {
        copy.textContent = "[ select + copy it ]";
      }
    });
    const hide = el("button", "inline-btn", "[ HIDE ]");
    hide.addEventListener("click", () => ((shown = null), redraw()));
    code.append(" ", copy, hide);
    wrap.append(code, el("div", "save-warn", "> anyone with this code can play as you. keep it to yourself."));
  } else {
    const show = el("button", "inline-btn", "[ SHOW MY SAVE CODE ]");
    show.addEventListener("click", async () => {
      try {
        shown = (await api.getSaveCode()).code;
      } catch {
        shown = null;
      }
      redraw();
    });
    wrap.append(show);
  }
  wrap.append(el("div", "", ""), loadSaveForm());
  return outer;
}

/** "Have a save code?" form. Loading one switches this browser to that player. */
export function loadSaveForm() {
  const form = /** @type {HTMLFormElement} */ (el("form", "name-form load-save"));
  const row = el("div", "name-row");
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.placeholder = "XXXX-XXXX-XXXX";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 20;
  input.setAttribute("aria-label", "Save code");
  input.setAttribute("autocapitalize", "characters");
  const go = el("button", "inline-btn", "[ LOAD SAVE ]");
  row.append(input, go);
  const err = el("div", "name-err", "");
  form.append(row, err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const me = state.me;
    const hasStuff = me && me.name_chosen && (me.total_attacks > 0 || me.inventory.length > 0);
    if (hasStuff && go.dataset.sure !== "1") {
      go.dataset.sure = "1";
      go.textContent = "[ SURE? ]";
      err.textContent = `this browser will switch to that player. ${me.name} stays safe: note ${me.name}'s save code first.`;
      return;
    }
    go.textContent = "[ LOADING... ]";
    try {
      await api.loadSave(input.value);
      location.reload();
    } catch (e2) {
      err.textContent = /** @type {Error} */ (e2).message;
      go.textContent = "[ LOAD SAVE ]";
      go.dataset.sure = "";
    }
  });
  return form;
}
