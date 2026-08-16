/**
 * The dashboard's entry script — the opposite balance to marketing:
 * Bootstrap's JS (dropdown, modal, offcanvas, toast, tooltip), Alpine for the
 * two panes with genuine local state, and ECharts only where a chart exists.
 */
import { Dropdown, Modal, Offcanvas, Toast, Tooltip } from "bootstrap";
import Alpine from "alpinejs";

window.bootstrap = { Dropdown, Modal, Offcanvas, Toast, Tooltip };

const context = (() => {
  const el = document.getElementById("app-context");
  try { return el ? JSON.parse(el.textContent || "{}") : {}; } catch { return {}; }
})();
window.CITERATE = context;

// Bootstrap components that need explicit construction.
document.querySelectorAll("[data-bs-toggle='dropdown']").forEach((el) => new Dropdown(el));
document.querySelectorAll("[data-bs-toggle='tooltip']").forEach((el) => new Tooltip(el));

// Alpine drives the panes with local state (query add sheet, invite form).
Alpine.store("ui", { busy: false });
window.Alpine = Alpine;
Alpine.start();

// Charts: one chunk, loaded only when the page says it has a chart.
if (document.body.dataset.charts === "true" && document.querySelector("[data-chart]")) {
  import("./modules/charts.js").then((m) => m.default?.());
}
if (document.querySelector("[data-cause-bar]")) {
  import("./modules/cause-bar.js").then((m) => m.default?.());
}
if (document.querySelector("[data-query-table]")) {
  import("./modules/table.js").then((m) => m.default?.());
}
if (document.querySelector("[data-fix]")) {
  import("./modules/fixes.js").then((m) => m.default?.());
}
if (document.querySelector("[data-rescan]")) {
  import("./modules/rescan.js").then((m) => m.default?.());
}
if (document.querySelector("[data-count]")) {
  import("./modules/count-up.js").then((m) => m.default?.());
}
