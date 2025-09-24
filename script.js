(async () => {
  const res = await fetch("data/pump.json", { cache: "no-store" });
  const { series } = await res.json();

  const labels = series.map(d => d.date);
  const price  = series.map(d => d.price);
  const fees   = series.map(d => d.fees);

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
      interaction: { mode:"index", intersect:false },
      scales: {
        x: { type:"time", time:{ unit:"day" } },
        yL: { position:"left" },
        yR: { position:"right", grid:{ drawOnChartArea:false } }
      }
    }
  });
})();
