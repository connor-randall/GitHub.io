// Pure keyboard rules kept separate so shortcut behavior can be regression-tested
// without loading the browser UI.

/** @param {{key: string, repeat?: boolean}} event */
export function isAttackShortcut(event) {
  const key = event.key.toLowerCase();
  return !event.repeat && (key === "a" || key === " ");
}

/** @param {{key: string, repeat?: boolean}} event */
export function isHeldSpace(event) {
  return event.key === " " && Boolean(event.repeat);
}

/** Number keys 1-9 (top row or keypad) wear loadout 1-9: its index (0-8), or
 * null for any other key or a held key's repeats.
 * @param {{key: string, repeat?: boolean}} event */
export function loadoutShortcut(event) {
  if (event.repeat || !/^[1-9]$/.test(event.key)) return null;
  return Number(event.key) - 1;
}
