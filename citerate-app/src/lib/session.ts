/**
 * Sessions. Cookie holds an opaque 160-bit value; D1 stores only its SHA-256,
 * so a leaked database row cannot be replayed as a login.
 *
 * Trusted devices get SESSION_TTL_DAYS; anything else gets one day, which is
 * the Phase 3b rule ("this device only" is the default, not a checkbox).
 */
import type { APIContext, AstroCookies } from "astro";
import type { Env } from "./env";
import { id, now, one, run, sha256 } from "./db";

export const COOKIE = "cr_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  twoFactor: boolean;
}

export interface ActiveSession {
  user: SessionUser;
  sessionId: string;
  trusted: boolean;
  expiresAt: number;
}

interface SessionRow {
  session_id: string;
  trusted: number;
  expires_at: number;
  user_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  totp_secret: string | null;
}

function ttlSeconds(env: Env, trusted: boolean): number {
  const days = Number(
    (trusted ? (env as never as Record<string, string>).SESSION_TTL_DAYS : (env as never as Record<string, string>).SESSION_TTL_DAYS_UNTRUSTED) ??
      (trusted ? 30 : 1)
  );
  return days * 86_400;
}

/** Raw cookie value is returned once and never stored anywhere. */
export async function createSession(
  env: Env,
  userId: string,
  opts: { trusted?: boolean; ip?: string | null; userAgent?: string | null; deviceLabel?: string | null } = {}
): Promise<{ value: string; maxAge: number }> {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const value = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const trusted = opts.trusted ?? false;
  const maxAge = ttlSeconds(env, trusted);

  await run(
    env.DB,
    `INSERT INTO sessions (id, user_id, device_label, ip, user_agent, trusted, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    await sha256(value),
    userId,
    opts.deviceLabel ?? null,
    opts.ip ?? null,
    opts.userAgent ?? null,
    trusted ? 1 : 0,
    now(),
    now() + maxAge
  );

  await run(env.DB, `UPDATE users SET last_seen_at = ? WHERE id = ?`, now(), userId);
  return { value, maxAge };
}

export function setSessionCookie(cookies: AstroCookies, value: string, maxAge: number): void {
  cookies.set(COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge
  });
}

export async function readSession(env: Env, cookies: AstroCookies): Promise<ActiveSession | null> {
  const raw = cookies.get(COOKIE)?.value;
  if (!raw) return null;

  const row = await one<SessionRow>(
    env.DB,
    `SELECT s.id AS session_id, s.trusted, s.expires_at,
            u.id AS user_id, u.email, u.name, u.avatar_url, u.totp_secret
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
    await sha256(raw),
    now()
  );
  if (!row) return null;

  return {
    sessionId: row.session_id,
    trusted: row.trusted === 1,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      twoFactor: Boolean(row.totp_secret)
    }
  };
}

export async function destroySession(env: Env, cookies: AstroCookies): Promise<void> {
  const raw = cookies.get(COOKIE)?.value;
  if (raw) await run(env.DB, `DELETE FROM sessions WHERE id = ?`, await sha256(raw));
  cookies.delete(COOKIE, { path: "/" });
}

/** Every other session for this user — the "sign out everywhere" control. */
export async function destroyOtherSessions(env: Env, userId: string, keepSessionId: string): Promise<void> {
  await run(env.DB, `DELETE FROM sessions WHERE user_id = ? AND id != ?`, userId, keepSessionId);
}

export function clientIp(ctx: APIContext): string | null {
  return ctx.request.headers.get("cf-connecting-ip") ?? null;
}

/** Human device label from the UA string: "Chrome · macOS". Best effort only. */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} · ${os}`;
}

export { id as newId };
