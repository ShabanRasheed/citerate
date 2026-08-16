/**
 * Passwordless auth. One code path for sign-in and sign-up: we mint a token,
 * email it as both a link and a 6-digit code, and consume it once.
 *
 * Phase 3b decisions encoded here:
 *  - the same screen handles new and returning users; we never leak which
 *    ("check your email" is identical either way)
 *  - a token is single-use and 15 minutes old at most
 *  - claiming a free scan attaches the anonymous scan to the new user
 *  - a domain already tracked by someone else produces a join request, not an
 *    error dead end
 */
import type { Env } from "./env";
import { all, id, now, one, run, sha256 } from "./db";

export type TokenKind = "magic_link" | "otp_code" | "email_change" | "password_reset";

const CODE_ALPHABET = "0123456789";

function ttlMinutes(env: Env): number {
  return Number((env as never as Record<string, string>).MAGIC_LINK_TTL_MINUTES ?? 15);
}

export function sixDigitCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % 10]).join("");
}

export function linkSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
}

/**
 * Issues one token that answers to both the link and the typed code — the pair
 * is stored as `<secret>:<code>` so either path consumes the same row.
 */
export async function issueToken(
  env: Env,
  email: string,
  kind: TokenKind = "magic_link",
  userId: string | null = null
): Promise<{ tokenId: string; secret: string; code: string; expiresAt: number }> {
  const secret = linkSecret();
  const code = sixDigitCode();
  const tokenId = id("tok");
  const expiresAt = now() + ttlMinutes(env) * 60;

  await run(
    env.DB,
    `INSERT INTO auth_tokens (id, user_id, email, kind, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    tokenId,
    userId,
    email.toLowerCase(),
    kind,
    await sha256(`${secret}:${code}`),
    now(),
    expiresAt
  );

  // The typed-code path only has the code, so the secret half lives in KV for
  // the token's lifetime. It expires with the token — nothing to clean up.
  await env.SCAN_CACHE.put(`otp:${tokenId}`, secret, { expirationTtl: ttlMinutes(env) * 60 });

  return { tokenId, secret, code, expiresAt };
}

export interface ConsumedToken {
  email: string;
  userId: string | null;
  kind: TokenKind;
}

/** Single use. Returns null for wrong, expired, or already-consumed tokens. */
export async function consumeToken(
  env: Env,
  secret: string,
  code: string
): Promise<ConsumedToken | null> {
  const hash = await sha256(`${secret}:${code}`);
  const row = await one<{ id: string; email: string; user_id: string | null; kind: TokenKind }>(
    env.DB,
    `SELECT id, email, user_id, kind FROM auth_tokens
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    hash,
    now()
  );
  if (!row) return null;

  await run(env.DB, `UPDATE auth_tokens SET consumed_at = ? WHERE id = ?`, now(), row.id);
  return { email: row.email, userId: row.user_id, kind: row.kind };
}

/** Look up or create the user, then make sure they have somewhere to land. */
export async function upsertUser(env: Env, email: string, name: string | null = null): Promise<{ userId: string; created: boolean }> {
  const existing = await one<{ id: string }>(env.DB, `SELECT id FROM users WHERE email = ?`, email.toLowerCase());
  if (existing) return { userId: existing.id, created: false };

  const userId = id("usr");
  await run(
    env.DB,
    `INSERT INTO users (id, email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
    userId,
    email.toLowerCase(),
    name,
    now(),
    now()
  );
  return { userId, created: true };
}

export async function createWorkspace(
  env: Env,
  userId: string,
  name: string,
  plan: "free" | "starter" | "growth" | "scale" | "agency" = "free"
): Promise<string> {
  const workspaceId = id("wsp");
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28)}-${workspaceId.slice(-4)}`;

  await run(
    env.DB,
    `INSERT INTO workspaces (id, name, slug, plan, created_at) VALUES (?, ?, ?, ?, ?)`,
    workspaceId,
    name,
    slug,
    plan,
    now()
  );
  await run(
    env.DB,
    `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
    workspaceId,
    userId,
    now()
  );
  return workspaceId;
}

export async function workspacesFor(env: Env, userId: string) {
  return all<{ id: string; name: string; slug: string; plan: string; role: string; parent_id: string | null }>(
    env.DB,
    `SELECT w.id, w.name, w.slug, w.plan, m.role, w.parent_id
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ?
      ORDER BY w.parent_id IS NOT NULL, w.name`,
    userId
  );
}

/**
 * Claim an anonymous free scan. The scan's domain moves into the workspace and
 * the scan is stamped with the claiming user — this is the only way a free
 * readout becomes an account, per Phase 3b screen 3.
 */
export async function claimScan(env: Env, shareToken: string, userId: string, workspaceId: string): Promise<{ ok: boolean; domainId?: string; hostname?: string }> {
  const scan = await one<{ id: string; domain_id: string; hostname: string; workspace_id: string | null }>(
    env.DB,
    `SELECT s.id, s.domain_id, d.hostname, s.workspace_id
       FROM scans s JOIN domains d ON d.id = s.domain_id
      WHERE s.share_token = ?`,
    shareToken
  );
  if (!scan) return { ok: false };
  if (scan.workspace_id && scan.workspace_id !== workspaceId) return { ok: false };

  await env.DB.batch([
    env.DB.prepare(`UPDATE scans SET claimed_by = ?, workspace_id = ? WHERE id = ?`).bind(userId, workspaceId, scan.id),
    env.DB.prepare(`UPDATE domains SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL`).bind(workspaceId, scan.domain_id)
  ]);

  return { ok: true, domainId: scan.domain_id, hostname: scan.hostname };
}

/**
 * Someone else already verified this hostname. We do not fail — we record a
 * join request against their workspace and tell the user it was sent.
 */
export async function requestJoin(env: Env, hostname: string, userId: string): Promise<{ sent: boolean; workspaceId?: string }> {
  const owner = await one<{ workspace_id: string }>(
    env.DB,
    `SELECT workspace_id FROM domains WHERE hostname = ? AND workspace_id IS NOT NULL LIMIT 1`,
    hostname
  );
  if (!owner) return { sent: false };

  await run(
    env.DB,
    `INSERT INTO join_requests (id, workspace_id, user_id, hostname, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at, status = 'pending'`,
    id("jrq"),
    owner.workspace_id,
    userId,
    hostname,
    now(),
    now() + 7 * 86_400
  );

  return { sent: true, workspaceId: owner.workspace_id };
}

export async function audit(
  env: Env,
  workspaceId: string | null,
  actorUserId: string | null,
  action: string,
  target: string | null = null,
  meta: Record<string, unknown> | null = null,
  ip: string | null = null
): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO audit_log (workspace_id, actor_user_id, action, target, meta, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    workspaceId,
    actorUserId,
    action,
    target,
    meta ? JSON.stringify(meta) : null,
    ip,
    now()
  );
}
