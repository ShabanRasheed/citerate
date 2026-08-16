/**
 * POST /api/claim — attach an email to a free scan so the result is kept.
 * Creates the user row if needed; the magic-link auth flow (Phase 3b) takes it
 * from there.
 */
export const prerender = false;

import type { APIContext } from "astro";
import { env, id, now, one, run, fail } from "../../lib/db";
import { rateLimit, clientIp } from "../../lib/guard";
import { send, scanReadyEmail } from "../../lib/email";

export async function POST(ctx: APIContext): Promise<Response> {
  const e = env(ctx);
  const form = await ctx.request.formData();
  const token = String(form.get("token") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();

  if (!token || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail("A valid email and scan token are required.", 422);
  }

  const limit = await rateLimit(e, `claim:${clientIp(ctx.request) ?? "unknown"}`, 10, 3600);
  if (!limit.ok) return fail("Too many attempts. Try again shortly.", 429);

  const scan = await one<{ id: string; hostname: string; citation_rate: number | null }>(
    e.DB,
    `SELECT s.id, d.hostname, s.citation_rate FROM scans s JOIN domains d ON d.id = s.domain_id
      WHERE s.share_token = ?`,
    token
  );
  if (!scan) return fail("That scan link is no longer valid.", 404);

  let user = await one<{ id: string }>(e.DB, `SELECT id FROM users WHERE email = ?`, email);
  if (!user) {
    const userId = id("usr");
    await run(e.DB, `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`, userId, email, now());
    user = { id: userId };
  }

  await run(e.DB, `UPDATE scans SET claimed_by = ? WHERE id = ?`, user.id, scan.id);

  await send(e, {
    to: email,
    subject: `${scan.hostname}: ${Math.round((scan.citation_rate ?? 0) * 100)}% citation rate`,
    html: scanReadyEmail(e.PUBLIC_SITE_URL, scan.hostname, token, scan.citation_rate ?? 0)
  });

  return ctx.redirect(`/scan/${token}?claimed=1`, 303);
}
