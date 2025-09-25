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
          yL: {
            position: "left",
            ticks: { callback: v => `$${Number(v).toLocaleString()}` }
          },
          yR: {
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

    const pctAt = (rows, when) => {
      const serverPct = latestOnOrBefore(rows, "pct_mcap_bought", when);
      if (isFinite(serverPct)) return serverPct;
      const bb = latestOnOrBefore(rows, "cum_buybacks_usd", when);
      const mc = latestOnOrBefore(rows, "mcap_usd", when);
      if (!isFinite(bb) || !isFinite(mc) || mc === 0) return NaN;
      return bb / mc;
    };

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
          { label: "Market Cap (USD)", data: mcapUSD, yAxisID: "yUSD", tension: .25, pointRadius: 0, borderColor: "#000000", backgroundColor: rgba("#000000", 0.12), borderWidth: 2, fill: false },
          { label: "Cum. Buybacks (USD)", data: buyUSD, yAxisID: "yUSD", tension: .25, pointRadius: 0, borderColor: "#54d794", backgroundColor: rgba("#54d794", 0.12), borderWidth: 2, fill: false },
          { label: "Share bought (% MC)", data: pct, yAxisID: "yPct", tension: .25, pointRadius: 0, borderColor: "#777", borderDash: [6,4], backgroundColor: "transparent", borderWidth: 2, fill: false }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "top" },
          tooltip: { callbacks: { label: c => (c.dataset.yAxisID === "yPct") ? `${c.dataset.label}: ${(c.parsed.y*100).toFixed(2)}%` : `${c.dataset.label}: $${Number(c.parsed.y).toLocaleString()}` } } },
        scales: {
          x: { type: "time", time: { unit: "day" } },
          yUSD: { position: "left", ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
          yPct: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => `${(v*100).toFixed(1)}%` } }
        }
      }
    });

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
  window.__charts.priceFees = await makeDualAxis({
    el: "chart", file: "data/pump.json",
    leftKey: "fees", rightKey: "price",
    leftLabel: "Fees", rightLabel: "Price (USD)",
    statsId: "stats-chart"
  });

  window.__charts.priceRevenue = await makeDualAxis({
    el: "chart-revenue", file: "data/pump_price_revenue.json",
    leftKey: "revenue", rightKey: "price",
    leftLabel: "Revenue", rightLabel: "Price (USD)",
    statsId: "stats-chart-rev"
  });

  window.__charts.priceBuybacks = await makeDualAxis({
    el: "chart-buybacks", file: "data/pump_price_buybacks_usd.json",
    leftKey: "buybacks_usd", rightKey: "price",
    leftLabel: "Buybacks (USD)", rightLabel: "Price (USD)",
    statsId: "stats-chart-bb"
  });

  window.__charts.bbmcap = await makeBuybacksVsMcap({
    el: "chart-bbmcap",
    file: "data/pump_buybacks_vs_mcap.json",
    statsId: "stats-chart-bbmcap"
  });
})();

/* ============ Performance Tab (fixed wiring + YTD) ============ */

(() => {
  const MS_DAY = 24 * 60 * 60 * 1000;

  const state = {
    range: "YTD",
    assetsIndex: null,
    cache: new Map(),
    initialized: false,
  };

  function startOfDayUTC(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function makeBaselineStartTs(range, nowUTC = new Date()) {
    const now = nowUTC;
    switch (range) {
      case "24H": return startOfDayUTC(new Date(now.getTime() - 1 * MS_DAY)).getTime();
      case "1W":  return startOfDayUTC(new Date(now.getTime() - 7 * MS_DAY)).getTime();
      case "1M":  return startOfDayUTC(new Date(now.getTime() - 30 * MS_DAY)).getTime();
      case "3M":  return startOfDayUTC(new Date(now.getTime() - 90 * MS_DAY)).getTime();
      case "YTD": return Date.UTC(now.getUTCFullYear(), 0, 1);
      default:    return startOfDayUTC(new Date(now.getTime() - 30 * MS_DAY)).getTime();
    }
  }

  function baselinePriceOnOrAfter(series, baselineTs) {
    if (!series?.length) return null;
    let lo = 0, hi = series.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = series[mid].t.getTime();
      if (t >= baselineTs) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    if (ans !== -1) return series[ans].p;
    return series[0].p; // earliest if baseline precedes series
  }

  function computePctChange(series, range, now = new Date()) {
    if (!series?.length) return null;
    const end = series.at(-1)?.p;
    if (end == null) return null;
    const baselineTs = makeBaselineStartTs(range, now);
    const start = baselinePriceOnOrAfter(series, baselineTs);
    if (start == null || start <= 0) return null;
    return ((end - start) / start) * 100;
  }

  function normalizeSeries(payload) {
    const arr = Array.isArray(payload) ? payload : (payload?.data ?? []);
    const out = [];
    for (const row of arr) {
      let tIso = null, p = null;
      if (row.t != null) {
        tIso = typeof row.t === "string" ? row.t : new Date(row.t * 1000).toISOString();
        p = row.p ?? row.c ?? row.close ?? row.price;
      } else if (row.time != null) {
        tIso = typeof row.time === "string" ? row.time : new Date(row.time * 1000).toISOString();
        p = row.close ?? row.c ?? row.p ?? row.price;
      } else if (row.timestamp != null) {
        tIso = typeof row.timestamp === "string" ? row.timestamp : new Date(row.timestamp * 1000).toISOString();
        p = row.close ?? row.c ?? row.p ?? row.price;
      }
      if (tIso != null && p != null && !Number.isNaN(+p)) out.push({ t: new Date(tIso), p: +p });
    }
    out.sort((a, b) => a.t - b.t);
    const dedup = [];
    for (const d of out) {
      if (!dedup.length || dedup[dedup.length - 1].t.getTime() !== d.t.getTime()) dedup.push(d);
      else dedup[dedup.length - 1] = d;
    }
    return dedup;
  }

  function formatNumber(x) {
    if (x >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return x.toLocaleString(undefined, { maximumFractionDigits: 6 });
    }

  async function init() {
    const idxRes = await fetch("data/assets.json", { cache: "no-store" });
    state.assetsIndex = await idxRes.json();

    // Delegated click handler with preventDefault (so anchor pills work)
    document.addEventListener("click", (e) => {
      const btn = e.target.closest('#pane-performance [data-range], .perf-controls [data-range]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const group = btn.closest('#pane-performance') || document;
      group.querySelectorAll('[data-range]').forEach(b => b.classList.toggle("active", b === btn));
      state.range = btn.dataset.range;
      renderTable();
    });

    const ytdBtn = document.querySelector('#pane-performance [data-range="YTD"]') ||
                   document.querySelector('.perf-controls [data-range="YTD"]');
    if (ytdBtn) ytdBtn.classList.add("active");

    await renderTable();
  }

  async function renderTable() {
    const tbody = document.querySelector("#perf-table tbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;

    const rows = [];
    const now = new Date();

    for (const a of state.assetsIndex.assets) {
      let series = state.cache.get(a.symbol);
      if (!series) {
        try {
          const res = await fetch(a.path, { cache: "no-store" });
          const raw = await res.json();
          series = normalizeSeries(raw);
          state.cache.set(a.symbol, series);
        } catch (e) {
          console.error("Performance load failed:", a.symbol, e);
          continue;
        }
      }
      if (!series.length) continue;

      const latest = series.at(-1);
      const pct = computePctChange(series, state.range, now);
      rows.push({ symbol: a.symbol, name: a.name ?? a.symbol, price: latest.p, changePct: pct });
    }

    rows.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));

    tbody.innerHTML = "";
    for (const r of rows) {
      const up = (r.changePct ?? 0) >= 0;
      const pctTxt = (r.changePct == null || Number.isNaN(r.changePct)) ? "—" : (r.changePct >= 0 ? "+" : "") + r.changePct.toFixed(2) + "%";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align:left;"><strong>${r.name}</strong></td>
        <td>$${formatNumber(r.price)}</td>
        <td class="${up ? "badge-up" : "badge-down"}">${pctTxt}</td>
      `;
      tr.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("open-asset", { detail: { symbol: r.symbol, display: r.name }}));
      });
      tbody.appendChild(tr);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const perfTab = document.getElementById("tab-performance");
    if (perfTab) {
      perfTab.addEventListener("click", async () => {
        if (!state.initialized) {
          state.initialized = true;
          try { await init(); } catch (e) { console.error("Performance init error:", e); }
        }
      });
    }
    if ((location.hash || "").toLowerCase() === "#performance" || document.getElementById("pane-performance")?.classList.contains("active")) {
      if (!state.initialized) {
        state.initialized = true;
        init().catch(e => console.error("Performance init error:", e));
      }
    }
  });
})();


