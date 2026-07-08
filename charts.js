/* ═══════════════════════════════════════════
   CHARTS — Chart.js powered visualizations
   ═══════════════════════════════════════════ */

Chart.defaults.color = "#8892b0";
Chart.defaults.borderColor = "rgba(110,90,255,0.1)";
Chart.defaults.font.family = "'Inter', sans-serif";

const CHART_COLORS = {
  violet:       "rgba(124, 58, 237, 1)",
  violetAlpha:  "rgba(124, 58, 237, 0.3)",
  violetFill:   "rgba(124, 58, 237, 0.08)",
  cyan:         "rgba(6, 182, 212, 1)",
  cyanAlpha:    "rgba(6, 182, 212, 0.3)",
  cyanFill:     "rgba(6, 182, 212, 0.06)",
  green:        "rgba(16, 185, 129, 1)",
  amber:        "rgba(245, 158, 11, 1)",
  rose:         "rgba(244, 63, 94, 1)",
  roseAlpha:    "rgba(244, 63, 94, 0.25)",
};

let focusBarChart, focusLineChart, interruptChart;

function createGradient(ctx, color1, color2, height = 300) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color1);
  gradient.addColorStop(1, color2);
  return gradient;
}

/* ─── Sparklines ─── */
function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  
  if (!data || !data.length) {
    ctx.clearRect(0, 0, w, h);
    return;
  }

  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * (h - 4) - 2
  }));

  ctx.clearRect(0, 0, w, h);

  // Fill area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace("1)", "0.3)"));
  grad.addColorStop(1, color.replace("1)", "0)"));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, h);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function initSparklines() {
  drawSparkline("sparkline1", DEMO_SPARKLINES.weekTime,    CHART_COLORS.violet);
  drawSparkline("sparkline2", DEMO_SPARKLINES.focusTrend,  CHART_COLORS.cyan);
  drawSparkline("sparkline3", DEMO_SPARKLINES.bestSession, CHART_COLORS.amber);
  drawSparkline("sparkline4", DEMO_SPARKLINES.sessions,    CHART_COLORS.green);
}

/* ─── Focus Bar Chart ─── */
function initFocusBarChart() {
  const ctx = document.getElementById("focusBarChart");
  if (!ctx) return;

  const grad = createGradient(ctx.getContext("2d"), CHART_COLORS.violet, CHART_COLORS.violetAlpha, 220);

  focusBarChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: DEMO_DAILY.labels,
      datasets: [
        {
          label: "Focus Minutes",
          data: DEMO_DAILY.focusMins,
          backgroundColor: grad,
          borderColor: CHART_COLORS.violet,
          borderWidth: 1,
          borderRadius: 8,
          borderSkipped: false,
        },
        {
          label: "Target",
          data: DEMO_DAILY.target,
          type: "line",
          borderColor: CHART_COLORS.cyan,
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0.4,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(13,20,40,0.95)",
          borderColor: "rgba(124,58,237,0.4)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#f0f4ff",
          bodyColor: "#8892b0",
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 0) return ` Focus: ${ctx.raw} min`;
              return ` Target: ${ctx.raw} min`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(110,90,255,0.06)" },
          ticks: { color: "#8892b0", font: { size: 12 } },
        },
        y: {
          grid: { color: "rgba(110,90,255,0.06)" },
          ticks: { color: "#8892b0", font: { size: 12 }, callback: v => v + "m" },
          suggestedMin: 0,
          suggestedMax: 250,
        }
      },
      animation: { duration: 900, easing: "easeOutQuart" }
    }
  });
}

/* ─── Focus % Line Chart ─── */
function initFocusLineChart() {
  const ctx = document.getElementById("focusLineChart");
  if (!ctx) return;

  const grad = createGradient(ctx.getContext("2d"), CHART_COLORS.cyanAlpha, CHART_COLORS.cyanFill, 200);

  focusLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: DEMO_FOCUS_TREND.labels,
      datasets: [{
        label: "Focus %",
        data: DEMO_FOCUS_TREND.pct,
        borderColor: CHART_COLORS.cyan,
        backgroundColor: grad,
        borderWidth: 2.5,
        fill: true,
        tension: 0.45,
        pointBackgroundColor: CHART_COLORS.cyan,
        pointBorderColor: "rgba(13,20,40,1)",
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(13,20,40,0.95)",
          borderColor: "rgba(6,182,212,0.4)",
          borderWidth: 1,
          padding: 12,
          callbacks: { label: ctx => ` Focus Score: ${ctx.raw}%` }
        }
      },
      scales: {
        x: { grid: { color: "rgba(110,90,255,0.06)" }, ticks: { color: "#8892b0", font: { size: 11 } } },
        y: {
          grid: { color: "rgba(110,90,255,0.06)" },
          ticks: { color: "#8892b0", font: { size: 11 }, callback: v => v + "%" },
          min: 40, max: 100,
        }
      },
      animation: { duration: 900, easing: "easeOutQuart" }
    }
  });
}

/* ─── Interruptions Chart ─── */
function initInterruptChart() {
  const ctx = document.getElementById("interruptChart");
  if (!ctx) return;

  interruptChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: DEMO_INTERRUPTS.labels,
      datasets: [{
        label: "Interruptions",
        data: DEMO_INTERRUPTS.counts,
        backgroundColor: DEMO_INTERRUPTS.counts.map(v =>
          v <= 2 ? CHART_COLORS.green :
          v <= 4 ? CHART_COLORS.amber :
          CHART_COLORS.rose
        ),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(13,20,40,0.95)",
          borderColor: "rgba(110,90,255,0.4)",
          borderWidth: 1,
          padding: 12,
          callbacks: { label: ctx => ` Interruptions: ${ctx.raw}` }
        }
      },
      scales: {
        x: { grid: { color: "rgba(110,90,255,0.06)" }, ticks: { color: "#8892b0", font: { size: 11 } } },
        y: {
          grid: { color: "rgba(110,90,255,0.06)" },
          ticks: { color: "#8892b0", font: { size: 11 }, stepSize: 1 },
          min: 0,
        }
      },
      animation: { duration: 900, easing: "easeOutQuart" }
    }
  });
}

/* ─── Session Table ─── */
function initSessionTable() {
  const tbody = document.getElementById("sessionTableBody");
  if (!tbody) return;
  tbody.innerHTML = DEMO_SESSIONS.map(s => `
    <tr>
      <td>${s.date}</td>
      <td>${s.start}</td>
      <td><span style="font-family:var(--font-mono);font-size:12px">${s.durationStr}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:50px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08)">
            <div style="width:${s.focusPct}%;height:100%;border-radius:2px;background:${s.focusPct>=80?'var(--green)':s.focusPct>=65?'var(--cyan)':'var(--amber)'}"></div>
          </div>
          ${s.focusPct}%
        </div>
      </td>
      <td>${s.interruptions}</td>
      <td><span class="quality-badge ${s.quality}">${s.quality.charAt(0).toUpperCase()+s.quality.slice(1)}</span></td>
    </tr>
  `).join("");
}

function initAllCharts() {
  initSparklines();
  initFocusBarChart();
  initFocusLineChart();
  initInterruptChart();
  initSessionTable();
}
