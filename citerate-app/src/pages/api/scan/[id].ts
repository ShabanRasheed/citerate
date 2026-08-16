/** Scan progress. The same shape the marketing site's free-scan poller reads. */
import type { APIRoute } from "astro";
import { env, json, fail, one } from "../../../lib/db";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  if (!workspace) return fail("unauthorised", 401);

  const scan = await one<{
    id: string; status: string; queries_total: number; queries_done: number;
    citation_rate: number | null; completed_at: number | null;
  }>(
    e.DB,
    `SELECT id, status, queries_total, queries_done, citation_rate, completed_at
       FROM scans WHERE id = ? AND workspace_id = ?`,
    ctx.params.id!,
    workspace.workspaceId
  );
  if (!scan) return fail("not_found", 404);

  return json({
    scanId: scan.id,
    status: scan.status,
    queriesTotal: scan.queries_total,
    queriesDone: scan.queries_done,
    citationRate: scan.citation_rate,
    completedAt: scan.completed_at
  });
};
