/**
 * Free-scan form. Submits to POST /api/scan, then polls GET /api/scan/:token
 * until the scan completes and redirects to the teaser readout.
 *
 * Turnstile renders invisibly; if it never loads we still submit and let the
 * server reject — better than blocking a real user behind a third-party script.
 */
import { track, EVENTS } from "../../lib/analytics.js";

const POLL_MS = 1500;
const POLL_MAX = 90;

export default function scanForm() {
  document.querySelectorAll("[data-scan-form]").forEach((form) => {
    const input = form.querySelector("[data-scan-input]");
    const button = form.querySelector("[data-scan-submit]");
    const error = form.querySelector("[data-scan-error]");
    const progress = document.querySelector("[data-scan-progress]");
    const fill = progress?.querySelector("[data-scan-fill]");
    const label = progress?.querySelector("[data-scan-label]");

    const setError = (msg) => {
      if (!error) return;
      error.textContent = msg || "";
      error.hidden = !msg;
    };

    const setBusy = (busy, text) => {
      form.dataset.state = busy ? "loading" : "";
      if (button) {
        button.disabled = busy;
        button.textContent = busy ? text || "Scanning…" : button.dataset.idleLabel || "Run free scan";
      }
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setError("");

      const domain = input?.value?.trim();
      if (!domain) {
        setError("Enter a domain to scan.");
        input?.focus();
        return;
      }

      setBusy(true, "Starting…");
      track(EVENTS.scanSubmitted, { domain });

      let token;
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain,
            turnstileToken: form.querySelector('[name="cf-turnstile-response"]')?.value ?? null
          })
        });
        const data = await res.json();

        if (!res.ok) {
          setBusy(false);
          setError(data.error || "Something went wrong. Try again.");
          return;
        }

        token = data.token;
        if (data.cached) {
          track(EVENTS.scanCachedHit, { domain });
          location.href = `/scan/${token}`;
          return;
        }
      } catch {
        setBusy(false);
        setError("Network error. Check your connection and try again.");
        return;
      }

      // Poll for progress. The scanner Worker updates queries_done as it goes.
      let ticks = 0;
      const poll = async () => {
        ticks += 1;
        try {
          const res = await fetch(`/api/scan/${token}`);
          const s = await res.json();
          const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;

          if (fill) fill.style.width = `${pct}%`;
          if (label) label.textContent = `${s.done} of ${s.total} checked`;
          setBusy(true, `Scanning… ${pct}%`);

          if (s.status === "complete" || s.status === "partial") {
            track(EVENTS.scanCompleted, { domain, rate: s.citationRate });
            location.href = `/scan/${token}`;
            return;
          }
          if (s.status === "failed") {
            setBusy(false);
            setError("The scan failed. We've logged it — try again in a minute.");
            return;
          }
        } catch {
          /* transient: keep polling */
        }

        if (ticks < POLL_MAX) {
          setTimeout(poll, POLL_MS);
        } else {
          setBusy(false);
          setError("This is taking longer than usual. We'll email you when it's done.");
        }
      };

      setTimeout(poll, POLL_MS);
    });
  });
}
