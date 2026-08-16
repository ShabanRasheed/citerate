/** Resend or revoke a pending invite. */
import type { APIRoute } from "astro";
import { env, now, one, sha256, fail } from "../../../../lib/db";
import { can } from "../../../../lib/rbac";
import { send as sendEmail } from "../../../../lib/email";
import { inviteEmail } from "../../../../lib/app-emails";
import { audit } from "../../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "invite")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const action = String(form.get("action") ?? "revoke");

  const invite = await one<{ id: string; email: string; role: string }>(
    e.DB,
    `SELECT id, email, role FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    ctx.params.id!,
    workspace.workspaceId
  );
  if (!invite) return fail("not_found", 404);

  if (action === "revoke") {
    await e.DB.prepare(`UPDATE invites SET revoked_at = ? WHERE id = ?`).bind(now(), invite.id).run();
    await audit(e, workspace.workspaceId, user.id, "invite.revoked", invite.email);
    return ctx.redirect("/settings/team?revoked=1", 303);
  }

  // Resend rotates the token: an email forwarded by mistake stops working.
  const secret = crypto.randomUUID().replace(/-/g, "");
  await e.DB.prepare(`UPDATE invites SET token_hash = ?, created_at = ?, expires_at = ? WHERE id = ?`)
    .bind(await sha256(secret), now(), now() + 7 * 86_400, invite.id)
    .run();

  const link = `${e.PUBLIC_APP_URL}/invite/${secret}`;
  const sent = await sendEmail(e, {
    to: invite.email,
    ...inviteEmail(user.name ?? user.email, workspace.name, invite.role, link)
  }).catch(() => false);
  if (!sent) console.log(`[invite:resend] ${invite.email}: ${link}`);

  await audit(e, workspace.workspaceId, user.id, "invite.resent", invite.email);
  return ctx.redirect("/settings/team?resent=1", 303);
};
