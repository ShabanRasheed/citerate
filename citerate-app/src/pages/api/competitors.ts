/** Add a competitor by hand. Costs nothing on the meter — it rides existing queries. */
import type { APIRoute } from "astro";
import { env, id, now, one, fail } from "../../lib/db";
import { normalizeDomain } from "../../lib/domain";
import { can } from "../../lib/rbac";
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
  const hostname = normalizeDomain(String(form.get("hostname") ?? ""));
  if (!hostname) return ctx.redirect("/competitors?error=invalid", 303);

  const owned = await one<{ id: string }>(
    e.DB,
    `SELECT id FROM domains WHERE id = ? AND workspace_id = ?`,
    domainId,
    workspace.workspaceId
  );
  if (!owned) return fail("not_found", 404);

  await e.DB.prepare(
    `INSERT INTO competitors (id, domain_id, hostname, discovered, created_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (domain_id, hostname) DO NOTHING`
  )
    .bind(id("cmp"), domainId, hostname, now())
    .run();

  await audit(e, workspace.workspaceId, user.id, "competitor.added", hostname);
  return ctx.redirect("/competitors?added=1", 303);
};
