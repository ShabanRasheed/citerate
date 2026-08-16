/**
 * Liveness probe + local self-check.
 *
 * Deployed: `{ok, db}` and nothing more — the database shape is not public.
 * On localhost: the detail `pnpm verify:local` reads — which migrations landed,
 * whether the seed is there, which bindings resolved, mocks or live engines.
 * Gated on hostname, so a deployed app never returns any of it.
 */
import type { APIRoute } from "astro";
import { env, json } from "../lib/db";

export const prerender = false;

/** Every table the three migrations should have created, in order of origin. */
const NEEDED = [
  // 0001 (marketing repo)
  "users", "sessions", "auth_tokens", "workspaces", "memberships", "domains",
  "queries", "scans", "observations", "findings", "subscriptions", "usage_counters",
  // 0002 (this repo)
  "invites", "notification_prefs", "saved_views", "report_snapshots", "api_keys",
  // 0003 (this repo)
  "gsc_connections",
];

export const GET: APIRoute = async (ctx) => {
  try {
    const e = env(ctx);
    await e.DB.prepare("SELECT 1").first();

    const host = new URL(ctx.request.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return json({ ok: true, db: "up" });

    const bag = e as unknown as Record<string, unknown>;
    const rows = await e.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
    const tables = (rows.results ?? []).map((r) => r.name);
    const missing = NEEDED.filter((t) => !tables.includes(t));

    const count = async (t: string) =>
      tables.includes(t)
        ? Number((await e.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())?.n ?? 0)
        : null;

    return json({
      ok: missing.length === 0,
      db: "up",
      migrations: missing.length
        ? `incomplete — missing ${missing.length}: ${missing.join(", ")}`
        : "0001 + 0002 + 0003 applied",
      seed: {
        users: await count("users"),
        workspaces: await count("workspaces"),
        queries: await count("queries"),
        scans: await count("scans"),
        findings: await count("findings"),
      },
      bindings: {
        DB: !!bag.DB,
        SCAN_CACHE: !!bag.SCAN_CACHE,
        RATE_LIMIT: !!bag.RATE_LIMIT,
        ARTIFACTS: !!bag.ARTIFACTS,
        BROWSER: !!bag.BROWSER,
      },
      engine: bag.USE_ENGINE_MOCKS === "true" ? "mocks" : "live",
    });
  } catch (error) {
    return json({ ok: false, error: String(error) }, 503);
  }
};
