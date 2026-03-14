console.log("TICKER FILE LOADED");

const skillNames = [
  "Overall", "Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic",
  "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting",
  "Smithing", "Mining", "Herblore", "Agility", "Thieving", "Slayer",
  "Farming", "Runecraft", "Hunter", "Construction"
];

const WORKER_URL = "https://osrs-stat-bot.c-m-randall.workers.dev/";

// Pixels per second — tune this to taste
const SCROLL_SPEED = 64;

function applyTickerAnimation(track) {
  // scrollWidth is the full doubled content; half of that is one loop
  const halfWidth = track.scrollWidth / 2;
  const duration = halfWidth / SCROLL_SPEED;

  track.style.animation = "none";
  track.offsetHeight; // force reflow so the reset takes effect
  track.style.animation = `ticker-scroll ${duration}s linear infinite`;
}

const LABEL_TEXT = ">>> OSRS STATS <<<";
const LABEL_SPEED = 40; // px/s, slower than the stats ticker

function buildLabelTrack() {
  const label = document.getElementById("osrs-label-track");
  if (!label) return;

  // Fill with enough copies to be at least 3x the screen width, then double for seamless loop
  const singleSpan = `<span>${LABEL_TEXT}</span>`;
  // Temporarily set one copy to measure its width
  label.innerHTML = singleSpan;
  const singleWidth = label.scrollWidth;
  const needed = Math.ceil((window.innerWidth * 3) / singleWidth) + 2;
  const half = Array(needed).fill(singleSpan).join("");
  label.innerHTML = half + half;

  requestAnimationFrame(() => {
    const halfWidth = label.scrollWidth / 2;
    const duration = halfWidth / LABEL_SPEED;
    label.style.animation = "none";
    label.offsetHeight;
    label.style.animation = `ticker-scroll ${duration}s linear infinite`;
  });
}


  try {
    const res = await fetch(WORKER_URL, { cache: "no-store" });
    const text = await res.text();

    console.log("RAW FIRST LINES:", text.split("\n").slice(0, 5));

    const lines = text.trim().split("\n").slice(0, 24);

    let html = "";

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].trim().split(",");
      if (parts.length < 2) continue;

      const level = parts[1].trim();
      if (level === "99") {
        html += `<span class="osrs-99">[ ⭐${skillNames[i]}: ${level}⭐ ]</span>`;
      } else {
        html += `<span>[ ${skillNames[i]}: ${level} ]</span>`;
      }
    }

    const track = document.getElementById("osrs-ticker-track");
    if (!track) return;

    // Set content (doubled for seamless loop)
    track.innerHTML = html + html;

    // Wait one frame so the browser has rendered and scrollWidth is accurate
    requestAnimationFrame(() => {
      applyTickerAnimation(track);
    });

  } catch (err) {
    console.error("Ticker error:", err);
    const track = document.getElementById("osrs-ticker-track");
    if (track) {
      track.textContent = "[ OSRS STATS OFFLINE ]";
    }
  }
}

// Recalculate duration on resize so speed stays consistent at any window width
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const track = document.getElementById("osrs-ticker-track");
    if (track && track.scrollWidth > 0) {
      applyTickerAnimation(track);
    }
    buildLabelTrack();
  }, 150);
});

window.addEventListener("load", () => {
  loadStats();
  buildLabelTrack();
});
setInterval(loadStats, 600000);
