/**
 * ECharts, configured once. Every chart in the app goes through this file so the
 * confidence band, the discontinuity flag, and the tokens are identical
 * everywhere — including in the PDF, which screenshots these canvases.
 */
import * as echarts from "echarts";

const css = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const INK = () => css("--ink", "#141B26");
const SOFT = () => css("--ink-soft", "#5B6472");
const LINE = () => css("--line", "#E2E5EA");
const CITED = () => css("--cited", "#0E7C66");
const BAND = () => css("--chart-band", "rgba(14,124,102,0.22)");

const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

function trendOption(series) {
  const days = series.map((s) => s.day);
  const rate = series.map((s) => (s.rate === null ? null : +(s.rate * 100).toFixed(1)));
  const low = series.map((s) => (s.low === null ? null : +(s.low * 100).toFixed(1)));
  const spread = series.map((s, i) =>
    s.low === null || s.high === null ? null : +((s.high - s.low) * 100).toFixed(1)
  );
  const flags = series.filter((s) => s.flag);

  return {
    animationDuration: 420,
    animationEasing: "cubicOut",
    grid: { top: 16, right: 12, bottom: 28, left: 44 },
    tooltip: {
      trigger: "axis",
      backgroundColor: INK(),
      borderWidth: 0,
      textStyle: { color: "#F4F5F7", fontFamily: MONO, fontSize: 12 },
      formatter: (params) => {
        const i = params[0]?.dataIndex ?? 0;
        const s = series[i];
        if (!s) return "";
        const band =
          s.low !== null && s.high !== null
            ? `<br/>band ${(s.low * 100).toFixed(0)}–${(s.high * 100).toFixed(0)}%`
            : "";
        return `${s.day}<br/><b>${(s.rate * 100).toFixed(0)}%</b> · ${s.runs} runs${band}${
          s.flag ? "<br/>⚠ method changed" : ""
        }`;
      }
    },
    xAxis: {
      type: "category",
      data: days,
      boundaryGap: false,
      axisLine: { lineStyle: { color: LINE() } },
      axisTick: { show: false },
      axisLabel: {
        color: SOFT(),
        fontFamily: MONO,
        fontSize: 11,
        formatter: (v) => v.slice(5).replace("-", "/")
      }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: LINE() } },
      axisLabel: { color: SOFT(), fontFamily: MONO, fontSize: 11, formatter: "{value}%" }
    },
    series: [
      // Confidence band: an invisible floor plus a stacked spread. Movement
      // inside this ribbon is noise, and the chart says so visually.
      { type: "line", data: low, stack: "band", lineStyle: { opacity: 0 }, symbol: "none", silent: true },
      {
        type: "line",
        data: spread,
        stack: "band",
        lineStyle: { opacity: 0 },
        areaStyle: { color: BAND() },
        symbol: "none",
        silent: true
      },
      {
        type: "line",
        data: rate,
        smooth: false,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { color: CITED(), width: 2 },
        itemStyle: { color: CITED() },
        markLine: flags.length
          ? {
              symbol: "none",
              label: { formatter: "method", color: css("--warn-ink", "#9A6210"), fontFamily: MONO, fontSize: 10 },
              lineStyle: { color: css("--warn", "#D98324"), type: "dashed" },
              data: flags.map((f) => ({ xAxis: f.day }))
            }
          : undefined
      }
    ]
  };
}

export default function charts() {
  const instances = [];

  document.querySelectorAll("[data-chart]").forEach((figure) => {
    const canvas = figure.querySelector("[data-chart-canvas]");
    const payload = figure.querySelector("[data-chart-data]");
    if (!canvas || !payload) return;

    let series;
    try { series = JSON.parse(payload.textContent || "[]"); } catch { return; }
    if (!series.length) return;

    const chart = echarts.init(canvas, null, { renderer: "canvas" });
    chart.setOption(trendOption(series));
    instances.push(chart);

    // Range buttons re-slice the data we already have — no round trip.
    figure.querySelectorAll("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        figure.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", "false"));
        button.setAttribute("aria-pressed", "true");
        const days = Number(button.dataset.range);
        chart.setOption(trendOption(series.slice(-days)), true);
      });
    });
  });

  const resize = () => instances.forEach((c) => c.resize());
  window.addEventListener("resize", resize, { passive: true });

  // Print: ECharts canvases must be laid out before the print snapshot.
  window.addEventListener("beforeprint", resize);
}
