// helper to convert hex color -> rgba with alpha
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// simple registry so we can update ranges later
const CHARTS = new Map(); // id -> { chart, full }

function rangeStart(range, lastDate) {
  // lastDate is a Date (end of the series)
  const d = new Date(lastDate);
  switch (range) {
    case "1W": d.setDate(d.getDate() - 7);   return d;
    case "1M": d.setMonth(d.getMonth() - 1); return d;
    case "3M": d.setMonth(d.getMonth() - 3); return d;
    case "ALL":
    default:  return null; // no slicing
  }
}

function sliceSeries(series, range) {
  if (!series?.length) return series;
  const last = new Date(series[series.length - 1].date);
  const start = rangeStart(range, last);
  if (!start) return series;
  return series.filter(row => new Date(row.date) >= start);
}

function buildDataset(arr, key, color, yAxisID, label) {
  return {
    label,
    data: arr.map(d => d[key]),
    yAxisID,
    tension: .25,
    pointRadius: 0,
    borderColor: color,
    backgroundColor: rgba(color, 0.12),
    borderWidth: 2,
    fill: false
  };
}

async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = "#54d794",      // pumpfun green
  rightColor = "#000000"      // black
}) {
  const res = await fetch(file, { cache: "no-store" });
  const { series } = await res.json();

  // keep a copy of the full data for range filtering
  CHARTS.set(el, { chart: null, full: series });

  // initial (ALL) view
  const initial = sliceSeries(series, "ALL");
  const labels  = initial.map(d => d.date);

  const ctx = document.getElementById(el).getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        buildDataset(initial, leftKey,  leftColor,  "yL", leftLabel),
        buildDataset(initial, rightKey, rightColor, "yR", rightLabel),
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
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
        x: { type: "time", time: { unit: "day" } },
        yL: {
          position: "left",
          ticks: { color: "#000", callback: v => `$${Number(v).toFixed(3)}` },
          grid: { color: "rgba(0,0,0,0.08)" }
        },
        yR: {
          position: "right",
          grid: { drawOnChartArea: false, color: "#000" },
          ticks: { color: "#000", callback: v => Number(v).toLocaleString() }
        }
      }
    }
  });

  // store the chart instance
  CHARTS.get(el).chart = chart;
}

// apply a new range to a given chart id
function applyRange(id, range) {
  const entry = CHARTS.get(id);
  if (!entry) return;
  const { chart, full } = entry;
  const view = sliceSeries(full, range);

  chart.data.labels = view.map(d => d.date);
  // dataset[0] is left, dataset[1] is right — keep labels/colors/axes, swap data
  const leftKey  = chart.data.datasets[0].yAxisID === "yL"
    ? chart.data.datasets[0].label.includes("Price") ? "price" : null
    : null;

  // We don’t rely on label text; we recompute from stored full + current datasets’ axis
  // A safer way: infer keys from original “full” object shape using the last non-null.
  const keys = Object.keys(full[0] || {});
  const numericKeys = keys.filter(k => k !== "date");
  // Assume 2 keys: leftKey is whatever dataset[0] used originally (we saved by values order)
  // Easiest: rebuild from current dataset metadata we piggybacked via custom props
  // Instead, store the keys when we make the chart:
}

// Attach one delegated click handler for all toolbars
document.addEventListener("click", (e) => {
  const btn = e.target.closest('.toolbar button');
  if (!btn) return;

  const toolbar = btn.closest('.toolbar');
  const targetId = toolbar?.dataset?.for;
  const range = btn.dataset.range;

  // toggle button state
  toolbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));

  // re-slice and update that chart
  updateChartRange(targetId, range);
});

// We’ll keep the two data keys (left & right) next to each chart so we can rebuild quickly.
const KEYS = new Map(); // id -> { leftKey, rightKey }

function updateChartRange(id, range) {
  const entry = CHARTS.get(id);
  if (!entry) return;

  const { chart, full } = entry;
  const { leftKey, rightKey } = KEYS.get(id);

  const view = sliceSeries(full, range);
  chart.data.labels = view.map(d => d.date);
  chart.data.datasets[0].data = view.map(d => d[leftKey]);
  chart.data.datasets[1].data = view.map(d => d[rightKey]);
  chart.update('none');
}

// ------- Initialize charts (keys registered here) -------
makeDualAxis({
  el: "chart",
  file: "data/pump.json",
  leftKey: "price", rightKey: "fees",
  leftLabel: "Price (USD)", rightLabel: "Fees",
  leftColor: "#54d794",
  rightColor: "#000000"
}).then(() => KEYS.set("chart", { leftKey: "price", rightKey: "fees" }));

makeDualAxis({
  el: "chart-revenue",
  file: "data/pump_price_revenue.json",
  leftKey: "price", rightKey: "revenue",
  leftLabel: "Price (USD)", rightLabel: "Revenue",
  leftColor: "#54d794",
  rightColor: "#000000"
}).then(() => KEYS.set("chart-revenue", { leftKey: "price", rightKey: "revenue" }));

makeDualAxis({
  el: "chart-buybacks",
  file: "data/pump_price_buybacks_usd.json",
  leftKey: "price",
  rightKey: "buybacks_usd",
  leftLabel: "Price (USD)",
  rightLabel: "Buybacks (USD)",
  leftColor: "#54d794",
  rightColor: "#000000"
}).then(() => KEYS.set("chart-buybacks", { leftKey: "price", rightKey: "buybacks_usd" }));




