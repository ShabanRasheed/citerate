# Citerate — project instructions

## Ownership and git

- This project is Shaban's. **Always commit and push using Shaban's GitHub account** —
  `Shaban Rasheed <ShabanRasheed@users.noreply.github.com>`. Never use another identity.
- Remote: `https://github.com/ShabanRasheed/citerate` — one repo holding both apps as
  sibling folders, plus `docs/` and the `.dc.html` design phase documents. Default branch `main`.
- The repo is **private and must stay private** while `docs/audit-2026-08.md` is committed —
  it documents unpatched vulnerabilities, including an unauthenticated account-takeover path.

## Local development

- Requires pnpm 9 (`npm i -g pnpm@9.15.4`); Node 20.11+.
- Migrations are split across repos against one database and must run **in this order**:
  `0001_init.sql` from `citerate/`, then `0002`/`0003` from `citerate-app/`.
- `pnpm dev` → marketing on 4321, dashboard on 4322. Setup is documented in `docs/local-setup.md`.

## Product

- Two repos, one product: `citerate/` (marketing + scan engine, port 4321) and `citerate-app/` (dashboard, port 4322). They share one D1 database (`citerate-db`) in production AND locally — the app repo points all local wrangler commands and `platformProxy.persist` at `../citerate/.wrangler/state`. Never break that: any new wrangler `--local` command in citerate-app must carry `--persist-to ../citerate/.wrangler/state`.
- Everything must work in BOTH environments: local (`pnpm dev`, `.env`, local migrations/seeds, mocks allowed) and Cloudflare Pages via wrangler deploy (`pnpm deploy`, `[vars]` + `secret put`). Any new feature or config value gets a local default/fallback in `.env.example` and a production entry in `wrangler.toml` or the secrets list, plus a preflight check when it can break a deploy.
- Deploys go through `pnpm deploy` (preflight gate first). `deploy:force` only for a deliberate partial deploy.
- Git-based deployment (Pages Git integration) is a DEFERRED decision — do not wire it up or restructure for it until the user decides.
- Copy style: human-written, plain, no AI-marketing vocabulary (seamless, empower, unlock-as-hype, journey, etc.). "Unlock" is allowed only as literal plan-gating language.
