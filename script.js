async function makeDualAxis({ el, file, leftKey, rightKey, leftLabel, rightLabel }) {
  const res = await fetch(file, { cache: "no-store" });
  const { series } = await res.json();

  const labels = series.map(d => d.date);
  const left   = series.map(d => d[leftKey]);
  const right  = series.map(d => d[rightKey]);

  const ctx = document.getElementById(el).getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: leftLabel,  data: left,  yAxisID: "yL", tension:.25, pointRadius:0 },
        { label: rightLabel, data: right, yAxisID: "yR", tension:.25, pointRadius:0 }
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
              if (/price/i.test(label)) return `${label}: $${v?.toLocaleString(undefined,{ maximumFractionDigits:6 })}`;
              return `${label}: ${v?.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: { type: "time", time: { unit: "day" } },
        yL: { position: "left",  ticks: { callback: v => `$${Number(v).toFixed(3)}` } },
        yR: { position: "right", grid: { drawOnChartArea: false }, ticks: { callback: v => Number(v).toLocaleString() } }
      }
    }
  });
}

// Existing chart: Price vs Fees (reads data/pump.json or your current file)
makeDualAxis({
  el: "chart",
  file: "data/pump.json",
  leftKey: "price", rightKey: "fees",
  leftLabel: "Price (USD)", rightLabel: "Fees"
});

// New chart: Price vs Revenue (reads data/pump_price_revenue.json)
makeDualAxis({
  el: "chart-revenue",
  file: "data/pump_price_revenue.json",
  leftKey: "price", rightKey: "revenue",
  leftLabel: "Price (USD)", rightLabel: "Revenue"
});

