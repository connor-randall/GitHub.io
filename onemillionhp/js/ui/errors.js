// One-line error readout in the footer.

let timer = 0;

/** @param {string} msg */
export function showError(msg) {
  const e = document.getElementById("err");
  if (!e) return;
  e.textContent = "> " + msg;
  clearTimeout(timer);
  timer = window.setTimeout(() => (e.textContent = ""), 5000);
}
