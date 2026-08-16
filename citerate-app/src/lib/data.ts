/**
 * Every read the dashboard performs, in one file. Two rules:
 *  1. Charts read from `daily_rollups` only — never a live aggregate over
 *     observations. That is what the rollup table is for.
 *  2. Gating reads `usage_counters`, never a count(*) over queries.
 */
import type { Env } from "./env";
import { all, one } from "./db";
import type { Cause } from "./scoring";
import { confidenceBand, isWithinNoise } from "./scoring";
import type { Role } from "./rbac";

export interface WorkspaceContext {
  workspaceId: string;
  name: string;
  plan: string;
  role: Role;
  parentId: string | null;
  brandAccent: string | null;
  brandLogoKey: string | null;
  brandDomain: string | null;
}

export async function workspaceContext(env: Env, userId: string, workspaceId?: string | null): Promise<WorkspaceContext | null> {
  const row = workspaceId
    ? await one<Record<string, string | null>>(
        env.DB,
        `SELECT w.id, w.name, w.plan, m.role, w.parent_id, w.brand_accent, w.brand_logo_key, w.brand_domain
           FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = ? AND w.id = ?`,
        userId,
        workspaceId
      )
    : await one<Record<string, string | null>>(
        env.DB,
        `SELECT w.id, w.name, w.plan, m.role, w.parent_id, w.brand_accent, w.brand_logo_key, w.brand_domain
           FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = ?
          ORDER BY w.parent_id IS NOT NULL, m.created_at
          LIMIT 1`,
        userId
      );
  if (!row) return null;

  return {
    workspaceId: row.id as string,
    name: row.name as string,
    plan: row.plan as string,
    role: row.role as Role,
    parentId: row.parent_id,
    brandAccent: row.brand_accent,
    brandLogoKey: row.brand_logo_key,
    brandDomain: row.brand_domain
  };
}

export interface DomainRow {
  id: string;
  hostname: string;
  label: string | null;
  gsc_connected: number;
}

export async function domainsFor(env: Env, workspaceId: string): Promise<DomainRow[]> {
  return all<DomainRow>(
    env.DB,
    `SELECT id, hostname, label, gsc_connected FROM domains WHERE workspace_id = ? ORDER BY created_at`,
    workspaceId
  );
}

export async function activeDomain(env: Env, workspaceId: string, domainId?: string | null): Promise<DomainRow | null> {
  if (domainId) {
    return one<DomainRow>(
      env.DB,
      `SELECT id, hostname, label, gsc_connected FROM domains WHERE id = ? AND workspace_id = ?`,
      domainId,
      workspaceId
    );
  }
  const [first] = await domainsFor(env, workspaceId);
  return first ?? null;
}

// --- Overview ---------------------------------------------------------------

export interface RollupRow {
  day: string;
  engine: string;
  cluster: string;
  citation_rate: number;
  runs: number;
  band_low: number | null;
  band_high: number | null;
  cause_aio: number;
  cause_rank: number;
  cause_tech: number;
  cause_other: number;
  discontinuity: string | null;
}

export async function trend(env: Env, domainId: string, days = 90, engine = "*", cluster = "*"): Promise<RollupRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return all<RollupRow>(
    env.DB,
    `SELECT day, engine, cluster, citation_rate, runs, band_low, band_high,
            cause_aio, cause_rank, cause_tech, cause_other, discontinuity
       FROM daily_rollups
      WHERE domain_id = ? AND engine = ? AND cluster = ? AND day >= ?
      ORDER BY day`,
    domainId,
    engine,
    cluster,
    since
  );
}

export interface Headline {
  rate: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  runs: number;
  previousRate: number | null;
  withinNoise: boolean;
  day: string | null;
  discontinuity: string | null;
  causes: { aio: number; rank: number; tech: number; other: number };
}

/** The score unit's numbers, including whether the delta is real or noise. */
export async function headline(env: Env, domainId: string): Promise<Headline> {
  const rows = await all<RollupRow>(
    env.DB,
    `SELECT day, engine, cluster, citation_rate, runs, band_low, band_high,
            cause_aio, cause_rank, cause_tech, cause_other, discontinuity
       FROM daily_rollups
      WHERE domain_id = ? AND engine = '*' AND cluster = '*'
      ORDER BY day DESC LIMIT 8`,
    domainId
  );

  const latest = rows[0];
  const prior = rows[7] ?? rows[rows.length - 1];

  if (!latest) {
    return {
      rate: null, bandLow: null, bandHigh: null, runs: 0, previousRate: null,
      withinNoise: false, day: null, discontinuity: null,
      causes: { aio: 0, rank: 0, tech: 0, other: 0 }
    };
  }

  const latestCited = Math.round(latest.citation_rate * latest.runs);
  const [low, high] = latest.band_low !== null && latest.band_high !== null
    ? [latest.band_low, latest.band_high]
    : confidenceBand(latestCited, latest.runs);

  const noise = prior && prior !== latest
    ? isWithinNoise(
        { cited: latestCited, runs: latest.runs },
        { cited: Math.round(prior.citation_rate * prior.runs), runs: prior.runs }
      )
    : false;

  return {
    rate: latest.citation_rate,
    bandLow: low,
    bandHigh: high,
    runs: latest.runs,
    previousRate: prior && prior !== latest ? prior.citation_rate : null,
    withinNoise: noise,
    day: latest.day,
    discontinuity: latest.discontinuity,
    causes: {
      aio: latest.cause_aio,
      rank: latest.cause_rank,
      tech: latest.cause_tech,
      other: latest.cause_other
    }
  };
}

export interface EngineRate {
  engine: string;
  citation_rate: number;
  runs: number;
  previous_rate: number | null;
}

export async function engineBreakdown(env: Env, domainId: string): Promise<EngineRate[]> {
  return all<EngineRate>(
    env.DB,
    `WITH latest AS (
       SELECT engine, MAX(day) AS d FROM daily_rollups
        WHERE domain_id = ? AND engine != '*' AND cluster = '*'
        GROUP BY engine
     )
     SELECT r.engine, r.citation_rate, r.runs,
            (SELECT citation_rate FROM daily_rollups p
              WHERE p.domain_id = r.domain_id AND p.engine = r.engine AND p.cluster = '*' AND p.day < r.day
              ORDER BY p.day DESC LIMIT 1) AS previous_rate
       FROM daily_rollups r JOIN latest l ON l.engine = r.engine AND l.d = r.day
      WHERE r.domain_id = ? AND r.cluster = '*'
      ORDER BY r.citation_rate DESC`,
    domainId,
    domainId
  );
}

// --- Queries pane -----------------------------------------------------------

export interface QueryRow {
  id: string;
  text: string;
  cluster: string | null;
  intent: string | null;
  source: string | null;
  active: number;
  citation_rate: number | null;
  runs: number | null;
  cited_runs: number | null;
  mention_runs: number | null;
  cause: Cause | null;
  cause_confidence: number | null;
  organic_rank: number | null;
  engine: string | null;
  scanned_at: number | null;
}

/** One row per query, carrying its most recent observation across all engines. */
export async function queryRows(env: Env, domainId: string, opts: { cluster?: string | null; cause?: string | null; limit?: number } = {}): Promise<QueryRow[]> {
  const rows = await all<QueryRow>(
    env.DB,
    `WITH last_scan AS (
       SELECT id FROM scans
        WHERE domain_id = ? AND status IN ('complete','partial')
        ORDER BY created_at DESC LIMIT 1
     )
     SELECT q.id, q.text, q.cluster, q.intent, q.source, q.active,
            AVG(o.citation_rate) AS citation_rate,
            SUM(o.runs) AS runs,
            SUM(o.cited_runs) AS cited_runs,
            SUM(o.mention_runs) AS mention_runs,
            MIN(o.cause) AS cause,
            AVG(o.cause_confidence) AS cause_confidence,
            MIN(o.organic_rank) AS organic_rank,
            NULL AS engine,
            MAX(o.scanned_at) AS scanned_at
       FROM queries q
       JOIN query_sets s ON s.id = q.query_set_id
       LEFT JOIN observations o
              ON o.query_id = q.id AND o.scan_id = (SELECT id FROM last_scan)
      WHERE s.domain_id = ?
      GROUP BY q.id
      ORDER BY citation_rate IS NULL, citation_rate ASC, q.text
      LIMIT ?`,
    domainId,
    domainId,
    opts.limit ?? 500
  );

  return rows.filter((r) => {
    if (opts.cluster && r.cluster !== opts.cluster) return false;
    if (opts.cause && r.cause !== opts.cause) return false;
    return true;
  });
}

export async function clusters(env: Env, domainId: string): Promise<{ cluster: string; n: number }[]> {
  return all<{ cluster: string; n: number }>(
    env.DB,
    `SELECT COALESCE(q.cluster, 'uncategorised') AS cluster, COUNT(*) AS n
       FROM queries q JOIN query_sets s ON s.id = q.query_set_id
      WHERE s.domain_id = ? AND q.active = 1
      GROUP BY cluster ORDER BY n DESC`,
    domainId
  );
}

/** Per-engine evidence for one query — the row detail drawer. */
export async function queryEvidence(env: Env, queryId: string) {
  const observations = await all<{
    id: string; engine: string; runs: number; cited_runs: number; mention_runs: number;
    citation_rate: number; organic_rank: number | null; aio_present: number | null;
    tech_pass: number | null; cause: Cause | null; cause_confidence: number | null;
    answer_key: string | null; scanned_at: number;
  }>(
    env.DB,
    `SELECT id, engine, runs, cited_runs, mention_runs, citation_rate, organic_rank,
            aio_present, tech_pass, cause, cause_confidence, answer_key, scanned_at
       FROM observations WHERE query_id = ?
      ORDER BY scanned_at DESC, engine LIMIT 12`,
    queryId
  );

  const citations = observations.length
    ? await all<{ observation_id: string; run_index: number; hostname: string; url: string; is_subject: number; excerpt: string | null }>(
        env.DB,
        `SELECT observation_id, run_index, hostname, url, is_subject, excerpt
           FROM citations WHERE observation_id IN (${observations.map(() => "?").join(",")})
          ORDER BY run_index`,
        ...observations.map((o) => o.id)
      )
    : [];

  return { observations, citations };
}

// --- Fix Queue --------------------------------------------------------------

export interface FixRow {
  id: string;
  title: string;
  detail: string | null;
  cause: string;
  impact: "high" | "medium" | "low";
  cluster: string | null;
  query_ids: string;
  baseline_rate: number | null;
  state: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  shipped_at: number | null;
  verified_rate: number | null;
  updated_at: number | null;
}

export async function fixQueue(env: Env, domainId: string): Promise<FixRow[]> {
  return all<FixRow>(
    env.DB,
    `SELECT f.id, f.title, f.detail, f.cause, f.impact, f.cluster, f.query_ids, f.baseline_rate,
            COALESCE(x.state, 'open') AS state, x.owner_user_id,
            u.name AS owner_name, u.email AS owner_email,
            x.shipped_at, x.verified_rate, x.updated_at
       FROM findings f
       LEFT JOIN fix_states x ON x.finding_id = f.id
       LEFT JOIN users u ON u.id = x.owner_user_id
      WHERE f.domain_id = ?
      ORDER BY CASE f.impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               f.created_at DESC`,
    domainId
  );
}

// --- Competitors ------------------------------------------------------------

export async function competitorShare(env: Env, domainId: string, limit = 8) {
  return all<{ hostname: string; cited_runs: number; share: number; discovered: number }>(
    env.DB,
    `WITH last_scan AS (
       SELECT id FROM scans WHERE domain_id = ? AND status IN ('complete','partial')
        ORDER BY created_at DESC LIMIT 1
     ),
     runs AS (SELECT SUM(runs) AS total FROM observations WHERE scan_id = (SELECT id FROM last_scan))
     SELECT c.hostname,
            COUNT(ci.id) AS cited_runs,
            CAST(COUNT(ci.id) AS REAL) / MAX(1, (SELECT total FROM runs)) AS share,
            c.discovered
       FROM citations ci
       JOIN observations o ON o.id = ci.observation_id
       JOIN competitors c ON c.hostname = ci.hostname AND c.domain_id = ?
      WHERE o.scan_id = (SELECT id FROM last_scan) AND ci.is_subject = 0
      GROUP BY c.hostname
      ORDER BY cited_runs DESC
      LIMIT ?`,
    domainId,
    domainId,
    limit
  );
}

// --- Usage / gating ---------------------------------------------------------

export interface Usage {
  trackedQueries: { used: number; included: number };
  domains: { used: number; included: number };
  seats: { used: number; included: number };
  rescans: { used: number; included: number };
  period: string;
}

export async function usage(env: Env, workspaceId: string): Promise<Usage> {
  const period = new Date().toISOString().slice(0, 7);
  const rows = await all<{ metric: string; used: number; included: number }>(
    env.DB,
    `SELECT metric, used, included FROM usage_counters WHERE workspace_id = ? AND period = ?`,
    workspaceId,
    period
  );
  const get = (metric: string) => {
    const row = rows.find((r) => r.metric === metric);
    return { used: row?.used ?? 0, included: row?.included ?? 0 };
  };
  return {
    period,
    trackedQueries: get("tracked_queries"),
    domains: get("domains"),
    seats: get("seats"),
    rescans: get("rescans")
  };
}

export async function latestScan(env: Env, domainId: string) {
  return one<{
    id: string; status: string; kind: string; queries_total: number; queries_done: number;
    citation_rate: number | null; created_at: number; completed_at: number | null;
  }>(
    env.DB,
    `SELECT id, status, kind, queries_total, queries_done, citation_rate, created_at, completed_at
       FROM scans WHERE domain_id = ? ORDER BY created_at DESC LIMIT 1`,
    domainId
  );
}

export async function members(env: Env, workspaceId: string) {
  return all<{ user_id: string; email: string; name: string | null; role: Role; created_at: number; last_seen_at: number | null }>(
    env.DB,
    `SELECT m.user_id, u.email, u.name, m.role, m.created_at, u.last_seen_at
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 3 ELSE 4 END,
               u.email`,
    workspaceId
  );
}

export async function pendingInvites(env: Env, workspaceId: string) {
  return all<{ id: string; email: string; role: Role; created_at: number; expires_at: number }>(
    env.DB,
    `SELECT id, email, role, created_at, expires_at FROM invites
      WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    workspaceId
  );
}

export async function reports(env: Env, workspaceId: string) {
  return all<{ id: string; domain_id: string; hostname: string; period: string; kind: string; created_at: number; artifact_key: string | null }>(
    env.DB,
    `SELECT r.id, r.domain_id, d.hostname, r.period, r.kind, r.created_at, r.artifact_key
       FROM report_snapshots r JOIN domains d ON d.id = r.domain_id
      WHERE r.workspace_id = ?
      ORDER BY r.created_at DESC LIMIT 50`,
    workspaceId
  );
}
