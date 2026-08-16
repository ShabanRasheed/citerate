/** Approve or decline a join request from someone at the same domain. */
import type { APIRoute } from "astro";
import { env, now, one, fail } from "../../../../lib/db";
import { can, type Role } from "../../../../lib/rbac";
import { audit } from "../../../../lib/auth";
import { send as sendEmail } from "../../../../lib/email";
import { joinApprovedEmail } from "../../../../lib/app-emails";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const actor = ctx.locals.user;
  if (!workspace || !actor) return fail("unauthorised", 401);
  if (!can(workspace.role, "invite")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const action = String(form.get("action") ?? "decline");
  const role = (String(form.get("role") ?? "viewer") as Role) ?? "viewer";

  const request = await one<{ id: string; user_id: string; hostname: string; email: string }>(
    e.DB,
    `SELECT j.id, j.user_id, j.hostname, u.email FROM join_requests j JOIN users u ON u.id = j.user_id
      WHERE j.id = ? AND j.workspace_id = ? AND j.status = 'pending'`,
    ctx.params.id!,
    workspace.workspaceId
  );
  if (!request) return fail("not_found", 404);

  if (action === "approve") {
    await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`
      ).bind(workspace.workspaceId, request.user_id, ["viewer", "editor"].includes(role) ? role : "viewer", now()),
      e.DB.prepare(`UPDATE join_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?`)
        .bind(actor.id, now(), request.id)
    ]);
    await sendEmail(e, {
      to: request.email,
      ...joinApprovedEmail(workspace.name, request.hostname, e.PUBLIC_APP_URL)
    }).catch(() => false);
    await audit(e, workspace.workspaceId, actor.id, "join_request.approved", request.email, { role });
  } else {
    await e.DB.prepare(`UPDATE join_requests SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ?`)
      .bind(actor.id, now(), request.id)
      .run();
    await audit(e, workspace.workspaceId, actor.id, "join_request.declined", request.email);
  }

  return ctx.redirect("/settings/team", 303);
};
