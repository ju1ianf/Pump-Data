// --- helpers ---------------------------------------------------------------
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// cache json so repeated range switches don’t re-fetch files
const __dataCache = Object.create(null);
async function loadSeries(file) {
  if (!__dataCache[file]) {
    const res = await fetch(file, { cache: "no-store" });
    const j = await res.json();
    __dataCache[file] = j.series || [];
  }
  return __dataCache[file];
}

/**
 * Build a dual-axis line chart and wire up the toolbar buttons under it.
 *
 * @param {object} cfg
 *   el:           canvas id
 *   file:         json path
 *   leftKey:      series key for left axis
 *   rightKey:     series key for right axis
 *   leftLabel:    legend label
 *   rightLabel:   legend label
 *   leftColor:    hex color (line)
 *   rightColor:   hex color (line)
 */
async function makeDualAxis(cfg) {
  const {
    el, file,
    leftKey, rightKey,
    leftLabel, rightLabel,
    leftColor = "#54d794",
    rightColor = "#000000",
  } = cfg;

  // 1) load data
  const series = await loadSeries(file);

  // 2) shape data
  const labels = series.map(d => d.date);
  const left   = series.map(d => d[leftKey]);
  const right  = series.map(d => d[rightKey]);

  // 3) chart
  const ctx = document.getElementById(el)?.getContext("2d");
  if (!ctx) return;

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: leftLabel,
          data: left,
          yAxisID: "yL",
          tension: .25,
          pointRadius: 0,
          borderColor: leftColor,
          backgroundColor: rgba(leftColor, 0.12),
          borderWidth: 2,
          fill: false,
        },
        {
          label: rightLabel,
          data: right,
          yAxisID: "yR",
          tension: .25,
          pointRadius: 0,
          borderColor: rightColor,
          backgroundColor: rgba(rightColor, 0.12),
          borderWidth: 2,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", labels: { color: "#111" } },
        tooltip: {
          callbacks: {
            label: c => {
              const label = c.dataset.label || "";
              const v = c.parsed.y;
              if (/price/i.test(label))
                return `${label}: $${v?.toLocaleString(undefined,{ maximumFractionDigits:6 })}`;
              return `${label}: ${v?.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "day" },
          ticks: { color: "#111" },
          grid:  { color: "rgba(0,0,0,.06)" },
        },
        yL: {
          position: "left",
          ticks: { color: "#111", callback: v => `$${Number(v).toFixed(3)}` },
          grid:  { color: "rgba(0,0,0,.06)" },
        },
        yR: {
          position: "right",
          grid: { drawOnChartArea: false, color: "#111" }, // right axis line black
          ticks: { color: "#111", callback: v => Number(v).toLocaleString() },
        }
      }
    }
  });

  // expose for resize from tab switch
  window.__charts = window.__charts || {};
  window.__charts[el] = chart;

  // 4) wire toolbar (by data-for, so placement/position doesn’t matter)
  const toolbar = document.querySelector(`.toolbar[data-for="${el}"]`);
  if (!toolbar) return;

  function setActive(btn) {
    toolbar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));
  }

  function cutoffFor(rangeCode) {
    // labels are ISO dates (YYYY-MM-DD). Let’s compute a Date cutoff.
    if (!labels.length || rangeCode === "ALL") return undefined;
    const last = new Date(labels[labels.length - 1] + "T00:00:00Z");
    const d = new Date(last);
    if (rangeCode === "1W") d.setDate(d.getDate() - 7);
    else if (rangeCode === "1M") d.setMonth(d.getMonth() - 1);
    else if (rangeCode === "3M") d.setMonth(d.getMonth() - 3);
    return d;
  }

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    const range = btn.getAttribute("data-range");
    const min = cutoffFor(range);
    chart.options.scales.x.min = min;
    chart.update();
    setActive(btn);
  });

  // ensure default button (with .on) applies on load
  const defaultBtn = toolbar.querySelector("button.on") || toolbar.querySelector("button[data-range]");
  if (defaultBtn) {
    const evt = new Event("click", { bubbles: true });
    defaultBtn.dispatchEvent(evt);
  }
}

// --- init all three charts ---------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  makeDualAxis({
    el: "chart",
    file: "data/pump.json",
    leftKey: "price",
    rightKey: "fees",
    leftLabel: "Price (USD)",
    rightLabel: "Fees",
    leftColor: "#54d794",
    rightColor: "#000000",
  });

  makeDualAxis({
    el: "chart-revenue",
    file: "data/pump_price_revenue.json",
    leftKey: "price",
    rightKey: "revenue",
    leftLabel: "Price (USD)",
    rightLabel: "Revenue",
    leftColor: "#54d794",
    rightColor: "#000000",
  });

  makeDualAxis({
    el: "chart-buybacks",
    file: "data/pump_price_buybacks_usd.json",
    leftKey: "price",
    rightKey: "buybacks_usd",
    leftLabel: "Price (USD)",
    rightLabel: "Buybacks (USD)",
    leftColor: "#54d794",
    rightColor: "#000000",
  });
});



