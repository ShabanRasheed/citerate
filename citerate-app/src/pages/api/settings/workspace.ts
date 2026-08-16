/**
 * Switch workspace, or create a client workspace under an agency plan. Switching
 * is a cookie write — the middleware resolves membership on every request, so a
 * stale cookie can never grant access.
 */
import type { APIRoute } from "astro";
import { env, one, fail } from "../../../lib/db";
import { createWorkspace, audit } from "../../../lib/auth";
import { PLANS, type PlanId } from "../../../lib/plans";
import { can } from "../../../lib/rbac";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const user = ctx.locals.user;
  const current = ctx.locals.workspace;
  if (!user || !current) return fail("unauthorised", 401);

  const form = await ctx.request.formData();

  if (String(form.get("action")) === "create_child") {
    if (!can(current.role, "manage_billing")) return fail("insufficient_role", 403);
    const limits = PLANS[current.plan as PlanId];
    if (!limits.clientWorkspaces) return fail("plan_required", 402);

    const name = String(form.get("name") ?? "").trim().slice(0, 60);
    if (!name) return fail("invalid", 422);

    const childId = await createWorkspace(e, user.id, name, current.plan as PlanId);
    await e.DB.prepare(`UPDATE workspaces SET parent_id = ? WHERE id = ?`).bind(current.workspaceId, childId).run();
    await audit(e, current.workspaceId, user.id, "workspace.client_created", name);

    ctx.cookies.set("cr_ws", childId, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
    return ctx.redirect("/onboarding/domain", 303);
  }

  const target = String(form.get("workspaceId") ?? "");
  const membership = await one<{ workspace_id: string }>(
    e.DB,
    `SELECT workspace_id FROM memberships WHERE workspace_id = ? AND user_id = ?`,
    target,
    user.id
  );
  if (!membership) return fail("not_found", 404);

  ctx.cookies.set("cr_ws", target, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
  return ctx.redirect("/overview", 303);
};
