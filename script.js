// helper to convert hex color -> rgba with alpha
function rgba(hex, a = 0.15) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

async function makeDualAxis({
  el, file, leftKey, rightKey, leftLabel, rightLabel,
  leftColor = "#54d794",   // default pumpfun green
  rightColor = "#000000"   // default black
}) {
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

      // legend + tooltip
      plugins: {
        legend: {
          position: "top",
          labels: { color: "#000000" }   // legend labels -> black
        },
        tooltip: {
          callbacks: {
            label: c => {
              const label = c.dataset.label || "";
              const v = c.parsed.y;
              if (/price/i.test(label)) {
                return `${label}: $${v?.toLocaleString(undefined,{ maximumFractionDigits: 6 })}`;
              }
              return `${label}: ${v?.toLocaleString()}`;
            }
          }
        }
      },

      // axes
      scales: {
        x: {
          type: "time",
          time: { unit: "day" },
          ticks: { color: "#000000" },       // x tick labels -> black
          border: { color: "#000000" },      // x axis line -> black
          grid: { color: "#e6e6e6" }         // subtle grid (optional)
        },
        yL: {
          position: "left",
          ticks: {
            color: "#000000",                // left ticks -> black
            callback: v => `$${Number(v).toFixed(3)}`
          },
          border: { color: "#000000" },      // left axis line -> black
          grid: { color: "#e6e6e6" }         // optional
        },
        yR: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { color: "#000000" },       // right ticks -> black
          border: { color: "#000000" }       // **right axis line -> black**
        }
      }
    }
  });
}

// Example usage
makeDualAxis({
  el: "chart",
  file: "data/pump.json",
  leftKey: "price", rightKey: "fees",
  leftLabel: "Price (USD)", rightLabel: "Fees",
  leftColor: "#54d794",
  rightColor: "#000000"
});

makeDualAxis({
  el: "chart-revenue",
  file: "data/pump_price_revenue.json",
  leftKey: "price", rightKey: "revenue",
  leftLabel: "Price (USD)", rightLabel: "Revenue",
  leftColor: "#54d794",
  rightColor: "#000000"
});

makeDualAxis({
  el: "chart-buybacks",
  file: "data/pump_price_buybacks_usd.json",
  leftKey: "price",
  rightKey: "buybacks_usd",
  leftLabel: "Price (USD)",
  rightLabel: "Buybacks (USD)",
  leftColor: "#54d794",
  rightColor: "#000000"
});



