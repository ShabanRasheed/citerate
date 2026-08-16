/**
 * Search Console OAuth — callback (Phase 10).
 * 1. Burn the state minted by ../gsc.ts (KV, 10 min, single use — deleted
 *    even when the rest fails).
 * 2. Exchange the code; the refresh token comes back because the consent hop
 *    asks with access_type=offline & prompt=consent.
 * 3. Seal the refresh token (AES-GCM under SESSION_SECRET) into
 *    gsc_connections — the scanner reads impressions with it at scan time.
 * 4. Best-effort: pull the domain's top Search Console queries into the query
 *    set, labelled `source: 'gsc'`, capped by the plan's tracked-query limit.
 *    A failure here still leaves the connection usable.
 */
import type { APIRoute } from "astro";
import { env, id, now, one, all, fail } from "../../../../lib/db";
import { seal } from "../../../../lib/seal";
import { audit } from "../../../../lib/auth";
import { PLANS, type PlanId } from "../../../../lib/plans";

export const prerender = false;

interface StateBlob {
  domainId: string;
  hostname: string;
  workspaceId: string;
  userId: string;
  back: string;
}

async function gscTopQueries(
  token: string,
  property: string
): Promise<{ query: string; impressions: number }[] | null> {
  const end = new Date();
  const start = new Date(Date.now() - 28 * 86_400_000);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ["query"],
        rowLimit: 50
      })
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { rows?: { keys: string[]; impressions: number }[] };
  return (data.rows ?? []).map((r) => ({ query: r.keys[0] ?? "", impressions: r.impressions ?? 0 }));
}

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  const user = ctx.locals.user;
  if (!workspace || !user) return fail("unauthorised", 401);

  const denied = ctx.url.searchParams.get("error");
  const code = ctx.url.searchParams.get("code");
  const state = ctx.url.searchParams.get("state") ?? "";

  const raw = state ? await e.SCAN_CACHE.get(`gsc_state:${state}`) : null;
  if (raw) await e.SCAN_CACHE.delete(`gsc_state:${state}`);
  const blob = raw ? (JSON.parse(raw) as StateBlob) : null;
  const back = blob?.back ?? "/onboarding/connect";

  if (denied) return ctx.redirect(`${back}?gsc=denied`, 303);
  if (!code || !blob || blob.workspaceId !== workspace.workspaceId) {
    return ctx.redirect(`${back}?gsc=error`, 303);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: e.GOOGLE_CLIENT_ID ?? "",
      client_secret: e.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${e.PUBLIC_APP_URL}/api/connect/gsc/callback`,
      grant_type: "authorization_code"
    })
  });
  if (!tokenRes.ok) return ctx.redirect(`${back}?gsc=error`, 303);
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token) return ctx.redirect(`${back}?gsc=error`, 303);

  // Find the property that answers: domain property first, URL-prefix second.
  let property = `sc-domain:${blob.hostname}`;
  let rows = await gscTopQueries(tokens.access_token, property);
  if (rows === null) {
    property = `https://${blob.hostname}/`;
    rows = await gscTopQueries(tokens.access_token, property);
  }

  await e.DB.prepare(
    `INSERT INTO gsc_connections (domain_id, workspace_id, property, refresh_token, scope, connected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (domain_id) DO UPDATE SET
       property = excluded.property, refresh_token = excluded.refresh_token,
       scope = excluded.scope, connected_by = excluded.connected_by,
       updated_at = excluded.updated_at, revoked_at = NULL`
  )
    .bind(
      blob.domainId,
      blob.workspaceId,
      property,
      await seal(e.SESSION_SECRET, tokens.refresh_token),
      tokens.scope ?? "https://www.googleapis.com/auth/webmasters.readonly",
      user.id,
      now(),
      now()
    )
    .run();

  // Best-effort blend: the domain's top GSC queries join the set, deduped,
  // up to the plan limit. Failure leaves the connection intact.
  let added = 0;
  if (rows?.length) {
    const setRow = await one<{ id: string }>(
      e.DB,
      `SELECT id FROM query_sets WHERE domain_id = ? ORDER BY created_at LIMIT 1`,
      blob.domainId
    );
    if (setRow) {
      const existing = await all<{ text: string }>(
        e.DB,
        `SELECT text FROM queries WHERE query_set_id = ?`,
        setRow.id
      );
      const seen = new Set(existing.map((q) => q.text.toLowerCase().trim()));
      const limit = PLANS[workspace.plan as PlanId].trackedQueries;
      const capacity = Math.max(0, limit - seen.size);

      const inserts: D1PreparedStatement[] = [];
      for (const row of [...rows].sort((a, b) => b.impressions - a.impressions)) {
        if (inserts.length >= capacity) break;
        const text = row.query.toLowerCase().replace(/\s+/g, " ").trim();
        if (!text || text.length > 120 || seen.has(text)) continue;
        seen.add(text);
        inserts.push(
          e.DB.prepare(
            `INSERT INTO queries (id, query_set_id, text, intent, cluster, source, active, created_at)
             VALUES (?, ?, ?, 'informational', 'gsc-ranking', 'gsc', 1, ?)`
          ).bind(id("qry"), setRow.id, text, now())
        );
      }
      if (inserts.length) {
        added = inserts.length;
        inserts.push(
          e.DB.prepare(
            `INSERT INTO usage_counters (workspace_id, period, metric, used, included)
             VALUES (?, ?, 'tracked_queries', ?, ?)
             ON CONFLICT (workspace_id, period, metric) DO UPDATE SET used = usage_counters.used + ?`
          ).bind(blob.workspaceId, new Date().toISOString().slice(0, 7), added, limit, added)
        );
        await e.DB.batch(inserts);
      }
    }
  }

  await audit(e, blob.workspaceId, user.id, "connect.gsc", blob.hostname, { property, queriesAdded: added });
  return ctx.redirect(`${back}?gsc=connected`, 303);
};
