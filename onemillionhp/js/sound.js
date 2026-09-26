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

/** @param {number} freq @param {number} dur @param {number} [delay] @param {OscillatorType} [type] */
function blip(freq, dur, delay = 0, type = "square") {
  if (!enabled) return;
  ctx ??= new AudioContext();
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
export const loot = () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.1, i * 0.08, "triangle"));
