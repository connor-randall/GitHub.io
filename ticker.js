const skillNames = [
  "Overall",
  "Attack",
  "Defence",
  "Strength",
  "Hitpoints",
  "Ranged",
  "Prayer",
  "Magic",
  "Cooking",
  "Woodcutting",
  "Fletching",
  "Fishing",
  "Firemaking",
  "Crafting",
  "Smithing",
  "Mining",
  "Herblore",
  "Agility",
  "Thieving",
  "Slayer",
  "Farming",
  "Runecraft",
  "Hunter",
  "Construction"
];

async function loadOsrsTicker() {
  try {
    const response = await fetch("/api/osrs");
    const text = await response.text();

    const lines = text.trim().split("\n");
    const skillLines = lines.slice(0, 24);

    const stats = skillLines.map((line, index) => {
      const parts = line.split(",");

      return {
        name: skillNames[index],
        rank: parts[0],
        level: parts[1],
        xp: parts[2] || null
      };
    });

    const tickerTrack = document.getElementById("osrs-ticker-track");

    const html = stats
      .map(stat => {
        if (stat.name === "Overall") {
          return `<span>[ ${stat.name}: ${stat.level} ]</span>`;
        }
        return `<span>[ ${stat.name}: ${stat.level} ]</span>`;
      })
      .join("");

    // duplicate content so it loops more smoothly
    tickerTrack.innerHTML = html + html;
  } catch (error) {
    console.error("Failed to load OSRS stats:", error);
    document.getElementById("osrs-ticker-track").innerHTML =
      "<span>[ OSRS STATS OFFLINE ]</span>";
  }
}

loadOsrsTicker();
setInterval(loadOsrsTicker, 1000 * 60 * 10);
