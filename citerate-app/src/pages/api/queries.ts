/**
 * Add tracked queries. Over the plan limit does not fail — it adds the queries
 * and records the overage block, which is what the pricing page promises.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, json, fail } from "../../lib/db";
import { can } from "../../lib/rbac";
import { PLANS, OVERAGE_BLOCK, type PlanId } from "../../lib/plans";
import { audit } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "edit_queries")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const domainId = String(form.get("domainId") ?? "");
  const lines = String(form.get("queries") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500);

  if (!domainId || !lines.length) return fail("nothing_to_add", 422);

  const domain = await one<{ id: string }>(
    e.DB,
    `SELECT id FROM domains WHERE id = ? AND workspace_id = ?`,
    domainId,
    workspace.workspaceId
  );
  if (!domain) return fail("not_found", 404);

  let set = await one<{ id: string }>(e.DB, `SELECT id FROM query_sets WHERE domain_id = ? LIMIT 1`, domainId);
  if (!set) {
    const setId = id("qst");
    await e.DB.prepare(`INSERT INTO query_sets (id, domain_id, name, created_at) VALUES (?, ?, 'Default set', ?)`)
      .bind(setId, domainId, now())
      .run();
    set = { id: setId };
  }

  await e.DB.batch(
    lines.map((text) =>
      e.DB.prepare(
        `INSERT INTO queries (id, query_set_id, text, source, active, created_at) VALUES (?, ?, ?, 'user', 1, ?)`
      ).bind(id("qry"), set!.id, text, now())
    )
  );

  // Counters, not a live count — the same rule gating reads by.
  const period = new Date().toISOString().slice(0, 7);
  const limits = PLANS[workspace.plan as PlanId];
  await e.DB.prepare(
    `INSERT INTO usage_counters (workspace_id, period, metric, used, included, overage_units)
     VALUES (?, ?, 'tracked_queries', ?, ?, 0)
     ON CONFLICT (workspace_id, period, metric) DO UPDATE SET
       used = usage_counters.used + ?,
       overage_units = MAX(0, (usage_counters.used + ? - usage_counters.included + ${OVERAGE_BLOCK.queries - 1}) / ${OVERAGE_BLOCK.queries})`
  )
    .bind(workspace.workspaceId, period, lines.length, limits.trackedQueries, lines.length, lines.length)
    .run();

  await audit(e, workspace.workspaceId, user.id, "queries.added", domainId, { count: lines.length });

  const wantsJson = ctx.request.headers.get("accept")?.includes("application/json");
  return wantsJson ? json({ ok: true, added: lines.length }) : ctx.redirect("/queries?added=1", 303);
};
