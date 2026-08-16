-- ---------------------------------------------------------------------------
-- Citerate — initial schema (D1 / SQLite)
-- 14 tables in four groups, matching the Phase 6a data model.
-- Apply:  pnpm db:migrate:local   |   pnpm db:migrate:remote
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = ON;

-- === IDENTITY ==============================================================
CREATE TABLE users (
  id            TEXT PRIMARY KEY,               -- usr_<nanoid>
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  avatar_url    TEXT,
  totp_secret   TEXT,                           -- null until 2FA enrolled
  created_at    INTEGER NOT NULL,               -- unix seconds
  last_seen_at  INTEGER
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,               -- ses_<nanoid>, hashed cookie value
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label  TEXT,
  ip            TEXT,
  user_agent    TEXT,
  trusted       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);

CREATE TABLE auth_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,                  -- kept for signup-before-user flow
  kind          TEXT NOT NULL CHECK (kind IN ('magic_link','otp_code','email_change','password_reset')),
  token_hash    TEXT NOT NULL,
  consumed_at   INTEGER,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX idx_auth_tokens_hash ON auth_tokens(token_hash);

CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,               -- wsp_<nanoid>
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  parent_id     TEXT REFERENCES workspaces(id) ON DELETE SET NULL, -- agency → client
  plan          TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free','starter','growth','scale','agency','enterprise')),
  brand_logo_key   TEXT,                        -- R2 key, white label
  brand_accent     TEXT,                        -- hex, replaces --cited in PDFs only
  brand_domain     TEXT,                        -- reports.youragency.com
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_workspaces_parent ON workspaces(parent_id);

CREATE TABLE memberships (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer','client')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- === SUBJECT ===============================================================
CREATE TABLE domains (
  id            TEXT PRIMARY KEY,               -- dom_<nanoid>
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE, -- null = anonymous free scan
  hostname      TEXT NOT NULL,                  -- normalised, no scheme, no www
  label         TEXT,
  gsc_connected INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_domains_hostname ON domains(hostname);
CREATE INDEX idx_domains_workspace ON domains(workspace_id);

CREATE TABLE query_sets (
  id            TEXT PRIMARY KEY,
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Default set',
  created_at    INTEGER NOT NULL
);

CREATE TABLE queries (
  id            TEXT PRIMARY KEY,               -- qry_<nanoid>
  query_set_id  TEXT NOT NULL REFERENCES query_sets(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  intent        TEXT CHECK (intent IN ('informational','commercial','navigational','transactional')),
  cluster       TEXT,                           -- category-pick | alternatives | pricing | migration…
  source        TEXT CHECK (source IN ('site','search_console','category','user')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_queries_set ON queries(query_set_id, active);

CREATE TABLE competitors (
  id            TEXT PRIMARY KEY,
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  hostname      TEXT NOT NULL,
  discovered    INTEGER NOT NULL DEFAULT 1,     -- 1 = found by engines, 0 = added by user
  created_at    INTEGER NOT NULL,
  UNIQUE (domain_id, hostname)
);

-- === MEASUREMENT ===========================================================
CREATE TABLE scans (
  id            TEXT PRIMARY KEY,               -- scn_<nanoid>
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('free','scheduled','on_demand','backfill')),
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','complete','partial','failed')),
  share_token   TEXT UNIQUE,                    -- /scan/<token>, free scans only
  claimed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  engines       TEXT NOT NULL,                  -- json array
  runs_per_engine INTEGER NOT NULL DEFAULT 3,
  queries_total    INTEGER NOT NULL DEFAULT 0,
  queries_done     INTEGER NOT NULL DEFAULT 0,
  citation_rate    REAL,                        -- cached rollup for the readout
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX idx_scans_domain ON scans(domain_id, created_at DESC);
CREATE INDEX idx_scans_status ON scans(status, created_at);

-- The queue. A cron tick claims a batch of these; no external queue service.
CREATE TABLE scan_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id       TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  query_id      TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  engine        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','claimed','done','error')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  claimed_at    INTEGER,
  error         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_jobs_claim ON scan_jobs(status, created_at);
CREATE INDEX idx_jobs_scan ON scan_jobs(scan_id, status);

-- One row per query per engine per scan.
CREATE TABLE observations (
  id            TEXT PRIMARY KEY,               -- obs_<nanoid>
  scan_id       TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  query_id      TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  engine        TEXT NOT NULL,
  runs          INTEGER NOT NULL,
  cited_runs    INTEGER NOT NULL,
  citation_rate REAL NOT NULL,
  mention_runs  INTEGER NOT NULL DEFAULT 0,     -- named, not linked: never in citation_rate
  answer_key    TEXT,                           -- R2 key holding raw answer text
  organic_rank  INTEGER,                        -- evidence for attribution
  aio_present   INTEGER,
  tech_pass     INTEGER,
  cause         TEXT CHECK (cause IN ('aio_displacement','ranking_decline','technical_decay','unexplained')),
  cause_confidence REAL,
  scanned_at    INTEGER NOT NULL
);
CREATE INDEX idx_obs_scan ON observations(scan_id);
CREATE INDEX idx_obs_query ON observations(query_id, scanned_at DESC);

CREATE TABLE citations (
  id            TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  run_index     INTEGER NOT NULL,
  url           TEXT NOT NULL,                  -- as printed by the engine
  resolved_url  TEXT,                           -- after following redirects
  hostname      TEXT NOT NULL,
  is_subject    INTEGER NOT NULL DEFAULT 0,     -- resolves to the measured domain
  excerpt       TEXT
);
CREATE INDEX idx_citations_obs ON citations(observation_id);
CREATE INDEX idx_citations_host ON citations(hostname);

-- Charts read only from here.
CREATE TABLE daily_rollups (
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,                  -- YYYY-MM-DD
  engine        TEXT NOT NULL,                  -- '*' = all engines
  cluster       TEXT NOT NULL DEFAULT '*',
  citation_rate REAL NOT NULL,
  runs          INTEGER NOT NULL,
  band_low      REAL,                           -- confidence band
  band_high     REAL,
  cause_aio     REAL NOT NULL DEFAULT 0,
  cause_rank    REAL NOT NULL DEFAULT 0,
  cause_tech    REAL NOT NULL DEFAULT 0,
  cause_other   REAL NOT NULL DEFAULT 0,
  discontinuity TEXT,                           -- changelog slug when method changed
  PRIMARY KEY (domain_id, day, engine, cluster)
);

-- === ACTION AND MONEY ======================================================
CREATE TABLE findings (
  id            TEXT PRIMARY KEY,               -- fnd_<nanoid>
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  detail        TEXT,
  cause         TEXT NOT NULL,
  impact        TEXT NOT NULL CHECK (impact IN ('high','medium','low')),
  cluster       TEXT,
  query_ids     TEXT NOT NULL,                  -- json array, the fix's own queries
  baseline_rate REAL,                           -- for the before/after delta
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_findings_domain ON findings(domain_id, impact);

CREATE TABLE fix_states (
  finding_id    TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'open'
                CHECK (state IN ('open','in_progress','shipped','verified','dismissed')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  shipped_at    INTEGER,
  verified_rate REAL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE subscriptions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'paddle',
  provider_id   TEXT,
  plan          TEXT NOT NULL,
  interval      TEXT NOT NULL CHECK (interval IN ('month','year')),
  status        TEXT NOT NULL,                  -- active | past_due | cancelled | trialing
  current_period_end INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_subs_workspace ON subscriptions(workspace_id);

-- Gating reads these, never a live count over observations.
CREATE TABLE usage_counters (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,                  -- YYYY-MM
  metric        TEXT NOT NULL,                  -- tracked_queries | domains | seats | rescans
  used          INTEGER NOT NULL DEFAULT 0,
  included      INTEGER NOT NULL DEFAULT 0,
  overage_units INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, period, metric)
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target        TEXT,
  meta          TEXT,                           -- json
  ip            TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_workspace ON audit_log(workspace_id, created_at DESC);

-- === SITE-SIDE TABLES ======================================================
CREATE TABLE contact_requests (
  id            TEXT PRIMARY KEY,
  intent        TEXT NOT NULL CHECK (intent IN ('sales','agency','support','security')),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  context       TEXT,                           -- domain / client count / workspace / surface
  message       TEXT NOT NULL,
  ip            TEXT,
  created_at    INTEGER NOT NULL,
  handled_at    INTEGER
);

CREATE TABLE subscribers (
  email         TEXT PRIMARY KEY,
  source        TEXT NOT NULL,                  -- blog | changelog | api_beta
  confirmed_at  INTEGER,
  unsubscribed_at INTEGER,
  created_at    INTEGER NOT NULL
);
