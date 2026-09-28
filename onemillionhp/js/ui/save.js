// Save codes: the bag lives on the server; this code logs another device
// (or a wiped browser) back in as you.

import * as api from "../api.js?v=a46acbc584";
import { el } from "../ascii.js?v=a46acbc584";
import { state } from "../store.js?v=a46acbc584";

let shown = /** @type {string | null} */ (null);

/** The SAVE CODE block for the [ YOU ] panel. @param {() => void} redraw */
export function saveSection(redraw) {
  const wrap = el("div", "save-box");
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
  return wrap;
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
  const go = el("button", "", "[ LOAD SAVE ]");
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
