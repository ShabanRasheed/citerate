/**
 * One thin wrapper over analytics so swapping Cloudflare Web Analytics for GA4
 * or PostHog later is a single-file change. Cookieless by default, which is why
 * the consent banner stays a legal formality rather than a wall in the funnel.
 */
type Props = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    __cfBeacon?: unknown;
    dataLayer?: unknown[];
  }
}

const QUEUE: { name: string; props?: Props }[] = [];

export function track(name: string, props?: Props): void {
  if (typeof window === "undefined") return;
  // Cloudflare Web Analytics has no custom-event API yet, so named events land
  // as a beacon fetch that a Worker route can log; swap this body when you
  // adopt a product analytics tool.
  QUEUE.push({ name, props });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/event",
      new Blob([JSON.stringify({ name, props, path: location.pathname, ts: Date.now() })], {
        type: "application/json"
      })
    );
  }
}

/** Named CTA events — the funnel we actually report on. */
export const EVENTS = {
  scanSubmitted: "scan_submitted",
  scanCompleted: "scan_completed",
  scanCachedHit: "scan_cache_hit",
  scanClaimed: "scan_claimed",
  pricingToggled: "pricing_interval_toggled",
  planCtaClicked: "plan_cta_clicked",
  roleTabViewed: "role_tab_viewed",
  compareViewed: "compare_viewed",
  demoRequested: "agency_demo_requested",
  contactSubmitted: "contact_submitted",
  apiBetaJoined: "api_beta_joined",
  newsletterJoined: "newsletter_joined"
} as const;

export function flush(): typeof QUEUE {
  return QUEUE.splice(0, QUEUE.length);
}
