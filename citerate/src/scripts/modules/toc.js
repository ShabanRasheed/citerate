/** Article table of contents: marks the heading currently in view. */
export default function toc() {
  const nav = document.querySelector("[data-toc]");
  if (!nav) return;

  const links = [...nav.querySelectorAll("a[href^='#']")];
  const targets = links
    .map((a) => document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))))
    .filter(Boolean);
  if (!targets.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((a) => {
        const on = a.getAttribute("href").slice(1) === visible.target.id;
        a.setAttribute("aria-current", on ? "true" : "false");
      });
    },
    { rootMargin: "-88px 0px -70% 0px" }
  );

  targets.forEach((t) => io.observe(t));
}
