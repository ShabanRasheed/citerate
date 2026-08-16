#!/usr/bin/env node
/**
 * Phase 17 — deploy preflight for the marketing repo. Zero dependencies, runs
 * offline, reads only the repo: wrangler.toml, workers/scanner/wrangler.toml,
 * .env, .env.example, migrations/, public/, src/data/pricing.json.
 *
 *   pnpm preflight          production readiness (wrangler.toml [vars])
 *   pnpm preflight:local    local readiness (.env)
 *
 * BLOCK = deploying now ships something broken or fake.
 * WARN  = known-open, does not block launch.
 * NOTE  = cannot be verified offline; confirm by hand.
 *
 * Exits 1 if any BLOCK. Wired into `deploy` so a misconfigured deploy stops
 * before it reaches Cloudflare rather than after. Mirrors the app repo's
 * preflight; the checks that differ are the ones this repo owns — the free
 * scan, the scanner Worker, and the two configs agreeing with each other.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const local = process.argv.includes("--local");
const out = [];
const add = (level, check, msg) => out.push({ level, check, msg });
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);

const toml = read("wrangler.toml") ?? "";
const scannerToml = read("workers/scanner/wrangler.toml") ?? "";
const example = read(".env.example") ?? "";
const envFile = read(local ? ".env" : "wrangler.toml");
if (local && envFile === null) {
  console.error("preflight: no .env — copy .env.example to .env first.");
  process.exit(1);
}

/** Reads a var out of .env (KEY=value) or a wrangler.toml [vars] block. */
const varFrom = (src, key, isToml) => {
  // The .env side uses [ \t] rather than \s: \s crosses the newline, so an
  // empty value would capture the following line and an unset key would look
  // set — a check that fails open.
  const re = isToml
    ? new RegExp(`^${key}\\s*=\\s*"([\\s\\S]*?)"`, "m")
    : new RegExp(`^${key}[ \\t]*=[ \\t]*(.*)$`, "m");
  const m = (src ?? "").match(re);
  if (!m) return null;
  return m[1].trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
};
const varOf = (key) => varFrom(envFile, key, !local);

/* ---- 1. placeholder ids ------------------------------------------------ */
const idsIn = (src) => [...src.matchAll(/^\s*(?:database_id|id)\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
const pagesIds = idsIn(toml);
const scannerIds = idsIn(scannerToml);
if (!local) {
  const ph = [...new Set([...pagesIds, ...scannerIds].filter((v) => /^REPLACE_WITH_/.test(v)))];
  if (ph.length) add("BLOCK", "binding ids", `still placeholder in wrangler.toml or the scanner: ${ph.join(", ")}`);
  else add("PASS", "binding ids", "no REPLACE_WITH_ left in either config");
}

/* ---- 2. one database, three configs ------------------------------------ */
// The scanner and both front ends must name the same D1 id, or a scan writes
// to a database the dashboard never reads.
const dbOf = (src) => {
  const m = /\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
};
const pagesDb = dbOf(toml);
const scannerDb = dbOf(scannerToml);
const appToml = existsSync(join(root, "..", "citerate-app", "wrangler.toml"))
  ? readFileSync(join(root, "..", "citerate-app", "wrangler.toml"), "utf8")
  : null;
const appDb = appToml ? dbOf(appToml) : null;
const dbs = { "wrangler.toml": pagesDb, "scanner": scannerDb, ...(appDb ? { "citerate-app": appDb } : {}) };
const distinct = [...new Set(Object.values(dbs).filter(Boolean))];
if (distinct.length > 1)
  add("BLOCK", "shared D1 id", `configs disagree — ${Object.entries(dbs).map(([k, v]) => `${k}=${v}`).join(", ")}`);
else if (distinct.length === 1) add("PASS", "shared D1 id", `all ${Object.keys(dbs).length} configs name ${distinct[0]}`);
if (!appToml) add("WARN", "sibling repo", "../citerate-app not found — could not confirm both front ends share one database.");

/* ---- 3. engine mocks --------------------------------------------------- */
// Production reads this from the scanner's [vars]; the site itself only needs
// it locally, so check whichever config owns it for this run.
const mocks = local ? varOf("USE_ENGINE_MOCKS") : varFrom(scannerToml, "USE_ENGINE_MOCKS", true);
if (mocks !== "false")
  add(
    local ? "WARN" : "BLOCK",
    "USE_ENGINE_MOCKS",
    `is "${mocks}" in ${local ? ".env" : "workers/scanner/wrangler.toml"} — every scan would return deterministic fake answers.`
  );
else add("PASS", "USE_ENGINE_MOCKS", "false — scans hit the real engines");

/* ---- 4. the free scan agrees everywhere -------------------------------- */
// The public promise. pricing.json states it on the page, [vars] enforces it,
// and .env.example has to match or a fresh clone scans a different product.
const pricing = (() => {
  try { return JSON.parse(read("src/data/pricing.json") ?? "{}"); } catch { return {}; }
})();
// The free tier states its limits in prose, so read them out of the sentence
// the visitor actually sees rather than a field that does not exist.
const freeBody = `${pricing.free?.body ?? ""} ${pricing.free?.limits ?? ""}`;
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const advertisedQueries = (/(\d+)\s+queries/i.exec(freeBody) ?? [])[1] ?? null;
const advertisedEnginesWord = (/(one|two|three|four|five)\s+engines?/i.exec(freeBody) ?? [])[1] ?? null;
const advertisedEngines = advertisedEnginesWord ? WORDS[advertisedEnginesWord.toLowerCase()] : null;

const limit = varOf("FREE_SCAN_QUERY_LIMIT");
const engines = varOf("FREE_SCAN_ENGINES");
const exLimit = varFrom(example, "FREE_SCAN_QUERY_LIMIT", false);
const exEngines = varFrom(example, "FREE_SCAN_ENGINES", false);

if (!limit) add("BLOCK", "FREE_SCAN_QUERY_LIMIT", "unset — the scan endpoint has no ceiling.");
else if (advertisedQueries && advertisedQueries !== String(limit))
  add("BLOCK", "free scan limit", `config allows ${limit} queries, the pricing page advertises ${advertisedQueries} — the page promises something the endpoint refuses.`);
else if (exLimit && exLimit !== limit)
  add("WARN", "free scan limit", `${limit} here, ${exLimit} in .env.example — a fresh clone scans a different product.`);
else add("PASS", "free scan limit", `${limit} queries, matching the pricing page`);

if (!engines) add("BLOCK", "FREE_SCAN_ENGINES", "unset — the scan would run every engine and spend on a free result.");
else {
  const n = engines.split(",").filter(Boolean).length;
  if (advertisedEngines && advertisedEngines !== n)
    add("BLOCK", "free scan engines", `config runs ${n} (${engines}), the pricing page advertises ${advertisedEnginesWord}.`);
  else if (exEngines && exEngines !== engines)
    add("WARN", "FREE_SCAN_ENGINES", `"${engines}" here, "${exEngines}" in .env.example.`);
  else add("PASS", "free scan engines", `${n} — ${engines}, matching the pricing page`);
}

const ttl = varOf("FREE_SCAN_CACHE_TTL_SECONDS");
if (ttl && +ttl < 3600)
  add("WARN", "scan cache TTL", `${ttl}s — the decision was one live scan per domain per day (86400).`);
else if (ttl) add("PASS", "scan cache TTL", `${ttl}s`);

const runs = varOf("RUNS_PER_ENGINE");
const scannerRuns = varFrom(scannerToml, "RUNS_PER_ENGINE", true);
if (runs && scannerRuns && runs !== scannerRuns)
  add("BLOCK", "RUNS_PER_ENGINE", `site says ${runs}, scanner says ${scannerRuns} — the band on the readout would not match how it was sampled.`);
else if (runs) add("PASS", "RUNS_PER_ENGINE", `${runs}, site and scanner agree`);

/* ---- 5. Turnstile ------------------------------------------------------- */
const tsKey = varOf("PUBLIC_TURNSTILE_SITE_KEY");
const TEST_KEYS = /^(1x0{20}AA|2x0{20}AB|3x0{20}FF|0x0+2?)$/;
if (!tsKey) add("BLOCK", "Turnstile", "PUBLIC_TURNSTILE_SITE_KEY unset — the scan form has no bot gate.");
else if (!local && TEST_KEYS.test(tsKey))
  add("BLOCK", "Turnstile", `site key is Cloudflare's test key (${tsKey}) — production would accept every bot.`);
else if (local && !TEST_KEYS.test(tsKey))
  add("WARN", "Turnstile", "local config uses a real site key — the always-passes test key is easier locally.");
else add("PASS", "Turnstile", local ? "test key locally" : "real site key");

/* ---- 6. urls ----------------------------------------------------------- */
const siteUrl = varOf("PUBLIC_SITE_URL");
const appUrl = varOf("PUBLIC_APP_URL");
if (!local) {
  const bad = [["PUBLIC_SITE_URL", siteUrl], ["PUBLIC_APP_URL", appUrl]].filter(([, v]) => !v || /localhost/.test(v));
  if (bad.length) add("BLOCK", "public urls", `${bad.map(([k, v]) => `${k}=${v || "unset"}`).join(", ")} — links and canonicals would point at a dev machine.`);
  else if (!/^https:\/\//.test(siteUrl ?? "")) add("BLOCK", "public urls", `PUBLIC_SITE_URL is not https: ${siteUrl}`);
  else add("PASS", "public urls", `${siteUrl} → ${appUrl}`);
} else if (siteUrl && appUrl) add("PASS", "public urls", `${siteUrl} → ${appUrl}`);

/* ---- 7. local: shared state ------------------------------------------- */
if (local) {
  if (!existsSync(join(root, ".wrangler", "state")))
    add("WARN", "local D1 state", ".wrangler/state does not exist yet — run db:migrate:local, then db:seed:local. The app repo reads this same directory.");
  else add("PASS", "local D1 state", ".wrangler/state present — this repo owns it, citerate-app persists into it");
  if (!existsSync(join(root, "infra", "seeds", "dev.sql")))
    add("WARN", "seed", "infra/seeds/dev.sql missing — dev screens would render empty.");
}

/* ---- 8. migrations ----------------------------------------------------- */
const migDir = join(root, "migrations");
const migs = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort() : [];
if (!migs.includes("0001_init.sql")) add("BLOCK", "migrations", "0001_init.sql missing — nothing creates the base tables.");
else add("PASS", "migrations", `${migs.length} on disk (${migs.join(", ")})`);
add("NOTE", "migrations applied", local
  ? "pnpm db:migrate:local then db:seed:local"
  : "pnpm db:migrate:remote BEFORE deploy — Pages does not run migrations for you.");

/* ---- 9. secrets -------------------------------------------------------- */
const pagesSecrets = ["TURNSTILE_SECRET_KEY", "RESEND_API_KEY", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "SESSION_SECRET"];
const engineSecrets = ["OPENAI_API_KEY", "PERPLEXITY_API_KEY", "GEMINI_API_KEY", "SERP_API_KEY"];
if (local) {
  const weak = varOf("SESSION_SECRET");
  if (!weak || /change-me|put-it-here|dev-only/.test(weak))
    add("WARN", "SESSION_SECRET", "still the placeholder — fine locally, never in production.");
  const unset = engineSecrets.filter((s) => !varOf(s));
  if (unset.length && mocks === "false")
    add("BLOCK", "engine keys", `USE_ENGINE_MOCKS is false but ${unset.join(", ")} are unset — those engines would be marked unavailable on every scan.`);
  else if (unset.length)
    add("WARN", "engine keys", `unset: ${unset.join(", ")} — harmless while mocks are on.`);
} else {
  add("NOTE", "Pages secrets", `confirm: wrangler pages secret list --project-name=citerate → ${pagesSecrets.join(", ")}`);
  add("NOTE", "scanner secrets", `confirm: wrangler secret list --config workers/scanner/wrangler.toml → ${engineSecrets.join(", ")}`);
  const leaked = [...pagesSecrets, ...engineSecrets].filter((s) => new RegExp(`^\\s*${s}\\s*=`, "m").test(toml + scannerToml));
  if (leaked.length) add("BLOCK", "secrets in repo", `assigned in a wrangler.toml: ${leaked.join(", ")} — remove and use secret put.`);
}

/* ---- 10. .env.example covers what the code reads ----------------------- */
const declared = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const inToml = new Set([...toml.matchAll(/^([A-Z][A-Z0-9_]*)\s*=\s*"/gm)].map((m) => m[1]));
const missingFromExample = [...inToml].filter((k) => !declared.has(k));
if (missingFromExample.length)
  add("WARN", ".env.example", `production sets ${missingFromExample.join(", ")} with no local default — a fresh clone has no value for them.`);
else add("PASS", ".env.example", `${declared.size} keys, covering every [vars] entry`);

/* ---- 11. headers, robots, build ---------------------------------------- */
const headers = read("public/_headers") ?? "";
if (!headers) add("BLOCK", "public/_headers", "missing — no CSP or cache policy would ship.");
else {
  const missing = ["content-security-policy", "x-content-type-options", "referrer-policy"].filter((h) => !new RegExp(h, "i").test(headers));
  if (missing.length) add("WARN", "public/_headers", `no ${missing.join(", ")}`);
  else add("PASS", "public/_headers", "CSP, nosniff and referrer policy present");
}

const robots = read("public/robots.txt") ?? "";
if (!robots) add("WARN", "robots.txt", "missing.");
else if (/^\s*Disallow:\s*\/\s*$/mi.test(robots) && !local)
  add("BLOCK", "robots.txt", "Disallow: / — the marketing site would be deindexed.");
else if (!/sitemap/i.test(robots)) add("WARN", "robots.txt", "no Sitemap line.");
else add("PASS", "robots.txt", "crawlable, sitemap declared");

const pkg = JSON.parse(read("package.json") ?? "{}");
if (!/pagefind/.test(pkg.scripts?.build ?? ""))
  add("WARN", "search index", "build does not run pagefind — on-site search would return nothing.");
else add("PASS", "search index", "build runs pagefind over dist");

add("NOTE", "scanner cron", "the Pages deploy does not deploy the Worker — run pnpm scanner:deploy too, or scans queue and never run.");

/* ---- report ------------------------------------------------------------ */
const order = { BLOCK: 0, WARN: 1, NOTE: 2, PASS: 3 };
out.sort((a, b) => order[a.level] - order[b.level]);
const pad = Math.max(...out.map((r) => r.check.length));
const blocks = out.filter((r) => r.level === "BLOCK").length;
const warns = out.filter((r) => r.level === "WARN").length;

console.log(`\nciterate preflight — ${local ? "local (.env)" : "production (wrangler.toml)"}\n`);
for (const r of out) console.log(`  ${r.level.padEnd(5)}  ${r.check.padEnd(pad)}  ${r.msg}`);
console.log(
  `\n  ${blocks} blocking, ${warns} open-by-choice, ${out.filter((r) => r.level === "PASS").length} clear.\n` +
    (blocks
      ? `  Not deployable yet. Fix the ${blocks} BLOCK line${blocks === 1 ? "" : "s"} above, then run again.\n`
      : `  Clear to deploy. The WARN lines are deliberate; the NOTE lines need a human.\n`)
);
process.exit(blocks ? 1 : 0);
