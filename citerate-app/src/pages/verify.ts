/**
 * Magic-link landing. Consumes the token, creates the session, and sends the
 * user where they were going. Any failure lands back on /sign-in with a reason
 * rather than a stack trace.
 */
import type { APIRoute } from "astro";
import { env } from "../lib/db";
import { consumeToken, upsertUser, createWorkspace, claimScan, audit } from "../lib/auth";
import { createSession, setSessionCookie, clientIp, deviceLabel } from "../lib/session";
import { workspacesFor } from "../lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const url = new URL(ctx.request.url);
  const secret = url.searchParams.get("t") ?? "";
  const code = url.searchParams.get("c") ?? "";
  const next = url.searchParams.get("next") ?? "/overview";
  const trust = url.searchParams.get("trust") === "1";
  const claim = url.searchParams.get("claim");

  if (!secret || !code) return ctx.redirect("/sign-in?error=invalid", 302);

  const token = await consumeToken(e, secret, code);
  if (!token) return ctx.redirect("/sign-in?error=expired", 302);

  const { userId, created } = await upsertUser(e, token.email);

  // A brand-new user needs somewhere to land before any pane renders.
  const spaces = await workspacesFor(e, userId);
  let workspaceId = spaces[0]?.id ?? null;
  if (!workspaceId) {
    workspaceId = await createWorkspace(e, userId, token.email.split("@")[1] ?? "My workspace");
  }

  if (claim && workspaceId) {
    const result = await claimScan(e, claim, userId, workspaceId);
    if (result.ok) await audit(e, workspaceId, userId, "scan.claimed", result.hostname ?? null, null, clientIp(ctx));
  }

  const session = await createSession(e, userId, {
    trusted: trust,
    ip: clientIp(ctx),
    userAgent: ctx.request.headers.get("user-agent"),
    deviceLabel: deviceLabel(ctx.request.headers.get("user-agent"))
  });
  setSessionCookie(ctx.cookies, session.value, session.maxAge);
  ctx.cookies.set("cr_ws", workspaceId, { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: session.maxAge });

  await audit(e, workspaceId, userId, created ? "user.created" : "user.signed_in", null, null, clientIp(ctx));

  return ctx.redirect(next.startsWith("/") ? next : "/overview", 302);
};
