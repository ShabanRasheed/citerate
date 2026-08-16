// The prototype's data, transcribed from what the repos actually ship.
//
//   plans / prices  → citerate/src/lib/plans.ts and citerate/src/data/pricing.json
//   everything else → citerate/infra/seeds/dev.sql, the local D1 seed
//
// A prototype cannot query D1, so this file stands in for it. Keep it matching
// the seed: after `pnpm dev` and a seeded database, the dashboard shows these
// numbers.
(function () {
  if (window.CiterateSeed) return;

  var PLANS = {
    free:      { label: "Free scan", monthly: 0,    yearly: 0,   queries: 25,   domains: 1,   engines: "2",   refresh: "once",              seats: "1",         competitorNames: false, fixQueue: false, pdf: false,          api: false,        workspaces: 0 },
    starter:   { label: "Starter",   monthly: 49,   yearly: 41,  queries: 100,  domains: 1,   engines: "2",   refresh: "weekly",            seats: "1",         competitorNames: false, fixQueue: false, pdf: false,          api: false,        workspaces: 0 },
    growth:    { label: "Growth",    monthly: 199,  yearly: 166, queries: 500,  domains: 3,   engines: "4",   refresh: "daily",             seats: "5",         competitorNames: true,  fixQueue: true,  pdf: "standard",     api: "read",       workspaces: 0 },
    scale:     { label: "Scale",     monthly: 499,  yearly: 416, queries: 2000, domains: 10,  engines: "all", refresh: "daily + on demand", seats: "15",        competitorNames: true,  fixQueue: true,  pdf: "white_label",  api: "read + write", workspaces: 0 },
    agency:    { label: "Agency",    monthly: 799,  yearly: 666, queries: 5000, domains: 25,  engines: "all", refresh: "daily + on demand", seats: "unlimited", competitorNames: true,  fixQueue: true,  pdf: "white_label",  api: "read + write", workspaces: 25 },
    enterprise:{ label: "Enterprise",monthly: null, yearly: null,queries: 5000, domains: 100, engines: "all", refresh: "daily + on demand", seats: "unlimited", competitorNames: true,  fixQueue: true,  pdf: "white_label",  api: "read + write", workspaces: 0 },
  };

  var OVERAGE_BLOCK = { queries: 100, price: 19 };

  // Same arithmetic as meter() in src/lib/plans.ts.
  function meter(used, included) {
    var over = Math.max(0, used - included);
    var units = Math.ceil(over / OVERAGE_BLOCK.queries);
    return {
      used: used, included: included, over: over,
      pct: included ? Math.min(999, Math.round((used / included) * 100)) : 0,
      state: over > 0 ? "over" : used / Math.max(1, included) > 0.85 ? "near" : "ok",
      overageUnits: units, overageCost: units * OVERAGE_BLOCK.price,
    };
  }

  function price(planId, interval) {
    var p = PLANS[planId];
    var v = interval === "year" ? p.yearly : p.monthly;
    if (v === null) return "Talk to us";
    if (v === 0) return "$0";
    return "$" + v;
  }

  var SEED = {
    user: { email: "demo@citerate.com", name: "Demo User" },
    workspace: { name: "Acme CRM", slug: "acme-crm", plan: "growth" },
    domain: { hostname: "acmecrm.com", label: "Acme CRM" },
    // The five seeded queries, with the intent and cluster the seed gives them.
    queries: [
      { text: "best crm for startups",        intent: "commercial",    cluster: "category-pick", source: "category" },
      { text: "hubspot alternatives",         intent: "commercial",    cluster: "alternatives",  source: "search_console" },
      { text: "crm with free tier",           intent: "commercial",    cluster: "pricing",       source: "site" },
      { text: "crm for a 10 person team",      intent: "commercial",    cluster: "category-pick", source: "category" },
      { text: "how to migrate crm data",      intent: "informational", cluster: "migration",     source: "site" },
    ],
    engines: ["chatgpt", "google_aio", "perplexity", "gemini"],
    scan: { kind: "scheduled", status: "complete", queriesTotal: 5, queriesDone: 5, citationRate: 0.34 },
    rollup: { rate: 0.34, runs: 60, bandLow: 0.29, bandHigh: 0.39, causeAio: 0.46, causeRank: 0.27, causeTech: 0.17, causeOther: 0.10 },
    competitors: ["competitor-a.com", "competitor-b.com"],
    findings: [
      { id: "fnd_1", title: 'Publish a comparison page answering "hubspot alternatives" directly',
        detail: "Engines cite pages that name alternatives and state numbers.",
        cause: "aio", impact: "high", cluster: "alternatives", queries: ["hubspot alternatives"], baseline: 0.0, state: "open", owner: "Demo User" },
      { id: "fnd_2", title: "Add per-plan pricing detail",
        detail: "Answers citing pricing prefer pages with explicit figures.",
        cause: "aio", impact: "high", cluster: "pricing", queries: ["crm with free tier"], baseline: 0.33, state: "in_progress", owner: "Demo User" },
      { id: "fnd_3", title: "Fix soft-404s on 3 documentation URLs",
        detail: "Engines could not fetch these pages.",
        cause: "tech", impact: "medium", cluster: "migration", queries: ["how to migrate crm data"], baseline: 0.33, state: "open", owner: "" },
    ],
    usage: { period: "tracked_queries", used: 412, included: 500 },
  };

  window.CiterateSeed = {
    PLANS: PLANS, SEED: SEED, OVERAGE_BLOCK: OVERAGE_BLOCK,
    meter: meter, price: price,
    // Percentages, for the places the UI wants whole numbers.
    pct: function (n) { return Math.round(n * 100); },
  };
})();
