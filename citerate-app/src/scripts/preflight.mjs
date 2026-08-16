#!/usr/bin/env node
/**
 * Phase 11 — deploy preflight. Zero dependencies, runs offline, reads only the
 * repo: wrangler.toml, .env, migrations/, public/.
 *
 *   pnpm preflight          production readiness (wrangler.toml [vars])
 *   pnpm preflight:local    local readiness (.env)
 *
 * BLOCK = deploying now ships something broken or fake.
 * WARN  = known-open, does not block launch (README §8).
 * NOTE  = cannot be verified offline; confirm by hand.
 *
 * Exits 1 if any BLOCK. Wired into `deploy` so a misconfigured deploy stops
 * before it reaches Cloudflare rather than after.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const local = process.argv.includes("--local");
const out = [];
const add = (level, check, msg) => out.push({ level, check, msg });

const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null);

/* ---- source of truth for this run ------------------------------------- */
const toml = read("wrangler.toml") ?? "";
const envFile = read(local ? ".env" : "wrangler.toml");
if (local && envFile === null) {
  console.error("preflight: no .env — copy .env.example to .env first.");
  process.exit(1);
}

/** Reads a var out of .env (KEY=value) or wrangler.toml ([vars] KEY = "value"). */
const varOf = (key) => {
  const src = envFile ?? "";
  const re = local
    ? new RegExp(`^${key}[ \\t]*=[ \\t]*(.*)$`, "m")
    : new RegExp(`^${key}\\s*=\\s*"([\\s\\S]*?)"\\s*$`, "m");
  const m = src.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
};

/* ---- 1. placeholder ids ----------------------------------------------- */
const placeholders = [...toml.matchAll(/^\s*(?:database_id|id|[A-Z_]+)\s*=\s*"(REPLACE_WITH_[A-Z_]+)"/gm)].map(
  (m) => m[1]
);
if (placeholders.length && !local)
  add("BLOCK", "wrangler.toml ids", `still placeholder: ${[...new Set(placeholders)].join(", ")}`);
else if (!local) add("PASS", "wrangler.toml ids", "no REPLACE_WITH_ left");

/* ---- 2. engine mocks --------------------------------------------------- */
const mocks = varOf("USE_ENGINE_MOCKS");
if (mocks !== "false")
  add(
    local ? "WARN" : "BLOCK",
    "USE_ENGINE_MOCKS",
    `is "${mocks}" — every readout on the deployed app would be mock data. Set to false once the scanner Worker answers.`
  );
else add("PASS", "USE_ENGINE_MOCKS", "false — screens read the real engine");

/* ---- 3. Paddle price map ---------------------------------------------- */
const PLANS = ["starter", "growth", "scale", "agency"];
const ADDONS = ["extra_queries", "extra_domain", "rescan_pack", "seat_growth"];
const raw = varOf("PADDLE_PRICE_IDS");
if (!raw) {
  add("BLOCK", "PADDLE_PRICE_IDS", "unset — checkout returns 501 for every plan. Paste the JSON map from the Paddle dashboard.");
} else {
  let map = null;
  try {
    map = JSON.parse(raw);
  } catch {
    add("BLOCK", "PADDLE_PRICE_IDS", "is not valid JSON — checkout falls back to {} and 501s silently.");
  }
  if (map) {
    const missing = [];
    const malformed = [];
    for (const plan of PLANS)
      for (const interval of ["month", "year"]) {
        const v = map[plan]?.[interval];
        if (!v) missing.push(`${plan}.${interval}`);
        else if (!/^pri_/.test(v)) malformed.push(`${plan}.${interval}=${v}`);
      }
    for (const a of ADDONS) {
      const v = map.addons?.[a];
      if (!v) missing.push(`addons.${a}`);
      else if (!/^pri_/.test(v)) malformed.push(`addons.${a}=${v}`);
    }
    if (missing.length) add("BLOCK", "PADDLE_PRICE_IDS", `missing ${missing.length} of 12: ${missing.join(", ")}`);
    if (malformed.length) add("BLOCK", "PADDLE_PRICE_IDS", `not a Paddle price id (expect pri_…): ${malformed.join(", ")}`);
    if (!missing.length && !malformed.length) add("PASS", "PADDLE_PRICE_IDS", "8 plan prices + 4 add-ons, all pri_…");
  }
}
const paddleEnv = varOf("PADDLE_ENV");
if (!local && paddleEnv !== "production")
  add("BLOCK", "PADDLE_ENV", `is "${paddleEnv}" — production money would route to Paddle's sandbox.`);
else if (local && paddleEnv !== "sandbox")
  add("WARN", "PADDLE_ENV", `is "${paddleEnv}" in local config — local checkouts would hit live Paddle.`);
else add("PASS", "PADDLE_ENV", paddleEnv);

/* ---- 4. Google OAuth --------------------------------------------------- */
const gid = varOf("GOOGLE_CLIENT_ID");
if (!gid || /REPLACE_WITH/.test(gid))
  add("BLOCK", "GOOGLE_CLIENT_ID", "unset — Google sign-in is hidden and the GSC connect reads \u201cunconfigured\u201d.");
else if (!/\.apps\.googleusercontent\.com$/.test(gid))
  add("WARN", "GOOGLE_CLIENT_ID", "does not end .apps.googleusercontent.com — check it is the client id, not the project id.");
else add("PASS", "GOOGLE_CLIENT_ID", "well-formed");

const appUrl = varOf("PUBLIC_APP_URL");
if (appUrl) add("NOTE", "OAuth redirect uri", `must be registered verbatim in GCP: ${appUrl}/api/connect/gsc/callback`);

/* ---- 4b. local: shared state with the sibling repo ---------------------- */
if (local) {
  const sibling = join(root, "..", "citerate");
  if (!existsSync(join(sibling, "migrations", "0001_init.sql")))
    add("BLOCK", "sibling repo", "../citerate not found — local D1 state is shared from there; clone both repos side by side.");
  else if (!existsSync(join(sibling, ".wrangler", "state")))
    add("WARN", "shared local D1", "../citerate/.wrangler/state does not exist yet — run db:migrate:local in the marketing repo first (0001 creates the base tables).");
  else add("PASS", "shared local D1", "../citerate/.wrangler/state present — both repos read one local database");
}

/* ---- 5. migrations ----------------------------------------------------- */
const migDir = join(root, "migrations");
const migs = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort() : [];
const need = ["0002_app.sql", "0003_connections.sql"];
const absent = need.filter((n) => !migs.includes(n));
if (absent.length) add("BLOCK", "migrations", `missing ${absent.join(", ")}`);
else add("PASS", "migrations", `${migs.length} on disk (${migs.join(", ")})`);
add(
  "NOTE",
  "migrations applied",
  local ? "pnpm db:migrate:local — 0003 creates gsc_connections" : "pnpm db:migrate:remote BEFORE deploy — 0003 creates gsc_connections"
);

/* ---- 6. secrets (never in the repo, so only listable) ------------------ */
const secrets = ["SESSION_SECRET", "TURNSTILE_SECRET_KEY", "RESEND_API_KEY", "PADDLE_API_KEY", "GOOGLE_CLIENT_SECRET"];
if (local) {
  const weak = varOf("SESSION_SECRET");
  if (!weak || /change-me|dev-only/.test(weak)) add("WARN", "SESSION_SECRET", "still the dev placeholder — fine locally, never in production.");
  const unset = secrets.filter((s) => !varOf(s));
  if (unset.length) add("WARN", "local secrets", `unset: ${unset.join(", ")} — those features degrade, they do not crash.`);
} else {
  add("NOTE", "secrets", `confirm all five are set: wrangler pages secret list --project-name=citerate-app → ${secrets.join(", ")}`);
  if (/^\s*(SESSION_SECRET|PADDLE_API_KEY|GOOGLE_CLIENT_SECRET|RESEND_API_KEY|TURNSTILE_SECRET_KEY)\s*=/m.test(toml))
    add("BLOCK", "secrets in repo", "a secret is assigned in wrangler.toml — remove it and use `wrangler pages secret put`.");
}

/* ---- 7. browser binding vs the dependency ----------------------------- */
const pkg = JSON.parse(read("package.json") ?? "{}");
const hasPuppeteer = !!pkg.dependencies?.["@cloudflare/puppeteer"];
const hasBinding = /^\s*\[browser\]/m.test(toml);
if (hasBinding && !hasPuppeteer)
  add("BLOCK", "PDF renderer", "[browser] binding is declared but @cloudflare/puppeteer is not a dependency — the route would throw.");
else if (!hasBinding && hasPuppeteer)
  add("WARN", "PDF renderer", "no [browser] binding — PDF downloads fall back to the print path (stated on the page).");
else if (hasBinding) add("PASS", "PDF renderer", "[browser] binding + @cloudflare/puppeteer present");
add("NOTE", "PDF renderer", "Browser Rendering is a paid add-on — if the account lacks it, delete [browser] from wrangler.toml and the print path takes over.");

/* ---- 8. headers, robots, fonts ---------------------------------------- */
const headers = read("public/_headers") ?? "";
if (!/noindex/i.test(headers)) add("BLOCK", "public/_headers", "no noindex — the authenticated app would be indexable.");
else if (!/no-store/i.test(headers)) add("WARN", "public/_headers", "noindex present, no-store missing.");
else add("PASS", "public/_headers", "noindex + no-store");

const fontDir = join(root, "public", "fonts");
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => f.endsWith(".woff2")) : [];
if (fonts.length < 4)
  add("WARN", "fonts", `${fonts.length} of 4 woff2 in public/fonts — display type falls back to Georgia. Known-open, README §8.`);
else add("PASS", "fonts", "4 woff2 present");

add("WARN", "2FA enrolment", "column and pane exist, enrolment screens do not. Known-open, README §8 — go/no-go call.");

/* ---- report ------------------------------------------------------------ */
const order = { BLOCK: 0, WARN: 1, NOTE: 2, PASS: 3 };
out.sort((a, b) => order[a.level] - order[b.level]);
const pad = Math.max(...out.map((r) => r.check.length));
const blocks = out.filter((r) => r.level === "BLOCK").length;
const warns = out.filter((r) => r.level === "WARN").length;

console.log(`\nciterate-app preflight — ${local ? "local (.env)" : "production (wrangler.toml)"}\n`);
for (const r of out) console.log(`  ${r.level.padEnd(5)}  ${r.check.padEnd(pad)}  ${r.msg}`);
console.log(
  `\n  ${blocks} blocking, ${warns} open-by-choice, ${out.filter((r) => r.level === "PASS").length} clear.\n` +
    (blocks
      ? `  Not deployable yet. Fix the ${blocks} BLOCK line${blocks === 1 ? "" : "s"} above, then run again.\n`
      : `  Clear to deploy. The WARN lines are deliberate; the NOTE lines need a human.\n`)
);
process.exit(blocks ? 1 : 0);
