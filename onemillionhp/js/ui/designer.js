import * as api from "../api.js?v=b7420735b5";
import {
  DESIGN_COLORS, DESIGN_LINES, DESIGN_WIDTH, artSize, paintBossLine, sanitizeBossArt, syncHurtArt,
} from "../boss-design.js?v=b7420735b5";
import { el } from "../ascii.js?v=b7420735b5";
import { state } from "../store.js?v=b7420735b5";
import { showError } from "./errors.js?v=b7420735b5";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const FRAME_KEYS = ["phase1_art", "phase1_hurt_art", "phase2_art", "phase2_hurt_art",
  "phase3_art", "phase3_hurt_art", "death_art"];
const FRAME_NAMES = ["PHASE I", "PHASE I HURT", "PHASE II", "PHASE II HURT",
  "PHASE III", "PHASE III HURT", "DEATH"];
const TOOLS = ["#", "@", "*", "+", "/", "\\", "|", "-", "_", ".", "(", ")"];
const DRAFT_KEY = "omhp.boss-design-draft";
const HURT_FOR_NORMAL = {
  phase1_art: "phase1_hurt_art", phase2_art: "phase2_hurt_art", phase3_art: "phase3_hurt_art",
};

let built = false;
let active = 0;
let selectedColor = "amber";
let selectedTool = "#";
let pencilOn = false;
/** @type {Record<string, string>} */
const frames = {
  phase1_art: "", phase1_hurt_art: "", phase2_art: "", phase2_hurt_art: "",
  phase3_art: "", phase3_hurt_art: "", death_art: "",
};

/** Update one frame and mirror it into an untouched matching hurt frame. */
function updateFrame(key, value) {
  const previous = frames[key];
  frames[key] = value;
  const hurtKey = HURT_FOR_NORMAL[key];
  if (hurtKey) frames[hurtKey] = syncHurtArt(frames[hurtKey], previous, value);
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: /** @type {HTMLInputElement} */ ($("design-name")).value,
      flavor: /** @type {HTMLInputElement} */ ($("design-flavor")).value,
      color: selectedColor,
      ...frames,
    }));
  } catch {
    /* local drafts are optional */
  }
}

function drawPreview() {
  const art = frames[FRAME_KEYS[active]];
  const preview = $("design-preview");
  preview.textContent = art || "\n       ( draw something terrible )\n";
  preview.style.setProperty("--design-color", DESIGN_COLORS[selectedColor]);
  $("design-canvas").style.setProperty("--design-color", DESIGN_COLORS[selectedColor]);
  const size = artSize(art);
  $("design-size").textContent = `${size.width}/${DESIGN_WIDTH} COLS :: ${size.lines}/${DESIGN_LINES} LINES`;
  document.querySelectorAll(".design-phase").forEach((node, index) => {
    node.setAttribute("aria-selected", String(index === active));
    const done = Boolean(frames[FRAME_KEYS[index]].trim());
    node.textContent = `[ ${done ? "x" : " "} ${FRAME_NAMES[index]} ]`;
  });
  const copyStatus = document.getElementById("design-copy-status");
  if (copyStatus) {
    const states = [["I", "phase1_art", "phase1_hurt_art"],
      ["II", "phase2_art", "phase2_hurt_art"], ["III", "phase3_art", "phase3_hurt_art"]]
      .map(([label, normalKey, hurtKey]) => {
        const normal = frames[normalKey];
        const hurt = frames[hurtKey];
        const mode = normal.trim() && hurt === normal ? "AUTO" : hurt.trim() ? "CUSTOM" : "WAITING";
        return `PHASE ${label} ${mode}`;
      });
    copyStatus.textContent = `HURT COPY :: ${states.join("  |  ")}`;
  }
}

/** @param {number} index */
function selectFrame(index) {
  const canvas = /** @type {HTMLTextAreaElement} */ ($("design-canvas"));
  updateFrame(FRAME_KEYS[active], sanitizeBossArt(canvas.value));
  active = index;
  canvas.value = frames[FRAME_KEYS[active]];
  drawPreview();
  canvas.focus();
}

/** Convert a pointer position into a cell on the fixed ASCII grid. */
function pointerCell(canvas, event) {
  const style = getComputedStyle(canvas);
  const probe = document.createElement("canvas").getContext("2d");
  if (probe) probe.font = style.font;
  const charWidth = probe?.measureText("M").width || Number.parseFloat(style.fontSize) * 0.6;
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.12;
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left - Number.parseFloat(style.paddingLeft) + canvas.scrollLeft;
  const y = event.clientY - bounds.top - Number.parseFloat(style.paddingTop) + canvas.scrollTop;
  const cell = { row: Math.floor(y / lineHeight), col: Math.floor(x / charWidth) };
  return cell.row >= 0 && cell.row < DESIGN_LINES && cell.col >= 0 && cell.col < DESIGN_WIDTH ? cell : null;
}

async function loadSaved() {
  let draft = null;
  let savedStatus = "";
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
  } catch {
    /* ignore a damaged local draft */
  }
  try {
    const response = await api.getBossDesign();
    savedStatus = response.design?.status ?? "";
    if (!draft && response.design) draft = response.design;
  } catch {
    /* the editor still works offline until submit */
  }
  if (!draft) return;
  /** @type {HTMLInputElement} */ ($("design-name")).value = draft.name ?? "";
  /** @type {HTMLInputElement} */ ($("design-flavor")).value = draft.flavor ?? "";
  selectedColor = DESIGN_COLORS[draft.color] ? draft.color : "amber";
  for (const key of FRAME_KEYS) frames[key] = sanitizeBossArt(draft[key] ?? "");
  for (const [normalKey, hurtKey] of Object.entries(HURT_FOR_NORMAL)) {
    frames[hurtKey] = syncHurtArt(frames[hurtKey], "", frames[normalKey]);
  }
  /** @type {HTMLTextAreaElement} */ ($("design-canvas")).value = frames[FRAME_KEYS[active]];
  document.querySelectorAll(".design-color").forEach((node) => {
    node.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (node).dataset.color === selectedColor));
  });
  drawPreview();
  if (savedStatus) {
    $("design-status").textContent = savedStatus === "denied"
      ? "STATUS DENIED — EDIT + RESUBMIT WHEN READY"
      : `SAVED SUBMISSION :: STATUS ${savedStatus.toUpperCase()}`;
  }
}

export function renderDesigner() {
  if (built) return;
  built = true;
  const host = $("panel-designer");
  const title = el("pre", "art designer-title",
    "+------------------------------------------+\n|       A S C I I   B O S S   F O R G E      |\n+------------------------------------------+");
  const intro = el("div", "designer-note",
    "> Seven required drawings: three normal phases, each phase's hurt frame, and DEATH. Every frame is locked to 48 x 16. Hurt frames copy their phase until you edit them.");
  const fields = el("div", "designer-fields");
  const name = /** @type {HTMLInputElement} */ (el("input", "designer-input"));
  name.id = "design-name";
  name.maxLength = 24;
  name.placeholder = "BOSS NAME";
  name.setAttribute("aria-label", "Boss name");
  const flavor = /** @type {HTMLInputElement} */ (el("input", "designer-input"));
  flavor.id = "design-flavor";
  flavor.maxLength = 160;
  flavor.placeholder = "FLAVOR TEXT / TITLE / THREAT";
  flavor.setAttribute("aria-label", "Boss flavor text");
  fields.append(name, flavor);

  const colors = el("div", "designer-colors");
  colors.append(el("span", "dim", "ONE COLOR :: "));
  for (const [id, color] of Object.entries(DESIGN_COLORS)) {
    const button = el("button", "design-color", `[ ${id.toUpperCase()} ]`);
    button.dataset.color = id;
    button.style.setProperty("--design-color", color);
    button.setAttribute("aria-pressed", String(id === selectedColor));
    button.addEventListener("click", () => {
      selectedColor = id;
      document.querySelectorAll(".design-color").forEach((node) =>
        node.setAttribute("aria-pressed", String(node === button)));
      drawPreview();
      saveDraft();
    });
    colors.append(button);
  }

  const phases = el("div", "designer-phases");
  for (const indexes of [[0, 1], [2, 3], [4, 5], [6]]) {
    const group = el("div", "designer-phase-group");
    for (const index of indexes) {
      const button = el("button", "design-phase", `[   ${FRAME_NAMES[index]} ]`);
      button.addEventListener("click", () => selectFrame(index));
      group.append(button);
    }
    phases.append(group);
  }
  const copyStatus = el("div", "designer-copy-status dim", "HURT COPY :: WAITING FOR PHASE ART");
  copyStatus.id = "design-copy-status";
  const tools = el("div", "designer-tools");
  tools.append(el("span", "dim", "DRAW :: "));
  const canvas = /** @type {HTMLTextAreaElement} */ (el("textarea", "design-canvas"));
  canvas.id = "design-canvas";
  canvas.rows = DESIGN_LINES;
  canvas.cols = DESIGN_WIDTH;
  canvas.wrap = "off";
  canvas.spellcheck = false;
  const pencil = /** @type {HTMLButtonElement} */ (el("button", "design-tool design-pencil", "[ PENCIL: OFF ]"));
  pencil.setAttribute("aria-pressed", "false");
  const toolButtons = [];
  function paintToolState() {
    pencil.textContent = `[ PENCIL: ${pencilOn ? "ON" : "OFF"} ]`;
    pencil.setAttribute("aria-pressed", String(pencilOn));
    canvas.classList.toggle("pencil-on", pencilOn);
    canvas.readOnly = pencilOn;
    for (const button of toolButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === selectedTool));
    }
  }
  pencil.addEventListener("click", () => {
    pencilOn = !pencilOn;
    paintToolState();
    canvas.focus();
  });
  tools.append(pencil);
  function addTool(char, label = char) {
    const button = /** @type {HTMLButtonElement} */ (el("button", "design-tool", `[ ${label} ]`));
    button.dataset.tool = char;
    button.setAttribute("aria-pressed", String(char === selectedTool));
    button.addEventListener("click", () => {
      selectedTool = char;
      pencilOn = true;
      paintToolState();
      canvas.focus();
    });
    toolButtons.push(button);
    tools.append(button);
  }
  for (const char of TOOLS) {
    addTool(char);
  }
  addTool(" ", "ERASE");
  const size = el("div", "designer-size dim", "0/48 COLS :: 1/16 LINES");
  size.id = "design-size";
  const canvasFrame = el("div", "design-canvas-frame");
  const topBorder = "+--[ BOSS FRAME :: 48 x 16 ]".padEnd(DESIGN_WIDTH + 1, "-") + "+";
  const bottomBorder = `+${"-".repeat(DESIGN_WIDTH)}+`;
  canvasFrame.append(el("div", "design-canvas-border", topBorder),
    canvas, size,
    el("div", "design-canvas-border bottom", bottomBorder));
  const preview = el("pre", "art design-preview");
  preview.id = "design-preview";
  const status = el("div", "designer-status dim", "DRAFT — NOT IN THE LIVE BOSS ROTATION");
  status.id = "design-status";
  const submit = /** @type {HTMLButtonElement} */ (el("button", "designer-submit",
    "+--------------------------------+\n|       [ SUBMIT FOR REVIEW ]      |\n+--------------------------------+"));

  canvas.addEventListener("input", () => {
    const cleaned = sanitizeBossArt(canvas.value);
    if (canvas.value !== cleaned) canvas.value = cleaned;
    updateFrame(FRAME_KEYS[active], cleaned);
    drawPreview();
    saveDraft();
  });
  let drawing = false;
  let lastCell = null;
  const paintAtPointer = (event) => {
    const cell = pointerCell(canvas, event);
    if (!cell || (lastCell && cell.row === lastCell.row && cell.col === lastCell.col)) return;
    canvas.value = paintBossLine(canvas.value, lastCell || cell, cell, selectedTool);
    updateFrame(FRAME_KEYS[active], canvas.value);
    lastCell = cell;
    drawPreview();
    saveDraft();
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (!pencilOn || event.button !== 0) return;
    event.preventDefault();
    drawing = true;
    lastCell = null;
    canvas.setPointerCapture(event.pointerId);
    paintAtPointer(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing || !pencilOn) return;
    event.preventDefault();
    paintAtPointer(event);
  });
  const stopDrawing = (event) => {
    drawing = false;
    lastCell = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  for (const input of [name, flavor]) input.addEventListener("input", saveDraft);
  submit.addEventListener("click", async () => {
    updateFrame(FRAME_KEYS[active], sanitizeBossArt(canvas.value));
    submit.disabled = true;
    status.textContent = "TRANSMITTING DESIGN...";
    try {
      const response = await api.saveBossDesign({
        name: name.value,
        flavor: flavor.value,
        color: selectedColor,
        ...frames,
      });
      status.textContent = `SUBMITTED :: ${response.design.name} :: STATUS ${response.design.status.toUpperCase()}`;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* optional */ }
    } catch (error) {
      status.textContent = "SUBMISSION FAILED — DRAFT KEPT LOCALLY";
      showError(/** @type {Error} */ (error).message);
    } finally {
      submit.disabled = false;
    }
  });
  if (!state.me?.name_chosen) status.textContent = "CHOOSE YOUR PLAYER NAME BEFORE SUBMITTING";
  host.append(title, intro, fields, colors, phases, copyStatus, tools, canvasFrame,
    el("div", "panel-h designer-preview-h", "LIVE MONOCHROME PREVIEW"), preview, status, submit);
  drawPreview();
  paintToolState();
  loadSaved();
}
