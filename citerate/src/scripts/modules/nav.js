/** Mobile nav. No Bootstrap JS, no offcanvas dependency. */
export default function nav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const panel = document.querySelector("[data-nav]");
  if (!toggle || !panel) return;

  const set = (open) => {
    panel.classList.toggle("nav--open", open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };

  toggle.addEventListener("click", () => {
    set(toggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") set(false);
  });

  panel.addEventListener("click", (e) => {
    if (e.target.closest("a")) set(false);
  });

  window.matchMedia("(min-width: 992px)").addEventListener("change", (e) => {
    if (e.matches) set(false);
  });
}
