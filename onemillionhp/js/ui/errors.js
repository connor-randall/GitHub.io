// One-line error readout, pinned to the top of the screen (ticket #158). A tap clears it.

let timer = 0;

/** @param {string} msg */
export function showError(msg) {
  const e = document.getElementById("err");
  if (!e) return;
  e.onclick = () => (e.textContent = "");
  e.textContent = "> " + msg;
  clearTimeout(timer);
  timer = window.setTimeout(() => (e.textContent = ""), 5000);
}
