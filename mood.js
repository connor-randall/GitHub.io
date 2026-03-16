// =====================================================================
// mood.js — daily mood tracker
// Requires a Cloudflare Worker that returns your Google Sheet as CSV.
// The Worker should return rows like:
//   1/1/2026 2:00:22,3
//   1/2/2026 2:00:13,4
// (column A = timestamp, column B = rating 1-5)
//
// Set up: in Cloudflare Workers, fetch your sheet's published CSV URL:
//   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv
// and return the response text. Then paste your Worker URL below.
// =====================================================================

const MOOD_WORKER_URL = "https://moodbot.c-m-randall.workers.dev/";

const MOOD_LABELS = { 1:"awful", 2:"bad", 3:"okay", 4:"good", 5:"great" };
const STAR_COUNT  = { 1:"★", 2:"★★", 3:"★★★", 4:"★★★★", 5:"★★★★★" };

async function loadMood() {
  try {
    const res  = await fetch(MOOD_WORKER_URL, { cache: "no-store" });
    const text = await res.text();
    const rows = text.trim().split("\n").filter(r => r.trim());

    // Skip header row
    const dataRows = rows.filter(r => !r.toLowerCase().startsWith("timestamp"));

    // Parse into { dateKey: rating } — keep last entry per day
    const byDay = {};
    for (const row of dataRows) {
      const parts = row.trim().split(",");
      if (parts.length < 2) continue;
      const rating = parseInt(parts[1].trim(), 10);
      if (isNaN(rating) || rating < 1 || rating > 5) continue;

      // Parse date from timestamp like "1/2/2026 2:00:13"
      const datePart = parts[0].trim().split(" ")[0];
      const [m, d, y] = datePart.split("/").map(Number);
      if (!m || !d || !y) continue;
      const key = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      byDay[key] = rating;
    }

    // Most recent entry is "today" regardless of exact date
    const lastRow = dataRows[dataRows.length - 1];
    let todayRating = 0;
    if (lastRow) {
      const parts = lastRow.trim().split(",");
      if (parts.length >= 2) {
        const r = parseInt(parts[1].trim(), 10);
        if (r >= 1 && r <= 5) todayRating = r;
      }
    }

    // Build last 30 days array ending today
    const today = new Date();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      days.push({ key, rating: byDay[key] || 0, date: d });
    }

    renderChart(days);
    renderToday(todayRating);

  } catch (err) {
    console.error("Mood error:", err);
    const el = document.getElementById("mood-today-value");
    if (el) el.textContent = "offline";
  }
}

function renderToday(rating) {
  const val   = document.getElementById("mood-today-value");
  const stars = document.getElementById("mood-today-stars");
  if (!val || !stars) return;

  if (!rating) {
    val.textContent   = "--";
    stars.textContent = "";
    return;
  }

  val.textContent   = `${rating}/5 ${MOOD_LABELS[rating]}`;
  stars.textContent = STAR_COUNT[rating];

  // Color the value to match the bar color
  const colors = { 1:"#ff6666", 2:"#ffaa44", 3:"#ffff88", 4:"#44ff88", 5:"#88ffff" };
  val.style.color   = colors[rating] || "#fff";
  stars.style.color = "#ffd700";
}

function renderChart(days) {
  const chart = document.getElementById("mood-chart");
  if (!chart) return;

  const maxH = 72; // px, matches container height minus padding
  chart.innerHTML = "";

  for (const { rating, date } of days) {
    const bar = document.createElement("div");
    bar.className = "mood-bar";
    bar.dataset.r = rating || 0;

    const h = rating ? Math.round((rating / 5) * maxH) : 4;
    bar.style.height = h + "px";

    const label = date.toLocaleDateString("en-US", { month:"numeric", day:"numeric" });
    bar.title = rating ? `${label}: ${rating}/5 (${MOOD_LABELS[rating]})` : `${label}: no entry`;

    chart.appendChild(bar);
  }

  // Date range labels
  const start = document.getElementById("mood-date-start");
  const end   = document.getElementById("mood-date-end");
  if (start) start.textContent = days[0].date.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  if (end)   end.textContent   = days[days.length-1].date.toLocaleDateString("en-US", { month:"short", day:"numeric" });
}

window.addEventListener("load", loadMood);
// Refresh once per hour
setInterval(loadMood, 3600000);
