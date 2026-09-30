export const DESIGN_WIDTH = 48;
export const DESIGN_LINES = 16;
export const DESIGN_COLORS = {
  amber: "#ffb000",
  red: "#ff6e62",
  green: "#75e36d",
  cyan: "#8bdcff",
  purple: "#dc8cff",
  white: "#f0eadc",
};

/** Strip non-printable/non-ASCII characters and enforce the art dimensions. @param {string} value */
export function sanitizeBossArt(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\x20-\x7e\n]/g, "")
    .split("\n")
    .slice(0, DESIGN_LINES)
    .map((line) => line.slice(0, DESIGN_WIDTH))
    .join("\n");
}

/** @param {string} art */
export function artSize(art) {
  const lines = art.split("\n");
  return { lines: lines.length, width: Math.max(0, ...lines.map((line) => line.length)) };
}

/** Keep an untouched hurt frame in sync with its normal frame. Once the
 * creator changes the hurt art, it becomes independent. */
export function syncHurtArt(hurtArt, previousNormal, nextNormal) {
  return !String(hurtArt).trim() || hurtArt === previousNormal ? nextNormal : hurtArt;
}

/** Paint one printable ASCII character at a grid coordinate. @param {string} art @param {number} row @param {number} col @param {string} char */
export function paintBossArt(art, row, col, char) {
  if (row < 0 || row >= DESIGN_LINES || col < 0 || col >= DESIGN_WIDTH ||
      !/^[\x20-\x7e]$/.test(char)) return sanitizeBossArt(art);
  const lines = sanitizeBossArt(art).split("\n");
  while (lines.length <= row) lines.push("");
  lines[row] = lines[row].padEnd(col + 1, " ");
  lines[row] = `${lines[row].slice(0, col)}${char}${lines[row].slice(col + 1)}`;
  return sanitizeBossArt(lines.join("\n"));
}

/** Paint a continuous line so a quick pointer drag cannot leave holes. */
export function paintBossLine(art, from, to, char) {
  let { row, col } = from;
  const dc = Math.abs(to.col - col);
  const dr = Math.abs(to.row - row);
  const stepCol = col < to.col ? 1 : -1;
  const stepRow = row < to.row ? 1 : -1;
  let error = dc - dr;
  let result = art;
  for (;;) {
    result = paintBossArt(result, row, col, char);
    if (row === to.row && col === to.col) return result;
    const twice = error * 2;
    if (twice > -dr) { error -= dr; col += stepCol; }
    if (twice < dc) { error += dc; row += stepRow; }
  }
}
