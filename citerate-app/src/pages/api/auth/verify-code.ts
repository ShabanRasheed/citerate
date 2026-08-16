/**
 * Typed-code path. Same token row as the link, so a user who clicks the link
 * after typing the code gets "already used" rather than two sessions.
 */
import type { APIRoute } from "astro";
import { env, all, now } from "../../../lib/db";
import { consumeToken, upsertUser, createWorkspace, workspacesFor, audit } from "../../../lib/auth";
import { createSession, setSessionCookie, clientIp, deviceLabel } from "../../../lib/session";
import { sha256 } from "../../../lib/db";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const form = await ctx.request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/overview");
  const code = [0, 1, 2, 3, 4, 5].map((i) => String(form.get(`d${i}`) ?? "")).join("");

  if (code.length !== 6) {
    return ctx.redirect(`/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}&error=code`, 302);
  }

  // We hold hash(secret:code), so the code alone needs its candidate rows.
  const candidates = await all<{ id: string; token_hash: string; user_id: string | null }>(
    e.DB,
    `SELECT id, token_hash, user_id FROM auth_tokens
      WHERE email = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 5`,
    email,
    now()
  );

  let matched: { secret: string } | null = null;
  for (const row of candidates) {
    // The code is the tail of the stored pair; we re-derive with the stored id's
    // secret half kept in KV for exactly this reason.
    const secret = await e.SCAN_CACHE.get(`otp:${row.id}`);
    if (!secret) continue;
    if ((await sha256(`${secret}:${code}`)) === row.token_hash) { matched = { secret }; break; }
  }

  if (!matched) {
    return ctx.redirect(`/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}&error=code`, 302);
  }

  const token = await consumeToken(e, matched.secret, code);
  if (!token) {
    return ctx.redirect(`/sign-in?error=expired`, 302);
  }

  const { userId, created } = await upsertUser(e, token.email);
  const spaces = await workspacesFor(e, userId);
  const workspaceId = spaces[0]?.id ?? (await createWorkspace(e, userId, token.email.split("@")[1] ?? "My workspace"));

  const session = await createSession(e, userId, {
    ip: clientIp(ctx),
    userAgent: ctx.request.headers.get("user-agent"),
    deviceLabel: deviceLabel(ctx.request.headers.get("user-agent"))
  });
  setSessionCookie(ctx.cookies, session.value, session.maxAge);
  ctx.cookies.set("cr_ws", workspaceId, { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: session.maxAge });
  await audit(e, workspaceId, userId, created ? "user.created" : "user.signed_in", "otp", null, clientIp(ctx));

  return ctx.redirect(next.startsWith("/") ? next : "/overview", 302);
};
