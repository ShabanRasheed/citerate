/**
 * Cloudflare bindings + vars, in one place so both the Pages app and the
 * scanner Worker can import it without pulling Astro types into the Worker
 * bundle.
 */
export interface Env {
  DB: D1Database;
  SCAN_CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  ARTIFACTS: R2Bucket;

  PUBLIC_SITE_URL: string;
  PUBLIC_APP_URL: string;
  PUBLIC_TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  SESSION_SECRET: string;

  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_SALES?: string;
  EMAIL_SUPPORT?: string;
  EMAIL_SECURITY?: string;

  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;

  OPENAI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  GEMINI_API_KEY?: string;
  SERP_API_KEY?: string;

  FREE_SCAN_QUERY_LIMIT?: string;
  FREE_SCAN_ENGINES?: string;
  FREE_SCAN_CACHE_TTL_SECONDS?: string;
  RUNS_PER_ENGINE?: string;
  USE_ENGINE_MOCKS?: string;
  SCAN_BATCH_SIZE?: string;
}
