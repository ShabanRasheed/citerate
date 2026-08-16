/**
 * Abuse controls for the public scan form. Three layers, in this order:
 *   1. Turnstile     — invisible to humans, free, stops the scripted majority
 *   2. KV rate limit — per IP and per domain
 *   3. KV cache      — one live scan per domain per day (the cost decision)
 */
import type { Env } from "./env";
import { sha256 } from "./db";

export async function verifyTurnstile(
  env: Env,
  token: string | null,
  ip: string | null
): Promise<boolean> {
  if (!token) return false;
  // Cloudflare's test keys always pass; keeps local dev unblocked.
  if (env.TURNSTILE_SECRET_KEY?.startsWith("1x00000")) return true;
  try {
    const body = new FormData();
    body.append("secret", env.TURNSTILE_SECRET_KEY);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

interface Bucket {
  n: number;
  reset: number;
}

/** Fixed-window counter in KV. Cheap, good enough, no Durable Object needed. */
export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  const nowMs = Date.now();
  const raw = await env.RATE_LIMIT.get(key, "json");
  const bucket = (raw as Bucket | null) ?? { n: 0, reset: nowMs + windowSeconds * 1000 };

  if (bucket.reset < nowMs) {
    bucket.n = 0;
    bucket.reset = nowMs + windowSeconds * 1000;
  }

  bucket.n += 1;
  const ttl = Math.max(60, Math.ceil((bucket.reset - nowMs) / 1000));
  await env.RATE_LIMIT.put(key, JSON.stringify(bucket), { expirationTtl: ttl });

  return {
    ok: bucket.n <= limit,
    remaining: Math.max(0, limit - bucket.n),
    retryAfter: Math.ceil((bucket.reset - nowMs) / 1000)
  };
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

/**
 * Free-scan cache. Decision (Phase 6b): one live scan per domain per 24h; a
 * repeat visitor gets the cached share token instead of new engine calls.
 * This is what makes an anonymous, no-signup scan affordable.
 */
export async function cachedScanToken(env: Env, hostname: string): Promise<string | null> {
  const key = `scan:${await sha256(hostname)}`;
  return (await env.SCAN_CACHE.get(key)) ?? null;
}

export async function cacheScanToken(env: Env, hostname: string, token: string): Promise<void> {
  const key = `scan:${await sha256(hostname)}`;
  const ttl = Number(env.FREE_SCAN_CACHE_TTL_SECONDS ?? 86400);
  await env.SCAN_CACHE.put(key, token, { expirationTtl: ttl });
}

/** Composite guard used by POST /api/scan. */
export async function guardFreeScan(
  env: Env,
  request: Request,
  hostname: string,
  turnstileToken: string | null
): Promise<{ ok: true } | { ok: false; status: number; message: string; retryAfter?: number }> {
  const ip = clientIp(request);

  if (!(await verifyTurnstile(env, turnstileToken, ip))) {
    return { ok: false, status: 403, message: "Verification failed. Reload and try again." };
  }

  // 5 scans per IP per hour.
  const perIp = await rateLimit(env, `ip:${ip ?? "unknown"}`, 5, 3600);
  if (!perIp.ok) {
    return {
      ok: false,
      status: 429,
      message: "That's a lot of scans from one place. Try again in a little while.",
      retryAfter: perIp.retryAfter
    };
  }

  // 1 live scan per domain per day — beyond that we serve cache.
  const perDomain = await rateLimit(env, `dom:${hostname}`, 1, 86400);
  if (!perDomain.ok) {
    return {
      ok: false,
      status: 409,
      message: "This domain was scanned in the last 24 hours.",
      retryAfter: perDomain.retryAfter
    };
  }

  return { ok: true };
}
