/** Per-engine evidence for one query — the table's row detail. */
import type { APIRoute } from "astro";
import { env, json, fail, one } from "../../../../lib/db";
import { queryEvidence } from "../../../../lib/data";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  if (!workspace) return fail("unauthorised", 401);

  const queryId = ctx.params.id!;

  // Ownership check: a query id is guessable, the data behind it is not public.
  const owned = await one<{ id: string }>(
    e.DB,
    `SELECT q.id FROM queries q
       JOIN query_sets s ON s.id = q.query_set_id
       JOIN domains d ON d.id = s.domain_id
      WHERE q.id = ? AND d.workspace_id = ?`,
    queryId,
    workspace.workspaceId
  );
  if (!owned) return fail("not_found", 404);

  const { observations, citations } = await queryEvidence(e, queryId);
  return json({
    observations,
    citations: citations.map((c) => ({
      observation_id: c.observation_id,
      run_index: c.run_index,
      hostname: c.hostname,
      is_subject: c.is_subject,
      excerpt: c.excerpt
    }))
  });
};
