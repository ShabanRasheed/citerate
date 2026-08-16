/** Profile: name only. Email changes go through a verified token flow. */
import type { APIRoute } from "astro";
import { env, fail } from "../../../lib/db";
import { audit } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const user = ctx.locals.user;
  if (!user) return fail("unauthorised", 401);

  const form = await ctx.request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 80) || null;

  await e.DB.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(name, user.id).run();
  await audit(e, ctx.locals.workspace?.workspaceId ?? null, user.id, "profile.updated");

  return ctx.redirect("/settings?saved=1", 303);
};
