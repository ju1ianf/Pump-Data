(async () => {
  const res = await fetch("data/pump.json", { cache: "no-store" });
  const { series } = await res.json();

  const labels = series.map(d => d.date);
  const price  = series.map(d => d.price);
  const fees   = series.map(d => d.fees);

  const fmtUSD  = v => v == null ? "–" : `$${v.toLocaleString(undefined,{ maximumFractionDigits:6 })}`;
  const fmtBig  = v => v == null ? "–" : v.toLocaleString();

  const ctx = document.getElementById("chart").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Price (USD)", data: price, yAxisID: "yL", tension:.25, pointRadius:0 },
        { label: "Fees",        data: fees,  yAxisID: "yR", tension:.25, pointRadius:0 }
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: c => c.dataset.label === "Price (USD)"
              ? `${c.dataset.label}: ${fmtUSD(c.parsed.y)}`
              : `${c.dataset.label}: ${fmtBig(c.parsed.y)}`
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
})();

