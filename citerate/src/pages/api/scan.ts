/**
 * POST /api/scan — start a free scan.
 *
 * Order of operations matters:
 *   1. normalise the domain (reject garbage before spending anything)
 *   2. KV cache hit? return the existing share token — no engine calls
 *   3. Turnstile + rate limits
 *   4. create domain/query set/scan rows and enqueue scan_jobs
 *   5. return the token; the scanner Worker drains the queue on its cron tick
 */
export const prerender = false;

import type { APIContext } from "astro";
import { env, id, now, one, run, batch, json, fail, shareToken } from "../../lib/db";
import { normalizeDomain } from "../../lib/domain";
import { guardFreeScan, cachedScanToken, cacheScanToken } from "../../lib/guard";
import type { EngineId } from "../../lib/engines";

/** Starter prompt set for an unknown domain. The real generator lives in the app. */
function seedQueries(host: string): { text: string; intent: string; cluster: string }[] {
  const brand = host.split(".")[0]!;
  const base = [
    ["best tools for", "commercial", "category-pick"],
    ["alternatives", "commercial", "alternatives"],
    ["pricing", "commercial", "pricing"],
    ["reviews", "commercial", "reviews"],
    ["how to choose", "informational", "buying-guide"]
  ] as const;
  // 25 prompts: five patterns × five phrasings. Replaced by the real generator
  // (site crawl + Search Console + category patterns) once a workspace exists.
  const phrasings = ["", " for startups", " for small business", " for enterprise", " 2026"];
  const out: { text: string; intent: string; cluster: string }[] = [];
  for (const [pattern, intent, cluster] of base) {
    for (const suffix of phrasings) {
      out.push({ text: `${brand} ${pattern}${suffix}`.replace(/\s+/g, " ").trim(), intent, cluster });
    }
  }
  return out.slice(0, 25);
}

export async function POST(ctx: APIContext): Promise<Response> {
  const e = env(ctx);

  // Accept JSON (enhanced form) and urlencoded (no-JS fallback).
  let domainRaw = "";
  let turnstileToken: string | null = null;
  const contentType = ctx.request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await ctx.request.json()) as { domain?: string; turnstileToken?: string };
    domainRaw = body.domain ?? "";
    turnstileToken = body.turnstileToken ?? null;
  } else {
    const form = await ctx.request.formData();
    domainRaw = String(form.get("domain") ?? "");
    turnstileToken = String(form.get("cf-turnstile-response") ?? "") || null;
  }

  const hostname = normalizeDomain(domainRaw);
  if (!hostname) return fail("That doesn't look like a domain. Try example.com.", 422);

  // 2. Cache: one live scan per domain per day.
  const cached = await cachedScanToken(e, hostname);
  if (cached) {
    if (!contentType.includes("application/json")) return ctx.redirect(`/scan/${cached}`, 302);
    return json({ token: cached, cached: true });
  }

  // 3. Abuse controls.
  const guard = await guardFreeScan(e, ctx.request, hostname, turnstileToken);
  if (!guard.ok) {
    // Rate-limited but a previous scan exists → serve it rather than a dead end.
    const fallback = await one<{ share_token: string }>(
      e.DB,
      `SELECT s.share_token FROM scans s JOIN domains d ON d.id = s.domain_id
        WHERE d.hostname = ? AND s.share_token IS NOT NULL
        ORDER BY s.created_at DESC LIMIT 1`,
      hostname
    );
    if (fallback?.share_token) {
      if (!contentType.includes("application/json")) return ctx.redirect(`/scan/${fallback.share_token}`, 302);
      return json({ token: fallback.share_token, cached: true });
    }
    return fail(guard.message, guard.status, { retryAfter: guard.retryAfter });
  }

  // 4. Create rows.
  const ts = now();
  const domainId = id("dom");
  const setId = id("qs");
  const scanId = id("scn");
  const token = shareToken();
  const engineList = (e.FREE_SCAN_ENGINES ?? "chatgpt,google_aio").split(",") as EngineId[];
  const queries = seedQueries(hostname).slice(0, Number(e.FREE_SCAN_QUERY_LIMIT ?? 25));

  await run(
    e.DB,
    `INSERT INTO domains (id, workspace_id, hostname, created_at) VALUES (?, NULL, ?, ?)`,
    domainId,
    hostname,
    ts
  );
  await run(e.DB, `INSERT INTO query_sets (id, domain_id, name, created_at) VALUES (?, ?, 'Free scan', ?)`, setId, domainId, ts);

  const queryRows = queries.map((q) => ({ id: id("qry"), ...q }));
  await batch(
    e.DB,
    queryRows.map((q) =>
      e.DB.prepare(
        `INSERT INTO queries (id, query_set_id, text, intent, cluster, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'category', ?)`
      ).bind(q.id, setId, q.text, q.intent, q.cluster, ts)
    )
  );

  await run(
    e.DB,
    `INSERT INTO scans (id, domain_id, workspace_id, kind, status, share_token, engines,
                        runs_per_engine, queries_total, queries_done, created_at)
     VALUES (?, ?, NULL, 'free', 'queued', ?, ?, ?, ?, 0, ?)`,
    scanId,
    domainId,
    token,
    JSON.stringify(engineList),
    Number(e.RUNS_PER_ENGINE ?? 3),
    queryRows.length,
    ts
  );

  // 5. Enqueue one job per query per engine. The cron consumer claims batches.
  const jobs = queryRows.flatMap((q) =>
    engineList.map((engine) =>
      e.DB.prepare(
        `INSERT INTO scan_jobs (scan_id, query_id, engine, status, created_at) VALUES (?, ?, ?, 'pending', ?)`
      ).bind(scanId, q.id, engine, ts)
    )
  );
  await batch(e.DB, jobs);

  await cacheScanToken(e, hostname, token);

  if (!contentType.includes("application/json")) return ctx.redirect(`/scan/${token}`, 302);
  return json({ token, cached: false, total: queryRows.length * engineList.length });
}

export function GET(): Response {
  return fail("POST a domain to start a scan.", 405);
}
