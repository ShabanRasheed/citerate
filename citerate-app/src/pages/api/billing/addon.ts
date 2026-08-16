/**
 * Add-on purchase. Add-ons buy volume only — they raise a counter's `included`,
 * they never unlock a feature. With Paddle configured the charge goes through
 * hosted checkout and the webhook (marketing repo) raises the counter on
 * payment; unconfigured (dev) the raise happens locally so the pane stays
 * honest about what it recorded.
 */
import type { APIRoute } from "astro";
import { env, fail } from "../../../lib/db";
import { can } from "../../../lib/rbac";
import { ADDONS } from "../../../lib/plans";
import { audit } from "../../../lib/auth";
import { addonPriceFor, paddleBase } from "./checkout";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "manage_billing")) return fail("insufficient_role", 403);

  const form = await ctx.request.formData();
  const label = String(form.get("addon") ?? "");
  const addon = Object.values(ADDONS).find((a) => a.label === label);
  if (!addon) return fail("unknown_addon", 422);

  const addonKey =
    addon === ADDONS.extraQueries ? "extra_queries"
    : addon === ADDONS.extraDomain ? "extra_domain"
    : addon === ADDONS.rescanPack ? "rescan_pack"
    : "seat_growth";

  // Paddle configured → hosted checkout. The counter is raised by the webhook
  // on payment, never here — a closed tab must not grant volume.
  const price = addonPriceFor(e, addonKey);
  if (e.PADDLE_API_KEY && price) {
    const res = await fetch(`${paddleBase(e)}/transactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${e.PADDLE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ price_id: price, quantity: 1 }],
        custom_data: { workspace_id: workspace.workspaceId, addon: addonKey },
        checkout: { url: `${e.PUBLIC_APP_URL}/settings/billing?addon=paid` }
      })
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: { checkout?: { url?: string } } };
      const url = data.data?.checkout?.url;
      if (url) {
        await audit(e, workspace.workspaceId, user.id, "billing.addon_checkout", addon.label, { price: addon.price });
        return ctx.redirect(url, 303);
      }
    }
    return fail("paddle_error", 502);
  }

  // Unconfigured (dev): record locally so the meter moves and the pane is honest.
  const period = new Date().toISOString().slice(0, 7);
  const metric =
    addon === ADDONS.extraQueries ? "tracked_queries"
    : addon === ADDONS.extraDomain ? "domains"
    : addon === ADDONS.rescanPack ? "rescans"
    : addon === ADDONS.seatGrowth ? "seats"
    : null;

  if (metric) {
    await e.DB.prepare(
      `INSERT INTO usage_counters (workspace_id, period, metric, used, included)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT (workspace_id, period, metric) DO UPDATE SET included = usage_counters.included + ?`
    )
      .bind(workspace.workspaceId, period, metric, addon.unit, addon.unit)
      .run();
  }

  await audit(e, workspace.workspaceId, user.id, "billing.addon_added", addon.label, { price: addon.price });
  return ctx.redirect("/settings/billing?addon=1", 303);
};
