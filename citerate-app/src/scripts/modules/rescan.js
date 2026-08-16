/**
 * Rescan. Rescans are metered (a pack of 10 is $15), so the button always says
 * what it will spend, and polls the same progress endpoint the free scan uses.
 */
import { toast } from "./toasts.js";

export default function rescan() {
  document.querySelectorAll("[data-rescan]").forEach((button) => {
    button.addEventListener("click", async () => {
      const domainId = button.dataset.domain;
      button.disabled = true;
      const label = button.textContent;
      button.textContent = "Queuing…";

      try {
        const res = await fetch("/api/rescan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domainId })
        });
        const data = await res.json();

        if (res.status === 402) {
          toast(`Out of on-demand rescans. ${data.hint || "A pack of 10 is $15."}`, "error");
          return;
        }
        if (!res.ok) throw new Error(data.error || "failed");

        toast(`Scan queued · ${data.queriesTotal} queries × ${data.enginesCount} engines`);
        poll(data.scanId, button, label);
        return;
      } catch {
        toast("Could not queue the scan. Nothing was charged.", "error");
      } finally {
        if (button.textContent === "Queuing…") {
          button.disabled = false;
          button.textContent = label;
        }
      }
    });
  });
}

function poll(scanId, button, label) {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    try {
      const res = await fetch(`/api/scan/${scanId}`);
      const data = await res.json();
      button.textContent = `Scanning ${data.queriesDone}/${data.queriesTotal}`;

      if (data.status === "complete" || data.status === "partial") {
        toast(data.status === "partial" ? "Scan finished with partial coverage — the readout says which runs are missing." : "Scan complete. Reloading the readout.");
        setTimeout(() => window.location.reload(), 900);
        return;
      }
      if (data.status === "failed") {
        toast("The scan stopped. We kept the runs that completed and did not charge for the rest.", "error");
        button.disabled = false;
        button.textContent = label;
        return;
      }
    } catch {
      /* transient: keep polling */
    }
    if (tries < 120) setTimeout(tick, 5000);
  };
  setTimeout(tick, 4000);
}
