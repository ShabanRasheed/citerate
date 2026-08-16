# Running Citerate locally

Verified working on Windows 11, August 2026.

Both apps share **one** local D1/KV/R2 state directory, `citerate/.wrangler/state`, exactly as
they share one database in production. Every `citerate-app` wrangler command must therefore
carry `--persist-to ../citerate/.wrangler/state`.

## 1. Prerequisites

```bash
node -v          # needs >= 20.11
npm i -g pnpm@9.15.4
```

Corepack is the documented way to get pnpm, but `corepack enable` needs Administrator on
Windows because it writes shims into `C:\Program Files\nodejs`. The global npm install above
avoids that and installs to `%APPDATA%\npm`.

## 2. Install

```bash
cd citerate     && pnpm install
cd ../citerate-app && pnpm install
```

## 3. Environment

```bash
cp citerate/.env.example     citerate/.env
cp citerate-app/.env.example citerate-app/.env
```

Then set the same `SESSION_SECRET` in both — they share a session store:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Defaults are safe for local work: Turnstile uses Cloudflare's always-passes test keys, and
`USE_ENGINE_MOCKS=true` means no engine API spend. Leaving `RESEND_API_KEY` empty is
deliberate — magic links print to the console instead of sending.

## 4. Database

Order matters. Migration `0001` lives in `citerate/`, `0002` and `0003` in `citerate-app/`,
and they apply to the same database.

```bash
cd citerate
pnpm exec wrangler d1 migrations apply citerate-db --local
pnpm exec wrangler d1 execute citerate-db --local --file=./infra/seeds/dev.sql

cd ../citerate-app
pnpm exec wrangler d1 migrations apply citerate-db --local --persist-to ../citerate/.wrangler/state
pnpm exec wrangler d1 execute citerate-db --local --persist-to ../citerate/.wrangler/state --file=./infra/seeds/app-dev.sql
```

`database_id` stays `REPLACE_WITH_D1_ID` in `wrangler.toml` — local mode ignores it. Real ids
are only needed for `--remote`.

## 5. Run

Two terminals:

```bash
cd citerate     && pnpm dev    # http://localhost:4321
cd citerate-app && pnpm dev    # http://localhost:4322
```

## 6. Verify

```bash
curl -o /dev/null -w "%{http_code}\n" http://localhost:4321/
curl -o /dev/null -w "%{http_code}\n" http://localhost:4322/healthz
```

Both should return `200`. To sign in, submit any email at `/sign-in` and take the magic link
from the `citerate-app` console output.

## Known local quirks

- **`gsap` resolution error on boot.** `src/scripts/modules/scroll-narrative.js` dynamically
  imports `gsap`, which is deliberately absent from `package.json` until that page ships. Dev
  logs the error and continues; `pnpm build` will fail until it is added or stubbed.
- **`Invalid binding SESSION` warning** from the Cloudflare adapter is expected — the app uses
  its own D1-backed sessions, not Astro's KV sessions.
- **Wrangler 3 prints an out-of-date notice.** Both repos pin v3 deliberately; upgrading to v4
  is a separate decision.
