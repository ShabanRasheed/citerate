-- ---------------------------------------------------------------------------
-- Citerate — Phase 10. One table: Search Console connections. The refresh
-- token is sealed (AES-GCM under SESSION_SECRET, lib/seal.ts) before it is
-- stored, so a leaked row is ciphertext; rotating SESSION_SECRET invalidates
-- every stored token, which is the safe failure.
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = ON;

CREATE TABLE gsc_connections (
  domain_id     TEXT PRIMARY KEY REFERENCES domains(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  property      TEXT NOT NULL,            -- 'sc-domain:acme.com' or 'https://acme.com/'
  refresh_token TEXT NOT NULL,            -- sealed, never plaintext
  scope         TEXT NOT NULL,
  connected_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX idx_gsc_connections_ws ON gsc_connections(workspace_id);
