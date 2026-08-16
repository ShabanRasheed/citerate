/**
 * One guard for the whole app. Public routes are the exception list; everything
 * else needs a session, a workspace, and — if the account has no domain yet —
 * gets pushed into onboarding rather than an empty dashboard.
 */
import { defineMiddleware } from "astro:middleware";
import type { Env } from "./lib/env";
import { readSession } from "./lib/session";
import { workspaceContext, domainsFor } from "./lib/data";

const PUBLIC = [
  "/sign-in",
  "/sign-up",
  "/check-email",
  "/verify",
  "/sign-out",
  "/claim",
  "/invite",
  "/api/auth",
  "/healthz"
];

const isPublic = (pathname: string) => PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const onRequest = defineMiddleware(async (context, next) => {
  const runtime = (context.locals as { runtime?: { env: Env } }).runtime;
  if (!runtime?.env) return next();
  const env = runtime.env;

  const url = new URL(context.request.url);
  if (url.pathname.startsWith("/_") || url.pathname.startsWith("/favicon")) return next();

  const session = await readSession(env, context.cookies);

  if (!session) {
    if (isPublic(url.pathname)) return next();
    const back = encodeURIComponent(url.pathname + url.search);
    return context.redirect(`/sign-in?next=${back}`, 302);
  }

  const requested = context.cookies.get("cr_ws")?.value ?? null;
  const workspace = await workspaceContext(env, session.user.id, requested);

  // Signed in with no workspace at all: the invite/claim flows create one.
  if (!workspace) {
    if (isPublic(url.pathname) || url.pathname.startsWith("/onboarding")) return next();
    return context.redirect("/onboarding/domain", 302);
  }

  const domains = await domainsFor(env, workspace.workspaceId);

  Object.assign(context.locals, {
    session,
    user: session.user,
    workspace,
    domains
  });

  // A workspace with nothing tracked has nothing to show; onboarding is the app.
  if (!domains.length && !url.pathname.startsWith("/onboarding") && !isPublic(url.pathname) && !url.pathname.startsWith("/api/")) {
    return context.redirect("/onboarding/domain", 302);
  }

  if (isPublic(url.pathname) && (url.pathname === "/sign-in" || url.pathname === "/sign-up")) {
    return context.redirect("/overview", 302);
  }

  return next();
});
