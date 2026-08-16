/**
 * Request a magic link. Deliberately indistinguishable for known and unknown
 * emails: the response is always "check your email", and the rate limit is per
 * email and per IP so this cannot be used to enumerate accounts.
 */
import type { APIRoute } from "astro";
import { env, fail } from "../../../lib/db";
import { issueToken } from "../../../lib/auth";
import { send as sendEmail } from "../../../lib/email";
import { signInEmail } from "../../../lib/app-emails";

export const prerender = false;

const LIMIT_PER_HOUR = 5;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const form = await ctx.request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/overview");
  const claim = form.get("claim") ? String(form.get("claim")) : null;
  const trust = form.get("trust") === "1";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return ctx.redirect("/sign-in?error=invalid", 302);
  }

  const ip = ctx.request.headers.get("cf-connecting-ip") ?? "unknown";
  for (const key of [`auth:${email}`, `auth-ip:${ip}`]) {
    const used = Number((await e.RATE_LIMIT.get(key)) ?? 0);
    if (used >= LIMIT_PER_HOUR) {
      // Still a neutral response — a rate limit must not confirm an address.
      return ctx.redirect(`/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`, 302);
    }
    await e.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: 3600 });
  }

  const { secret, code } = await issueToken(e, email, "magic_link");
  const appUrl = e.PUBLIC_APP_URL || new URL(ctx.request.url).origin;
  const params = new URLSearchParams({ t: secret, c: code, next });
  if (trust) params.set("trust", "1");
  if (claim) params.set("claim", claim);
  const link = `${appUrl}/verify?${params.toString()}`;

  const sent = await sendEmail(e, { to: email, ...signInEmail(code, link) }).catch(() => false);

  if (!sent) console.log(`[auth] magic link for ${email}: ${link}`);

  const dev = sent ? "" : "&dev=1";
  return ctx.redirect(`/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}${dev}`, 302);
};

export const GET: APIRoute = () => fail("method_not_allowed", 405);
