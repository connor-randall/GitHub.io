// [ DESIGN ]: the community boss forge. Players draw a boss on the same
// 36 x 18 frame the hand-made bosses use, give it words (an entrance line,
// taunts per phase, a death line) and see it exactly as it will look in the
// game before sending it to the admin for review. Plus its BOSS UNIQUE: a
// relic drawn on the same grid (it must fit an item card) that only drops
// from this boss, with the standard boss-unique stats for its slot and theme.

import * as api from "../api.js?v=b6664395f3";
import { bar, el, fmt, setArt } from "../ascii.js?v=b6664395f3";
import {
  BOSS_GRID, DESIGN_COLORS, DESIGN_WIDTH, ITEM_GRID, ITEM_LINES, ITEM_WIDTH, MAX_ITEM_FLAVOR, MAX_TAUNT_LEN,
  MAX_TAUNTS, blank, cellAt, compact, cropArt, fitItemArt, fitOldDrafts, gridify, indexAt, isDrawn, normalizeFrames, paintBossLine,
  mirrorChar, mirrorCol, pasteBlock, syncHurtArt, tauntLines, typeAt,
} from "../boss-design.js?v=b6664395f3";
import { on, state } from "../store.js?v=b6664395f3";
import { EFFECT_HELP, EQUIP_SLOTS, effectParts } from "./effects.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { itemLines, popup } from "./fx.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const DRAFT_KEY = "omhp.boss-design-draft";
const BRUSHES = ["#", "@", "*", "o", "+", "=", "/", "\\", "|", "-", "_", ".", "'", "(", ")", "<", ">", "^",
  // the rest of ASCII's symbols, many of them buried on a phone keyboard
  "~", "`", '"', ":", ";", ",", "!", "?", "%", "&", "$", "[", "]", "{", "}", "v", "X"];
const GRID_KEY = "omhp.design.grid";

/** The seven drawings, in the order they're made. */
const FRAMES = [
  { key: "phase1_art", tab: "I", title: "PHASE I", phase: 1, copy: null,
    hint: "Full health: the boss at its best. Big and simple reads best from across the room." },
  { key: "phase1_hurt_art", tab: "I HIT", title: "PHASE I :: HIT", phase: 1, hurt: true, copy: "phase1_art",
    hint: "Flashes red for a split second each time it's hit. Starts as a copy of PHASE I: change a few bits (eyes to X, a flinch)." },
  { key: "phase2_art", tab: "II", title: "PHASE II", phase: 2, copy: "phase1_art",
    hint: "Below 50% HP. The same boss, banged up: cracks, chunks missing, angrier." },
  { key: "phase2_hurt_art", tab: "II HIT", title: "PHASE II :: HIT", phase: 2, hurt: true, copy: "phase2_art",
    hint: "PHASE II's flinch. Starts as a copy of PHASE II." },
  { key: "phase3_art", tab: "III", title: "PHASE III", phase: 3, copy: "phase2_art",
    hint: "Below 10% HP. Barely holding together." },
  { key: "phase3_hurt_art", tab: "III HIT", title: "PHASE III :: HIT", phase: 3, hurt: true, copy: "phase3_art",
    hint: "PHASE III's flinch. Starts as a copy of PHASE III." },
  { key: "death_art", tab: "DEATH", title: "DEATH", phase: 0, copy: "phase3_art",
    hint: "What's left after the final blow: a wreck, a grave, a puddle." },
  { key: "unique_art", tab: "UNIQUE", title: "BOSS UNIQUE", phase: -1, copy: null,
    hint: `Its one-in-a-million relic: only drops from your boss. Its grid is smaller (${ITEM_WIDTH} x ${ITEM_LINES}): the size of an item card. Name it in step 4.` },
];
const PHASE_KEYS = FRAMES.slice(0, 6).map((f) => f.key);
const HURT_OF = /** @type {Record<string, string>} */ ({
  phase1_art: "phase1_hurt_art", phase2_art: "phase2_hurt_art", phase3_art: "phase3_hurt_art",
});
const HP_AT = { 1: 0.8, 2: 0.32, 3: 0.06, 0: 0 };

/** The grid a frame is drawn on: the boss unique gets the smaller item-card grid (ticket #102). @param {string} key */
const gridOf = (key) => (key === "unique_art" ? ITEM_GRID : BOSS_GRID);
const d = {
  name: "",
  intro: "",
  taunts: ["", "", ""],
  death: "",
  color: "amber",
  /** @type {Record<string, string>} */
  frames: Object.fromEntries(FRAMES.map((f) => [f.key, gridify("", gridOf(f.key))])),
  unique: { name: "", slot: "weapon", theme: "", flavor: "" },
};
/** What a boss unique gets per slot and theme (from the server: slot -> theme -> mods). @type {Record<string, Record<string, any>>} */
let uniqueMods = {};
let active = 0;
/** @type {"type" | "draw" | "erase"} */
let mode = "type";
let brush = "#";
/** @type {{key: string, value: string}[]} */
let undoStack = [];
/** What UNDO took back, for REDO; any new change clears it. @type {{key: string, value: string}[]} */
let redoStack = [];
/** DRAW / ERASE paint the mirror image across the centre line too. */
let mirror = false;
let brightGrid = (() => {
  try {
    return localStorage.getItem(GRID_KEY) === "bright";
  } catch {
    return false;
  }
})();
let lastUndoAt = 0;
let built = false;
let lastStatusLoad = 0;
let hitUntil = 0;

const frame = () => FRAMES[active];
/** The grid of the frame being edited. */
const grid = () => gridOf(frame().key);

// ------------------------------------------------------------------ drafts

/** Ticket #248: one draft per account, so switching accounts in this browser
 * doesn't swap or wipe another account's drawing. */
const baseKey = () => (state.me?.id ? `${DRAFT_KEY}.${state.me.id}` : DRAFT_KEY);
// Ticket #273: several drawings on the go. Slot 0 is the original key, so nobody's draft moves.
const DRAFT_SLOTS = 5;
const slotKey = () => `${baseKey()}.slot`;
let draftSlot = 0;
const draftKey = (slot = draftSlot) => (slot ? `${baseKey()}.${slot + 1}` : baseKey());
// Nothing is saved until this account's draft has been read (the tab can open before /api/me answers).
let draftLoaded = false;

function saveDraft() {
  if (!draftLoaded) return;
  try {
    localStorage.setItem(draftKey(), JSON.stringify({ v: 2, ...d,
      frames: Object.fromEntries(Object.entries(d.frames).map(([k, v]) => [k, compact(v)])) }));
  } catch {
    /* drafts are optional */
  }
}

function loadDraft() {
  let raw = null;
  try {
    draftSlot = Math.min(DRAFT_SLOTS - 1, Math.max(0, Number(localStorage.getItem(slotKey())) || 0));
    let text = localStorage.getItem(draftKey());
    if (text === null && !draftSlot && draftKey() !== DRAFT_KEY) {
      // The old browser-wide draft goes to the first account that opens the designer.
      text = localStorage.getItem(DRAFT_KEY);
      if (text !== null) {
        localStorage.setItem(draftKey(), text);
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    raw = JSON.parse(text ?? "null");
  } catch {
    /* a damaged draft: start fresh */
  }
  if (!raw || typeof raw !== "object") return;
  const old = raw.v !== 2; // the first designer: frames at the top level, 48 wide, one flavor line
  const src = old ? raw : raw.frames ?? {};
  const fitted = fitOldDrafts(FRAMES.map((f) => String(src[f.key] ?? "")));
  FRAMES.forEach((f, i) => (d.frames[f.key] = f.key === "unique_art" ? fitItemArt(fitted[i]) : gridify(fitted[i])));
  d.name = String(raw.name ?? "");
  d.intro = String(old ? raw.flavor ?? "" : raw.intro ?? "").slice(0, 160);
  d.taunts = old ? ["", "", ""] : [0, 1, 2].map((i) => String(raw.taunts?.[i] ?? ""));
  d.death = old ? "" : String(raw.death ?? "");
  d.color = DESIGN_COLORS[/** @type {keyof typeof DESIGN_COLORS} */ (raw.color)] ? raw.color : "amber";
  const u = raw.unique ?? {};
  d.unique = { name: String(u.name ?? "").slice(0, 24), slot: EQUIP_SLOTS.some(([s]) => s === u.slot) ? u.slot : "weapon",
    theme: String(u.theme ?? ""), flavor: String(u.flavor ?? "").slice(0, MAX_ITEM_FLAVOR) };
}

/** Back to a blank page (the saved draft stays until resetDesign or the next save). */
function blankDesign() {
  d.name = d.intro = d.death = "";
  d.taunts = ["", "", ""];
  d.color = "amber";
  d.unique = { name: "", slot: "weapon", theme: "", flavor: "" };
  for (const f of FRAMES) d.frames[f.key] = gridify("", gridOf(f.key));
  undoStack = [];
  redoStack = [];
  active = 0;
}

/** Ticket #273: the [ 1 ] [ 2 ] ... row: each is its own saved drawing. */
function drawDraftSlots() {
  const host = $("design-slots");
  host.replaceChildren(el("span", "dim", "DRAFT "));
  for (let i = 0; i < DRAFT_SLOTS; i++) {
    let used = i === draftSlot;
    try {
      used ||= localStorage.getItem(draftKey(i)) !== null;
    } catch {
      /* no storage: one drawing */
    }
    const b = btn(`[ ${i + 1}${used ? "*" : ""} ]`, "design-tool", () => switchDraft(i));
    b.setAttribute("aria-pressed", String(i === draftSlot));
    b.title = used ? "open this drawing" : "start a new drawing here";
    host.append(b);
  }
}

/** @param {number} slot */
function switchDraft(slot) {
  if (slot === draftSlot) return;
  saveDraft();
  try {
    localStorage.setItem(slotKey(), String(slot));
  } catch {
    return; // nowhere to keep two drawings
  }
  blankDesign();
  loadDraft();
  fillInputs();
  selectFrame(0);
  changed();
  drawDraftSlots();
}

function resetDesign() {
  blankDesign();
  try {
    localStorage.removeItem(draftKey());
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ editing

/** Remember the frame before a change (typing within a moment counts as one). @param {boolean} [merge] */
function pushUndo(merge = false) {
  const key = frame().key;
  const now = Date.now();
  if (merge && now - lastUndoAt < 900 && undoStack.at(-1)?.key === key) return;
  lastUndoAt = now;
  undoStack.push({ key, value: d.frames[key] });
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

/** Change one frame; an untouched hit frame keeps copying its phase. @param {string} key @param {string} value */
function setFrame(key, value) {
  const before = d.frames[key];
  d.frames[key] = gridify(value, gridOf(key));
  const hurt = HURT_OF[key];
  if (hurt) d.frames[hurt] = syncHurtArt(d.frames[hurt], before, d.frames[key]);
  changed();
}

function changed() {
  saveDraft();
  drawTabs();
  drawPreview();
  drawChecklist();
}

/** Step back (UNDO) or forward again (REDO): the frame's current drawing
 * moves to the other stack. @param {{key: string, value: string}[]} from @param {{key: string, value: string}[]} to */
function travel(from, to) {
  const last = from.pop();
  if (!last) return;
  to.push({ key: last.key, value: d.frames[last.key] });
  lastUndoAt = 0; // the next keystroke starts a fresh undo step
  const index = FRAMES.findIndex((f) => f.key === last.key);
  if (index !== active) selectFrame(index);
  setFrame(last.key, last.value);
  canvas().value = d.frames[last.key];
}
const undo = () => travel(undoStack, redoStack);
const redo = () => travel(redoStack, undoStack);

const canvas = () => /** @type {HTMLTextAreaElement} */ ($("design-canvas"));

/** @param {number} index */
function selectFrame(index) {
  active = index;
  const c = canvas();
  const { w, h } = grid();
  c.value = d.frames[frame().key];
  c.rows = h;
  c.cols = w;
  c.style.setProperty("--cols", String(w));
  c.style.setProperty("--rows", String(h));
  c.setAttribute("aria-label", `${frame().key === "unique_art" ? "Boss unique" : "Boss"} drawing, ${w} columns by ${h} lines`);
  drawTabs();
  drawTools();
  drawPreview();
}

/** Type on the grid: characters overwrite, Enter goes down a line, Backspace
 * blanks, a paste lands as a block with its shape intact. @param {InputEvent} e */
function onBeforeInput(e) {
  const c = canvas();
  if (mode !== "type") {
    e.preventDefault();
    return;
  }
  const start = c.selectionStart;
  const end = c.selectionEnd;
  const size = grid();
  let value = gridify(c.value, size);
  let caret = start;
  const t = e.inputType;
  if (t === "historyUndo" || t === "historyRedo") {
    e.preventDefault();
    if (t === "historyUndo") undo();
    else redo();
    return;
  }
  if (t === "insertCompositionText") return; // phone keyboards: tidied up in onInput
  e.preventDefault();
  if (t === "insertText" || t === "insertReplacementText") {
    pushUndo(true);
    if (end > start) value = blank(value, start, end, size);
    for (const ch of e.data ?? "") ({ value, caret } = typeAt(value, caret, ch, size));
  } else if (t === "insertLineBreak" || t === "insertParagraph") {
    caret = indexAt(cellAt(start, size).row + 1, cellAt(start, size).col, size);
  } else if (t === "deleteContentBackward" || t === "deleteWordBackward") {
    pushUndo(true);
    if (end > start) value = blank(value, start, end, size);
    else if (cellAt(start, size).col > 0) {
      value = blank(value, start - 1, start, size);
      caret = start - 1;
    }
  } else if (t === "deleteContentForward" || t === "deleteByCut" || t === "deleteWordForward") {
    pushUndo();
    value = blank(value, start, Math.max(end, t === "deleteByCut" ? end : start + 1), size);
  } else if (t === "insertFromPaste" || t === "insertFromDrop") {
    // A textarea's paste text is in e.data (dataTransfer is only for contenteditable).
    const text = e.dataTransfer?.getData("text/plain") || e.data || "";
    if (!text) return;
    pushUndo();
    ({ value, caret } = pasteBlock(value, start, text, size));
  } else {
    return;
  }
  c.value = value;
  c.setSelectionRange(caret, caret);
  setFrame(frame().key, value);
}

/** Paste (ctrl/cmd+V or the menu, in any mode): read straight from the
 * clipboard, since some browsers give beforeinput no pasted text at all and
 * the paste was then swallowed. @param {ClipboardEvent} e */
function onPaste(e) {
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  e.preventDefault();
  const c = canvas();
  pushUndo();
  const { value, caret } = pasteBlock(gridify(c.value, grid()), c.selectionStart, text, grid());
  c.value = value;
  c.setSelectionRange(caret, caret);
  setFrame(frame().key, value);
}

/** Composition input (some phone keyboards) can't be intercepted: put the grid back together. */
function onInput() {
  const c = canvas();
  const caret = c.selectionStart;
  const fixed = gridify(c.value, grid());
  if (fixed !== c.value) {
    c.value = fixed;
    c.setSelectionRange(Math.min(caret, fixed.length), Math.min(caret, fixed.length));
  }
  setFrame(frame().key, fixed);
}

/** One character cell of the grid, as the browser really lays the text out
 * (measured, not the CSS "ch", which some browsers round differently). */
function cellSize() {
  const c = canvas();
  const style = getComputedStyle(c);
  const probe = document.createElement("span");
  probe.textContent = "M".repeat(DESIGN_WIDTH);
  for (const prop of ["font-family", "font-size", "font-weight", "letter-spacing"]) {
    probe.style.setProperty(prop, style.getPropertyValue(prop));
  }
  probe.style.setProperty("position", "absolute");
  probe.style.setProperty("visibility", "hidden");
  probe.style.setProperty("white-space", "pre");
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width / DESIGN_WIDTH;
  probe.remove();
  return {
    w: width || Number.parseFloat(style.fontSize) * 0.6,
    h: Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.15,
  };
}

/** The grid cell under the pointer. @param {PointerEvent} event */
function pointerCell(event) {
  const c = canvas();
  const style = getComputedStyle(c);
  const { w: charWidth, h: lineHeight } = cellSize();
  const bounds = c.getBoundingClientRect();
  const x = event.clientX - bounds.left - Number.parseFloat(style.paddingLeft) - c.clientLeft + c.scrollLeft;
  const y = event.clientY - bounds.top - Number.parseFloat(style.paddingTop) - c.clientTop + c.scrollTop;
  const cell = { row: Math.floor(y / lineHeight), col: Math.floor(x / charWidth) };
  const { w, h } = grid();
  return cell.row >= 0 && cell.row < h && cell.col >= 0 && cell.col < w ? cell : null;
}

function wireDrawing() {
  const c = canvas();
  let drawing = false;
  /** @type {{row: number, col: number} | null} */
  let last = null;
  /** @param {PointerEvent} e */
  const paint = (e) => {
    const cell = pointerCell(e);
    if (!cell || (last && cell.row === last.row && cell.col === last.col)) return;
    const from = last ?? cell;
    const char = mode === "erase" ? " " : brush;
    const size = grid();
    let value = paintBossLine(c.value, from, cell, char, size);
    if (mirror) {
      value = paintBossLine(value, { row: from.row, col: mirrorCol(from.col, size) },
        { row: cell.row, col: mirrorCol(cell.col, size) }, mirrorChar(char), size);
    }
    value = gridify(value, size);
    c.value = value;
    last = cell;
    setFrame(frame().key, value);
  };
  c.addEventListener("pointerdown", (e) => {
    if (mode === "type" || e.button !== 0) return;
    e.preventDefault();
    pushUndo();
    drawing = true;
    last = null;
    c.setPointerCapture(e.pointerId);
    paint(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (drawing) {
      e.preventDefault();
      paint(e);
    }
  });
  const stop = (/** @type {PointerEvent} */ e) => {
    drawing = false;
    last = null;
    if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
  };
  c.addEventListener("pointerup", stop);
  c.addEventListener("pointercancel", stop);
  // In DRAW, pressing a key picks it as the brush.
  c.addEventListener("keydown", (e) => {
    if (mode === "draw" && e.key.length === 1 && /[\x21-\x7e]/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      brush = e.key;
      drawTools();
    }
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if ((e.metaKey || e.ctrlKey) && key === "z") {
      e.preventDefault();
      undo();
    }
  });
}

/** Size the grid so all 36 columns fit the panel. */
function fitCanvas() {
  const c = canvas();
  const wrap = c.parentElement;
  if (!wrap || !wrap.clientWidth) return;
  const px = Math.max(8, Math.min(16, (wrap.clientWidth - 14) / (DESIGN_WIDTH * 0.602)));
  c.style.setProperty("font-size", `${px.toFixed(2)}px`);
  // The graph paper is sized from the real character cell, so every line
  // sits exactly between two characters (and the box is exactly 36 x 18).
  const cell = cellSize();
  c.style.setProperty("--cell-w", `${cell.w}px`);
  c.style.setProperty("--cell-h", `${cell.h}px`);
}

// ------------------------------------------------------------------ drawing the UI

function drawTabs() {
  document.querySelectorAll(".design-tab").forEach((node, i) => {
    node.setAttribute("aria-selected", String(i === active));
    node.textContent = `${isDrawn(d.frames[FRAMES[i].key]) ? "[x]" : "[ ]"} ${FRAMES[i].tab}`;
  });
  $("design-frame-title").textContent = frame().title;
  $("design-frame-hint").textContent = frame().hint;
}

function drawTools() {
  const c = canvas();
  c.readOnly = mode !== "type";
  c.classList.toggle("drawing", mode !== "type");
  c.style.setProperty("--design-color", DESIGN_COLORS[/** @type {keyof typeof DESIGN_COLORS} */ (d.color)]);
  document.querySelectorAll(".design-mode").forEach((b) =>
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.mode === mode)));
  const brushes = $("design-brushes");
  brushes.hidden = mode !== "draw";
  brushes.querySelectorAll(".design-brush").forEach((b) =>
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.brush === brush)));
  $("design-brush-now").textContent = `BRUSH: ${brush}  (or press any key)`;
  c.classList.toggle("bright-grid", brightGrid);
  const mirrorBtn = $("design-mirror");
  mirrorBtn.hidden = mode === "type";
  mirrorBtn.setAttribute("aria-pressed", String(mirror));
  mirrorBtn.textContent = mirror ? "[x MIRROR ]" : "[ MIRROR ]";
  $("design-grid").setAttribute("aria-pressed", String(brightGrid));
  $("design-grid").textContent = brightGrid ? "[x GRID ]" : "[ GRID ]";
  $("design-mode-help").textContent = mode === "type"
    ? "click a spot and type. letters overwrite (nothing shifts). paste a drawing to drop it in whole."
    : `${mode === "draw" ? "click or drag on the grid to paint with the brush." : "click or drag to rub out."}${
      mirror ? " MIRROR copies it onto the other half." : ""}`;
  const copy = /** @type {HTMLButtonElement} */ ($("design-copy"));
  const from = FRAMES.find((f) => f.key === frame().copy);
  copy.hidden = !from;
  if (from) copy.textContent = `[ COPY ${from.title} HERE ]`;
}

/** The boss exactly as the game will show it: same frame, centring, colour, fonts. */
function drawPreview() {
  const pre = $("design-preview-art");
  const f = frame();
  if (f.phase === -1) {
    drawUniquePreview(pre);
    return;
  }
  pre.classList.remove("r-boss_unique");
  const phase = f.phase || 3;
  const dead = f.phase === 0;
  const tint = DESIGN_COLORS[/** @type {keyof typeof DESIGN_COLORS} */ (d.color)];
  let lines;
  if (dead) lines = normalizeFrames([d.frames.death_art])[0];
  else {
    const all = normalizeFrames(PHASE_KEYS.map((k) => d.frames[k]));
    const hurt = f.hurt || performance.now() < hitUntil;
    lines = all[(phase - 1) * 2 + (hurt ? 1 : 0)];
  }
  if (!lines.some((l) => /\S/.test(l))) lines = ["", "", "", "   (nothing drawn here yet)", "", "", ""];
  setArt(pre, lines, 13);
  pre.classList.toggle("tinted", true);
  pre.style.setProperty("--boss-tint", tint);
  pre.classList.toggle("phase-2", phase === 2 && !dead);
  pre.classList.toggle("phase-3", phase === 3 && !dead);
  pre.classList.toggle("dead", dead);
  $("design-preview-name").textContent = (d.name.trim() || "YOUR BOSS").toUpperCase();
  $("design-preview-sub").textContent = `DRAWN BY ${state.me?.name ?? "YOU"}`;
  const taunts = tauntLines(d.taunts[phase - 1]).concat(...d.taunts.map(tauntLines));
  const say = dead ? d.death.trim() || `HERE LIES ${(d.name.trim() || "YOUR BOSS").toUpperCase()}. 1,000,000 HP.`
    : taunts[Math.floor(Date.now() / 4000) % Math.max(1, taunts.length)] ?? "(add taunts below)";
  $("design-preview-taunt").textContent = `"${say}"`;
  const frac = HP_AT[/** @type {0|1|2|3} */ (dead ? 0 : phase)];
  $("design-preview-hp").textContent = `HP ${bar(frac, 22)}`;
  $("design-preview-hp").style.whiteSpace = "";
  $("design-preview-phase").textContent = dead ? "D E F E A T E D" : `PHASE ${"I".repeat(phase)}`;
}

/** The boss unique as the game will show it: its item card. */
function uniqueItem() {
  const theme = themeOf();
  return { id: "design_unique", name: (d.unique.name.trim() || "YOUR RELIC").toUpperCase(), rarity: "boss_unique",
    slot: d.unique.slot, theme, art: cropArt(d.frames.unique_art), flavor: d.unique.flavor.trim(),
    mods: uniqueMods[d.unique.slot]?.[theme] ?? {} };
}

/** The chosen theme, or the slot's first. */
function themeOf() {
  const themes = Object.keys(uniqueMods[d.unique.slot] ?? {});
  return themes.includes(d.unique.theme) ? d.unique.theme : themes[0] ?? "";
}

/** @param {HTMLElement} pre */
function drawUniquePreview(pre) {
  const item = uniqueItem();
  const drawn = item.art.length ? item : { ...item, art: ["", "(nothing drawn", "here yet)", ""] };
  pre.classList.remove("tinted", "phase-2", "phase-3", "dead");
  pre.classList.add("r-boss_unique");
  setArt(pre, itemLines(drawn, { width: 26 }), 13);
  $("design-preview-name").textContent = item.name;
  $("design-preview-sub").textContent = `BOSS UNIQUE :: ONLY DROPS FROM ${(d.name.trim() || "YOUR BOSS").toUpperCase()}`;
  $("design-preview-taunt").textContent = item.flavor ? `"${item.flavor}"` : "(add a flavor line in step 4)";
  const hp = $("design-preview-hp");
  hp.textContent = effectParts(item.mods).join("  ::  ");
  hp.style.whiteSpace = "pre-wrap"; // the stats, not a bar: let them wrap
  $("design-preview-phase").textContent = "";
}

function missing() {
  const out = [];
  if (d.name.trim().length < 3) out.push("a name (3+ letters)");
  if (!d.intro.trim()) out.push("an entrance line");
  const blankFrames = FRAMES.filter((f) => !isDrawn(d.frames[f.key])).map((f) => f.tab);
  if (blankFrames.length) out.push(`drawings: ${blankFrames.join(", ")}`);
  const art = cropArt(d.frames.unique_art);
  const wide = Math.max(0, ...art.map((l) => l.length));
  if (art.length > ITEM_LINES || wide > ITEM_WIDTH) {
    out.push(`the UNIQUE drawing must fit ${ITEM_WIDTH} x ${ITEM_LINES} (it's ${wide} x ${art.length})`);
  }
  if (d.unique.name.trim().length < 3) out.push("a name for the unique (3+ letters)");
  return out;
}

function drawChecklist() {
  const need = missing();
  const submit = /** @type {HTMLButtonElement} */ ($("design-submit"));
  const status = $("design-status");
  if (!state.me?.name_chosen) {
    status.textContent = "> pick your player name first (it's on the boss as DRAWN BY ...).";
    submit.disabled = true;
  } else if (need.length) {
    status.textContent = `> still needed: ${need.join(" :: ")}`;
    submit.disabled = true;
  } else {
    const taunts = d.taunts.reduce((n, t) => n + tauntLines(t).length, 0);
    status.textContent = taunts ? "> ready to send." : "> ready to send. (tip: taunts make it feel alive.)";
    submit.disabled = false;
  }
}

/** @param {any[]} submissions */
function drawSubmissions(submissions = []) {
  const host = $("design-submissions");
  host.replaceChildren(el("b", "", "YOUR SUBMISSIONS"));
  if (!submissions.length) host.append(el("div", "dim", "none yet"));
  for (const s of submissions) {
    const row = el("div", `design-submission ${s.status}`, `${s.name}  ::  [ ${String(s.status).toUpperCase()} ]`);
    if (s.status !== "denied") {
      // Ticket #237: a link to show it off without a screenshot.
      row.append(" ", btn("[ COPY LINK ]", "design-tool", async () => {
        const link = `${location.origin}${location.pathname}#design=${s.id}`;
        try {
          await navigator.clipboard.writeText(link);
          popup("LINK COPIED", "proc");
        } catch {
          showError(link);
        }
      }));
    }
    host.append(row);
  }
}

/** Ticket #171: your bosses that made it in, and how they're doing. Ticket #315: the
 * ones from before the unique editor can send one in (from this page's UNIQUE tab).
 * @param {any[]} bosses */
function drawMyBosses(bosses = []) {
  const host = $("design-my-bosses");
  host.hidden = !bosses.length;
  host.replaceChildren(el("b", "", "YOUR BOSSES"));
  for (const b of bosses) {
    const row = el("div", "design-my-boss");
    row.append(el("div", "", `${b.name}  ::  ${b.runs ? `FOUGHT ${fmt(b.runs)}x` : "NOT FOUGHT YET"}`));
    if (b.runs) {
      row.append(el("div", "dim", `${fmt(b.kills)} kills, ${fmt(b.damage)} damage taken, ${fmt(b.fighters)} fighters, `
        + `longest ${Math.round(b.longest / 60)} min`));
    }
    if (b.has_unique) row.append(el("div", "dim", `its unique is owned by ${fmt(b.unique_owners)} player${b.unique_owners === 1 ? "" : "s"}`));
    else if (b.proposal === "pending") row.append(el("div", "dim", "its unique is waiting for the admin"));
    else {
      if (b.proposal === "denied") row.append(el("div", "dim", "its last unique was turned down: you can send another"));
      row.append(btn("[ SEND MY UNIQUE TAB AS ITS UNIQUE ]", "design-tool", () => sendUnique(b.id)));
    }
    host.append(row);
  }
}

/** @param {string} bossId */
async function sendUnique(bossId) {
  try {
    const r = await api.proposeBossUnique(bossId, { name: d.unique.name.trim(), slot: d.unique.slot, theme: themeOf(),
      flavor: d.unique.flavor.trim(), art: compact(d.frames.unique_art) });
    drawMyBosses(r.bosses);
    popup("SENT TO THE ADMIN", "proc");
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
}

async function refreshSubmissions() {
  lastStatusLoad = Date.now();
  try {
    const r = await api.getBossDesign();
    drawSubmissions(r.submissions ?? (r.design ? [r.design] : []));
    drawMyBosses(r.bosses ?? []);
    if (r.unique_mods) {
      uniqueMods = r.unique_mods;
      drawUniqueChoices();
      drawPreview();
    }
  } catch {
    /* offline: try again next time */
  }
}

async function submit() {
  const btn = /** @type {HTMLButtonElement} */ ($("design-submit"));
  btn.disabled = true;
  $("design-status").textContent = "> sending to the admin...";
  try {
    const r = await api.saveBossDesign({
      name: d.name,
      flavor: d.intro,
      color: d.color,
      ...Object.fromEntries(FRAMES.filter((f) => f.phase >= 0).map((f) => [f.key, compact(d.frames[f.key])])),
      extras: { taunts: d.taunts.map(tauntLines), death_line: d.death.trim() },
      unique: { name: d.unique.name.trim(), slot: d.unique.slot, theme: themeOf(), flavor: d.unique.flavor.trim(),
        art: compact(d.frames.unique_art) },
    });
    drawSubmissions(r.submissions ?? [r.design]);
    resetDesign();
    fillInputs();
    selectFrame(0);
    changed();
    $("design-status").textContent = `> sent! ${r.design.name} is waiting for the admin. it shows under YOUR SUBMISSIONS.`;
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
    drawChecklist();
  }
}

function fillInputs() {
  /** @type {HTMLInputElement} */ ($("design-name")).value = d.name;
  /** @type {HTMLInputElement} */ ($("design-intro")).value = d.intro;
  /** @type {HTMLInputElement} */ ($("design-death")).value = d.death;
  [0, 1, 2].forEach((i) => (/** @type {HTMLTextAreaElement} */ ($(`design-taunts-${i}`)).value = d.taunts[i]));
  document.querySelectorAll(".design-color").forEach((b) =>
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.color === d.color)));
  /** @type {HTMLInputElement} */ ($("design-unique-name")).value = d.unique.name;
  /** @type {HTMLInputElement} */ ($("design-unique-flavor")).value = d.unique.flavor;
  drawUniqueChoices();
}

/** Slot and theme buttons for the unique, plus what the theme gives. */
function drawUniqueChoices() {
  document.querySelectorAll(".design-slot").forEach((b) =>
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.slot === d.unique.slot)));
  const host = $("design-themes");
  const theme = themeOf();
  host.replaceChildren(el("span", "dim", "THEME "));
  for (const t of Object.keys(uniqueMods[d.unique.slot] ?? {})) {
    const b = btn(`[ ${t} ]`, "design-color design-theme", () => {
      d.unique.theme = t;
      drawUniqueChoices();
      changed();
    });
    b.setAttribute("aria-pressed", String(t === theme));
    b.style.setProperty("--design-color", DESIGN_COLORS.amber);
    host.append(b);
  }
  const parts = effectParts(uniqueMods[d.unique.slot]?.[theme]);
  const help = parts.map((p) => Object.entries(EFFECT_HELP).find(([k]) => p.endsWith(k))?.[1]).filter(Boolean);
  $("design-unique-stats").textContent = parts.length
    ? `> ${parts.join("  ::  ")}${help.length ? `\n  (${help.join("; ")})` : ""}`
    : "> loading stats...";
}

// ------------------------------------------------------------------ building

/** @param {string} label @param {string} cls @param {() => void} fn */
function btn(label, cls, fn) {
  const b = /** @type {HTMLButtonElement} */ (el("button", cls, label));
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

/** @param {string} id @param {string} placeholder @param {number} max @param {(v: string) => void} set */
function input(id, placeholder, max, set) {
  const i = /** @type {HTMLInputElement} */ (el("input", "designer-input"));
  i.id = id;
  i.placeholder = placeholder;
  i.maxLength = max;
  i.spellcheck = false;
  i.autocomplete = "off";
  i.addEventListener("input", () => {
    set(i.value.replace(/[^\x20-\x7e]/g, ""));
    changed();
  });
  return i;
}

/** @param {string} n @param {string} title @param {string} [note] */
function step(n, title, note) {
  const s = el("section", "design-step");
  s.append(el("h3", "design-step-h", `${n} :: ${title}`));
  if (note) s.append(el("div", "designer-note", note));
  return s;
}

function build() {
  const host = $("panel-designer");
  const subs = el("div", "design-submissions");
  subs.id = "design-submissions";
  const myBosses = el("div", "design-submissions");
  myBosses.id = "design-my-bosses";
  myBosses.hidden = true;
  const draftSlots = el("div", "design-slots");
  draftSlots.id = "design-slots";

  // 1: who is it
  const who = step("1", "WHO IS IT");
  const name = input("design-name", "BOSS NAME  (e.g. DEADLY DIE)", 24, (v) => (d.name = v));
  name.classList.add("upper");
  const intro = input("design-intro", "ENTRANCE LINE  (e.g. A tall mirror rolls in.)", 160, (v) => (d.intro = v));
  const colors = el("div", "designer-colors");
  colors.append(el("span", "dim", "COLOR "));
  for (const [id, color] of Object.entries(DESIGN_COLORS)) {
    const b = btn(`[ ${id.toUpperCase()} ]`, "design-color", () => {
      d.color = id;
      fillInputs();
      drawTools();
      changed();
    });
    b.dataset.color = id;
    b.style.setProperty("--design-color", color);
    colors.append(b);
  }
  who.append(name, intro, colors);

  // 2: draw it
  const draw = step("2", "DRAW IT",
    "seven drawings on the same 36 x 18 frame as the game's own bosses (it gets centred for you), " +
    `plus its unique, which must fit ${ITEM_WIDTH} x ${ITEM_LINES}.`);
  const tabs = el("div", "design-tabs");
  FRAMES.forEach((_, i) => tabs.append(btn("", "design-tab", () => selectFrame(i))));
  const head = el("div", "design-frame-head");
  const title = el("b", "", "");
  title.id = "design-frame-title";
  const hint = el("div", "dim", "");
  hint.id = "design-frame-hint";
  head.append(title, hint);
  const modes = el("div", "design-modes");
  for (const [m, label] of /** @type {const} */ ([["type", "TYPE"], ["draw", "DRAW"], ["erase", "ERASE"]])) {
    const b = btn(`[ ${label} ]`, "design-mode", () => {
      mode = m;
      drawTools();
      canvas().focus();
    });
    b.dataset.mode = m;
    modes.append(b);
  }
  const mirrorBtn = btn("[ MIRROR ]", "design-tool design-toggle", () => {
    mirror = !mirror;
    drawTools();
    canvas().focus();
  });
  mirrorBtn.id = "design-mirror";
  mirrorBtn.title = "paint both halves at once, mirrored across the centre line";
  const gridBtn = btn("[ GRID ]", "design-tool design-toggle", () => {
    brightGrid = !brightGrid;
    try {
      localStorage.setItem(GRID_KEY, brightGrid ? "bright" : "faint");
    } catch {
      /* ignore */
    }
    drawTools();
  });
  gridBtn.id = "design-grid";
  gridBtn.title = "make the grid lines easier to see";
  modes.append(btn("[ UNDO ]", "design-tool", undo), btn("[ REDO ]", "design-tool", redo), mirrorBtn, gridBtn,
    btn("[ CLEAR ]", "design-tool", () => {
    pushUndo();
    canvas().value = gridify("", grid());
    setFrame(frame().key, "");
  }));
  const copy = btn("", "design-tool", () => {
    const from = frame().copy;
    if (!from) return;
    pushUndo();
    canvas().value = d.frames[from];
    setFrame(frame().key, d.frames[from]);
  });
  copy.id = "design-copy";
  modes.append(copy);
  const brushes = el("div", "design-brushes");
  brushes.id = "design-brushes";
  for (const b of BRUSHES) {
    const node = btn(b, "design-brush", () => {
      brush = b;
      drawTools();
      canvas().focus();
    });
    node.dataset.brush = b;
    brushes.append(node);
  }
  const brushNow = el("span", "dim design-brush-now", "");
  brushNow.id = "design-brush-now";
  brushes.append(brushNow);
  const help = el("div", "dim design-mode-help", "");
  help.id = "design-mode-help";
  const wrap = el("div", "design-canvas-wrap");
  const c = /** @type {HTMLTextAreaElement} */ (el("textarea", "design-canvas"));
  c.id = "design-canvas";
  c.rows = BOSS_GRID.h;
  c.cols = BOSS_GRID.w;
  c.wrap = "off";
  c.spellcheck = false;
  c.setAttribute("autocapitalize", "off");
  c.setAttribute("autocomplete", "off");
  c.setAttribute("aria-label", "Boss drawing, 36 columns by 18 lines");
  c.addEventListener("beforeinput", onBeforeInput);
  c.addEventListener("paste", onPaste);
  c.addEventListener("input", onInput);
  wrap.append(c);
  draw.append(tabs, head, modes, brushes, help, wrap);

  // 3: what it says
  const say = step("3", "WHAT IT SAYS", `up to ${MAX_TAUNTS} taunts per phase, one per line. they show under its name.`);
  ["PHASE I", "PHASE II (hurt)", "PHASE III (nearly dead)"].forEach((label, i) => {
    const t = /** @type {HTMLTextAreaElement} */ (el("textarea", "designer-input design-taunts"));
    t.id = `design-taunts-${i}`;
    t.rows = MAX_TAUNTS;
    t.spellcheck = false;
    t.placeholder = i === 0 ? "You look tired.\nI've eaten bigger heroes than you." : `${label} taunts`;
    t.setAttribute("aria-label", `${label} taunts`);
    t.addEventListener("input", () => {
      const lines = t.value.split("\n").slice(0, MAX_TAUNTS).map((l) => l.slice(0, MAX_TAUNT_LEN));
      if (lines.join("\n") !== t.value) t.value = lines.join("\n");
      d.taunts[i] = t.value;
      changed();
    });
    say.append(el("div", "dim design-taunt-label", label), t);
  });
  const death = input("design-death", "DEATH LINE  (e.g. HERE LIES UOY. SEVEN YEARS OF BAD LUCK.)", 100,
    (v) => (d.death = v));
  say.append(el("div", "dim design-taunt-label", "AFTER THE FINAL BLOW"), death);

  // 4: its boss unique
  const relic = step("4", "ITS BOSS UNIQUE",
    "a one-in-a-million relic that only drops from your boss. draw it on the UNIQUE tab above. " +
    "it gets the same stats as every boss's unique: you pick the slot and theme.");
  const uname = input("design-unique-name", "RELIC NAME  (e.g. SEAHORSE ON A STICK)", 24, (v) => (d.unique.name = v));
  uname.classList.add("upper");
  const slots = el("div", "designer-colors");
  slots.append(el("span", "dim", "SLOT "));
  for (const [id, label] of EQUIP_SLOTS) {
    const b = btn(`[ ${label} ]`, "design-color design-slot", () => {
      d.unique.slot = id;
      d.unique.theme = "";
      drawUniqueChoices();
      changed();
    });
    b.dataset.slot = id;
    b.style.setProperty("--design-color", DESIGN_COLORS.amber);
    slots.append(b);
  }
  const themes = el("div", "designer-colors");
  themes.id = "design-themes";
  const stats = el("div", "dim design-unique-stats", "");
  stats.id = "design-unique-stats";
  const uflavor = input("design-unique-flavor", "FLAVOR LINE  (e.g. Sea, it's not the time to start horsing around.)",
    MAX_ITEM_FLAVOR, (v) => (d.unique.flavor = v));
  relic.append(uname, slots, themes, stats, uflavor,
    btn("[ SHOW IT ]", "design-tool", () => selectFrame(FRAMES.findIndex((f) => f.key === "unique_art"))));

  // 5: preview + send
  const look = step("5", "HOW IT LOOKS IN THE GAME",
    "switch drawings above to see each phase (and the UNIQUE's item card). hit it to see the flinch.");
  const preview = el("div", "design-preview");
  const stage = el("div", "design-preview-stage");
  const art = el("pre", "boss-art art");
  art.id = "design-preview-art";
  stage.append(art);
  stage.title = "hit it";
  const hit = () => {
    if (frame().phase === -1) return; // an item doesn't flinch
    hitUntil = performance.now() + 260;
    art.classList.remove("hurt");
    void art.offsetWidth;
    art.classList.add("hurt");
    drawPreview();
    setTimeout(() => {
      art.classList.remove("hurt");
      drawPreview();
    }, 270);
  };
  stage.addEventListener("click", hit);
  const pname = el("div", "boss-name", "");
  pname.id = "design-preview-name";
  const psub = el("div", "boss-sub", "");
  psub.id = "design-preview-sub";
  const ptaunt = el("div", "taunt", "");
  ptaunt.id = "design-preview-taunt";
  const php = el("pre", "hp-bar", "");
  php.id = "design-preview-hp";
  const pphase = el("div", "phase", "");
  pphase.id = "design-preview-phase";
  preview.append(stage, pname, psub, ptaunt, php, pphase, btn("[ HIT IT ]", "design-tool design-hit", hit));
  const status = el("div", "designer-status", "");
  status.id = "design-status";
  const send = btn("[ SEND TO THE ADMIN ]", "designer-submit", submit);
  send.id = "design-submit";
  look.append(preview, status, send);

  const intro0 = el("div", "designer-note",
    "> draw a boss for everyone to fight. if the admin approves it, it joins the boss queue, and when it goes live you get 1,000 <> and the rainbow & badge.");
  host.replaceChildren(el("h2", "designer-title", "A S C I I   B O S S   F O R G E"), intro0, subs,
    myBosses, draftSlots, who, draw, say, relic, look);
  drawDraftSlots();
  wireDrawing();
  void document.fonts?.ready.then(() => fitCanvas()); // the font's real width, once it has loaded
  window.addEventListener("resize", () => {
    fitCanvas();
    drawPreview();
  });
  setInterval(() => {
    if (!$("panel-designer").hidden) drawPreview(); // cycle the preview's taunts
  }, 4000);
}

on("me", () => {
  if (!built || draftLoaded || !state.me) return;
  draftLoaded = true;
  loadDraft();
  fillInputs();
  selectFrame(0);
  changed();
  drawDraftSlots();
});

export function renderDesigner() {
  if (!built) {
    built = true;
    build();
    if (state.me) {
      draftLoaded = true;
      loadDraft();
    }
    fillInputs();
    selectFrame(0);
    changed();
    drawDraftSlots();
    void refreshSubmissions();
  } else if (Date.now() - lastStatusLoad > 10_000) {
    void refreshSubmissions();
  }
  requestAnimationFrame(() => {
    fitCanvas();
    drawPreview();
    drawChecklist();
  });
}
