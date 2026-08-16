/**
 * Report PDF (Phase 10). Idempotent: the first request renders /reports/<id>
 * with the Browser Rendering binding, writes the PDF to R2, and stamps
 * artifact_key on the snapshot; every later request streams the stored
 * artifact. A snapshot's PDF is rendered once and never recomputed — the same
 * promise the payload makes. Without a BROWSER binding the route falls back
 * to the report page, which is the print source and prints correctly.
 */
import type { APIRoute } from "astro";
import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import { env, one, fail } from "../../../../lib/db";
import { can } from "../../../../lib/rbac";
import { COOKIE } from "../../../../lib/session";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const e = env(ctx);
  const workspace = ctx.locals.workspace;
  if (!workspace) return fail("unauthorised", 401);
  if (!can(workspace.role, "export")) return fail("insufficient_role", 403);

  const report = await one<{ id: string; artifact_key: string | null; period: string; hostname: string }>(
    e.DB,
    `SELECT r.id, r.artifact_key, r.period, d.hostname
       FROM report_snapshots r JOIN domains d ON d.id = r.domain_id
      WHERE r.id = ? AND r.workspace_id = ?`,
    ctx.params.id,
    workspace.workspaceId
  );
  if (!report) return fail("not_found", 404);

  const headers = {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="citerate-${report.hostname}-${report.period}.pdf"`,
    "cache-control": "no-store"
  };

  if (report.artifact_key) {
    const stored = await e.ARTIFACTS.get(report.artifact_key);
    if (stored) return new Response(stored.body, { headers });
  }

  if (!e.BROWSER) return ctx.redirect(`/reports/${report.id}?pdf=unavailable`, 303);

  const browser = await puppeteer.launch(e.BROWSER as unknown as BrowserWorker);
  try {
    const page = await browser.newPage();
    // The report page is authenticated; hand the caller's own cookies to the
    // renderer so it sees exactly what the caller sees, nothing more.
    const host = new URL(e.PUBLIC_APP_URL).hostname;
    const jar = [COOKIE, "cr_ws"]
      .map((name) => ({ name, value: ctx.cookies.get(name)?.value ?? "" }))
      .filter((c) => c.value)
      .map((c) => ({ ...c, domain: host, path: "/", httpOnly: true, secure: true }));
    if (jar.length) await page.setCookie(...jar);

    await page.goto(`${e.PUBLIC_APP_URL}/reports/${report.id}`, {
      waitUntil: "networkidle0",
      timeout: 30_000
    });
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" }
    });

    const key = `reports/${workspace.workspaceId}/${report.id}.pdf`;
    await e.ARTIFACTS.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });
    await e.DB.prepare(`UPDATE report_snapshots SET artifact_key = ? WHERE id = ?`)
      .bind(key, report.id)
      .run();
    return new Response(pdf, { headers });
  } finally {
    await browser.close();
  }
};
