// ASCII helpers: boxes, bars, big digits, fitting art to its container.

export const LOGO_WIDE = [
  "  ___  _  _ ___   __  __ ___ _    _    ___  ___  _  _   _  _ ___ ",
  " / _ \\| \\| | __| |  \\/  |_ _| |  | |  |_ _|/ _ \\| \\| | | || | _ \\",
  "| (_) | .` | _|  | |\\/| || || |__| |__ | || (_) | .` | | __ |  _/",
  " \\___/|_|\\_|___| |_|  |_|___|____|____|___|\\___/|_|\\_| |_||_|_|  ",
];

export const LOGO_STACK = [
  "            ___  _  _ ___",
  "           / _ \\| \\| | __|",
  "          | (_) | .` | _|",
  "           \\___/|_|\\_|___|",
  " __  __ ___ _    _    ___  ___  _  _",
  "|  \\/  |_ _| |  | |  |_ _|/ _ \\| \\| |",
  "| |\\/| || || |__| |__ | || (_) | .` |",
  "|_|  |_|___|____|____|___|\\___/|_|\\_|",
  "              _  _ ___",
  "             | || | _ \\",
  "             | __ |  _/",
  "             |_||_|_|",
];

/**
 * Per-rarity box style. Readable without color: each tier has its own
 * border characters and label decoration.
 * @type {Record<string, {h: string, v: string, c: string, deco: [string, string]}>}
 */
export const RARITY_STYLE = {
  common:    { h: "-", v: "|", c: "+", deco: ["[", "]"] },
  uncommon:  { h: "-", v: ":", c: "+", deco: [":", ":"] },
  rare:      { h: "~", v: "|", c: "*", deco: ["* ", " *"] },
  epic:      { h: "=", v: "|", c: "+", deco: ["<< ", " >>"] },
  legendary: { h: "#", v: "#", c: "#", deco: ["## ", " ##"] },
  mythic:    { h: "@", v: "@", c: "@", deco: ["@@ ", " @@"] },
};

/** @param {number} n */
export const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** @param {string} s @param {number} w */
export function center(s, w) {
  if (s.length >= w) return s.slice(0, w);
  const left = Math.floor((w - s.length) / 2);
  return " ".repeat(left) + s + " ".repeat(w - s.length - left);
}

/** @param {string} s @param {number} w */
export const padR = (s, w) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
/** @param {string} s @param {number} w */
export const padL = (s, w) => (s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s);

/** Widest line length (ignoring trailing spaces). @param {readonly string[]} lines */
export const widthOf = (lines) => lines.reduce((m, l) => Math.max(m, l.replace(/\s+$/, "").length), 0);

/**
 * Draw a box around lines. Lines are centred inside unless align = "left".
 * @param {readonly string[]} lines
 * @param {{width?: number, style?: {h: string, v: string, c: string}, align?: "left"|"center", padX?: number}} [opts]
 * @returns {string[]}
 */
export function box(lines, opts = {}) {
  const st = opts.style ?? RARITY_STYLE.common;
  const padX = opts.padX ?? 1;
  const inner = Math.max(opts.width ? opts.width - 2 : 0, widthOf(lines) + padX * 2);
  const body = lines.map((l) => {
    const t = l.replace(/\s+$/, "");
    const cell = opts.align === "left" ? " ".repeat(padX) + padR(t, inner - padX) : center(t, inner);
    return st.v + cell + st.v;
  });
  const edge = st.c + st.h.repeat(inner) + st.c;
  return [edge, ...body, edge];
}

/** Remove the indentation shared by every non-blank line.
 * @param {readonly string[]} lines */
export function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut).replace(/\s+$/, ""));
}

/**
 * Left-align a block of art as a unit and centre the block (keeps the art's
 * internal alignment intact, unlike centring each line).
 * @param {readonly string[]} art @param {number} w
 */
export function centerBlock(art, w) {
  const aw = widthOf(art);
  const left = Math.max(0, Math.floor((w - aw) / 2));
  return art.map((l) => " ".repeat(left) + padR(l.replace(/\s+$/, ""), aw));
}

/**
 * HP bar like  [██████████░░░░░░]
 * @param {number} frac 0..1 @param {number} cells
 */
export function bar(frac, cells) {
  const f = Math.max(0, Math.min(1, frac));
  // Never show an empty bar while the boss has any HP left.
  let full = Math.floor(f * cells);
  if (f > 0 && full === 0) full = 1;
  return "[" + "\u2588".repeat(full) + "\u2591".repeat(cells - full) + "]";
}

// 5-row block digits for big damage numbers (crit / ultimate).
const DIGITS = {
  "0": [" ### ", "#   #", "#   #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "  ## ", " #   ", "#####"],
  "3": ["#### ", "    #", " ### ", "    #", "#### "],
  "4": ["#  # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "#### "],
  "6": [" ### ", "#    ", "#### ", "#   #", " ### "],
  "7": ["#####", "   # ", "  #  ", " #   ", " #   "],
  "8": [" ### ", "#   #", " ### ", "#   #", " ### "],
  "9": [" ### ", "#   #", " ####", "    #", " ### "],
  ",": ["   ", "   ", "   ", " # ", "#  "],
};

/** @param {string} text digits and commas @returns {string[]} */
export function bigText(text) {
  const rows = ["", "", "", "", ""];
  for (const ch of text) {
    const g = DIGITS[/** @type {keyof typeof DIGITS} */ (ch)];
    if (!g) continue;
    for (let r = 0; r < 5; r++) rows[r] += g[r] + " ";
  }
  return rows.map((r) => r.replace(/\s+$/, ""));
}

/**
 * Size a <pre> of ASCII art so its widest line fits the container, capped
 * at maxPx. Monospace advance ~0.6em for JetBrains Mono.
 * @param {HTMLElement} pre @param {number} [maxPx]
 */
export function fitArt(pre, maxPx = 14) {
  const cols = Number(pre.dataset.cols) || widthOf(pre.textContent?.split("\n") ?? []);
  const parent = pre.parentElement;
  if (!parent || !cols) return;
  const avail = parent.clientWidth;
  const px = Math.max(5, Math.min(maxPx, avail / (cols * 0.602)));
  pre.style.setProperty("font-size", px.toFixed(2) + "px");
}

/** @param {HTMLElement} pre @param {readonly string[]} lines @param {number} [maxPx] */
export function setArt(pre, lines, maxPx) {
  pre.textContent = lines.join("\n");
  pre.dataset.cols = String(widthOf(lines));
  if (maxPx) pre.dataset.max = String(maxPx);
  fitArt(pre, maxPx ?? (Number(pre.dataset.max) || 14));
}

/** Refit every art block when the viewport changes. */
export function autoFit() {
  const refit = () => {
    document.querySelectorAll("pre.art").forEach((el) => {
      const pre = /** @type {HTMLElement} */ (el);
      fitArt(pre, Number(pre.dataset.max) || 14);
    });
  };
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(refit);
  });
  return refit;
}

/** Tiny DOM helper. @param {string} tag @param {string} [cls] @param {string} [text] */
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** @param {number} secs */
export function duration(secs) {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

/** @param {number} secs */
export function clock(secs) {
  const s = Math.max(0, Math.floor(secs));
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Relative age like 12s, 4m, 3h. @param {number} secs */
export function ago(secs) {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
