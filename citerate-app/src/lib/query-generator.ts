/**
 * Query generation — the real generator (Phase 10). Blends three sources and
 * labels every row so provenance is never lost:
 *   crawl     — the site's own title, headings, and sitemap slugs
 *   gsc       — Search Console queries where the domain already ranks
 *               (added by api/connect/gsc/callback.ts after OAuth)
 *   category  — the deterministic template in seed-queries.ts, the floor
 * Network failure degrades to category-only within 5s; onboarding never
 * blocks on a slow site.
 */
import { SEED_QUERIES, brandFrom, type SeedQuery } from "./seed-queries";

export interface GeneratedQuery extends SeedQuery {
  source: "crawl" | "gsc" | "category";
}

const FETCH_MS = 5000;

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { "user-agent": "CiterateBot/1.0 (+https://citerate.com)" }
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

const strip = (s: string): string =>
  s.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

export interface Crawl {
  title: string | null;
  description: string | null;
  headings: string[];
  slugs: string[];
}

export async function crawlSite(hostname: string): Promise<Crawl> {
  const [home, sitemap] = await Promise.all([
    get(`https://${hostname}/`),
    get(`https://${hostname}/sitemap.xml`)
  ]);

  const title = home?.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)?.[1] ?? null;
  const description =
    home?.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{1,300})["']/i)?.[1] ??
    home?.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]*name=["']description["']/i)?.[1] ??
    null;

  const headings = [...(home ?? "").matchAll(/<h[12][^>]*>([\s\S]{1,200}?)<\/h[12]>/gi)]
    .map((m) => strip(m[1]))
    .filter((t) => t.split(" ").length >= 3 && t.length <= 90)
    .slice(0, 8);

  const skip = /privacy|terms|legal|cookie|sign-?in|sign-?up|login|404|feed|tag\/|author\/|page\/\d/i;
  const slugs = [...(sitemap ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => {
      try {
        return new URL(m[1]).pathname;
      } catch {
        return "";
      }
    })
    .filter((p) => p.length > 1 && !skip.test(p))
    .map((p) =>
      p.replace(/\/+$/, "").split("/").pop()!.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().toLowerCase()
    )
    .filter((s) => s.split(" ").length >= 2 && s.length <= 60)
    .slice(0, 10);

  return {
    title: title ? strip(title) : null,
    description: description ? strip(description) : null,
    headings,
    slugs
  };
}

/** "Acme — AI visibility for docs teams" → "ai visibility for docs teams" */
function categoryPhrase(crawl: Crawl, brand: string): string | null {
  const segments = (crawl.title ?? "")
    .split(/[|–—·:]| - /)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 70 && s.toLowerCase() !== brand.toLowerCase());
  const best = segments.sort((a, b) => b.length - a.length)[0] ?? null;
  return best ? best.toLowerCase() : null;
}

export function queriesFromCrawl(hostname: string, crawl: Crawl): GeneratedQuery[] {
  const brand = brandFrom(hostname);
  const out: GeneratedQuery[] = [];
  const phrase = categoryPhrase(crawl, brand);
  if (phrase) {
    out.push({ text: `best ${phrase}`, intent: "commercial", cluster: "category-pick", source: "crawl" });
    out.push({ text: `${phrase} comparison`, intent: "commercial", cluster: "category-pick", source: "crawl" });
    out.push({ text: `how to choose ${phrase}`, intent: "informational", cluster: "category-pick", source: "crawl" });
  }
  for (const h of crawl.headings.slice(0, 4)) {
    out.push({ text: h.toLowerCase(), intent: "informational", cluster: "site-content", source: "crawl" });
  }
  for (const s of crawl.slugs.slice(0, 6)) {
    out.push({ text: s, intent: "informational", cluster: "site-content", source: "crawl" });
  }
  return out;
}

/**
 * The blend, ordered by value: the category template's brand core first (those
 * are the queries buyers actually ask), then everything the crawl surfaced,
 * then the rest of the template as fill. Deduped on normalized text, capped
 * at `limit`.
 */
export async function generateQueries(hostname: string, limit = 25): Promise<GeneratedQuery[]> {
  const crawl = await crawlSite(hostname);
  const fromCrawl = queriesFromCrawl(hostname, crawl);
  const category: GeneratedQuery[] = SEED_QUERIES(hostname).map((q) => ({ ...q, source: "category" as const }));

  const seen = new Set<string>();
  const out: GeneratedQuery[] = [];
  for (const q of [...category.slice(0, 6), ...fromCrawl, ...category.slice(6)]) {
    const text = q.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ ...q, text });
    if (out.length >= limit) break;
  }
  return out;
}
