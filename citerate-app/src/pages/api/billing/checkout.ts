/**
 * Paddle checkout (Phase 10). The marketing repo's webhook
 * (`/api/billing/webhook`, HMAC-verified) is the half that attributes money;
 * this half creates the transaction and hands off to Paddle's hosted checkout.
 *
 * Price ids are config, not code: set the PADDLE_PRICE_IDS var to the JSON
 * map created once in the Paddle dashboard —
 *   {"starter":{"month":"pri_…","year":"pri_…"},"growth":{…},"scale":{…},
 *    "agency":{…},"addons":{"extra_queries":"pri_…","extra_domain":"pri_…",
 *    "rescan_pack":"pri_…","seat_growth":"pri_…"}}
 * PADDLE_ENV=sandbox routes to sandbox-api.paddle.com. A missing key or price
 * still returns a clear 501 instead of a broken redirect.
 */
import type { APIRoute } from "astro";
import type { Env } from "../../../lib/env";
import { env, fail } from "../../../lib/db";
import { can } from "../../../lib/rbac";
import { PLANS, type PlanId } from "../../../lib/plans";
import { audit } from "../../../lib/auth";

export const prerender = false;

export const paddleBase = (e: Env): string =>
  e.PADDLE_ENV === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";

type PriceMap = Partial<Record<PlanId, { month?: string; year?: string }>> & {
  addons?: Record<string, string>;
};

const priceMap = (e: Env): PriceMap => {
  try {
    return JSON.parse(e.PADDLE_PRICE_IDS ?? "{}") as PriceMap;
  } catch {
    return {};
  }
};

export const priceFor = (e: Env, plan: PlanId, interval: "month" | "year"): string | null =>
  priceMap(e)[plan]?.[interval] ?? null;

export const addonPriceFor = (e: Env, key: string): string | null =>
  priceMap(e).addons?.[key] ?? null;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "manage_billing")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const plan = String(form.get("plan") ?? "") as PlanId;
  const interval = (String(form.get("interval") ?? "month") as "month" | "year");
  if (!PLANS[plan]) return fail("unknown_plan", 422);
  if (PLANS[plan].monthly === null) return ctx.redirect(`${e.PUBLIC_SITE_URL}/contact?intent=sales`, 303);

  const price = priceFor(e, plan, interval);
  if (!e.PADDLE_API_KEY || !price) {
    await audit(e, workspace.workspaceId, user.id, "billing.checkout_unconfigured", plan);
    return fail("billing_not_configured", 501, {
      hint: "Set the PADDLE_API_KEY secret and the PADDLE_PRICE_IDS var (JSON map — format in api/billing/checkout.ts)."
    });
  }

  const res = await fetch(`${paddleBase(e)}/transactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${e.PADDLE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ price_id: price, quantity: 1 }],
      custom_data: { workspace_id: workspace.workspaceId, plan },
      checkout: { url: `${e.PUBLIC_APP_URL}/settings/billing?checkout=done` }
    })
  });

  if (!res.ok) return fail("paddle_error", 502);
  const data = (await res.json()) as { data?: { checkout?: { url?: string } } };
  const url = data.data?.checkout?.url;
  if (!url) return fail("paddle_no_checkout_url", 502);

  await audit(e, workspace.workspaceId, user.id, "billing.checkout_started", plan, { interval });
  return ctx.redirect(url, 303);
};
