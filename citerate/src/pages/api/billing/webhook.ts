/**
 * POST /api/billing/webhook — Paddle notifications.
 * Paddle is merchant of record, so VAT/sales tax is handled for us at a higher
 * percentage. Signature verification is mandatory: an unverified webhook can
 * hand out a plan for free.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { env, id, now, run, one, json, fail } from "../../../lib/db";

async function verify(secret: string, signatureHeader: string, raw: string): Promise<boolean> {
  // Paddle sends: ts=<unix>;h1=<hex hmac of `${ts}:${raw}`>
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => p.split("=") as [string, string])
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${raw}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // constant-time compare
  if (expected.length !== h1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ h1.charCodeAt(i);
  return diff === 0;
}

const PLAN_BY_PRICE: Record<string, string> = {
  // Fill with Paddle price ids once the catalogue exists.
  pri_starter_month: "starter",
  pri_starter_year: "starter",
  pri_growth_month: "growth",
  pri_growth_year: "growth",
  pri_scale_month: "scale",
  pri_scale_year: "scale",
  pri_agency_year: "agency"
};

export async function POST(ctx: APIContext): Promise<Response> {
  const e = env(ctx);
  if (!e.PADDLE_WEBHOOK_SECRET) return fail("Billing not configured", 503);

  const raw = await ctx.request.text();
  const signature = ctx.request.headers.get("paddle-signature") ?? "";
  if (!(await verify(e.PADDLE_WEBHOOK_SECRET, signature, raw))) {
    return fail("Invalid signature", 401);
  }

  const event = JSON.parse(raw) as {
    event_type: string;
    data: {
      id: string;
      status?: string;
      custom_data?: { workspace_id?: string };
      items?: { price?: { id?: string }; billing_cycle?: { interval?: string } }[];
      current_billing_period?: { ends_at?: string };
    };
  };

  const workspaceId = event.data.custom_data?.workspace_id;
  if (!workspaceId) return json({ ignored: true, reason: "no workspace_id in custom_data" });

  const priceId = event.data.items?.[0]?.price?.id ?? "";
  const plan = PLAN_BY_PRICE[priceId] ?? "starter";
  const interval = event.data.items?.[0]?.billing_cycle?.interval === "year" ? "year" : "month";
  const periodEnd = event.data.current_billing_period?.ends_at
    ? Math.floor(new Date(event.data.current_billing_period.ends_at).getTime() / 1000)
    : null;
  const ts = now();

  switch (event.event_type) {
    case "subscription.created":
    case "subscription.updated":
    case "subscription.resumed": {
      const existing = await one<{ id: string }>(
        e.DB,
        `SELECT id FROM subscriptions WHERE provider_id = ?`,
        event.data.id
      );
      if (existing) {
        await run(
          e.DB,
          `UPDATE subscriptions SET plan = ?, interval = ?, status = ?, current_period_end = ?, updated_at = ?
            WHERE id = ?`,
          plan,
          interval,
          event.data.status ?? "active",
          periodEnd,
          ts,
          existing.id
        );
      } else {
        await run(
          e.DB,
          `INSERT INTO subscriptions (id, workspace_id, provider, provider_id, plan, interval, status,
                                      current_period_end, created_at, updated_at)
           VALUES (?, ?, 'paddle', ?, ?, ?, ?, ?, ?, ?)`,
          id("sub"),
          workspaceId,
          event.data.id,
          plan,
          interval,
          event.data.status ?? "active",
          periodEnd,
          ts,
          ts
        );
      }
      await run(e.DB, `UPDATE workspaces SET plan = ? WHERE id = ?`, plan, workspaceId);
      break;
    }

    case "subscription.canceled":
    case "subscription.paused": {
      await run(
        e.DB,
        `UPDATE subscriptions SET status = ?, updated_at = ? WHERE provider_id = ?`,
        event.data.status ?? "cancelled",
        ts,
        event.data.id
      );
      // Downgrade at period end, not immediately — history stays exportable.
      break;
    }
  }

  await run(
    e.DB,
    `INSERT INTO audit_log (workspace_id, actor_user_id, action, target, meta, ip, created_at)
     VALUES (?, NULL, ?, ?, ?, NULL, ?)`,
    workspaceId,
    `billing.${event.event_type}`,
    event.data.id,
    JSON.stringify({ plan, interval }),
    ts
  );

  return json({ ok: true });
}
