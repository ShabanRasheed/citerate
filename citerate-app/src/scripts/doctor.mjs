#!/usr/bin/env node
/**
 * Local verification — proves the two dev servers, the shared database and the
 * route guards actually work. Zero dependencies, no browser, ~2 seconds.
 *
 *   pnpm dev            (this repo, port 4322)
 *   pnpm dev            (../citerate, port 4321)
 *   pnpm verify:local
 *
 * Defaults can be overridden: --app=http://localhost:4322 --site=http://localhost:4321
 * Exits 1 on any FAIL. Everything it cannot see from outside is printed at the
 * end as a short by-hand list.
 */
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const APP = arg("app", "http://localhost:4322").replace(/\/$/, "");
const SITE = arg("site", "http://localhost:4321").replace(/\/$/, "");

const results = [];
const ok = (name, detail) => results.push({ pass: true, name, detail });
const no = (name, detail) => results.push({ pass: false, name, detail });

async function get(url, { redirect = "manual" } = {}) {
  try {
    const res = await fetch(url, { redirect, headers: { "user-agent": "citerate-doctor" } });
    return { res, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
  } catch (error) {
    return { error: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

/* ---- 1. is anything listening? ---------------------------------------- */
const appRoot = await get(`${APP}/sign-in`);
if (appRoot.error) {
  no("app server", `${APP} not answering (${appRoot.error}) — run pnpm dev in citerate-app`);
} else {
  ok("app server", `${APP} answering`);
}

const siteRoot = await get(`${SITE}/`);
if (siteRoot.error) {
  no("marketing server", `${SITE} not answering (${siteRoot.error}) — run pnpm dev in ../citerate`);
} else if (siteRoot.res.status !== 200) {
  no("marketing server", `/ returned ${siteRoot.res.status}, expected 200`);
} else {
  ok("marketing server", `${SITE} answering`);
}

/* ---- 2. database, migrations, seed, bindings --------------------------- */
const health = await get(`${APP}/healthz`);
if (health.error) {
  no("database", `/healthz unreachable — ${health.error}`);
} else if (health.res.status === 503) {
  no("database", `D1 binding is broken: ${JSON.stringify(health.body)}`);
} else {
  const h = typeof health.body === "object" ? health.body : {};
  if (h.db === "up") ok("database", "D1 answers through platformProxy");
  else no("database", `unexpected /healthz body: ${JSON.stringify(h)}`);

  if (typeof h.migrations === "string") {
    if (h.migrations.startsWith("incomplete"))
      no("migrations", `${h.migrations} — run db:migrate:local in ../citerate first, then here`);
    else ok("migrations", h.migrations);
  }

  const seed = h.seed ?? {};
  const empty = Object.entries(seed).filter(([, v]) => !v).map(([k]) => k);
  if (!Object.keys(seed).length) no("seed", "no counts returned");
  else if (empty.length)
    no("seed", `empty: ${empty.join(", ")} — run pnpm db:seed:local (and ../citerate's db:seed:local)`);
  else
    ok("seed", Object.entries(seed).map(([k, v]) => `${k}:${v}`).join("  "));

  const b = h.bindings ?? {};
  const dead = Object.entries(b).filter(([k, v]) => !v && k !== "BROWSER").map(([k]) => k);
  if (dead.length) no("bindings", `unresolved: ${dead.join(", ")} — check wrangler.toml`);
  else ok("bindings", `DB, SCAN_CACHE, RATE_LIMIT, ARTIFACTS live${b.BROWSER ? " + BROWSER" : " (BROWSER absent locally — PDF uses the print path)"}`);

  if (h.engine === "mocks") ok("engine", "mocks — expected locally, no API spend");
  else ok("engine", "live engines — real API calls will be billed");
}

/* ---- 3. route guards: the thing most likely to silently break ---------- */
const guarded = ["/overview", "/queries", "/reports", "/settings/billing", "/settings/team", "/competitors", "/fixes"];
const leaks = [];
for (const path of guarded) {
  const r = await get(`${APP}${path}`);
  if (r.error) { leaks.push(`${path} errored`); continue; }
  const loc = r.res.headers.get("location") ?? "";
  const redirectedToSignIn = [301, 302, 303, 307, 308].includes(r.res.status) && /sign-in/.test(loc);
  if (!redirectedToSignIn) leaks.push(`${path} → ${r.res.status}${loc ? ` ${loc}` : ""}`);
}
if (leaks.length) no("auth guard", `signed-out access not redirected: ${leaks.join(", ")}`);
else ok("auth guard", `${guarded.length} panes redirect a signed-out visitor to /sign-in`);

const pub = [["/sign-in", 200], ["/sign-up", 200], ["/check-email", 200]];
const badPub = [];
for (const [path, want] of pub) {
  const r = await get(`${APP}${path}`);
  if (r.error || r.res.status !== want) badPub.push(`${path} → ${r.error ?? r.res.status}`);
}
if (badPub.length) no("public app routes", badPub.join(", "));
else ok("public app routes", "sign-in, sign-up, check-email all 200");

/* ---- 4. the app must never be indexable ------------------------------- */
const robots = await get(`${APP}/robots.txt`);
if (robots.error) no("robots.txt", robots.error);
else if (!/disallow:\s*\//i.test(String(robots.body))) no("robots.txt", "does not disallow / — the app would be crawlable");
else ok("robots.txt", "disallows everything");

/* ---- 5. marketing pages the funnel depends on ------------------------- */
if (!siteRoot.error) {
  const pages = ["/pricing", "/how-it-works", "/for/agencies", "/security"];
  const bad = [];
  for (const p of pages) {
    const r = await get(`${SITE}${p}`);
    if (r.error || r.res.status !== 200) bad.push(`${p} → ${r.error ?? r.res.status}`);
  }
  if (bad.length) no("marketing pages", bad.join(", "));
  else ok("marketing pages", "pricing, how-it-works, agencies, security all 200");
}

/* ---- report ------------------------------------------------------------ */
const fails = results.filter((r) => !r.pass);
const pad = Math.max(...results.map((r) => r.name.length));
console.log(`\nciterate local verification — app ${APP} · site ${SITE}\n`);
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
console.log(`\n  ${results.length - fails.length} of ${results.length} clear.\n`);

if (!fails.length) {
  console.log(`  Automated checks are clear. Four things only a human can see:

   1. Sign in — request a link on /sign-in, copy the URL printed in the dev
      server console, open it. You land in onboarding, not the dashboard.
   2. Onboarding — enter any domain; queries arrive labelled crawl + category.
   3. Report — open a seeded report, print to PDF: no clipped cards, no dark
      panels bleeding, footnotes intact.
   4. Client role — sign in as the seeded client user: no billing, no settings,
      no second workspace anywhere in the nav.
`);
}
process.exit(fails.length ? 1 : 0);
