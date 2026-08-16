/**
 * Cause bar: clicking a segment filters the query table on the same page and
 * writes the filter into the URL so a filtered view is shareable.
 */
export default function causeBar() {
  const bar = document.querySelector("[data-cause-bar]");
  if (!bar) return;

  const CAUSE = {
    aio: "aio_displacement",
    rank: "ranking_decline",
    tech: "technical_decay",
    other: "unexplained"
  };

  bar.querySelectorAll(".cause-bar__seg[data-cause]").forEach((seg) => {
    seg.addEventListener("click", () => {
      const active = seg.getAttribute("aria-pressed") === "true";
      bar.querySelectorAll(".cause-bar__seg").forEach((s) => s.setAttribute("aria-pressed", "false"));
      seg.setAttribute("aria-pressed", active ? "false" : "true");

      const cause = active ? "" : CAUSE[seg.dataset.cause] || "";
      document.querySelectorAll("[data-cause-filter]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.causeFilter === cause));
      });
      document.dispatchEvent(new CustomEvent("citerate:filter", { detail: { cause } }));

      const url = new URL(window.location.href);
      if (cause) url.searchParams.set("cause", cause);
      else url.searchParams.delete("cause");
      window.history.replaceState({}, "", url);
    });
  });
}
