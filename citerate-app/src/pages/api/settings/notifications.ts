/** Notification preferences, per membership. Unchecked boxes simply don't post. */
import type { APIRoute } from "astro";
import { env, now, fail } from "../../../lib/db";

export const prerender = false;

const KEYS = ["weekly_digest", "scan_complete", "fix_verified", "rate_drop", "quota_warning"] as const;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const user = ctx.locals.user;
  const workspace = ctx.locals.workspace;
  if (!user || !workspace) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  const values = KEYS.map((k) => (form.get(k) ? 1 : 0));

  await e.DB.prepare(
    `INSERT INTO notification_prefs (workspace_id, user_id, weekly_digest, scan_complete, fix_verified, rate_drop, quota_warning, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET
       weekly_digest = excluded.weekly_digest,
       scan_complete = excluded.scan_complete,
       fix_verified = excluded.fix_verified,
       rate_drop = excluded.rate_drop,
       quota_warning = excluded.quota_warning,
       updated_at = excluded.updated_at`
  )
    .bind(workspace.workspaceId, user.id, ...values, now())
    .run();

  return ctx.redirect("/settings?notifications=1", 303);
};
