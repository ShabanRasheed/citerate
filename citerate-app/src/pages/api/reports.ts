/**
 * Generate a report snapshot. The payload is written once from the rollups as
 * they read today; the PDF is rendered from /reports/<id> by the print path.
 * Nothing here recomputes history — a snapshot is the record, not a view.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, fail } from "../../lib/db";
import { headline, engineBreakdown, fixQueue } from "../../lib/data";
import { METHOD_VERSION } from "../../lib/scoring";
import { can } from "../../lib/rbac";
import { PLANS, type PlanId } from "../../lib/plans";
import { audit } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "export")) return fail("insufficient_role", 403);
  if (!PLANS[workspace.plan as PlanId].pdfReports) return fail("plan_required", 402);

  const form = await ctx.request.formData();
  const domainId = String(form.get("domainId") ?? "");
  const period = String(form.get("period") ?? new Date().toISOString().slice(0, 7));

  const domain = await one<{ id: string; hostname: string }>(
    e.DB,
    `SELECT id, hostname FROM domains WHERE id = ? AND workspace_id = ?`,
    domainId,
    workspace.workspaceId
  );
  if (!domain) return fail("not_found", 404);

  const [head, engines, fixes] = await Promise.all([
    headline(e, domain.id),
    engineBreakdown(e, domain.id),
    fixQueue(e, domain.id)
  ]);

  const payload = {
    rate: head.rate ?? 0,
    previousRate: head.previousRate,
    withinNoise: head.withinNoise,
    runs: head.runs,
    causes: head.causes,
    engines: engines.map((x) => ({ engine: x.engine, citation_rate: x.citation_rate, runs: x.runs })),
    fixes: fixes
      .filter((f) => f.state === "verified" || f.state === "shipped")
      .map((f) => ({ title: f.title, state: f.state ?? "open", baseline_rate: f.baseline_rate, verified_rate: f.verified_rate })),
    coverage: head.runs === 0 ? "No completed scan in this period." : null
  };

  const reportId = id("rpt");
  await e.DB.prepare(
    `INSERT INTO report_snapshots (id, workspace_id, domain_id, period, kind, method_version, payload, created_by, created_at)
     VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?, ?)
     ON CONFLICT (domain_id, period, kind) DO NOTHING`
  )
    .bind(reportId, workspace.workspaceId, domain.id, period, METHOD_VERSION, JSON.stringify(payload), user.id, now())
    .run();

  await audit(e, workspace.workspaceId, user.id, "report.generated", `${domain.hostname} ${period}`);

  return ctx.redirect(`/reports/${reportId}`, 303);
};
