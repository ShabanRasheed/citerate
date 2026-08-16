/**
 * GSAP scroll narrative — the /how-it-works stage pinning.
 * Loaded ONLY when: body[data-scroll-narrative="true"], viewport ≥ 900px, and
 * reduced motion is off (see scripts/main.js). GSAP therefore never appears in
 * the bundle for any other page, which is how Lighthouse 95 survives.
 *
 * Install: pnpm add gsap   (kept out of package.json until this page ships)
 */
export default async function scrollNarrative() {
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger")
  ]);
  gsap.registerPlugin(ScrollTrigger);

  const stages = [...document.querySelectorAll("[data-stage]")];
  if (!stages.length) return;

  stages.forEach((stage, i) => {
    const figure = stage.querySelector("[data-stage-figure]");
    ScrollTrigger.create({
      trigger: stage,
      start: "top 20%",
      end: "bottom 60%",
      onEnter: () => setActive(i),
      onEnterBack: () => setActive(i)
    });
    if (figure) {
      gsap.from(figure, {
        opacity: 0,
        y: 12,
        duration: 0.42,
        ease: "power2.out",
        scrollTrigger: { trigger: stage, start: "top 70%", once: true }
      });
    }
  });

  const dots = [...document.querySelectorAll("[data-stage-dot]")];
  function setActive(i) {
    dots.forEach((d, j) => d.setAttribute("aria-current", String(i === j)));
  }
}
