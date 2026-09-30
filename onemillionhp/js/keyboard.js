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
