const skillNames = [
  "Overall","Attack","Defence","Strength","Hitpoints","Ranged","Prayer","Magic",
  "Cooking","Woodcutting","Fletching","Fishing","Firemaking","Crafting",
  "Smithing","Mining","Herblore","Agility","Thieving","Slayer",
  "Farming","Runecraft","Hunter","Construction"
];

async function loadStats() {
  try {
    const res = await fetch("https://osrs-stat-bot.c-m-randall.workers.dev/");
    const text = await res.text();

    console.log("OSRS response:", text);

    const lines = text.trim().split("\n").slice(0, 24);

    let ticker = "";

    lines.forEach((line, i) => {
      const parts = line.split(",");

      if (parts.length < 2) {
        return;
      }

      const level = parts[1];
      ticker += `<span>[ ${skillNames[i]}: ${level} ]</span>`;
    });

    const track = document.getElementById("osrs-ticker-track");

    if (!ticker) {
      track.innerHTML = `<span>[ OSRS STATS UNAVAILABLE ]</span>`;
      return;
    }

    track.innerHTML = ticker + ticker;
  } catch (err) {
    console.error("Ticker error:", err);
    const track = document.getElementById("osrs-ticker-track");
    if (track) {
      track.innerHTML = `<span>[ OSRS STATS OFFLINE ]</span>`;
    }
  }
}

loadStats();
setInterval(loadStats, 600000);
