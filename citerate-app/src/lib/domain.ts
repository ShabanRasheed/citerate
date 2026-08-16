/**
 * Domain normalisation + citation URL matching.
 * These two functions decide what counts as "cited", so they are the most
 * consequential code in the product. Rules are documented in /how-it-works and
 * must not drift from it silently.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "example.com",
  "test.com"
]);

const TRACKING_PARAMS = [
  /^utm_/i, /^gclid$/i, /^fbclid$/i, /^msclkid$/i, /^ref$/i, /^source$/i, /^mc_/i, /^_hs/i
];

/** Accepts what a human types; returns a bare hostname or null. */
export function normalizeDomain(input: string): string | null {
  let raw = (input || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.length > 253) return null;
  if (!/^[a-z]+:\/\//.test(raw)) raw = `https://${raw}`;

  let host: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    host = url.hostname;
  } catch {
    return null;
  }

  if (host.startsWith("www.")) host = host.slice(4);
  if (!/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(host)) return null;
  if (host.includes("..") || host.startsWith("-") || host.endsWith("-")) return null;
  if (BLOCKED_HOSTS.has(host)) return null;
  // Reject bare IPs: we measure sites, not hosts.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  return host;
}

/** apex of a hostname, so blog.acme.com and acme.com match. */
export function apex(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Naive but adequate for the public suffixes we support; swap for a PSL
  // lookup if you start measuring .co.uk-style domains heavily.
  const twoLevelTlds = new Set(["co.uk", "com.au", "co.nz", "com.br", "co.in", "com.mx"]);
  const lastTwo = parts.slice(-2).join(".");
  return twoLevelTlds.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Follow up to `maxHops` redirects so a citation pointing at a shortener or a
 * legacy path still credits the right domain. HEAD first, GET as a fallback for
 * hosts that reject HEAD.
 */
export async function resolveUrl(url: string, maxHops = 5): Promise<string> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "HEAD", redirect: "manual" });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(current, { method: "GET", redirect: "manual" });
      }
    } catch {
      return current;
    }
    const location = res.headers.get("location");
    if (!location || res.status < 300 || res.status >= 400) return current;
    current = new URL(location, current).toString();
  }
  return current;
}

/**
 * The citation rule, in one place:
 *   - linked URL resolving to the subject domain (or a subdomain) → citation
 *   - brand named with no link                                   → mention
 *   - third-party page *about* the subject (g2.com/acme)          → neither
 */
export function isSubjectUrl(candidateUrl: string, subjectHost: string): boolean {
  try {
    const host = new URL(candidateUrl).hostname.replace(/^www\./, "");
    if (host === subjectHost) return true;
    return host.endsWith(`.${subjectHost}`) || apex(host) === apex(subjectHost);
  } catch {
    return false;
  }
}

/** Mentions are counted separately and never folded into citation_rate. */
export function mentionsBrand(answerText: string, subjectHost: string): boolean {
  const brand = apex(subjectHost).split(".")[0];
  if (!brand || brand.length < 3) return false;
  return new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(answerText);
}
