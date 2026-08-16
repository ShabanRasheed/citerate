/** Change a member's role, or remove them. The owner row is untouchable here. */
import type { APIRoute } from "astro";
import { env, now, one, fail } from "../../../lib/db";
import { can, type Role } from "../../../lib/rbac";
import { audit } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const actor = ctx.locals.user;
  if (!workspace || !actor) return fail("unauthorised", 401);
  if (!can(workspace.role, "invite")) return fail("insufficient_role", 403);

  const targetId = ctx.params.userId!;
  const form = await ctx.request.formData();
  const action = String(form.get("action") ?? "role");

  const membership = await one<{ role: Role }>(
    e.DB,
    `SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`,
    workspace.workspaceId,
    targetId
  );
  if (!membership) return fail("not_found", 404);
  if (membership.role === "owner") return fail("owner_immutable", 422);

  if (action === "remove") {
    await e.DB.prepare(`DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?`)
      .bind(workspace.workspaceId, targetId)
      .run();
    await audit(e, workspace.workspaceId, actor.id, "member.removed", targetId);
    return ctx.redirect("/settings/team?removed=1", 303);
  }

  const role = String(form.get("role") ?? "") as Role;
  if (!["admin", "editor", "viewer", "client"].includes(role)) return fail("invalid_role", 422);

  await e.DB.prepare(`UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?`)
    .bind(role, workspace.workspaceId, targetId)
    .run();
  await audit(e, workspace.workspaceId, actor.id, "member.role_changed", targetId, { role, at: now() });

  return ctx.redirect("/settings/team?updated=1", 303);
};
