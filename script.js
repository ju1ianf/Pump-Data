// ---------- helpers ----------
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function fmtPct(x) {
  if (x === null || !isFinite(x)) return "—";
  const v = (x * 100);
  return (Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2)) + "%";
}

function fmtNum(x) {
  if (x === null || !isFinite(x)) return "—";
  return Number(x).toLocaleString();
}

// Find the latest non-null value in a series for a given key
function latestValue(series, key) {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i][key];
    if (v !== null && v !== undefined && !Number.isNaN(v)) return { i, v, d: series[i].date };
  }
  return { i: -1, v: null, d: null };
}

// Get a value ~N days back (closest on/after target date); falls back to earliest available
function valueNDaysAgo(series, key, days) {
  const last = latestValue(series, key);
  if (last.i < 0) return { v: null, d: null };
  const target = new Date(last.d);
  target.setDate(target.getDate() - days);

  // walk forward until we hit target or pass it
  let candidate = null;
  for (let i = 0; i <= last.i; i++) {
    const d = new Date(series[i].date);
    const v = series[i][key];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (d >= target) { candidate = { v, d: series[i].date }; break; }
    candidate = { v, d: series[i].date }; // keep last good (fallback)
  }
  return candidate || { v: null, d: null };
}

// Return percent change between latest and N days ago
function pctChange(series, key, days) {
  const last = latestValue(series, key);
  const base = valueNDaysAgo(series, key, days);
  if (last.v === null || base.v === null || base.v === 0) return null;
  return (last.v - base.v) / base.v;
}

// ---------- chart builder ----------
async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = "#54d794", rightColor = "#000000"
}) {
  const res = await fetch(file, { cache: "no-store" });
  const { series } = await res.json();

  // Prepare data arrays
  const labels = series.map(d => d.date);
  const left   = series.map(d => d[leftKey]);
  const right  = series.map(d => d[rightKey]);

  const ctx = document.getElementById(el).getContext("2d");
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
          fill: false
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
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (c) => {
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
        yL: { position: "left",  ticks: { callback: v => `$${Number(v).toFixed(3)}` } },
        yR: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => Number(v).toLocaleString() }
        }
      }
    }
  });

  return { chart, series };
}

// ---------- stats renderer ----------
function renderStats(containerId, spec, series) {
  // spec: [{label, key, isMoney}]
  const el = document.getElementById(containerId);
  if (!el) return;

  const rows = spec.map(s => {
    const ch1M = pctChange(series, s.key, 30);
    const ch1W = pctChange(series, s.key, 7);
    const cls1M = (ch1M ?? 0) > 0 ? "pos" : (ch1M ?? 0) < 0 ? "neg" : "";
    const cls1W = (ch1W ?? 0) > 0 ? "pos" : (ch1W ?? 0) < 0 ? "neg" : "";

    return `
      <div class="stat-row">
        <div class="stat-name">${s.label}</div>
        <div class="stat-val ${cls1M}">${fmtPct(ch1M)}</div>
        <div class="stat-val ${cls1W}">${fmtPct(ch1W)}</div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="stat-head">
      <div></div>
      <div>1M</div>
      <div>1W</div>
    </div>
    ${rows}
  `;
}

// ---------- range buttons (per-chart) ----------
function wireRangeButtons() {
  const groups = document.querySelectorAll('.toolbar');
  groups.forEach(g => {
    const forId = g.getAttribute('data-for');
    const buttons = g.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.toggle('on', b === btn));
        const range = btn.getAttribute('data-range'); // ALL | 3M | 1M | 1W
        const meta = window.__charts?.[forId];
        if (!meta) return;

        // Filter labels by range
        const { chart, series } = meta;
        let days = null;
        if (range === '3M') days = 90;
        if (range === '1M') days = 30;
        if (range === '1W') days = 7;

        let startIndex = 0;
        if (days) {
          const lastDate = new Date(series[series.length - 1].date);
          const cutoff = new Date(lastDate);
          cutoff.setDate(cutoff.getDate() - days);
          startIndex = series.findIndex(d => new Date(d.date) >= cutoff);
          if (startIndex < 0) startIndex = 0;
        }

        const slice = series.slice(startIndex);
        chart.data.labels = slice.map(d => d.date);
        chart.data.datasets[0].data = slice.map(d => d[chart.data.datasets[0].label.toLowerCase().includes('price') ? 'price' : '']);
        // For safety, re-map from original keys instead of label check:
        const ds0Key = meta.keys.left;
        const ds1Key = meta.keys.right;
        chart.data.datasets[0].data = slice.map(d => d[ds0Key]);
        chart.data.datasets[1].data = slice.map(d => d[ds1Key]);

        chart.update('none');
      });
    });
  });
}

// ---------- boot ----------
(async function init() {
  window.__charts = {};

  // 1) Price vs Fees
  const pf = await makeDualAxis({
    el: "chart",
    file: "data/pump.json",
    leftKey: "price",   rightKey: "fees",
    leftLabel: "Price (USD)", rightLabel: "Fees",
    leftColor: "#54d794", rightColor: "#000000"
  });
  window.__charts["chart"] = { chart: pf.chart, series: pf.series, keys: { left: "price", right: "fees" } };
  renderStats("stats-fees", [
    { label: "Price Δ",   key: "price" },
    { label: "Fees Δ",    key: "fees" },
  ], pf.series);

  // 2) Price vs Revenue
  const pr = await makeDualAxis({
    el: "chart-revenue",
    file: "data/pump_price_revenue.json",
    leftKey: "price", rightKey: "revenue",
    leftLabel: "Price (USD)", rightLabel: "Revenue",
    leftColor: "#54d794", rightColor: "#000000"
  });
  window.__charts["chart-revenue"] = { chart: pr.chart, series: pr.series, keys: { left: "price", right: "revenue" } };
  renderStats("stats-revenue", [
    { label: "Price Δ",   key: "price" },
    { label: "Revenue Δ", key: "revenue" },
  ], pr.series);

  // 3) Price vs Buybacks
  const pb = await makeDualAxis({
    el: "chart-buybacks",
    file: "data/pump_price_buybacks_usd.json",
    leftKey: "price", rightKey: "buybacks_usd",
    leftLabel: "Price (USD)", rightLabel: "Buybacks (USD)",
    leftColor: "#54d794", rightColor: "#000000"
  });
  window.__charts["chart-buybacks"] = { chart: pb.chart, series: pb.series, keys: { left: "price", right: "buybacks_usd" } };
  renderStats("stats-buybacks", [
    { label: "Price Δ",      key: "price" },
    { label: "Buybacks Δ",   key: "buybacks_usd" },
  ], pb.series);

  wireRangeButtons();
})();




