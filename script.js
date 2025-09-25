/* ========= helpers ========= */
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${a})`;
}
const PRICE_COLOR = "#54d794";     // green
const RIGHT_COLOR = "#000000";     // black

function latestOnOrBefore(rows, key, cutoff) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = new Date(rows[i].date);
    if (d <= cutoff) {
      const v = rows[i][key];
      if (typeof v === "number" && !Number.isNaN(v)) return v;
    }
  }
  return NaN;
}
function pctChange(now, then) {
  if (!isFinite(now) || !isFinite(then) || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}
function formatPct(x) {
  if (x === null) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(1)}%`;
}

/* Render the right-hand stats box (1M / 1W change) */
function renderStatsBox(targetId, series, leftKey, rightKey) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const rows = series.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!rows.length) { el.innerHTML = ""; return; }

  const lastDate = new Date(rows[rows.length - 1].date);
  const d7  = new Date(lastDate); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(lastDate); d30.setDate(d30.getDate() - 30);

  const L_now = latestOnOrBefore(rows, leftKey, lastDate);
  const L_w   = latestOnOrBefore(rows, leftKey, d7);
  const L_m   = latestOnOrBefore(rows, leftKey, d30);

  const R_now = latestOnOrBefore(rows, rightKey, lastDate);
  const R_w   = latestOnOrBefore(rows, rightKey, d7);
  const R_m   = latestOnOrBefore(rows, rightKey, d30);

  const map = { price:"Price", fees:"Fees", revenue:"Revenue", buybacks_usd:"Buybacks" };

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-title">${map[leftKey] || leftKey}</div>
      <div class="stat-row"><span>1M</span><strong class="${pctChange(L_now, L_m)>=0?"pos":"neg"}">${formatPct(pctChange(L_now, L_m))}</strong></div>
      <div class="stat-row"><span>1W</span><strong class="${pctChange(L_now, L_w)>=0?"pos":"neg"}">${formatPct(pctChange(L_now, L_w))}</strong></div>
    </div>
    <div class="stat-card">
      <div class="stat-title">${map[rightKey] || rightKey}</div>
      <div class="stat-row"><span>1M</span><strong class="${pctChange(R_now, R_m)>=0?"pos":"neg"}">${formatPct(pctChange(R_now, R_m))}</strong></div>
      <div class="stat-row"><span>1W</span><strong class="${pctChange(R_now, R_w)>=0?"pos":"neg"}">${formatPct(pctChange(R_now, R_w))}</strong></div>
    </div>
  `;
}

/* Range filters */
function filterByRange(series, token) {
  if (token === "ALL") return series;
  const now = new Date(series[series.length - 1].date);
  const back = new Date(now);
  if (token === "3M") back.setMonth(back.getMonth() - 3);
  else if (token === "1M") back.setMonth(back.getMonth() - 1);
  else if (token === "1W") back.setDate(back.getDate() - 7);
  return series.filter(r => new Date(r.date) >= back);
}

/* Single dual-axis chart where Price (green) is on the RIGHT axis */
async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = RIGHT_COLOR, rightColor = PRICE_COLOR,
  statsId
}) {
  try {
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${file} fetch failed`);
    const { series } = await res.json();
    if (!Array.isArray(series)) throw new Error(`${file} bad shape`);

    // Stats
    if (statsId) renderStatsBox(statsId, series, leftKey, rightKey);

    const labels = series.map(d => d.date);
    const dataL  = series.map(d => d[leftKey]);
    const dataR  = series.map(d => d[rightKey]);

    const ctx = document.getElementById(el)?.getContext("2d");
    if (!ctx) return null;

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: leftLabel,       // left axis (black)
            data: dataL,
            yAxisID: "yL",
            tension: .25,
            pointRadius: 0,
            borderColor: leftColor,
            backgroundColor: rgba(leftColor, 0.12),
            borderWidth: 2,
            fill: false
          },
          {
            label: rightLabel,      // right axis (green) — PRICE
            data: dataR,
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
              label: c => {
                const label = c.dataset.label || "";
                const v = c.parsed.y;
                if (/price/i.test(label)) {
                  return `${label}: $${(v ?? 0).toLocaleString(undefined,{ maximumFractionDigits: 6 })}`;
                }
                return `${label}: $${(v ?? 0).toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          x: { type: "time", time: { unit: "day" } },
          yL: { // left axis (Fees/Revenue/Buybacks) — dollars
            position: "left",
            ticks: { callback: v => `$${Number(v).toLocaleString()}` }
          },
          yR: { // right axis (Price) — dollars
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { callback: v => `$${Number(v).toFixed(3)}` }
          }
        }
      }
    });

    // Attach range buttons
    const toolbar = document.querySelector(`.toolbar[data-for="${el}"]`);
    if (toolbar) {
      toolbar.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-range]");
        if (!btn) return;
        toolbar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));
        const subset = filterByRange(series, btn.dataset.range);
        chart.data.labels = subset.map(d => d.date);
        chart.data.datasets[0].data = subset.map(d => d[leftKey]);
        chart.data.datasets[1].data = subset.map(d => d[rightKey]);
        chart.update();
      });
    }

    return { chart, series };
  } catch (err) {
    console.error("Chart init failed:", el, err);
    return null;
  }
}

/* ========= build charts ========= */
window.__charts = {};

(async () => {
  // 1) Price vs Fees
  window.__charts.priceFees = await makeDualAxis({
    el: "chart",
    file: "data/pump.json",
    leftKey: "fees",
    rightKey: "price",
    leftLabel: "Fees",
    rightLabel: "Price (USD)",
    statsId: "stats-chart"
  });

  // 2) Price vs Revenue
  window.__charts.priceRevenue = await makeDualAxis({
    el: "chart-revenue",
    file: "data/pump_price_revenue.json",
    leftKey: "revenue",
    rightKey: "price",
    leftLabel: "Revenue",
    rightLabel: "Price (USD)",
    statsId: "stats-chart-rev"
  });

  // 3) Price vs Buybacks (USD)
  window.__charts.priceBuybacks = await makeDualAxis({
    el: "chart-buybacks",
    file: "data/pump_price_buybacks_usd.json",
    leftKey: "buybacks_usd",
    rightKey: "price",
    leftLabel: "Buybacks (USD)",
    rightLabel: "Price (USD)",
    statsId: "stats-chart-bb"
  });

  // NOTE: The new “Cumulative Buybacks vs Mcap” chart uses a *different*
  // file (data/pump_buybacks_vs_mcap.json) and a custom function.
  // If you haven’t generated that file yet, the rest will still render.
  // When it’s ready, we can plug it back in here.
})();

