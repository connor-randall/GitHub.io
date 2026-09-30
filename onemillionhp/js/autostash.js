// AUTO STASH: found items skip the ITEM FOUND pop-up and go straight to the
// bag. Off by default; remembered per browser (like sound).

const KEY = "omhp.autostash";
let enabled = false;
try {
  enabled = localStorage.getItem(KEY) === "on";
} catch {
  /* ignore */
}

export const isAutoStash = () => enabled;

/** @param {boolean} on */
export function setAutoStash(on) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}
