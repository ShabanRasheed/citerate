/**
 * Queue an on-demand rescan. Rescans are metered (10 for $15), so this route
 * checks the counter before it writes jobs and returns 402 with the price rather
 * than silently spending.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, all, json, fail } from "../../lib/db";
import { can } from "../../lib/rbac";
import { PLANS, ADDONS, type PlanId } from "../../lib/plans";
import { audit } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "run_rescan")) return fail("insufficient_role", 403);

  const body = (await ctx.request.json().catch(() => ({}))) as { domainId?: string };
  const limits = PLANS[workspace.plan as PlanId];

  const domain = await one<{ id: string; hostname: string }>(
    e.DB,
    `SELECT id, hostname FROM domains WHERE id = ? AND workspace_id = ?`,
    body.domainId ?? "",
    workspace.workspaceId
  );
  if (!domain) return fail("not_found", 404);

  if (limits.refresh !== "daily+on_demand") {
    return json(
      { error: "on_demand_not_included", hint: `On-demand rescans come with Scale, or ${ADDONS.rescanPack.label} for $${ADDONS.rescanPack.price}.` },
      402
    );
  }

  const period = new Date().toISOString().slice(0, 7);
  const counter = await one<{ used: number; included: number }>(
    e.DB,
    `SELECT used, included FROM usage_counters WHERE workspace_id = ? AND period = ? AND metric = 'rescans'`,
    workspace.workspaceId,
    period
  );
  if (counter && counter.used >= counter.included) {
    return json({ error: "out_of_rescans", hint: `${ADDONS.rescanPack.label} is $${ADDONS.rescanPack.price}.` }, 402);
  }

  // One in-flight scan per domain: a second queue would double-count runs.
  const inFlight = await one<{ id: string }>(
    e.DB,
    `SELECT id FROM scans WHERE domain_id = ? AND status IN ('queued','running') LIMIT 1`,
    domain.id
  );
  if (inFlight) return json({ error: "already_running", scanId: inFlight.id }, 409);

  const queries = await all<{ id: string }>(
    e.DB,
    `SELECT q.id FROM queries q JOIN query_sets s ON s.id = q.query_set_id
      WHERE s.domain_id = ? AND q.active = 1`,
    domain.id
  );
  if (!queries.length) return fail("no_active_queries", 422);

  const engines = limits.engines === "all"
    ? ["chatgpt", "perplexity", "gemini", "google_aio"]
    : ["chatgpt", "perplexity", "gemini", "google_aio"].slice(0, limits.engines as number);

  const scanId = id("scn");
  await e.DB.batch([
    e.DB.prepare(
      `INSERT INTO scans (id, domain_id, workspace_id, kind, status, engines, runs_per_engine, queries_total, queries_done, created_at)
       VALUES (?, ?, ?, 'on_demand', 'queued', ?, 3, ?, 0, ?)`
    ).bind(scanId, domain.id, workspace.workspaceId, JSON.stringify(engines), queries.length, now()),
    ...queries.flatMap((q) =>
      engines.map((engine) =>
        e.DB.prepare(
          `INSERT INTO scan_jobs (scan_id, query_id, engine, status, created_at) VALUES (?, ?, ?, 'pending', ?)`
        ).bind(scanId, q.id, engine, now())
      )
    ),
    e.DB.prepare(
      `INSERT INTO usage_counters (workspace_id, period, metric, used, included)
       VALUES (?, ?, 'rescans', 1, ?)
       ON CONFLICT (workspace_id, period, metric) DO UPDATE SET used = usage_counters.used + 1`
    ).bind(workspace.workspaceId, period, 10)
  ]);

  await audit(e, workspace.workspaceId, user.id, "scan.queued", domain.hostname, { scanId, engines });

  return json({ ok: true, scanId, queriesTotal: queries.length, enginesCount: engines.length });
};
