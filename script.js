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

  // Pretty names for common keys (added buybacks_usd → “Buybacks (USD)”)
  const map = { price:"Price", fees:"Fees", revenue:"Revenue", buybacks:"Buybacks", buybacks_usd:"Buybacks (USD)" };

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

/* ========== Dual-axis (left dollars, right Price) ========== */
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

/* ========== Cumulative Buybacks vs Circulating Market Cap ========== */
function fmtPctAxis(v) {
  if (!isFinite(v)) return "";
  return `${(v * 100).toFixed(1)}%`;
}

async function makeBuybacksVsMcap({ el, file, statsId }) {
  try {
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${file} fetch failed`);
    const { series } = await res.json();
    if (!Array.isArray(series)) throw new Error(`${file} bad shape`);

    // Helper: get % of market cap bought at a given date
    const pctAt = (rows, when) => {
      // prefer server-provided pct_mcap_bought at/ before 'when'
      const serverPct = latestOnOrBefore(rows, "pct_mcap_bought", when);
      if (isFinite(serverPct)) return serverPct;
      // fallback compute: cum_buybacks_usd / mcap_usd
      const bb = latestOnOrBefore(rows, "cum_buybacks_usd", when);
      const mc = latestOnOrBefore(rows, "mcap_usd", when);
      if (!isFinite(bb) || !isFinite(mc) || mc === 0) return NaN;
      return bb / mc;
    };

    // ---- Stats box ----
    (function renderStats() {
      const target = document.getElementById(statsId);
      if (!target || !series.length) return;

      const rows = series.slice().sort((a,b) => new Date(a.date) - new Date(b.date));
      const last = new Date(rows[rows.length-1].date);
      const d7   = new Date(last);  d7.setDate(d7.getDate()-7);
      const d30  = new Date(last);  d30.setDate(d30.getDate()-30);

      const pct_now = pctAt(rows, last);
      const pct_w   = pctAt(rows, d7);
      const pct_m   = pctAt(rows, d30);

      const b_now = latestOnOrBefore(rows,"cum_buybacks_usd", last);
      const b_w   = latestOnOrBefore(rows,"cum_buybacks_usd", d7);
      const b_m   = latestOnOrBefore(rows,"cum_buybacks_usd", d30);

      const m_now = latestOnOrBefore(rows,"mcap_usd", last);
      const m_w   = latestOnOrBefore(rows,"mcap_usd", d7);
      const m_m   = latestOnOrBefore(rows,"mcap_usd", d30);

      target.innerHTML = `
        <div class="stat-card">
          <div class="stat-title">Share bought (% of mkt cap)</div>
          <div class="stat-row"><span>Now</span><strong>${isFinite(pct_now)?(pct_now*100).toFixed(2)+'%':'—'}</strong></div>
          <div class="stat-row"><span>1M Δ</span><strong class="${pctChange(pct_now,pct_m)>=0?'pos':'neg'}">${formatPct(pctChange(pct_now,pct_m))}</strong></div>
          <div class="stat-row"><span>1W Δ</span><strong class="${pctChange(pct_now,pct_w)>=0?'pos':'neg'}">${formatPct(pctChange(pct_now,pct_w))}</strong></div>
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
    const pct    = series.map(d =>
      (typeof d.pct_mcap_bought === "number")
        ? d.pct_mcap_bought
        : (d.cum_buybacks_usd != null && d.mcap_usd != null ? d.cum_buybacks_usd / d.mcap_usd : null)
    );

    const ctx = document.getElementById(el)?.getContext("2d");
    if (!ctx) return null;

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
          { // % axis (right): percent of market cap bought
            label: "Share bought (% MC)",
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
            ticks: { callback: fmtPctAxis }
          }
        }
      }
    });

    // Range buttons
    const toolbar = document.querySelector(`.toolbar[data-for="${el}"]`);
    if (toolbar) {
      toolbar.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-range]");
        if (!btn) return;
        toolbar.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));

        const subset = filterByRange(series, btn.dataset.range);
        chart.data.labels = subset.map(d => d.date);
        chart.data.datasets[0].data = subset.map(d => d.mcap_usd);
        chart.data.datasets[1].data = subset.map(d => d.cum_buybacks_usd);
        chart.data.datasets[2].data = subset.map(d =>
          (typeof d.pct_mcap_bought === "number")
            ? d.pct_mcap_bought
            : (d.cum_buybacks_usd != null && d.mcap_usd != null ? d.cum_buybacks_usd / d.mcap_usd : null)
        );
        chart.update();
      });
    }

    return { chart, series };
  } catch (err) {
    console.error("BB vs Mcap init failed:", el, err);
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

  // 4) Cumulative Buybacks vs Circulating Market Cap
  window.__charts.bbmcap = await makeBuybacksVsMcap({
    el: "chart-bbmcap",
    file: "data/pump_buybacks_vs_mcap.json", // expects { date, cum_buybacks_usd, mcap_usd, [pct_mcap_bought] }
    statsId: "stats-chart-bbmcap"
  });
})();
