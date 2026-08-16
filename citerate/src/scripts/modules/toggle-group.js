/**
 * One pattern, four uses: pricing interval, role tabs, blog categories, contact
 * intent. Markup contract:
 *
 *   <div data-toggle-group="pricing" data-event="pricing_interval_toggled">
 *     <button class="pill" data-value="month" aria-selected="true">Monthly</button>
 *     <button class="pill" data-value="year">Yearly</button>
 *   </div>
 *   <div data-panel-group="pricing">
 *     <div data-panel="month">…</div>
 *     <div data-panel="year" hidden>…</div>
 *   </div>
 *
 * Elements with data-swap="pricing" and data-month / data-year attributes have
 * their text replaced instead — used by the price figures.
 */
import { track } from "../../lib/analytics.js";

export default function toggleGroup() {
  document.querySelectorAll("[data-toggle-group]").forEach((group) => {
    const name = group.dataset.toggleGroup;
    const buttons = [...group.querySelectorAll("[data-value]")];
    if (!buttons.length) return;

    const select = (value, fireEvent = true) => {
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.value === value)));

      document.querySelectorAll(`[data-panel-group="${name}"] [data-panel]`).forEach((panel) => {
        panel.hidden = panel.dataset.panel !== value;
      });

      document.querySelectorAll(`[data-swap="${name}"]`).forEach((el) => {
        const next = el.dataset[value];
        if (typeof next === "string") el.textContent = next;
      });

      if (group.dataset.persist === "url") {
        const url = new URL(location.href);
        url.searchParams.set(name, value);
        history.replaceState(null, "", url);
      }

      if (fireEvent && group.dataset.event) track(group.dataset.event, { group: name, value });
    };

    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (btn) select(btn.dataset.value);
    });

    // Arrow-key navigation, since these are tab-like.
    group.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const next = buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
      next.focus();
      select(next.dataset.value);
      e.preventDefault();
    });

    // Deep link: /pricing?pricing=year, /contact?intent=agency
    const fromUrl = new URL(location.href).searchParams.get(name);
    const initial =
      (fromUrl && buttons.some((b) => b.dataset.value === fromUrl) && fromUrl) ||
      buttons.find((b) => b.getAttribute("aria-selected") === "true")?.dataset.value ||
      buttons[0].dataset.value;
    select(initial, false);
  });
}
