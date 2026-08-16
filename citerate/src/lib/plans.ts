/**
 * Plan limits and gating. Read from usage_counters, never from a live count
 * over observations — that is what the counters exist for.
 */
export type PlanId = "free" | "starter" | "growth" | "scale" | "agency" | "enterprise";

export interface PlanLimits {
  label: string;
  monthly: number | null;      // USD, null = talk to us
  yearly: number | null;       // per month, billed yearly (2 months free)
  trackedQueries: number;
  domains: number;
  engines: number | "all";
  refresh: "once" | "weekly" | "daily" | "daily+on_demand";
  historyDays: number | null;  // null = unlimited
  seats: number | "unlimited";
  competitorNames: boolean;
  fixQueue: boolean;
  pdfReports: false | "standard" | "white_label";
  api: false | "read" | "read_write";
  clientWorkspaces?: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: "Free scan", monthly: 0, yearly: 0,
    trackedQueries: 25, domains: 1, engines: 2, refresh: "once",
    historyDays: 0, seats: 1, competitorNames: false, fixQueue: false,
    pdfReports: false, api: false
  },
  starter: {
    label: "Starter", monthly: 49, yearly: 41,
    trackedQueries: 100, domains: 1, engines: 2, refresh: "weekly",
    historyDays: 90, seats: 1, competitorNames: false, fixQueue: false,
    pdfReports: false, api: false
  },
  growth: {
    label: "Growth", monthly: 199, yearly: 166,
    trackedQueries: 500, domains: 3, engines: 4, refresh: "daily",
    historyDays: 365, seats: 5, competitorNames: true, fixQueue: true,
    pdfReports: "standard", api: "read"
  },
  scale: {
    label: "Scale", monthly: 499, yearly: 416,
    trackedQueries: 2000, domains: 10, engines: "all", refresh: "daily+on_demand",
    historyDays: null, seats: 15, competitorNames: true, fixQueue: true,
    pdfReports: "white_label", api: "read_write"
  },
  agency: {
    label: "Agency", monthly: 799, yearly: 666,
    trackedQueries: 5000, domains: 25, engines: "all", refresh: "daily+on_demand",
    historyDays: null, seats: "unlimited", competitorNames: true, fixQueue: true,
    pdfReports: "white_label", api: "read_write", clientWorkspaces: 25
  },
  enterprise: {
    label: "Enterprise", monthly: null, yearly: null,
    trackedQueries: 5000, domains: 100, engines: "all", refresh: "daily+on_demand",
    historyDays: null, seats: "unlimited", competitorNames: true, fixQueue: true,
    pdfReports: "white_label", api: "read_write"
  }
};

/** Add-ons buy volume only — never a gated feature. Keeps the tier story honest. */
export const ADDONS = {
  extraQueries: { unit: 100, price: 19, label: "100 extra tracked queries" },
  extraDomain: { unit: 1, price: 39, label: "Extra domain" },
  rescanPack: { unit: 10, price: 15, label: "10 on-demand rescans" },
  backfill: { unit: 90, price: 99, label: "90-day historical backfill (one-off)" },
  seatGrowth: { unit: 1, price: 12, label: "Additional seat (Growth)" },
  clientWorkspace: { unit: 1, price: 29, label: "Extra client workspace (Agency)" }
} as const;

export const OVERAGE_BLOCK = { queries: 100, price: 19 };

/**
 * Going over does not stop the scan: it shows a banner and bills the overage
 * block at the end of the cycle. No surprise mid-cycle lockouts.
 */
export function meter(used: number, included: number) {
  const over = Math.max(0, used - included);
  return {
    used,
    included,
    over,
    pct: included ? Math.min(999, Math.round((used / included) * 100)) : 0,
    state: over > 0 ? "over" : used / Math.max(1, included) > 0.85 ? "near" : "ok",
    overageUnits: Math.ceil(over / OVERAGE_BLOCK.queries),
    overageCost: Math.ceil(over / OVERAGE_BLOCK.queries) * OVERAGE_BLOCK.price
  } as const;
}

export function can(plan: PlanId, feature: keyof PlanLimits): boolean {
  const v = PLANS[plan][feature];
  return Boolean(v) && v !== false;
}

export function price(plan: PlanId, interval: "month" | "year"): string {
  const p = PLANS[plan];
  const value = interval === "year" ? p.yearly : p.monthly;
  if (value === null) return "Talk to us";
  if (value === 0) return "$0";
  return `$${value}`;
}
