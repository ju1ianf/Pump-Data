/* ======================= helpers & constants ======================= */

function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const PRICE_COLOR = "#54d794";  // green
const OTHER_COLOR = "#000000";  // black

/* find the most recent numeric value at or before a given Date */
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

/* render the right-hand stats box for dual-axis charts */
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

/* =================== dual-axis (Price on RIGHT) =================== */

async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = OTHER_COLOR, rightColor = PRICE_COLOR,
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
          // LEFT axis (USD): non-price metric, black
          label: leftLabel,
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
          // RIGHT axis (USD): Price, green
          label: rightLabel,
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
              return `${label}: $${Number(v).toLocaleString(undefined,{ maximumFractionDigits: 6 })}`;
            }
          }
        }
      },
      scales: {
        x: { type: "time", time: { unit: "day" } },
        yL: {
          position: "left",
          ticks: { callback: v => `$${Number(v).toLocaleString()}` }
        },
        yR: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { callback: v => `$${Number(v).toLocaleString()}` }
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
      chart.data.datasets[0].data = subset.map(d => d[leftKey]);
      chart.data.datasets[1].data = subset.map(d => d[rightKey]);
      chart.update();
    });
  }

  return { chart, series };
}

/* ========== PUMP: Cumulative Buybacks vs Market Cap (USD + %) ========== */

// % axis tick format
function fmtPctAxis(v) {
  if (!isFinite(v)) return "";
  return `${(v * 100).toFixed(1)}%`;
}

async function makeBuybacksVsMcap({ el, file, statsId }) {
  const res = await fetch(file, { cache: "no-store" });
  const { series } = await res.json();

  // ---- stats box: share retired + changes for buybacks & mcap ----
  (function renderStats() {
    const target = document.getElementById(statsId);
    if (!target || !series?.length) return;

    const rows = series.slice().sort((a,b) => new Date(a.date) - new Date(b.date));
    const last = new Date(rows[rows.length-1].date);
    const d7 = new Date(last);  d7.setDate(d7.getDate()-7);
    const d30 = new Date(last); d30.setDate(d30.getDate()-30);

    const latest = latestOnOrBefore(rows, "pct_bought", last);
    const wk  = latestOnOrBefore(rows, "pct_bought", d7);
    const mo  = latestOnOrBefore(rows, "pct_bought", d30);
    const pct_now = isFinite(latest) ? `${(latest*100).toFixed(2)}%` : "—";
    const pct_w = pctChange(latest, wk);
    const pct_m = pctChange(latest, mo);

    const b_now = latestOnOrBefore(rows, "cum_buybacks_usd", last);
    const b_w   = latestOnOrBefore(rows, "cum_buybacks_usd", d7);
    const b_m   = latestOnOrBefore(rows, "cum_buybacks_usd", d30);

    const m_now = latestOnOrBefore(rows, "mcap_usd", last);
    const m_w   = latestOnOrBefore(rows, "mcap_usd", d7);
    const m_m   = latestOnOrBefore(rows, "mcap_usd", d30);

    target.innerHTML = `
      <div class="stat-card">
        <div class="stat-title">Share retired</div>
        <div class="stat-row"><span>Now</span><strong>${pct_now}</strong></div>
        <div class="stat-row"><span>1M Δ</span><strong class="${pct_m>=0?'pos':'neg'}">${formatPct(pct_m)}</strong></div>
        <div class="stat-row"><span>1W Δ</span><strong class="${pct_w>=0?'pos':'neg'}">${formatPct(pct_w)}</strong></div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Cum. Buybacks (USD)</div>
        <div class="stat-row"><span>Now</span><strong>$${Number(b_now||0).toLocaleString()}</strong></div>
        <div class="stat-row"><span>1M Δ</span><strong class="${pctChange(b_now,b_m)>=0?'pos':'neg'}">${formatPct(pctChange(b_now,b_m))}</strong></div>
        <div class="stat-row"><span>1W Δ</span><strong class="${pctChange(b_now,b_w)>=0?'pos':'neg'}">${formatPct(pctChange(b_now,b_w))}</strong></div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Mkt Cap (USD)</div>
        <div class="stat-row"><span>Now</span><strong>$${Number(m_now||0).toLocaleString()}</strong></div>
        <div class="stat-row"><span>1M Δ</span><strong class="${pctChange(m_now,m_m)>=0?'pos':'neg'}">${formatPct(pctChange(m_now,m_m))}</strong></div>
        <div class="stat-row"><span>1W Δ</span><strong class="${pctChange(m_now,m_w)>=0?'pos':'neg'}">${formatPct(pctChange(m_now,m_w))}</strong></div>
      </div>
    `;
  })();

  const labels = series.map(d => d.date);
  const buyUSD = series.map(d => d.cum_buybacks_usd);
  const mcapUSD= series.map(d => d.mcap_usd);
  const pct    = series.map(d => d.pct_bought);

  const ctx = document.getElementById(el).getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { // USD axis (left): Market Cap (black)
          label: "Market Cap (USD)",
          data: mcapUSD,
          yAxisID: "yUSD",
          tension: .25,
          pointRadius: 0,
          borderColor: "#000000",
          backgroundColor: rgba("#000000", 0.12),
          borderWidth: 2,
          fill: false
        },
        { // USD axis (left): Cum. Buybacks (green)
          label: "Cum. Buybacks (USD)",
          data: buyUSD,
          yAxisID: "yUSD",
          tension: .25,
          pointRadius: 0,
          borderColor: "#54d794",
          backgroundColor: rgba("#54d794", 0.12),
          borderWidth: 2,
          fill: false
        },
        { // % axis (right): share retired
          label: "Share retired (%)",
          data: pct,
          yAxisID: "yPct",
          tension: .25,
          pointRadius: 0,
          borderColor: "#777",
          borderDash: [6,4],
          backgroundColor: "transparent",
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
              if (c.dataset.yAxisID === "yPct") {
                return `${label}: ${(v*100).toFixed(2)}%`;
              }
              return `${label}: $${Number(v).toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: { type: "time", time: { unit: "day" } },
        yUSD: {
          position: "left",
          ticks: { callback: v => `$${Number(v).toLocaleString()}` }
        },
        yPct: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: {
            callback: v => fmtPctAxis(v)
          }
        }
      }
    }
  });

  // range buttons
  const toolbar = document.querySelector(`.toolbar[data-for="${el}"]`);
  if (toolbar) {
    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-range]");
      if (!btn) return;
      toolbar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));

      const token = btn.dataset.range;
      const subset = filterByRange(series, token);
      chart.data.labels = subset.map(d => d.date);
      chart.data.datasets[0].data = subset.map(d => d.mcap_usd);
      chart.data.datasets[1].data = subset.map(d => d.cum_buybacks_usd);
      chart.data.datasets[2].data = subset.map(d => d.pct_bought);
      chart.update();
    });
  }

  return { chart, series };
}

/* ======================= build all charts ======================= */

window.__charts = {};

(async () => {
  // 1) Price vs Fees  (Price on RIGHT)
  window.__charts.pf = await makeDualAxis({
    el: "chart",
    file: "data/pump.json",
    leftKey: "fees",
    rightKey: "price",
    leftLabel: "Fees (USD)",
    rightLabel: "Price (USD)",
    leftColor: OTHER_COLOR,
    rightColor: PRICE_COLOR,
    statsId: "stats-chart"
  });

  // 2) Price vs Revenue (Price on RIGHT)
  window.__charts.pr = await makeDualAxis({
    el: "chart-revenue",
    file: "data/pump_price_revenue.json",
    leftKey: "revenue",
    rightKey: "price",
    leftLabel: "Revenue (USD)",
    rightLabel: "Price (USD)",
    leftColor: OTHER_COLOR,
    rightColor: PRICE_COLOR,
    statsId: "stats-chart-rev"
  });

  // 3) Price vs Buybacks (USD) (Price on RIGHT)
  window.__charts.pb = await makeDualAxis({
    el: "chart-buybacks",
    file: "data/pump_price_buybacks_usd.json",
    leftKey: "buybacks_usd",
    rightKey: "price",
    leftLabel: "Buybacks (USD)",
    rightLabel: "Price (USD)",
    leftColor: OTHER_COLOR,
    rightColor: PRICE_COLOR,
    statsId: "stats-chart-bb"
  });

  // 4) PUMP Cumulative Buybacks vs Market Cap
  window.__charts.bbmcap = await makeBuybacksVsMcap({
    el: "chart-bbmcap",
    file: "data/pump_mcap_buybacks.json",
    statsId: "stats-chart-bbmcap"
  });



