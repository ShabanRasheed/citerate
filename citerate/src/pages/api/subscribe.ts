/** POST /api/subscribe — newsletter + API beta list. One table, a source column. */
export const prerender = false;

import type { APIContext } from "astro";
import { env, now, run, fail } from "../../lib/db";
import { rateLimit, clientIp } from "../../lib/guard";

const SOURCES = new Set(["blog", "changelog", "api_beta"]);

export async function POST(ctx: APIContext): Promise<Response> {
  const e = env(ctx);
  const form = await ctx.request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const source = String(form.get("source") ?? "blog");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a valid email.", 422);
  if (!SOURCES.has(source)) return fail("Unknown source.", 422);

  const limit = await rateLimit(e, `sub:${clientIp(ctx.request) ?? "unknown"}`, 10, 3600);
  if (!limit.ok) return fail("Too many attempts. Try again shortly.", 429);

  await run(
    e.DB,
    `INSERT INTO subscribers (email, source, created_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET source = excluded.source`,
    email,
    source,
    now()
  );

  const back = ctx.request.headers.get("referer") ?? "/blog";
  return ctx.redirect(`${back}${back.includes("?") ? "&" : "?"}subscribed=1`, 303);
}
