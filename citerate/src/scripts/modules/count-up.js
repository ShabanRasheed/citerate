/** Number count-up. Respects reduced motion by reading the motion token. */
export default function countUp() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const animate = (el) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.countSuffix || "";
    const duration = reduced ? 0 : Number(el.dataset.countDuration || 700);

    if (!duration) {
      el.textContent = `${target}${suffix}`;
      return;
    }

    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      // --ease-settle
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.4 }
  );

  document.querySelectorAll("[data-count]").forEach((el) => io.observe(el));
}
