/**
 * Send a seat invite. Client seats are free and never counted, so the seat check
 * skips them — that rule is what makes "share the dashboard" safe for agencies.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, sha256, fail } from "../../../lib/db";
import { can, type Role } from "../../../lib/rbac";
import { PLANS, ADDONS, type PlanId } from "../../../lib/plans";
import { audit } from "../../../lib/auth";
import { send as sendEmail } from "../../../lib/email";
import { inviteEmail } from "../../../lib/app-emails";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "invite")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = String(form.get("role") ?? "editor") as Role;
  if (!email || !["admin", "editor", "viewer", "client"].includes(role)) return fail("invalid", 422);

  const limits = PLANS[workspace.plan as PlanId];

  if (role !== "client" && limits.seats !== "unlimited") {
    const used = await one<{ n: number }>(
      e.DB,
      `SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role != 'client'`,
      workspace.workspaceId
    );
    if ((used?.n ?? 0) >= limits.seats) {
      return ctx.redirect(`/settings/team?error=seats&price=${ADDONS.seatGrowth.price}`, 303);
    }
  }

  const secret = crypto.randomUUID().replace(/-/g, "");
  await e.DB.prepare(
    `INSERT INTO invites (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id("inv"), workspace.workspaceId, email, role, await sha256(secret), user.id, now(), now() + 7 * 86_400)
    .run();

  const appUrl = e.PUBLIC_APP_URL || new URL(ctx.request.url).origin;
  const link = `${appUrl}/invite/${secret}`;

  const sent = await sendEmail(e, {
    to: email,
    ...inviteEmail(user.name ?? user.email, workspace.name, role, link)
  }).catch(() => false);

  if (!sent) console.log(`[invite] ${email}: ${link}`);
  await audit(e, workspace.workspaceId, user.id, "invite.sent", email, { role });

  return ctx.redirect("/settings/team?invited=1", 303);
};
