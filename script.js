/* ---------- helpers ---------- */
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const PRICE_COLOR = "#54d794";
const RIGHT_COLOR = "#000000";

/* find the most recent value at or before a given Date */
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

/* % change utility */
function pctChange(now, then) {
  if (!isFinite(now) || !isFinite(then) || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

function formatPct(x) {
  if (x === null) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(1)}%`;
}

/* render the right-hand stats box */
function renderStatsBox(targetId, series, leftKey, rightKey) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const rows = series.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!rows.length) { el.innerHTML = ""; return; }

  const lastDate = new Date(rows[rows.length - 1].date);
  const d7  = new Date(lastDate); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(lastDate); d30.setDate(d30.getDate() - 30);

  const L_now  = latestOnOrBefore(rows, leftKey,  lastDate);
  const L_7    = latestOnOrBefore(rows, leftKey,  d7);
  const L_30   = latestOnOrBefore(rows, leftKey,  d30);

  const R_now  = latestOnOrBefore(rows, rightKey, lastDate);
  const R_7    = latestOnOrBefore(rows, rightKey, d7);
  const R_30   = latestOnOrBefore(rows, rightKey, d30);

  const L_w  = pctChange(L_now, L_7);
  const L_m  = pctChange(L_now, L_30);
  const R_w  = pctChange(R_now, R_7);
  const R_m  = pctChange(R_now, R_30);

  const map = { price: "Price", fees: "Fees", revenue: "Revenue", buybacks_usd: "Buybacks" };

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-title">${map[leftKey] || leftKey}</div>
      <div class="stat-row"><span>1M</span><strong class="${L_m>=0?"pos":"neg"}">${formatPct(L_m)}</strong></div>
      <div class="stat-row"><span>1W</span><strong class="${L_w>=0?"pos":"neg"}">${formatPct(L_w)}</strong></div>
    </div>
    <div class="stat-card">
      <div class="stat-title">${map[rightKey] || rightKey}</div>
      <div class="stat-row"><span>1M</span><strong class="${R_m>=0?"pos":"neg"}">${formatPct(R_m)}</strong></div>
      <div class="stat-row"><span>1W</span><strong class="${R_w>=0?"pos":"neg"}">${formatPct(R_w)}</strong></div>
    </div>
  `;
}

/* subset by range tokens */
function filterByRange(series, token) {
  if (token === "ALL") return series;
  const now = new Date(series[series.length - 1].date);
  const back = new Date(now);
  if (token === "3M") back.setMonth(back.getMonth() - 3);
  else if (token === "1M") back.setMonth(back.getMonth() - 1);
  else if (token === "1W") back.setDate(back.getDate() - 7);
  return series.filter(r => new Date(r.date) >= back);
}

/* make a dual-axis line chart + hook up toolbar buttons */
async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = PRICE_COLOR, rightColor = RIGHT_COLOR,
  statsId
}) {
  const res = await fetch(file, { cache: "no-store" });
  const { series } = await res.json();

  // one-time stats render (full history)
  renderStatsBox(statsId, series, leftKey, rightKey);

  const labels = series.map(d => d.date);
  const dataL  = series.map(d => d[leftKey]);
  const dataR  = series.map(d => d[rightKey]);

  const ctx = document.getElementById(el).getContext("2d");
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          // LEFT axis (non-price) — stays BLACK
          label: rightLabel,        // <— we’ll draw non-price second below; flip labels to keep legend order if you like
          data: dataR,
          yAxisID: "yL",
          tension: .25,
          pointRadius: 0,
          borderColor: rightColor,
          backgroundColor: rgba(rightColor, 0.12),
          borderWidth: 2,
          fill: false
        },
        {
          // RIGHT axis (price) — stays GREEN
          label: leftLabel,
          data: dataL,
          yAxisID: "yR",
          tension: .25,
          pointRadius: 0,
          borderColor: leftColor,
          backgroundColor: rgba(leftColor, 0.12),
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
              if (/price/i.test(label))
                return `${label}: $${v?.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
              return `${label}: ${v?.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: { type: "time", time: { unit: "day" } },
        // LEFT axis for non-price values (fees/revenue/buybacks)
        yL: {
          position: "left",
          ticks: { callback: v => Number(v).toLocaleString() }
        },
        // RIGHT axis for Price (USD)
        yR: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => `$${Number(v).toFixed(3)}` }
        }
      }
    }
  });

  // attach range buttons
  const toolbar = document.querySelector(`.toolbar[data-for="${el}"]`);
  if (toolbar) {
    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      toolbar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));

      const token = btn.dataset.range;
      const subset = filterByRange(series, token);

      chart.data.labels = subset.map(d => d.date);
      chart.data.datasets[0].data = subset.map(d => d[rightKey]); // non-price on LEFT
      chart.data.datasets[1].data = subset.map(d => d[leftKey]);  // price on RIGHT
      chart.update();
    });
  }

  return { chart, series };
}

/* ---------- build charts ---------- */
window.__charts = {};

(async () => {
  // 1) Price vs Fees
  window.__charts.pf = await makeDualAxis({
    el: "chart",
    file: "data/pump.json",
    leftKey: "price", rightKey: "fees",
    leftLabel: "Price (USD)", rightLabel: "Fees",
    statsId: "stats-chart"
  });

  // 2) Price vs Revenue
  window.__charts.pr = await makeDualAxis({
    el: "chart-revenue",
    file: "data/pump_price_revenue.json",
    leftKey: "price", rightKey: "revenue",
    leftLabel: "Price (USD)", rightLabel: "Revenue",
    statsId: "stats-chart-rev"
  });

  // 3) Price vs Buybacks (USD)
  window.__charts.pb = await makeDualAxis({
    el: "chart-buybacks",
    file: "data/pump_price_buybacks_usd.json",
    leftKey: "price", rightKey: "buybacks_usd",
    leftLabel: "Price (USD)", rightLabel: "Buybacks (USD)",
    statsId: "stats-chart-bb"
  });
})();



