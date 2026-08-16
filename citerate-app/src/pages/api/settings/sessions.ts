/** Session management: sign out every other device. */
import type { APIRoute } from "astro";
import { env, fail } from "../../../lib/db";
import { destroyOtherSessions } from "../../../lib/session";
import { audit } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const session = ctx.locals.session;
  if (!session) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  if (String(form.get("action")) === "revoke_others") {
    await destroyOtherSessions(e, session.user.id, session.sessionId);
    await audit(e, ctx.locals.workspace?.workspaceId ?? null, session.user.id, "sessions.revoked_others");
  }

  return ctx.redirect("/settings?sessions=1", 303);
};
