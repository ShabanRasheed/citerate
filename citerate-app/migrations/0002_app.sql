-- ---------------------------------------------------------------------------
-- Citerate — dashboard additions. Applies on top of 0001_init.sql; the
-- marketing repo never reads these tables.
-- Six tables: join requests, invites, notification prefs, saved views,
-- API keys, and report snapshots.
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = ON;

-- Someone tried to track a hostname another workspace already verified.
-- Phase 3b screen 2b: a request, not a dead end. Expires after 7 days.
CREATE TABLE join_requests (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hostname      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','declined','expired')),
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_join_requests_ws ON join_requests(workspace_id, status);

-- Seat invites. The token is hashed; the email is kept so a pending invite is
-- visible in Settings → Team before it is accepted.
CREATE TABLE invites (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer','client')),
  token_hash    TEXT NOT NULL,
  invited_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  accepted_at   INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX idx_invites_token ON invites(token_hash);
CREATE INDEX idx_invites_ws ON invites(workspace_id, accepted_at);

-- Notification preferences are per membership, not per user: an agency person
-- does not want every client's Monday digest.
CREATE TABLE notification_prefs (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_digest INTEGER NOT NULL DEFAULT 1,
  scan_complete INTEGER NOT NULL DEFAULT 1,
  fix_verified  INTEGER NOT NULL DEFAULT 1,
  rate_drop     INTEGER NOT NULL DEFAULT 1,   -- only fires outside the confidence band
  drop_threshold REAL NOT NULL DEFAULT 0.05,  -- 5 points
  quota_warning INTEGER NOT NULL DEFAULT 1,
  slack_webhook TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

-- A saved view is a filter set on the Queries pane. Cheap, and it is what turns
-- a 500-row table into somebody's Monday routine.
CREATE TABLE saved_views (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain_id     TEXT REFERENCES domains(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  filters       TEXT NOT NULL,               -- json: cluster, cause, engine, sort
  shared        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_saved_views_ws ON saved_views(workspace_id, domain_id);

-- Read API keys (Growth+). Prefix is shown in the UI; only the hash is stored.
CREATE TABLE api_keys (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  prefix        TEXT NOT NULL,               -- cr_live_8f3c…
  key_hash      TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read','read_write')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX idx_api_keys_ws ON api_keys(workspace_id, revoked_at);

-- A report is an immutable snapshot: the numbers as they read that month, the
-- method version that produced them, and the PDF in R2. Regenerating history is
-- exactly what the method promise forbids.
CREATE TABLE report_snapshots (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain_id     TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,               -- YYYY-MM
  kind          TEXT NOT NULL CHECK (kind IN ('monthly','ad_hoc','fix_proof')),
  method_version TEXT NOT NULL,
  payload       TEXT NOT NULL,               -- json: the readout as rendered
  artifact_key  TEXT,                        -- R2 key of the PDF, null until generated
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (domain_id, period, kind)
);
CREATE INDEX idx_reports_ws ON report_snapshots(workspace_id, created_at DESC);
