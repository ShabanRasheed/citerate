/**
 * White-label branding. The logo goes to R2; the accent is stored as hex and only
 * ever replaces the positive accent in reports. Structural ink, hairlines, the
 * cause palette, and the methodology block are not re-mappable by design.
 */
import type { APIRoute } from "astro";
import { env, fail } from "../../../lib/db";
import { can } from "../../../lib/rbac";
import { PLANS, type PlanId } from "../../../lib/plans";
import { audit } from "../../../lib/auth";

export const prerender = false;

const HEX = /^#[0-9a-f]{6}$/i;

export const POST: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "manage_brand")) return fail("insufficient_role", 403);
  if (PLANS[workspace.plan as PlanId].pdfReports !== "white_label") return fail("plan_required", 402);

  const form = await ctx.request.formData();
  const custom = String(form.get("accentCustom") ?? "").trim();
  const accent = HEX.test(custom) ? custom : String(form.get("accent") ?? "") || null;
  const brandDomain = String(form.get("brandDomain") ?? "").trim().toLowerCase() || null;

  let logoKey = workspace.brandLogoKey;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 512_000) return fail("logo_too_large", 413);
    logoKey = `brand/${workspace.workspaceId}/logo-${Date.now()}`;
    await e.ARTIFACTS.put(logoKey, await logo.arrayBuffer(), {
      httpMetadata: { contentType: logo.type || "image/png" }
    });
  }

  await e.DB.prepare(
    `UPDATE workspaces SET brand_accent = ?, brand_domain = ?, brand_logo_key = ? WHERE id = ?`
  )
    .bind(accent, brandDomain, logoKey, workspace.workspaceId)
    .run();

  await audit(e, workspace.workspaceId, user.id, "brand.updated", brandDomain, { accent });

  return ctx.redirect("/settings/brand?saved=1", 303);
};
