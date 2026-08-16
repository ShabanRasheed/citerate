/**
 * The only script the marketing site loads. Registers modules on demand and
 * does nothing else. Bootstrap's JS is NOT loaded here — marketing runs our own
 * ~40-line modules. (The dashboard is the opposite balance: Bootstrap JS +
 * Alpine + ECharts.)
 */
document.documentElement.classList.add("js");

const boot = () => {
  // Always-on, tiny.
  import("./modules/nav.js").then((m) => m.default?.());
  import("./modules/toggle-group.js").then((m) => m.default?.());
  import("./modules/consent.js").then((m) => m.default?.());

  // Conditional: only pay for what the page contains.
  if (document.querySelector("[data-scan-form]")) {
    import("./modules/scan-form.js").then((m) => m.default?.());
  }
  if (document.querySelector("[data-count]")) {
    import("./modules/count-up.js").then((m) => m.default?.());
  }
  if (document.querySelector("[data-reveal]")) {
    import("./modules/reveal.js").then((m) => m.default?.());
  }
  if (document.querySelector("[data-toc]")) {
    import("./modules/toc.js").then((m) => m.default?.());
  }

  // GSAP scroll narrative: two pages only, desktop only, motion allowed only.
  const wantsScroll = document.body.dataset.scrollNarrative === "true";
  const wide = window.matchMedia("(min-width: 900px)").matches;
  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (wantsScroll && wide && motionOk) {
    import("./modules/scroll-narrative.js").then((m) => m.default?.());
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
