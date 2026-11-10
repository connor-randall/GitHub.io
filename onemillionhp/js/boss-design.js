// Pure helpers for the boss designer (tested in tests/js/boss-design.test.js).
// Frames are edited on a fixed grid: always DESIGN_LINES lines of exactly
// DESIGN_WIDTH characters, so typing overwrites a cell instead of shoving the
// rest of the line sideways, like drawing on graph paper.

// The hand-made bosses' frame (docs/MAKING_BOSSES.md, server community.py).
export const DESIGN_WIDTH = 36;
export const DESIGN_LINES = 18;
/** A drawing grid's size: the boss frame, or the smaller boss unique (ITEM_GRID). */
export const BOSS_GRID = { w: DESIGN_WIDTH, h: DESIGN_LINES };
export const DESIGN_COLORS = {
  amber: "#ffb000",
  red: "#ff6e62",
  green: "#75e36d",
  cyan: "#8bdcff",
  purple: "#dc8cff",
  white: "#f0eadc",
  // Ticket #255: more colours (still one per boss).
  orange: "#ff8c2a",
  yellow: "#ffe14d",
  lime: "#c4f25a",
  teal: "#3fe0c0",
  blue: "#6f9bff",
  pink: "#ff8fd8",
  magenta: "#ff4fa8",
  silver: "#b9c2cc",
};
export const MAX_TAUNTS = 3;
export const MAX_TAUNT_LEN = 90;

/** Strip non-printable/non-ASCII characters and enforce the art dimensions.
 * @param {string} value @param {{w: number, h: number}} [size] */
export function sanitizeBossArt(value, size = BOSS_GRID) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[^\x20-\x7e\n]/g, "")
    .split("\n")
    .slice(0, size.h)
    .map((line) => line.slice(0, size.w))
    .join("\n");
}

/** The editing grid: exactly size.h lines x size.w, space-filled.
 * @param {string} art @param {{w: number, h: number}} [size] */
export function gridify(art, size = BOSS_GRID) {
  const lines = sanitizeBossArt(art, size).split("\n");
  while (lines.length < size.h) lines.push("");
  return lines.map((line) => line.padEnd(size.w)).join("\n");
}

/** What gets sent: the grid without trailing spaces or blank lines at the end. @param {string} art */
export function compact(art) {
  return sanitizeBossArt(art).split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n+$/, "");
}

/** Anything drawn? @param {string} art */
export const isDrawn = (art) => /\S/.test(art);

/** @param {string} art */
export function artSize(art) {
  const lines = compact(art).split("\n");
  return { lines: lines.length, width: Math.max(0, ...lines.map((line) => line.length)) };
}

/** A unique drawn on the old full-size grid, moved into the item grid: its
 * empty rows and columns around it are dropped first, so anything that fit
 * 24 x 14 anywhere on the big grid survives whole. @param {string} art */
export function fitItemArt(art) {
  return gridify(cropArt(art).join("\n"), ITEM_GRID);
}

/** Old drafts were drawn 48 wide: slide them left so the drawing fits 36.
 * @param {string[]} frames @returns {string[]} */
export function fitOldDrafts(frames) {
  const lines = frames.flatMap((f) => String(f).split("\n")).filter((l) => /\S/.test(l));
  if (!lines.some((l) => l.trimEnd().length > DESIGN_WIDTH)) return frames.map((f) => sanitizeBossArt(f));
  const cut = Math.min(...lines.map((l) => l.length - l.trimStart().length));
  return frames.map((f) => sanitizeBossArt(String(f).split("\n").map((l) => l.slice(cut)).join("\n")));
}

/** Keep an untouched hurt frame in sync with its normal frame. Once the
 * creator changes the hurt art, it becomes independent. */
export function syncHurtArt(hurtArt, previousNormal, nextNormal) {
  return !isDrawn(String(hurtArt)) || hurtArt === previousNormal ? nextNormal : hurtArt;
}

/** Paint one printable ASCII character at a grid coordinate. @param {string} art @param {number} row
 * @param {number} col @param {string} char @param {{w: number, h: number}} [size] */
export function paintBossArt(art, row, col, char, size = BOSS_GRID) {
  if (row < 0 || row >= size.h || col < 0 || col >= size.w ||
      !/^[\x20-\x7e]$/.test(char)) return sanitizeBossArt(art, size);
  const lines = sanitizeBossArt(art, size).split("\n");
  while (lines.length <= row) lines.push("");
  lines[row] = lines[row].padEnd(col + 1, " ");
  lines[row] = `${lines[row].slice(0, col)}${char}${lines[row].slice(col + 1)}`;
  return sanitizeBossArt(lines.join("\n"), size);
}

/** Characters that face a way, and their mirror image. */
const MIRRORED = /** @type {Record<string, string>} */ ({
  "/": "\\", "\\": "/", "(": ")", ")": "(", "<": ">", ">": "<", "[": "]", "]": "[", "{": "}", "}": "{",
  "`": "'", "'": "`", d: "b", b: "d", p: "q", q: "p",
});
/** A brush character as it looks in a left-right mirror. @param {string} char */
export const mirrorChar = (char) => MIRRORED[char] ?? char;
/** The column across the frame's centre line. @param {number} col @param {{w: number, h: number}} [size] */
export const mirrorCol = (col, size = BOSS_GRID) => size.w - 1 - col;

/** Paint a continuous line so a quick pointer drag cannot leave holes. */
export function paintBossLine(art, from, to, char, size = BOSS_GRID) {
  let { row, col } = from;
  const dc = Math.abs(to.col - col);
  const dr = Math.abs(to.row - row);
  const stepCol = col < to.col ? 1 : -1;
  const stepRow = row < to.row ? 1 : -1;
  let error = dc - dr;
  let result = art;
  for (;;) {
    result = paintBossArt(result, row, col, char, size);
    if (row === to.row && col === to.col) return result;
    const twice = error * 2;
    if (twice > -dr) { error -= dr; col += stepCol; }
    if (twice < dc) { error += dc; row += stepRow; }
  }
}

// ---- typing on the grid (the editor's value is always gridify()-shaped)

/** Caret index -> cell (a grid row is size.w characters plus its newline).
 * @param {number} index @param {{w: number, h: number}} [size] */
export const cellAt = (index, size = BOSS_GRID) => ({ row: Math.floor(index / (size.w + 1)), col: index % (size.w + 1) });

/** Cell -> caret index (clamped to the grid). @param {number} row @param {number} col @param {{w: number, h: number}} [size] */
export const indexAt = (row, col, size = BOSS_GRID) =>
  Math.max(0, Math.min(size.h - 1, row)) * (size.w + 1) + Math.max(0, Math.min(size.w, col));

/** Overtype one character at the caret. @returns {{value: string, caret: number}}
 * @param {string} grid @param {number} caret @param {string} char @param {{w: number, h: number}} [size] */
export function typeAt(grid, caret, char, size = BOSS_GRID) {
  const { row, col } = cellAt(caret, size);
  if (col >= size.w) return typeAt(grid, indexAt(row + 1, 0, size), char, size); // at a line end: wrap
  const value = gridify(paintBossArt(grid, row, col, char, size), size);
  return { value, caret: indexAt(row, col + 1, size) };
}

/** Blank the cells from start to end (newlines stay).
 * @param {string} grid @param {number} start @param {number} end @param {{w: number, h: number}} [size] */
export function blank(grid, start, end, size = BOSS_GRID) {
  const chars = gridify(grid, size).split("");
  for (let i = start; i < end && i < chars.length; i++) if (chars[i] !== "\n") chars[i] = " ";
  return chars.join("");
}

/** Paste a block of text with its top-left corner at the caret, keeping its
 * shape (each pasted line lands under the one before). Spaces in the paste
 * overwrite too, so a pasted drawing arrives exactly as copied.
 * @param {string} grid @param {number} caret @param {string} text @param {{w: number, h: number}} [size] */
export function pasteBlock(grid, caret, text, size = BOSS_GRID) {
  const { row, col } = cellAt(caret, size);
  let art = gridify(grid, size);
  const lines = sanitizeBossArt(text.replace(/\t/g, "  "), size).split("\n");
  // Too big for the space left: nudged up/left just enough to fit.
  const r0 = Math.max(0, Math.min(row, size.h - lines.length));
  const c0 = Math.max(0, Math.min(col, size.w - Math.max(...lines.map((l) => l.length))));
  lines.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) art = paintBossArt(art, r0 + r, c0 + c, line[c], size);
  });
  return { value: gridify(art, size), caret: indexAt(r0 + lines.length - 1, c0 + (lines.at(-1)?.length ?? 0), size) };
}

// ---- how the server will place the art (same as community.normalize_frames)

/** Crop the frames' shared bounding box, then centre it in a 36 x 18 frame
 * (bigger if the drawing is), exactly as the boss will appear in the game.
 * @param {string[]} frames @returns {string[][]} */
export function normalizeFrames(frames, width = DESIGN_WIDTH, height = DESIGN_LINES) {
  const rows = frames.map((f) => String(f).split("\n").map((l) => l.trimEnd()));
  const used = rows.flatMap((f) => f.map((line, r) => ({ r, line }))).filter((x) => /\S/.test(x.line));
  if (!used.length) return rows.map(() => Array(height).fill(" ".repeat(width)));
  const top = Math.min(...used.map((x) => x.r));
  const bottom = Math.max(...used.map((x) => x.r));
  const left = Math.min(...used.map((x) => x.line.length - x.line.trimStart().length));
  const right = Math.max(...used.map((x) => x.line.length));
  const w = Math.max(width, right - left);
  const h = Math.max(height, bottom - top + 1);
  const padLeft = Math.floor((w - (right - left)) / 2);
  const padTop = Math.floor((h - (bottom - top + 1)) / 2);
  return rows.map((f) => {
    const out = Array(padTop).fill("");
    for (let r = top; r <= bottom; r++) out.push(" ".repeat(padLeft) + (f[r] ?? "").slice(left, right));
    while (out.length < h) out.push("");
    return out.map((line) => line.trimEnd().padEnd(w));
  });
}

/** One taunt per line, up to MAX_TAUNTS, each up to MAX_TAUNT_LEN. @param {string} text */
export function tauntLines(text) {
  return String(text).split("\n").map((t) => t.replace(/[^\x20-\x7e]/g, "").trim()).filter(Boolean)
    .slice(0, MAX_TAUNTS).map((t) => t.slice(0, MAX_TAUNT_LEN));
}

// ---- the boss unique (its one-in-a-million relic)

// Drawn on its own smaller grid: it has to fit an item card (server community.py).
export const ITEM_WIDTH = 24;
export const ITEM_LINES = 14;
export const ITEM_GRID = { w: ITEM_WIDTH, h: ITEM_LINES };
export const MAX_ITEM_FLAVOR = 100;

/** The drawing without the empty rows and columns around it (as the server
 * stores it). @param {string} art @returns {string[]} */
export function cropArt(art) {
  const lines = sanitizeBossArt(art).split("\n").map((l) => l.trimEnd());
  const used = lines.map((l, i) => (/\S/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!used.length) return [];
  const body = lines.slice(used[0], used[used.length - 1] + 1);
  const cut = Math.min(...body.filter((l) => /\S/.test(l)).map((l) => l.length - l.trimStart().length));
  return body.map((l) => l.slice(cut));
}
