/**
 * Fix Queue: owner and state changes save optimistically. "Verified" is never
 * settable by hand — the scanner sets it when the measurement comes back — so
 * the option is disabled in markup and rejected here too.
 */
import { toast } from "./toasts.js";

export default function fixes() {
  document.querySelectorAll("[data-fix-form]").forEach((form) => {
    const card = form.closest("[data-fix]");
    const id = card?.dataset.fix;

    const save = async (patch) => {
      const previous = { ...card.dataset };
      try {
        const res = await fetch(`/api/fixes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch)
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        card.dataset.state = data.state;
        toast(
          patch.state === "shipped"
            ? "Marked shipped. The next scan measures it and moves it to verified."
            : "Saved."
        );
      } catch {
        Object.assign(card.dataset, previous);
        toast("Could not save that. Nothing was changed.", "error");
      }
    };

    form.querySelector("[data-fix-state]")?.addEventListener("change", (e) => {
      if (e.target.value === "verified") { e.target.value = card.dataset.state; return; }
      save({ state: e.target.value });
    });

    form.querySelector("[data-fix-owner]")?.addEventListener("change", (e) => {
      save({ owner: e.target.value || null });
    });

    form.addEventListener("submit", (e) => {
      // No-JS path posts the form; with JS we have already saved.
      e.preventDefault();
    });
  });
}
