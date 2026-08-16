/**
 * Count-up for the score unit. Respects prefers-reduced-motion by landing on the
 * final value immediately — the number is information, not decoration.
 */
export default function countUp() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target)) return;
    if (reduce) { el.textContent = `${Math.round(target * 100)}%`; return; }

    const duration = 700;
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(target * 100 * eased)}%`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
