/**
 * Binding access + tiny query helpers.
 * Every server route gets bindings from `locals.runtime.env` (Pages) — never
 * from a module-level singleton, because Workers have no long-lived process.
 */
import type { APIContext } from "astro";
import type { Env } from "./env";

export type { Env };

export function env(ctx: APIContext): Env {
  const runtime = (ctx.locals as { runtime?: { env: Env } }).runtime;
  if (!runtime?.env) {
    throw new Error(
      "Cloudflare bindings missing. Run `astro dev` (platformProxy) or `wrangler pages dev`."
    );
  }
  return runtime.env;
}

/** Unix seconds — the only time format stored in D1. */
export const now = (): number => Math.floor(Date.now() / 1000);

/** URL-safe id with a readable prefix: scn_x8f2k1… */
export function id(prefix: string): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}_${out}`;
}

/** Opaque share token for /scan/<token>. 160 bits, unguessable. */
export function shareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function one<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...args).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<T>();
  return res.results ?? [];
}

export async function run(db: D1Database, sql: string, ...args: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...args).run();
}

/** Batched writes go through here so a partial scan never lands half-written. */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length) await db.batch(statements);
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}
