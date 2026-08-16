/**
 * Cookie/consent notice. Cloudflare Web Analytics is cookieless, so this is a
 * one-time informational notice, not a blocking wall. Stores a single flag in
 * localStorage — never clears keys it did not write.
 */
const KEY = "citerate.notice.v1";

export default function consent() {
  const bar = document.querySelector("[data-consent]");
  if (!bar) return;

  let seen = null;
  try {
    seen = localStorage.getItem(KEY);
  } catch {
    /* storage blocked: just show it, dismissal is per-session */
  }

  if (seen === "dismissed") {
    bar.remove();
    return;
  }

  bar.hidden = false;
  bar.querySelector("[data-consent-dismiss]")?.addEventListener("click", () => {
    try {
      localStorage.setItem(KEY, "dismissed");
    } catch {
      /* ignore */
    }
    bar.remove();
  });
}
