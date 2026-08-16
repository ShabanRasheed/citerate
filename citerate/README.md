# Citerate — marketing site + scan engine

AI-visibility measurement. Astro 5 on Cloudflare Pages, D1 for data, R2 + KV for
artifacts and caching, a Worker cron for the scan queue. Everything sits inside a
free tier until you have paying customers; the only line that ever needs money is
the Workers paid plan at $5/month, and only once scan volume outgrows a cron tick.

Design system: `src/styles/01-settings/_tokens.scss` is the single source of truth
(ported verbatim from the Phase 1 token file). Bootstrap 5.3 compiles **against**
those tokens via `_bootstrap-map.scss` — nothing is overridden after the fact and
there is no `!important` in the codebase.

---

## 1. Prerequisites

- Node 20.11+ and pnpm 9+
- A Cloudflare account (free plan is enough)
- `pnpm add -g wrangler` or use the local one via `pnpm wrangler`

## 2. First run (5 minutes, no Cloudflare account needed)

```bash
pnpm install
cp .env.example .env          # USE_ENGINE_MOCKS=true by default — zero API spend
pnpm db:migrate:local         # creates the local D1 file
pnpm db:seed:local            # demo workspace, domain, scan, findings
pnpm dev                      # http://localhost:4321
```

`astro dev` runs with `platformProxy`, so `locals.runtime.env` gives you real
local D1/KV/R2. The scan form works end to end against mock engine answers.

To watch the queue drain locally, run the scanner in a second terminal:

```bash
pnpm scanner:dev              # then hit http://localhost:8787 to force a tick
```

## 3. Provisioning Cloudflare (one time)

```bash
wrangler login

wrangler d1 create citerate-db
wrangler kv namespace create SCAN_CACHE
wrangler kv namespace create RATE_LIMIT
wrangler r2 bucket create citerate-artifacts
```

Paste the returned ids into **both** `wrangler.toml` and
`workers/scanner/wrangler.toml` (they share the same bindings).

Then:

```bash
pnpm db:migrate:remote
pnpm deploy                   # Pages
pnpm scanner:deploy           # cron Worker
```

### Secrets

Never in a file. Pages:

```bash
wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=citerate
wrangler pages secret put SESSION_SECRET       --project-name=citerate
wrangler pages secret put RESEND_API_KEY       --project-name=citerate
wrangler pages secret put PADDLE_API_KEY       --project-name=citerate
wrangler pages secret put PADDLE_WEBHOOK_SECRET --project-name=citerate
```

Scanner Worker:

```bash
wrangler secret put OPENAI_API_KEY     --config workers/scanner/wrangler.toml
wrangler secret put PERPLEXITY_API_KEY --config workers/scanner/wrangler.toml
wrangler secret put GEMINI_API_KEY     --config workers/scanner/wrangler.toml
wrangler secret put SERP_API_KEY       --config workers/scanner/wrangler.toml
```

Then set `USE_ENGINE_MOCKS = "false"` in `workers/scanner/wrangler.toml`.

### Also configure in the dashboard

- **Custom domain** → Pages project → Custom domains → `citerate.com`
  (buy at Cloudflare Registrar: wholesale renewal, no markup)
- **Web Analytics** → copy the token into `src/layouts/Base.astro`
  (`data-cf-beacon`)
- **Turnstile** → create a widget, put the site key in `PUBLIC_TURNSTILE_SITE_KEY`
- **Email Routing** → route `hello@`, `sales@`, `help@`, `security@` to a real inbox
- **Resend** → verify the sending domain, add SPF/DKIM records

## 4. Fonts

Four self-hosted woff2 files, nothing hotlinked. Download once into `public/fonts/`:

```
source-serif-4-600.woff2
source-serif-4-400.woff2
jetbrains-mono-400.woff2
jetbrains-mono-500.woff2
```

(Both families are OFL-licensed. Subset to latin + latin-ext to stay under the
perf budget; `_reset.scss` already declares the `@font-face` rules and
`Base.astro` preloads the two used above the fold.)

## 5. What lives where

```
citerate/
├─ migrations/0001_init.sql        14 tables + 2 site tables. Apply, don't edit.
├─ infra/seeds/dev.sql             demo data for local work
├─ public/
│  ├─ _headers                     CSP, HSTS, immutable asset caching, noindex /scan
│  ├─ robots.txt                   AI crawlers allowed on purpose
│  └─ .well-known/security.txt
├─ workers/scanner/                cron consumer: claims jobs, calls engines, writes rows
└─ src/
   ├─ styles/                      01 settings → 06 utilities, main.scss is the only entry
   ├─ layouts/                     Base · Marketing · Doc · Legal
   ├─ components/                  Header, Footer, ScanForm, CauseBar, PricingTable, …
   ├─ pages/                       one file per URL (see table below)
   ├─ scripts/                     main.js + 7 modules, loaded on demand
   ├─ lib/                         env, db, domain, engines, scoring, guard, plans, email
   ├─ data/                        pricing.json, faq.json, engines.json
   └─ content/                     blog · changelog · legal · compare (MDX + zod schemas)
```

### Routes

| URL | Render | Notes |
| --- | --- | --- |
| `/` | static | home, rhythm 2a (readout before argument) |
| `/how-it-works` | static | method, direction 1b; only page besides `/for/agencies` allowed to load GSAP |
| `/pricing` | static | cards + table + 12 FAQs, FAQPage schema |
| `/for/in-house`, `/for/agencies` | static | two pages, not one with a switch |
| `/compare/[slug]` | static | 3 entries from the `compare` collection |
| `/customers` | static, **noindex** | template built, unlinked until a named customer exists |
| `/blog`, `/blog/[slug]` | static | MDX, methodology note on every data post |
| `/docs` | static | coming-soon state with a real response body |
| `/changelog` | static | engine-coverage changes flagged; feeds `/rss.xml` |
| `/about`, `/security` | static | |
| `/legal/[slug]` | static | privacy, terms, dpa, subprocessors, cookies |
| `/contact` | **server** | routes on intent, Turnstile, writes D1, Resend both ways |
| `/scan/[token]` | **server**, noindex | the teaser readout |
| `/api/scan`, `/api/scan/[token]` | server | start scan · poll progress |
| `/api/claim`, `/api/subscribe`, `/api/event` | server | |
| `/api/billing/webhook` | server | Paddle, HMAC-verified |

Server routes opt in with `export const prerender = false`. Everything else is
static HTML on the CDN.

## 6. The two cost decisions, as implemented

**Free scan caching.** `src/lib/guard.ts`: Turnstile → 5 scans/IP/hour → **1 live
scan per domain per 24h**. A repeat visitor gets the cached share token from KV
instead of new engine calls; a rate-limited visitor is redirected to the existing
readout rather than a dead end. Change the window with
`FREE_SCAN_CACHE_TTL_SECONDS`.

**Docs.** Shipped behind a coming-soon state with the resource model and one real
response body, so the nav slot is earned without publishing endpoints that will be
renamed. Concept pages publish before the endpoints do.

## 7. Performance budget

- No JS on a page that doesn't need it: `scripts/main.js` imports each module
  only when its markup is present.
- GSAP loads on **two** pages, **≥900px**, **motion allowed** only — and is not
  in `package.json` until that page ships (`pnpm add gsap`).
- No Bootstrap JS on marketing. Nav, toggles, scan form, consent, reveal,
  count-up, and TOC are ~40 lines each.
- Marketing CSS lands near 30 kB pre-compression because `_bootstrap.scss`
  imports partials, not the whole framework.
- Charts on marketing pages are hand-built SVG/CSS: no chart library, prints
  correctly, zero layout shift.
- `pagefind` builds the docs/blog search index at deploy time — no Algolia.

## 8. Method integrity (read before changing `scoring.ts`)

`src/lib/scoring.ts` is the contract `/how-it-works` publishes:

- citation rate is computed **over runs** (3 per engine per refresh), never one sample
- a citation requires a **linked URL that resolves to the subject domain**;
  a brand mention without a link is a separate `mention_runs` metric
- confidence below `CONFIDENCE_FLOOR` (0.6) is reported as **`unexplained`**,
  striped in every chart

If you change a rule: bump `METHOD_VERSION`, add a `changelog` entry with
`kind: "engine-coverage"` and `affectsHistory: true`, recompute affected
`daily_rollups`, and set `discontinuity` on those rows so charts show a flag
instead of a silent correction. That promise is on the About page.

## 9. Accessibility and print

- Focus rings come from `--focus-ring`; never removed.
- Hit targets ≥44px (`.btn-*`, `.pill`, `.form-field__input`).
- `--warn` is never used for text (2.6:1) — `--warn-ink` is.
- Cause colours are paired with a texture, so hue is never the only signal.
- `06-utilities/_print.scss` owns PDF/print geometry; the methodology block is
  never hidden in print.

## 10. Not in this repo yet

The dashboard (`/app`) is the other half of the stack and is deliberately a
separate build with the opposite JS balance: Bootstrap JS + Alpine + ECharts, per
the Phase 6a decision. Auth screens are specified in Phase 3b; the tables they
need (`sessions`, `auth_tokens`, `memberships`) already exist in migration 0001.

Also outstanding before launch:

- fill the founder / method-owner placeholders on `/about`
- counsel review on all `/legal/*` (every file is `draft: true`)
- real `og/default.png` and per-page OG images (R2 + a `/og/[slug].png` route)
- replace the seeded 25-prompt generator in `api/scan.ts` with the real one
  (site crawl + Search Console + category patterns)
- technical-decay check (`tech_pass`) is hardcoded `true` in the scanner
