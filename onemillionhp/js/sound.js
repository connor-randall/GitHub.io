// Optional square-wave blips. Off by default; the toggle is remembered
// per browser.

const KEY = "omhp.sound";
/** @type {AudioContext | null} */
let ctx = null;
let enabled = false;
try {
  enabled = localStorage.getItem(KEY) === "on";
} catch {
  /* ignore */
}

export const isOn = () => enabled;

export function toggle() {
  enabled = !enabled;
  try {
    localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (enabled) blip(660, 0.05);
  return enabled;
}

// Ticket #233: a chime when your attacks are full. Its own switch (off by
// default), so it rings even with the other sounds off.
const FULL_KEY = "omhp.sound.full";
let fullAlert = false;
try {
  fullAlert = localStorage.getItem(FULL_KEY) === "on";
} catch {
  /* ignore */
}

export const fullAlertOn = () => fullAlert;

export function toggleFullAlert() {
  fullAlert = !fullAlert;
  try {
    localStorage.setItem(FULL_KEY, fullAlert ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (fullAlert) attacksFull();
  return fullAlert;
}

/** Attacks are full: two bright rising notes, then a third. */
export function attacksFull() {
  if (!fullAlert) return;
  [[659, 0], [988, 0.12], [1319, 0.3]].forEach(([f, at]) => blip(f, 0.16, at, "triangle", true));
}

/** @param {number} freq @param {number} dur @param {number} [delay] @param {OscillatorType} [type]
 * @param {boolean} [always] play even with sound effects off (the full-attacks alert) */
function blip(freq, dur, delay = 0, type = "square", always = false) {
  if (!enabled && !always) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {}); // made before the first click
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.06, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

export const hit = () => {
  blip(180, 0.07);
  blip(90, 0.09, 0.03);
};
export const crit = () => [220, 330, 440, 660].forEach((f, i) => blip(f, 0.09, i * 0.06));
export const ultimate = () => [110, 147, 196, 262, 392, 523].forEach((f, i) => blip(f, 0.14, i * 0.09, "sawtooth"));
/** A boss relic: a rising shimmer, then a deep chord. */
export const relic = () => {
  [262, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => blip(f, 0.12, i * 0.09, "triangle"));
  [131, 196, 262, 392].forEach((f) => blip(f, 0.9, 1.25, "sawtooth"));
};
/** THE BLACKSMITH: a metal tap (``deep`` for the last blow), and a quench hiss. */
export const hammer = (deep = false) => {
  blip(deep ? 98 : 131, 0.05, 0, "square");
  blip(deep ? 1568 : 2093, 0.04, 0.005, "triangle");
};
export const hiss = () => [2637, 2349, 2093, 1865].forEach((f, i) => blip(f, 0.05, i * 0.035, "sawtooth"));
/** A chest rattling before it bursts: a dry wooden knock. */
export const rattle = () => blip(110 + Math.random() * 30, 0.03, 0, "square");
/** The boss enters a new phase: a falling three-note growl. */
export const phase = () => [196, 147, 98].forEach((f, i) => blip(f, 0.16, i * 0.12, "sawtooth"));
/** ATTACK pressed with nothing left: a dull thud. */
export const denied = () => blip(70, 0.08, 0, "square");
export const loot = () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.1, i * 0.08, "triangle"));
/** A world event starting: a quick 8-bit fanfare over a two-note bass. */
export const eventStart = () => {
  /** @type {[number, number, number][]} [freq, start, length] */
  const lead = [[784, 0, 0.07], [1047, 0.08, 0.07], [1319, 0.16, 0.07], [1568, 0.24, 0.11],
    [1319, 0.36, 0.07], [1568, 0.44, 0.38]];
  lead.forEach(([f, at, d]) => blip(f, d, at));
  blip(262, 0.3, 0, "triangle");
  blip(392, 0.4, 0.44, "triangle");
};
