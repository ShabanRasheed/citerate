/** GET /api/scan/:token — progress polling for the hero form. */
export const prerender = false;

import type { APIContext } from "astro";
import { env, one, json, fail } from "../../../lib/db";

interface Row {
  status: string;
  citation_rate: number | null;
  total: number;
  done: number;
}

export async function GET(ctx: APIContext): Promise<Response> {
  const e = env(ctx);
  const token = ctx.params.token;
  if (!token) return fail("Missing token", 400);

  const row = await one<Row>(
    e.DB,
    `SELECT s.status,
            s.citation_rate,
            (SELECT COUNT(*) FROM scan_jobs j WHERE j.scan_id = s.id) AS total,
            (SELECT COUNT(*) FROM scan_jobs j WHERE j.scan_id = s.id AND j.status IN ('done','error')) AS done
       FROM scans s WHERE s.share_token = ?`,
    token
  );

  if (!row) return fail("Not found", 404);

  return json({
    status: row.status,
    done: row.done,
    total: row.total,
    citationRate: row.citation_rate,
    url: `/scan/${token}`
  });
}
