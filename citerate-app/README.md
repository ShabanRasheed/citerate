# Citerate — dashboard (`app.citerate.com`)

The other half of the stack. Same D1 database as the marketing repo, opposite JS
balance: **Bootstrap JS + Alpine + ECharts** here, hand-rolled 40-line modules
there. Astro 5 with `output: "server"` — every route is authenticated, so nothing
is prerendered.

> Marketing site + scan engine live in the sibling `citerate/` repo. Migration
> `0001_init.sql` belongs to that repo; this one adds `0002_app.sql` and
> `0003_connections.sql`.

---

## 1. First run

```bash
# once, in the sibling citerate/ repo — its 0001 creates the base tables:
cd ../citerate && pnpm db:migrate:local && cd ../citerate-app

pnpm install
cp .env.example .env               # SESSION_SECRET is the only value you must change
pnpm db:migrate:local              # applies 0002+0003 on top of the marketing repo's 0001
pnpm db:seed:local                 # agency + client workspace, 12 queries, 2 scans, 5 findings
pnpm dev                           # http://localhost:4322
```

**One local database, like production.** All local wrangler commands here (and
the dev server via `platformProxy.persist`) point at the marketing repo's
`.wrangler/state`, so both repos read the same local D1/KV/R2. The two repos
must sit side by side (`citerate/` and `citerate-app/`); run the marketing
repo's `db:migrate:local` before this one's, or 0002 has no tables to build on.

Sign in as `founder@northline.co`. With `RESEND_API_KEY` unset the magic link and
the six-digit code are printed to the dev server console — no mail needed.

The marketing repo runs on 4321 and this one on 4322 so both can be open at once;
`PUBLIC_SITE_URL` and `PUBLIC_APP_URL` cross-link them.

## 2. Deploy

```bash
wrangler pages project create citerate-app
# paste the SAME d1/kv/r2 ids the marketing repo uses into wrangler.toml
pnpm db:migrate:remote
pnpm deploy
```

Secrets (never in a file):

```bash
wrangler pages secret put SESSION_SECRET       --project-name=citerate-app
wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=citerate-app
wrangler pages secret put RESEND_API_KEY       --project-name=citerate-app
wrangler pages secret put PADDLE_API_KEY       --project-name=citerate-app
wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=citerate-app
```

PDF export uses the Pages **Browser Rendering** binding (`[browser]` in
wrangler.toml). Accounts without the add-on can delete that block — the PDF
route degrades to the report's print path.

Custom domain: `app.citerate.com`. Agency white-label domains
(`reports.youragency.com`) are CNAMEs onto the same Pages project — add each as a
custom domain, then set `brand_domain` on the workspace.

## 3. Routes

| URL | What it is |
| --- | --- |
| `/overview` | score unit → cause bar → trend → engines → top fixes → competitors |
| `/queries` | dense table, client-side filter/sort, per-row evidence drawer |
| `/fixes` | Fix Queue grouped by cause; verified section on top |
| `/competitors` | share of cited runs, same unit as the score |
| `/reports`, `/reports/[id]` | immutable snapshots; `[id]` is the PDF print source |
| `/settings` | profile, notifications, signed-in devices |
| `/settings/team` | seats, roles, invites, join requests |
| `/settings/billing` | plan, meter, overage, add-ons |
| `/settings/brand` | white label (Scale+) |
| `/settings/workspaces` | agency switcher, client workspaces |
| `/settings/email` | two-sided email change |
| `/sign-in`, `/sign-up`, `/check-email`, `/verify`, `/sign-out` | passwordless auth |
| `/claim/[token]` | claim a free readout from the marketing site |
| `/invite/[token]` | seat invite acceptance |
| `/onboarding/domain`, `/onboarding/queries`, `/onboarding/connect` | three steps, then the readout |
| `/healthz` | touches D1 so a broken binding fails loudly |

API: `auth/request-link`, `auth/verify-code`, `fixes/[id]`, `queries`,
`queries/[id]/evidence`, `rescan`, `scan/[id]`, `competitors`, `reports`,
`reports/[id]/pdf`, `team/*`, `settings/*`, `billing/*`, `connect/gsc`,
`connect/gsc/callback`, `onboarding/*`.

## 4. Auth model (Phase 3b, as built)

- Passwordless. One token answers to both the link and the typed code, because
  they are the same row: `hash(secret:code)`. The secret half lives in KV for the
  token's 15-minute life so the code-only path can verify.
- Cookie holds an opaque 160-bit value; D1 stores only its SHA-256. A leaked row
  cannot be replayed.
- "Trust this device" is **off** by default: 1 day, not 30.
- The response is identical for known and unknown emails, including when rate
  limited — otherwise the form enumerates accounts.
- A hostname another workspace already verified produces a **join request**, not
  an error. Two workspaces measuring one domain would double-count runs.
- `middleware.ts` is the only guard: session → workspace → domains, then pushes
  into `/onboarding/domain` when there is nothing to show.

## 5. Roles

`owner` · `admin` · `editor` · `viewer` · `client`. The interesting one is
`client`: read-only, free, unlimited, and never counted against seats — that is
what makes "share the dashboard with the client" safe for agencies. Capabilities
live in `lib/rbac.ts`; routes call `can()` and return 403 rather than hiding a
button and trusting the UI.

## 6. Method integrity in the UI

The same three rules the marketing site publishes, enforced in the panes:

1. **Rates are computed over runs.** Charts read `daily_rollups` only — never a
   live aggregate over `observations`.
2. **Movement inside the confidence band is "within noise".** The score unit
   prints that phrase instead of an arrow; the trend chart draws the Wilson band
   as a ribbon.
3. **Nothing below 0.6 confidence gets a cause.** It reads `unexplained` and is
   striped in every chart, and "other" is never hidden to make the mix look
   tidier.

Two consequences worth keeping: a fix moves to `verified` **only** when a scan
measures its own queries (the select option is disabled and the API rejects it),
and a report snapshot is never recomputed — a method change flags affected
history instead of quietly rewriting an issued PDF.

## 7. Performance and JS budget

- `app.js` loads Bootstrap's five used components, Alpine, and nothing else;
  ECharts is a separate chunk imported only when `data-charts="true"` and a
  `[data-chart]` exists.
- Auth and onboarding load `auth.js` instead — no Bootstrap, no Alpine, no
  charts. ~2 kB.
- Query table filtering, sorting, and detail toggling are DOM-only over rows that
  are already rendered; the single fetch is row evidence, cached after first open.
- Every pane server-renders its numbers. Charts have a `<noscript>` table and a
  print path, so a report prints correctly with JS off.

## 8. What is deliberately unfinished

Phase 10 closed the four launch blockers:

- **Query generation** — `lib/query-generator.ts` blends a crawl of the site
  (title, headings, sitemap slugs) with the category template; Search Console
  queries join the set after OAuth. Every row keeps its `source` label —
  `crawl`, `gsc`, or `category` — so provenance is never lost. Crawl failure
  degrades to category-only within 5s.
- **Paddle checkout** — price ids moved to the `PADDLE_PRICE_IDS` var (JSON,
  format in `api/billing/checkout.ts`); unset still returns a readable 501.
  `PADDLE_ENV=sandbox` routes to Paddle's sandbox API. Add-ons charge through
  hosted checkout when configured; the webhook raises the counter on payment.
- **Search Console OAuth** — `api/connect/gsc/callback.ts` burns the single-use
  state, exchanges the code, seals the refresh token (AES-GCM under
  SESSION_SECRET, `lib/seal.ts`) into `gsc_connections` (migration 0003), and
  pulls the domain's top GSC queries into the set up to the plan limit.
- **PDF rendering** — `api/reports/[id]/pdf.ts` renders `/reports/<id>` once
  with the Browser Rendering binding, stores the PDF in R2, stamps
  `artifact_key`, and streams the stored artifact ever after. No `BROWSER`
  binding → the route falls back to the print path.

Still open, deliberately:

- **2FA** — `users.totp_secret` exists and the account pane reads it; enrolment
  screens are not built.
- **Fonts** — copy the same four woff2 files into `public/fonts/` (the marketing
  repo's README §4 lists them).

## 9. Verifying a local run

With both dev servers up (`pnpm dev` here on 4322, `pnpm dev` in `../citerate`
on 4321):

```bash
pnpm verify:local
```

It checks what a human cannot see quickly: both servers answering, D1 reachable
through platformProxy, all three migrations applied, the seed present, every
binding resolved, mocks vs live engines, seven authenticated panes redirecting a
signed-out visitor to `/sign-in`, `robots.txt` disallowing everything, and the
four marketing pages the funnel needs. Exits 1 on any failure, then prints the
four checks that genuinely need eyes (sign-in, onboarding, PDF print, client
role). `/healthz` returns the same detail as JSON on localhost and `{ok,db}`
only when deployed.

## 10. Preflight (Phase 11)

```bash
pnpm preflight        # production readiness — reads wrangler.toml
pnpm preflight:local  # local readiness — reads .env
```

Zero dependencies, fully offline. It reads the repo and classifies every launch
item as **BLOCK** (deploying now ships something broken or fake), **WARN**
(known-open, listed in §8, does not block launch) or **NOTE** (cannot be checked
from the repo — a human confirms it). It exits 1 on any BLOCK and `pnpm deploy`
runs it first, so a misconfigured deploy stops here instead of on Cloudflare.
`pnpm deploy:force` is the escape hatch for a deliberate partial deploy.

What it catches that a checklist forgets: `USE_ENGINE_MOCKS` still `true` (every
readout would be mock data), `PADDLE_ENV` still `sandbox` in production, a
`PADDLE_PRICE_IDS` map that parses but is short of the 8 plan prices or 4
add-ons, price values that aren't `pri_…`, leftover `REPLACE_WITH_` ids, a
secret accidentally assigned in `wrangler.toml`, and a `[browser]` binding
without `@cloudflare/puppeteer`.

## 11. Files

```
citerate-app/
├─ migrations/0002_app.sql      join_requests · invites · notification_prefs
│                              saved_views · api_keys · report_snapshots
├─ migrations/0003_connections.sql  gsc_connections (sealed refresh tokens)
├─ infra/seeds/app-dev.sql      one agency + one client workspace, seeded readout
├─ public/_headers              noindex, no-store, frame-ancestors 'none'
└─ src/
   ├─ middleware.ts             the only auth guard
   ├─ styles/                   same 01→06 pipeline; wider Bootstrap partial list
   ├─ layouts/                  App (shell) · Auth (one card)
   ├─ components/               Sidebar · Topbar · ScoreUnit · CauseBar
   │                            TrendChart · EngineGrid · QueryTable · FixCard
   │                            Locked · Toasts
   ├─ scripts/                  app.js · auth.js + 6 modules
   ├─ lib/                      session · auth · rbac · data · format
   │                            app-emails · seed-queries · query-generator
   │                            seal (+ shared copies of
   │                            env/db/plans/scoring/email/domain)
   └─ pages/                    see the route table above
```

`lib/env.ts`, `db.ts`, `plans.ts`, `scoring.ts`, `email.ts`, and `domain.ts` are
byte-identical copies of the marketing repo's. They are duplicated on purpose —
two Pages projects, no shared package — so **edit them in `citerate/` first and
copy across**, or the two halves will disagree about what a citation is.
