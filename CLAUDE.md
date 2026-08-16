# Citerate — project instructions

- Two repos, one product: `citerate/` (marketing + scan engine, port 4321) and `citerate-app/` (dashboard, port 4322). They share one D1 database (`citerate-db`) in production AND locally — the app repo points all local wrangler commands and `platformProxy.persist` at `../citerate/.wrangler/state`. Never break that: any new wrangler `--local` command in citerate-app must carry `--persist-to ../citerate/.wrangler/state`.
- Everything must work in BOTH environments: local (`pnpm dev`, `.env`, local migrations/seeds, mocks allowed) and Cloudflare Pages via wrangler deploy (`pnpm deploy`, `[vars]` + `secret put`). Any new feature or config value gets a local default/fallback in `.env.example` and a production entry in `wrangler.toml` or the secrets list, plus a preflight check when it can break a deploy.
- Deploys go through `pnpm deploy` (preflight gate first). `deploy:force` only for a deliberate partial deploy.
- Git-based deployment (Pages Git integration) is a DEFERRED decision — do not wire it up or restructure for it until the user decides.
- Copy style: human-written, plain, no AI-marketing vocabulary (seamless, empower, unlock-as-hype, journey, etc.). "Unlock" is allowed only as literal plan-gating language.
