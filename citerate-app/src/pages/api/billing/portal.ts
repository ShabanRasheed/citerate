/**
 * Paddle customer portal. Paddle mints a short-lived portal URL per customer;
 * we store the provider id on the subscription row. Unconfigured billing
 * returns to the billing pane with a readable reason instead of erroring.
 */
import type { APIRoute } from "astro";
import { env, one, fail } from "../../../lib/db";
import { can } from "../../../lib/rbac";
import { paddleBase } from "./checkout";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  if (!workspace) return fail("unauthorised", 401);
  if (!can(workspace.role, "manage_billing")) return fail("insufficient_role", 403);

  const subscription = await one<{ provider_id: string | null }>(
    e.DB,
    `SELECT provider_id FROM subscriptions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1`,
    workspace.workspaceId
  );

  if (!e.PADDLE_API_KEY || !subscription?.provider_id) {
    return ctx.redirect("/settings/billing?portal=unavailable", 303);
  }

  const res = await fetch(
    `${paddleBase(e)}/customers/${subscription.provider_id}/portal-sessions`,
    { method: "POST", headers: { authorization: `Bearer ${e.PADDLE_API_KEY}` } }
  );
  if (!res.ok) return ctx.redirect("/settings/billing?portal=error", 303);

  const data = (await res.json()) as { data?: { urls?: { general?: { overview?: string } } } };
  const url = data.data?.urls?.general?.overview;
  return url ? ctx.redirect(url, 303) : ctx.redirect("/settings/billing?portal=error", 303);
};
