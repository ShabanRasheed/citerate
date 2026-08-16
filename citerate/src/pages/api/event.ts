/**
 * POST /api/event — named CTA events from lib/analytics.ts (sendBeacon).
 * Cloudflare Web Analytics has no custom-event API, so events land here and go
 * to the audit log. Swap the body when you adopt product analytics.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { env, now, run } from "../../lib/db";
import { clientIp } from "../../lib/guard";

export async function POST(ctx: APIContext): Promise<Response> {
  try {
    const e = env(ctx);
    const body = (await ctx.request.json()) as {
      name?: string;
      props?: Record<string, unknown>;
      path?: string;
    };
    if (!body.name) return new Response(null, { status: 204 });

    await run(
      e.DB,
      `INSERT INTO audit_log (workspace_id, actor_user_id, action, target, meta, ip, created_at)
       VALUES (NULL, NULL, ?, ?, ?, ?, ?)`,
      `site.${body.name}`,
      body.path ?? null,
      JSON.stringify(body.props ?? {}),
      clientIp(ctx.request),
      now()
    );
  } catch {
    /* analytics must never break a page */
  }
  return new Response(null, { status: 204 });
}
