/**
 * Scan consumer. A jobs table in D1 plus a cron trigger every minute is a
 * working queue at zero cost: each tick claims a batch, calls the engines,
 * writes observations, and updates the progress the hero form polls.
 *
 * Move to Cloudflare Queues when a single tick stops keeping up — that is the
 * $5/month line and the only one in the stack.
 *
 *   dev:    pnpm scanner:dev
 *   deploy: pnpm scanner:deploy
 *   logs:   pnpm scanner:tail
 */
import type { Env } from "../../src/lib/env";
import { ask, organicRank, type EngineId } from "../../src/lib/engines";
import { isSubjectUrl, mentionsBrand, resolveUrl, stripTracking } from "../../src/lib/domain";
import { citationRate, confidenceBand, summarize, type RunResult } from "../../src/lib/scoring";

const nowS = () => Math.floor(Date.now() / 1000);
const rid = (p: string) =>
  `${p}_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(36)).join("").slice(0, 12)}`;

interface Job {
  id: number;
  scan_id: string;
  query_id: string;
  engine: EngineId;
  query: string;
  hostname: string;
  runs_per_engine: number;
}

export default {
  /** Cron entry point: * * * * * (every minute). */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(drain(env));
  },

  /** Manual kick for local dev: GET /?scan=scn_xxx or GET / to drain one batch. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    const processed = await drain(env);
    return new Response(JSON.stringify({ processed }), {
      headers: { "content-type": "application/json" }
    });
  }
} satisfies ExportedHandler<Env>;

async function drain(env: Env): Promise<number> {
  const batchSize = Number(env.SCAN_BATCH_SIZE ?? 12);
  const claimedAt = nowS();

  // Claim a batch. Two-step claim keeps it simple and idempotent enough for a
  // single consumer; stale claims are reset after 5 minutes.
  await env.DB.prepare(
    `UPDATE scan_jobs SET status = 'pending', attempts = attempts + 1
      WHERE status = 'claimed' AND claimed_at < ?`
  )
    .bind(claimedAt - 300)
    .run();

  const { results } = await env.DB.prepare(
    `SELECT j.id, j.scan_id, j.query_id, j.engine, q.text AS query, d.hostname, s.runs_per_engine
       FROM scan_jobs j
       JOIN queries q ON q.id = j.query_id
       JOIN scans s ON s.id = j.scan_id
       JOIN domains d ON d.id = s.domain_id
      WHERE j.status = 'pending' AND j.attempts < 3
      ORDER BY j.created_at ASC
      LIMIT ?`
  )
    .bind(batchSize)
    .all<Job>();

  const jobs = results ?? [];
  if (!jobs.length) return 0;

  await env.DB.batch(
    jobs.map((j) =>
      env.DB.prepare(`UPDATE scan_jobs SET status = 'claimed', claimed_at = ? WHERE id = ?`).bind(
        claimedAt,
        j.id
      )
    )
  );

  // Mark scans running.
  const scanIds = [...new Set(jobs.map((j) => j.scan_id))];
  await env.DB.batch(
    scanIds.map((sid) =>
      env.DB.prepare(
        `UPDATE scans SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?`
      ).bind(claimedAt, sid)
    )
  );

  for (const job of jobs) {
    try {
      await processJob(env, job);
      await env.DB.prepare(`UPDATE scan_jobs SET status = 'done' WHERE id = ?`).bind(job.id).run();
    } catch (err) {
      await env.DB.prepare(`UPDATE scan_jobs SET status = 'error', error = ? WHERE id = ?`)
        .bind(String(err).slice(0, 500), job.id)
        .run();
    }
  }

  for (const sid of scanIds) await finalizeIfDone(env, sid);
  return jobs.length;
}

async function processJob(env: Env, job: Job): Promise<void> {
  const runs = Math.max(1, Number(job.runs_per_engine || env.RUNS_PER_ENGINE || 3));
  const results: RunResult[] = [];
  const citationRows: {
    runIndex: number;
    url: string;
    resolved: string;
    hostname: string;
    isSubject: boolean;
  }[] = [];

  let answerBlob = "";
  let aioSeen = false;

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    const answer = await ask(env, job.engine, job.query, job.hostname);
    answerBlob += `\n\n--- run ${runIndex + 1} (${answer.engine}) ---\n${answer.text}`;
    if (answer.aioPresent) aioSeen = true;

    let cited = false;
    const competitorHosts: string[] = [];

    for (const rawUrl of answer.urls) {
      const cleaned = stripTracking(rawUrl);
      // Only pay for a redirect resolve when the naive host check misses; a
      // shortener or legacy path is the case that matters.
      const resolved = isSubjectUrl(cleaned, job.hostname) ? cleaned : await resolveUrl(cleaned);
      const subject = isSubjectUrl(resolved, job.hostname);
      let host = "";
      try {
        host = new URL(resolved).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      if (subject) cited = true;
      else competitorHosts.push(host);

      citationRows.push({ runIndex, url: rawUrl, resolved, hostname: host, isSubject: subject });
    }

    results.push({
      cited,
      mentioned: !cited && mentionsBrand(answer.text, job.hostname),
      aioPresent: answer.aioPresent,
      competitorHosts
    });
  }

  // Evidence for attribution.
  const rank = await organicRank(env, job.query, job.hostname);
  const verdict = summarize({
    runs: results,
    organicRank: rank,
    rankHeld: rank !== null && rank <= 8,
    techPass: true // replaced by the real technical check in the app pipeline
  });

  // Raw answer text to R2 — this is what "show me the receipt" reads from.
  const answerKey = `answers/${job.scan_id}/${job.query_id}/${job.engine}.txt`;
  await env.ARTIFACTS.put(answerKey, answerBlob.trim(), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" }
  });

  const obsId = rid("obs");
  await env.DB.prepare(
    `INSERT INTO observations
       (id, scan_id, query_id, engine, runs, cited_runs, citation_rate, mention_runs,
        answer_key, organic_rank, aio_present, tech_pass, cause, cause_confidence, scanned_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      obsId,
      job.scan_id,
      job.query_id,
      job.engine,
      verdict.runs,
      verdict.citedRuns,
      verdict.citationRate,
      verdict.mentionRuns,
      answerKey,
      rank,
      aioSeen ? 1 : 0,
      1,
      verdict.cause,
      verdict.confidence,
      nowS()
    )
    .run();

  if (citationRows.length) {
    await env.DB.batch(
      citationRows.slice(0, 40).map((c) =>
        env.DB.prepare(
          `INSERT INTO citations (id, observation_id, run_index, url, resolved_url, hostname, is_subject)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(rid("cit"), obsId, c.runIndex, c.url, c.resolved, c.hostname, c.isSubject ? 1 : 0)
      )
    );
  }

  // Competitors are discovered, never crawled: they appear because engines cite them.
  const discovered = [...new Set(citationRows.filter((c) => !c.isSubject).map((c) => c.hostname))]
    .filter((h) => !h.endsWith("g2.com") && !h.endsWith("capterra.com"))
    .slice(0, 10);
  if (discovered.length) {
    const domain = await env.DB.prepare(`SELECT domain_id FROM scans WHERE id = ?`)
      .bind(job.scan_id)
      .first<{ domain_id: string }>();
    if (domain) {
      await env.DB.batch(
        discovered.map((h) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO competitors (id, domain_id, hostname, discovered, created_at)
             VALUES (?,?,?,1,?)`
          ).bind(rid("cmp"), domain.domain_id, h, nowS())
        )
      );
    }
  }

  await env.DB.prepare(`UPDATE scans SET queries_done = queries_done + 1 WHERE id = ?`)
    .bind(job.scan_id)
    .run();
}

/** When every job for a scan is settled: compute the rollup and close it out. */
async function finalizeIfDone(env: Env, scanId: string): Promise<void> {
  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('done','error') THEN 1 ELSE 0 END) AS settled,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errored,
       COUNT(*) AS total
     FROM scan_jobs WHERE scan_id = ?`
  )
    .bind(scanId)
    .first<{ settled: number; errored: number; total: number }>();

  if (!counts || counts.settled < counts.total) return;

  const agg = await env.DB.prepare(
    `SELECT SUM(cited_runs) AS cited, SUM(runs) AS runs FROM observations WHERE scan_id = ?`
  )
    .bind(scanId)
    .first<{ cited: number; runs: number }>();

  const cited = agg?.cited ?? 0;
  const runs = agg?.runs ?? 0;
  const rate = citationRate(cited, runs);
  const [low, high] = confidenceBand(cited, runs);

  const status = counts.errored > 0 ? (counts.errored === counts.total ? "failed" : "partial") : "complete";

  await env.DB.prepare(
    `UPDATE scans SET status = ?, citation_rate = ?, completed_at = ? WHERE id = ?`
  )
    .bind(status, rate, nowS(), scanId)
    .run();

  // Cause mix for the rollup the charts read.
  const causes = await env.DB.prepare(
    `SELECT cause, COUNT(*) AS n FROM observations
      WHERE scan_id = ? AND cause IS NOT NULL GROUP BY cause`
  )
    .bind(scanId)
    .all<{ cause: string; n: number }>();

  const totalCauses = (causes.results ?? []).reduce((s, r) => s + r.n, 0) || 1;
  const share = (key: string) =>
    ((causes.results ?? []).find((r) => r.cause === key)?.n ?? 0) / totalCauses;

  const scan = await env.DB.prepare(`SELECT domain_id FROM scans WHERE id = ?`)
    .bind(scanId)
    .first<{ domain_id: string }>();
  if (!scan) return;

  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO daily_rollups
       (domain_id, day, engine, cluster, citation_rate, runs, band_low, band_high,
        cause_aio, cause_rank, cause_tech, cause_other)
     VALUES (?,?,'*','*',?,?,?,?,?,?,?,?)
     ON CONFLICT(domain_id, day, engine, cluster) DO UPDATE SET
       citation_rate = excluded.citation_rate,
       runs = excluded.runs,
       band_low = excluded.band_low,
       band_high = excluded.band_high,
       cause_aio = excluded.cause_aio,
       cause_rank = excluded.cause_rank,
       cause_tech = excluded.cause_tech,
       cause_other = excluded.cause_other`
  )
    .bind(
      scan.domain_id,
      day,
      rate,
      runs,
      low,
      high,
      share("aio_displacement"),
      share("ranking_decline"),
      share("technical_decay"),
      share("unexplained")
    )
    .run();
}
