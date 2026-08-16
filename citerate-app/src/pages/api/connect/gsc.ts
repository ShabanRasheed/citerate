/**
 * Search Console OAuth — consent hop (Phase 10). Read-only scope. The callback
 * (./gsc/callback.ts) burns the state minted here, exchanges the code, seals
 * the refresh token into gsc_connections, and pulls the domain's top Search
 * Console queries into the query set labelled `source: 'gsc'`. Without the
 * connection, ranking-decline findings still publish at lower confidence —
 * stated in onboarding rather than hidden.
 */
import type { APIRoute } from "astro";
import { env, one, shareToken, fail } from "../../../lib/db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) {
    return ctx.redirect("/onboarding/connect?gsc=unconfigured", 303);
  }

  const requested = ctx.url.searchParams.get("domain");
  const domain = requested
    ? await one<{ id: string; hostname: string }>(
        e.DB,
        `SELECT id, hostname FROM domains WHERE id = ? AND workspace_id = ?`,
        requested,
        workspace.workspaceId
      )
    : await one<{ id: string; hostname: string }>(
        e.DB,
        `SELECT id, hostname FROM domains WHERE workspace_id = ? ORDER BY created_at LIMIT 1`,
        workspace.workspaceId
      );
  if (!domain) return ctx.redirect("/onboarding/domain", 303);

  // Single-use state: 160 bits in KV for 10 minutes; the callback deletes it.
  const state = shareToken();
  await e.SCAN_CACHE.put(
    `gsc_state:${state}`,
    JSON.stringify({
      domainId: domain.id,
      hostname: domain.hostname,
      workspaceId: workspace.workspaceId,
      userId: user.id,
      back: ctx.request.headers.get("referer")?.includes("/settings") ? "/settings" : "/onboarding/connect"
    }),
    { expirationTtl: 600 }
  );

  const params = new URLSearchParams({
    client_id: e.GOOGLE_CLIENT_ID,
    redirect_uri: `${e.PUBLIC_APP_URL}/api/connect/gsc/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    state
  });

  return ctx.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
};

export const POST: APIRoute = () => fail("method_not_allowed", 405);
