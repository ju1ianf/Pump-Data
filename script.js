/* ========= helpers ========= */
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${a})`;
}
const PRICE_COLOR = "#54d794";     // green
const RIGHT_COLOR = "#000000";     // black

// --- ET (Eastern Time) formatting helpers ---
const ET_TZ = "America/New_York";
const fmtET = (date, opts = {}) =>
  new Intl.DateTimeFormat(undefined, { timeZone: ET_TZ, ...opts }).format(date);

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

/* Range filters for the PUMP charts */
function filterByRange(series, token) {
  if (token === "ALL") return series;
  const now = new Date(series[series.length - 1].date);
  const back = new Date(now);
  if (token === "3M") back.setMonth(back.getMonth() - 3);
  else if (token === "1M") back.setMonth(back.getMonth() - 1);
  else if (token === "1W") back.setDate(back.getDate() - 7);
  return series.filter(r => new Date(r.date) >= back);
}

/* Utility: map rows to time points with real Date objects */
const toPts = (rows, key) => rows.map(d => ({ x: new Date(d.date), y: d[key] }));

/* Ensure a canvas has fixed height so it can't stretch the page (PUMP only) */
function pinCanvasHeight(canvas, h = 420) {
  if (!canvas) return;
  canvas.height = h;                // drawing buffer
  canvas.style.height = `${h}px`;   // CSS box
  canvas.style.maxHeight = `${h}px`;
  canvas.style.width = "100%";
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

    const cnv = document.getElementById(el);
    if (!cnv) return null;
    pinCanvasHeight(cnv, 420); // keep PUMP charts structured

    const chart = new Chart(cnv.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          {
            label: leftLabel,
            data: toPts(series, leftKey),
            parsing: true,
            yAxisID: "yL",
            tension: .25,
            pointRadius: 0,
            pointHitRadius: 10,
            pointHoverRadius: 4,
            borderColor: leftColor,
            backgroundColor: rgba(leftColor, 0.12),
            borderWidth: 2,
            fill: false,
            spanGaps: true
          },
          {
            label: rightLabel,
            data: toPts(series, rightKey),
            parsing: true,
            yAxisID: "yR",
            tension: .25,
            pointRadius: 0,
            pointHitRadius: 10,
            pointHoverRadius: 4,
            borderColor: rightColor,
            backgroundColor: rgba(rightColor, 0.12),
            borderWidth: 2,
            fill: false,
            spanGaps: true
          }
        ]
      },
      options: {
        maintainAspectRatio: false, // respect pinned height
        interaction: { mode: "index", axis: "x", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            mode: "index",
            intersect: false,
            filter: (item) => Number.isFinite(item.parsed?.y),
            itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
            callbacks: {
              title: (items) => {
                const ts = items[0].parsed.x ?? items[0].label;
                return fmtET(new Date(ts), { year:"numeric", month:"short", day:"numeric" });
              },
              label: (c) => {
                const label = c.dataset.label || "";
                const v = c.parsed.y;
                if (/price/i.test(label) || c.dataset.yAxisID === "yR") {
                  return `${label}: $${(v ?? 0).toLocaleString(undefined,{ maximumFractionDigits: 6 })}`;
                }
                return `${label}: $${(v ?? 0).toLocaleString()}`;
              }
            }
          },
          subtitle: {
            display: true,
            text: "Times shown in Eastern Time (ET)",
            align: "end",
            padding: { top: 6 }
          }
        },
        parsing: true,
        scales: {
          x: {
            type: "time",
            time: { unit: "day" },
            ticks: {
              callback: (value, i, ticks) => {
                const ts = ticks?.[i]?.value ?? value;
                return fmtET(new Date(ts), { month:"short", day:"numeric" });
              }
            }
          },
          yL: { position: "left", ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
          yR: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => `$${Number(v).toFixed(3)}` } }
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
        chart.data.datasets[0].data = toPts(subset, leftKey);
        chart.data.datasets[1].data = toPts(subset, rightKey);
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

    // stats box
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

    const cnv = document.getElementById(el);
    if (!cnv) return null;
    pinCanvasHeight(cnv, 420); // keep PUMP chart structured

    const pctPts = (rows) =>
      rows.map(d => ({
        x: new Date(d.date),
        y: (typeof d.pct_mcap_bought === "number")
          ? d.pct_mcap_bought
          : (d.cum_buybacks_usd != null && d.mcap_usd != null ? d.cum_buybacks_usd / d.mcap_usd : null)
      }));

    const chart = new Chart(cnv.getContext("2d"), {
      type: "line",
      data: {
        datasets: [
          { label: "Market Cap (USD)",  data: toPts(series,"mcap_usd"), yAxisID: "yUSD", tension:.25, pointRadius:0, pointHitRadius:10, pointHoverRadius:4, borderColor:"#000000", backgroundColor:rgba("#000000",0.12), borderWidth:2, fill:false, spanGaps:true },
          { label: "Cum. Buybacks (USD)", data: toPts(series,"cum_buybacks_usd"), yAxisID: "yUSD", tension:.25, pointRadius:0, pointHitRadius:10, pointHoverRadius:4, borderColor:"#54d794", backgroundColor:rgba("#54d794",0.12), borderWidth:2, fill:false, spanGaps:true },
          { label: "Share bought (% MC)", data: pctPts(series), yAxisID: "yPct", tension:.25, pointRadius:0, pointHitRadius:10, pointHoverRadius:4, borderColor:"#777", borderDash:[6,4], backgroundColor:"transparent", borderWidth:2, fill:false, spanGaps:true }
        ]
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", axis: "x", intersect: false },
        plugins: {
          legend: { position: "top" },
          tooltip: {
            mode: "index",
            intersect: false,
            filter: (item) => Number.isFinite(item.parsed?.y),
            itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
            callbacks: {
              title: (items) => {
                const ts = items[0].parsed.x ?? items[0].label;
                return fmtET(new Date(ts), { year:"numeric", month:"short", day:"numeric" });
              },
              label: c => (c.dataset.yAxisID === "yPct")
                ? `${c.dataset.label}: ${(c.parsed.y*100).toFixed(2)}%`
                : `${c.dataset.label}: $${Number(c.parsed.y).toLocaleString()}`
            }
          },
          subtitle: {
            display: true,
            text: "Times shown in Eastern Time (ET)",
            align: "end",
            padding: { top: 6 }
          }
        },
        parsing: true,
        scales: {
          x: {
            type: "time",
            time: { unit: "day" },
            ticks: {
              callback: (value, i, ticks) => {
                const ts = ticks?.[i]?.value ?? value;
                return fmtET(new Date(ts), { month:"short", day:"numeric" });
              }
            }
          },
          yUSD: { position: "left",  ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
          yPct: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => `${(v*100).toFixed(1)}%` } }
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
        chart.data.datasets[0].data = toPts(subset, "mcap_usd");
        chart.data.datasets[1].data = toPts(subset, "cum_buybacks_usd");
        chart.data.datasets[2].data = pctPts(subset);
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

/* ============ Performance Tab (table + relative chart) ============ */
(() => {
  const MS_HOUR = 60 * 60 * 1000;
  const MS_DAY  = 24 * MS_HOUR;

  const state = {
    range: "YTD",          // default
    assetsIndex: null,
    cache: new Map(),      // symbol -> [{t: Date, p: number}]
    initialized: false,
  };

  function startOfDayUTC(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  function floorHourUTC(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  }

  function buildBoundaries(range, nowUTC = new Date()) {
    if (range === "24H") {
      const end = floorHourUTC(nowUTC);
      const start = new Date(end.getTime() - 24 * MS_HOUR);
      const out = [];
      for (let t = start.getTime(); t <= end.getTime(); t += MS_HOUR) out.push(new Date(t));
      return out;
    }
    const now = startOfDayUTC(nowUTC);
    let start;
    switch (range) {
      case "1W": start = new Date(now.getTime() - 7 * MS_DAY); break;
      case "1M": start = new Date(now.getTime() - 30 * MS_DAY); break;
      case "3M": start = new Date(now.getTime() - 90 * MS_DAY); break;
      case "YTD": start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); break;
      default:   start = new Date(now.getTime() - 30 * MS_DAY);
    }
    const out = [];
    for (let t = start.getTime(); t <= now.getTime(); t += MS_DAY) out.push(new Date(t));
    return out;
  }

  function latestOnOrBeforeTs(series, ts) {
    if (!series?.length) return null;
    let lo = 0, hi = series.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const tm  = series[mid].t.getTime();
      if (tm <= ts) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans === -1 ? null : series[ans].p;
  }

  function normalizeSeries(payload) {
    const arr = Array.isArray(payload) ? payload : (payload?.data ?? []);
    const out = [];
    for (const row of arr) {
      let iso = null, p = null;
      if (row.t != null) {
        iso = typeof row.t === "string" ? row.t : new Date(row.t * 1000).toISOString();
        p   = row.p ?? row.c ?? row.close ?? row.price;
      } else if (row.time != null) {
        iso = typeof row.time === "string" ? row.time : new Date(row.time * 1000).toISOString();
        p   = row.close ?? row.c ?? row.p ?? row.price;
      } else if (row.timestamp != null) {
        iso = typeof row.timestamp === "string" ? row.timestamp : new Date(row.timestamp * 1000).toISOString();
        p   = row.close ?? row.c ?? row.p ?? row.price;
      }
      if (iso && p != null && !Number.isNaN(+p)) out.push({ t: new Date(iso), p: +p });
    }
    out.sort((a,b) => a.t - b.t);
    const dedup = [];
    for (const d of out) {
      if (!dedup.length || dedup[dedup.length-1].t.getTime() !== d.t.getTime()) dedup.push(d);
      else dedup[dedup.length-1] = d;
    }
    return dedup;
  }

  function computePctChange(series, range, nowUTC = new Date()) {
    if (!series?.length) return null;
    const end = series.at(-1)?.p;
    if (end == null) return null;

    let baselineTs;
    if (range === "24H") {
      baselineTs = new Date(floorHourUTC(nowUTC).getTime() - 24 * MS_HOUR).getTime();
    } else if (range === "YTD") {
      const y = nowUTC.getUTCFullYear();
      baselineTs = Date.UTC(y, 0, 1);
    } else {
      const d0 = startOfDayUTC(nowUTC);
      const back = { "1W":7, "1M":30, "3M":90 }[range] ?? 30;
      baselineTs = new Date(d0.getTime() - back * MS_DAY).getTime();
    }

    let lo = 0, hi = series.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].t.getTime() >= baselineTs) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
    }
    const start = (ans !== -1) ? series[ans].p : series[0].p;
    if (start == null || start <= 0) return null;
    return ((end - start) / start) * 100;
  }

  function formatNumber(x) {
    if (x >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return x.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function colorFor(sym) { let h=0; for (let i=0;i<sym.length;i++) h=(h*31+sym.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 45%)`; }

  const rel = {
    selected: new Set(["HYPE","SOL","ETH","BTC","PUMP"]),
    chart: null,
  };

  function buildPicker() {
    const box = document.getElementById("relperf-picker");
    if (!box || !state.assetsIndex) return;
    box.innerHTML = "";
    state.assetsIndex.assets.forEach(a => {
      const btn = document.createElement("button");
      btn.className = "asset-btn" + (rel.selected.has(a.symbol) ? " on" : "");
      btn.textContent = a.name || a.symbol;
      btn.dataset.symbol = a.symbol;
      btn.addEventListener("click", () => {
        const s = btn.dataset.symbol;
        if (rel.selected.has(s)) { rel.selected.delete(s); btn.classList.remove("on"); }
        else { rel.selected.add(s); btn.classList.add("on"); }
        updateRelPerfChart().catch(console.error);
      });
      box.appendChild(btn);
    });
  }

  async function ensureSeries(symbol, path) {
    let s = state.cache.get(symbol);
    if (!s) {
      const res = await fetch(path, { cache: "no-store" });
      const raw = await res.json();
      s = normalizeSeries(raw);
      state.cache.set(symbol, s);
    }
    return s;
  }

  function buildRelativePoints(series, boundaries) {
    if (!series?.length || !boundaries.length) return [];
    const baselinePx = latestOnOrBeforeTs(series, boundaries[0].getTime()) ?? series[0].p;
    if (!(baselinePx > 0)) return [];
    const pts = [];
    for (const t of boundaries) {
      const px = latestOnOrBeforeTs(series, t.getTime());
      if (px == null) continue;
      const ret = ((px / baselinePx) - 1) * 100;
      pts.push({ x: t, y: ret });
    }
    return pts;
  }

  async function updateRelPerfChart() {
    const canvas = document.getElementById("relperf-chart");
    if (!canvas || !state.assetsIndex) return;

    const now = new Date();
    const boundaries = buildBoundaries(state.range, now);

    const datasets = [];
    for (const a of state.assetsIndex.assets) {
      if (!rel.selected.has(a.symbol)) continue;
      const series = await ensureSeries(a.symbol, a.path);
      const points = buildRelativePoints(series, boundaries);
      if (!points.length) continue;

      datasets.push({
        label: a.name || a.symbol,
        data: points,
        borderColor: colorFor(a.symbol),
        backgroundColor: "transparent",
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2,
        parsing: true,
        spanGaps: true
      });
    }

    const ctx = canvas.getContext("2d");
    const xUnit = (state.range === "24H") ? "hour" : "day";
    const tooltipTitle = (ts) =>
      new Date(ts).toLocaleString(undefined, {
        timeZone: ET_TZ,
        month: "short", day: "numeric",
        hour: xUnit === "hour" ? "numeric" : undefined,
        minute: xUnit === "hour" ? "2-digit" : undefined
      });

    if (!rel.chart) {
      rel.chart = new Chart(ctx, {
        type: "line",
        data: { datasets },
        options: {
          maintainAspectRatio: false,   // <<< restored so canvas matches CSS height (sharp, correct size)
          interaction: { mode: "index", axis: "x", intersect: false },
          plugins: {
            legend: { position: "top" },
            tooltip: {
              callbacks: {
                title: (items) => items?.length ? tooltipTitle(items[0].parsed.x) : "",
                label: (c) => `${c.dataset.label}: ${(c.parsed.y >= 0 ? "+" : "")}${c.parsed.y.toFixed(2)}%`,
              }
            }
          },
          scales: {
            x: {
              type: "time",
              time: { unit: xUnit },
              ticks: {
                callback: (v) => {
                  const d = new Date(v);
                  return d.toLocaleString(undefined, {
                    timeZone: ET_TZ,
                    month: (xUnit === "day") ? "short" : undefined,
                    day:   (xUnit === "day") ? "numeric" : undefined,
                    hour:  (xUnit === "hour") ? "numeric" : undefined
                  });
                }
              }
            },
            y: {
              ticks: { callback: v => `${v.toFixed(0)}%` },
              grid: { color: ctx => (ctx.tick.value === 0 ? "#888" : "rgba(0,0,0,.08)") }
            }
          }
        }
      });
    } else {
      rel.chart.data.datasets = datasets;
      rel.chart.options.scales.x.time.unit = xUnit;
      rel.chart.update();
    }
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
      rows.push({
        symbol: a.symbol,
        name: a.name ?? a.symbol,
        price: latest.p,
        changePct: pct
      });
    }

    rows.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));

    tbody.innerHTML = "";
    for (const r of rows) {
      const up = (r.changePct ?? 0) >= 0;
      const pctTxt = (r.changePct == null || Number.isNaN(r.changePct))
        ? "—"
        : (r.changePct >= 0 ? "+" : "") + r.changePct.toFixed(2) + "%";

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

  async function init() {
    const idxRes = await fetch("data/assets.json", { cache: "no-store" });
    state.assetsIndex = await idxRes.json();

    document.addEventListener("click", (e) => {
      const btn = e.target.closest('#pane-performance .rng[data-range]');
      if (!btn) return;
      (btn.closest(".range-switch") || document)
        .querySelectorAll(".rng").forEach(b => b.classList.toggle("active", b === btn));
      state.range = btn.dataset.range;
      renderTable();
      updateRelPerfChart();
    });

    buildPicker();

    await renderTable();
    await updateRelPerfChart();
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
    if ((location.hash || "").toLowerCase() === "#performance" ||
        document.getElementById("pane-performance")?.classList.contains("active")) {
      if (!state.initialized) {
        state.initialized = true;
        init().catch(e => console.error("Performance init error:", e));
      }
    }
  });
})();
