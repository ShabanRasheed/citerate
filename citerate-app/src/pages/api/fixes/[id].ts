/**
 * Fix state and owner. PATCH for the optimistic client path, POST for the no-JS
 * form. `verified` is rejected from both: only the scanner sets it, because a
 * fix marked done by the person who shipped it is not evidence.
 */
import type { APIRoute } from "astro";
import { env, json, fail, now, one, run } from "../../../lib/db";
import { can } from "../../../lib/rbac";
import { audit } from "../../../lib/auth";

export const prerender = false;

const ALLOWED = ["open", "in_progress", "shipped", "dismissed"] as const;

async function patch(ctx: Parameters<APIRoute>[0], body: { state?: string; owner?: string | null }) {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);
  if (!can(workspace.role, "edit_fixes")) return fail("insufficient_role", 403);

  const findingId = ctx.params.id!;
  const finding = await one<{ id: string; domain_id: string; baseline_rate: number | null }>(
    e.DB,
    `SELECT f.id, f.domain_id, f.baseline_rate FROM findings f
       JOIN domains d ON d.id = f.domain_id
      WHERE f.id = ? AND d.workspace_id = ?`,
    findingId,
    workspace.workspaceId
  );
  if (!finding) return fail("not_found", 404);

  const state = body.state && (ALLOWED as readonly string[]).includes(body.state) ? body.state : null;
  if (body.state && !state) return fail("verified_is_measured_not_set", 422);

  const existing = await one<{ state: string; owner_user_id: string | null }>(
    e.DB,
    `SELECT state, owner_user_id FROM fix_states WHERE finding_id = ?`,
    findingId
  );

  const nextState = state ?? existing?.state ?? "open";
  const nextOwner = body.owner === undefined ? (existing?.owner_user_id ?? null) : body.owner;

  await run(
    e.DB,
    `INSERT INTO fix_states (finding_id, state, owner_user_id, shipped_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (finding_id) DO UPDATE SET
       state = excluded.state,
       owner_user_id = excluded.owner_user_id,
       shipped_at = CASE WHEN excluded.state = 'shipped' AND fix_states.shipped_at IS NULL THEN excluded.shipped_at ELSE fix_states.shipped_at END,
       updated_at = excluded.updated_at`,
    findingId,
    nextState,
    nextOwner,
    nextState === "shipped" ? now() : null,
    now()
  );

  await audit(e, workspace.workspaceId, user.id, `fix.${nextState}`, findingId, { owner: nextOwner });

  return json({ ok: true, state: nextState, owner: nextOwner });
}

export const PATCH: APIRoute = async (ctx) => {
  const body = (await ctx.request.json().catch(() => ({}))) as { state?: string; owner?: string | null };
  return patch(ctx, body);
};

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const res = await patch(ctx, {
    state: form.get("state") ? String(form.get("state")) : undefined,
    owner: form.has("owner") ? (String(form.get("owner")) || null) : undefined
  });
  // No-JS form posts expect a page back.
  return res.status < 400 ? ctx.redirect("/fixes", 303) : res;
};
