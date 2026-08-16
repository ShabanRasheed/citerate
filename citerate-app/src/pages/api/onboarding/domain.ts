/**
 * Onboarding step 1. Creates the domain, seeds the query set, and queues the
 * first scan. If the hostname belongs to another workspace we file a join
 * request instead — the same rule the claim flow uses.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, fail } from "../../../lib/db";
import { normalizeDomain } from "../../../lib/domain";
import { requestJoin, createWorkspace, audit } from "../../../lib/auth";
import { PLANS, type PlanId } from "../../../lib/plans";
import { generateQueries } from "../../../lib/query-generator";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const user = ctx.locals.user;
  if (!user) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  const raw = String(form.get("hostname") ?? "");
  const hostname = normalizeDomain(raw);
  const workspaceName = String(form.get("workspaceName") ?? "").trim();
  if (!hostname) return ctx.redirect("/onboarding/domain?error=invalid", 302);

  let workspaceId = ctx.locals.workspace?.workspaceId ?? null;
  if (!workspaceId) workspaceId = await createWorkspace(e, user.id, workspaceName || hostname);
  else if (workspaceName) {
    await e.DB.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).bind(workspaceName, workspaceId).run();
  }

  // Taken by someone else → join request, never a duplicate measurement.
  const owned = await one<{ workspace_id: string | null }>(
    e.DB,
    `SELECT workspace_id FROM domains WHERE hostname = ? AND workspace_id IS NOT NULL LIMIT 1`,
    hostname
  );
  if (owned && owned.workspace_id !== workspaceId) {
    await requestJoin(e, hostname, user.id);
    return ctx.redirect("/onboarding/domain?error=taken", 302);
  }

  // Reuse an anonymous free-scan domain row if one exists for this hostname.
  const anonymous = await one<{ id: string }>(
    e.DB,
    `SELECT id FROM domains WHERE hostname = ? AND workspace_id IS NULL LIMIT 1`,
    hostname
  );

  const domainId = anonymous?.id ?? id("dom");
  const limits = PLANS[(ctx.locals.workspace?.plan ?? "free") as PlanId];
  const engines = limits.engines === "all" ? ["chatgpt", "perplexity", "gemini", "google_aio"] : ["chatgpt", "perplexity", "gemini", "google_aio"].slice(0, limits.engines as number);

  const statements = [];
  if (anonymous) {
    statements.push(e.DB.prepare(`UPDATE domains SET workspace_id = ? WHERE id = ?`).bind(workspaceId, domainId));
  } else {
    statements.push(
      e.DB.prepare(`INSERT INTO domains (id, workspace_id, hostname, created_at) VALUES (?, ?, ?, ?)`)
        .bind(domainId, workspaceId, hostname, now())
    );
  }

  // Generate the query set: crawl + category blend, each row labelled with its
  // source. Search Console queries join later, via the GSC OAuth callback.
  const setId = id("qst");
  statements.push(
    e.DB.prepare(`INSERT INTO query_sets (id, domain_id, name, created_at) VALUES (?, ?, 'Generated set', ?)`)
      .bind(setId, domainId, now())
  );

  const seeded = await generateQueries(hostname, limits.trackedQueries);
  for (const q of seeded) {
    statements.push(
      e.DB.prepare(
        `INSERT INTO queries (id, query_set_id, text, intent, cluster, source, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
      ).bind(id("qry"), setId, q.text, q.intent, q.cluster, q.source, now())
    );
  }

  const scanId = id("scn");
  statements.push(
    e.DB.prepare(
      `INSERT INTO scans (id, domain_id, workspace_id, kind, status, engines, runs_per_engine, queries_total, queries_done, created_at)
       VALUES (?, ?, ?, 'scheduled', 'queued', ?, 3, ?, 0, ?)`
    ).bind(scanId, domainId, workspaceId, JSON.stringify(engines), seeded.length, now())
  );

  statements.push(
    e.DB.prepare(
      `INSERT INTO usage_counters (workspace_id, period, metric, used, included)
       VALUES (?, ?, 'tracked_queries', ?, ?)
       ON CONFLICT (workspace_id, period, metric) DO UPDATE SET used = excluded.used, included = excluded.included`
    ).bind(workspaceId, new Date().toISOString().slice(0, 7), seeded.length, limits.trackedQueries)
  );

  await e.DB.batch(statements);
  await audit(e, workspaceId, user.id, "domain.added", hostname, { seeded: seeded.length });

  ctx.cookies.set("cr_ws", workspaceId, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
  return ctx.redirect(`/onboarding/queries?domain=${domainId}`, 303);
};
