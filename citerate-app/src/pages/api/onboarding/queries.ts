/**
 * Onboarding step 2. Deactivates what the user unchecked and appends anything
 * they typed. Deactivating frees the slot immediately — the counter is rewritten
 * from the active set here, which is the one place a live count is correct.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, all, fail } from "../../../lib/db";
import { PLANS, type PlanId } from "../../../lib/plans";
import { audit } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  const domainId = String(form.get("domainId") ?? "");
  const keep = new Set(form.getAll("active").map(String));
  const extra = String(form.get("extra") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const domain = await one<{ id: string }>(
    e.DB,
    `SELECT id FROM domains WHERE id = ? AND workspace_id = ?`,
    domainId,
    workspace.workspaceId
  );
  if (!domain) return fail("not_found", 404);

  const rows = await all<{ id: string; query_set_id: string }>(
    e.DB,
    `SELECT q.id, q.query_set_id FROM queries q JOIN query_sets s ON s.id = q.query_set_id WHERE s.domain_id = ?`,
    domainId
  );
  const setId = rows[0]?.query_set_id;
  if (!setId) return fail("no_query_set", 422);

  const statements = rows.map((r) =>
    e.DB.prepare(`UPDATE queries SET active = ? WHERE id = ?`).bind(keep.has(r.id) ? 1 : 0, r.id)
  );

  for (const text of extra) {
    statements.push(
      e.DB.prepare(
        `INSERT INTO queries (id, query_set_id, text, source, active, created_at) VALUES (?, ?, ?, 'user', 1, ?)`
      ).bind(id("qry"), setId, text, now())
    );
  }

  const active = keep.size + extra.length;
  const limits = PLANS[workspace.plan as PlanId];
  statements.push(
    e.DB.prepare(
      `INSERT INTO usage_counters (workspace_id, period, metric, used, included)
       VALUES (?, ?, 'tracked_queries', ?, ?)
       ON CONFLICT (workspace_id, period, metric) DO UPDATE SET used = excluded.used`
    ).bind(workspace.workspaceId, new Date().toISOString().slice(0, 7), active, limits.trackedQueries)
  );

  // The queued scan's total has to match what will actually be measured.
  statements.push(
    e.DB.prepare(`UPDATE scans SET queries_total = ? WHERE domain_id = ? AND status = 'queued'`).bind(active, domainId)
  );

  await e.DB.batch(statements);
  await audit(e, workspace.workspaceId, user.id, "queries.reviewed", domainId, { active });

  return ctx.redirect("/onboarding/connect", 303);
};
