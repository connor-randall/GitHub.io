console.log("NEW TICKER LOADED");

const skillNames = [
  "Overall", "Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic",
  "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting",
  "Smithing", "Mining", "Herblore", "Agility", "Thieving", "Slayer",
  "Farming", "Runecraft", "Hunter", "Construction"
];

const WORKER_URL = "https://osrs-stat-bot.c-m-randall.workers.dev/";

async function loadStats() {
  try {
    const res = await fetch(WORKER_URL, { cache: "no-store" });
    const text = await res.text();

    console.log("RAW RESPONSE:", text.split("\n").slice(0, 5));

    const lines = text.trim().split("\n").slice(0, 24);

    let html = "";

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].trim().split(",");
      if (parts.length < 2) continue;

      const level = parts[1].trim();
      html += `<span>[ ${skillNames[i]}: ${level} ]</span>`;
    }

    const track = document.getElementById("osrs-ticker-track");
    if (track) {
      track.innerHTML = html + html;
    }
  } catch (err) {
    console.error("Ticker error:", err);
    const track = document.getElementById("osrs-ticker-track");
    if (track) {
      track.textContent = "[ OSRS STATS OFFLINE ]";
    }
  }
}

window.addEventListener("load", loadStats);
setInterval(loadStats, 600000);
