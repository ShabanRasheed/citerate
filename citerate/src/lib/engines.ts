/**
 * Engine clients. Each engine exposes the same shape so the scanner does not
 * care which one it is talking to. A missing API key marks that engine
 * "unavailable" for the run rather than failing the whole scan.
 *
 * USE_ENGINE_MOCKS=true returns deterministic fake answers — develop the whole
 * pipeline without spending a cent.
 */
import type { Env } from "./env";

export type EngineId = "chatgpt" | "google_aio" | "perplexity" | "gemini" | "copilot" | "claude";

export interface EngineAnswer {
  engine: EngineId;
  ok: boolean;
  text: string;
  urls: string[];
  aioPresent: boolean;
  raw?: unknown;
  error?: string;
  latencyMs: number;
}

export const ENGINES: Record<EngineId, { label: string; minPlan: string; keyVar: keyof Env }> = {
  chatgpt:    { label: "ChatGPT",            minPlan: "free",    keyVar: "OPENAI_API_KEY" as keyof Env },
  google_aio: { label: "Google AI Overviews", minPlan: "free",   keyVar: "SERP_API_KEY" as keyof Env },
  perplexity: { label: "Perplexity",         minPlan: "growth",  keyVar: "PERPLEXITY_API_KEY" as keyof Env },
  gemini:     { label: "Gemini",             minPlan: "growth",  keyVar: "GEMINI_API_KEY" as keyof Env },
  copilot:    { label: "Copilot",            minPlan: "scale",   keyVar: "SERP_API_KEY" as keyof Env },
  claude:     { label: "Claude",             minPlan: "scale",   keyVar: "OPENAI_API_KEY" as keyof Env }
};

/** Fixed wording, unpersonalized, US region. Changing this invalidates history. */
export function buildPrompt(query: string): string {
  return query;
}

const URL_RE = /https?:\/\/[^\s)\]"'<>]+/g;

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_RE) ?? [])];
}

// --- mocks ------------------------------------------------------------------
function mockAnswer(engine: EngineId, query: string, subjectHost: string): EngineAnswer {
  // Deterministic per (engine, query) so local runs are reproducible.
  let seed = 0;
  for (const ch of `${engine}:${query}`) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  const cited = seed % 3 === 0;
  const urls = cited
    ? [`https://${subjectHost}/startups`, "https://competitor-a.com"]
    : ["https://competitor-a.com", "https://competitor-b.com", "https://g2.com/acme"];
  return {
    engine,
    ok: true,
    aioPresent: seed % 5 !== 0,
    text:
      `For teams asking "${query}", the most commonly recommended options are ` +
      urls.map((u) => u.replace("https://", "")).join(" and ") +
      ".",
    urls,
    latencyMs: 120 + (seed % 400)
  };
}

// --- real clients -----------------------------------------------------------
async function askOpenAI(env: Env, query: string): Promise<EngineAnswer> {
  const started = Date.now();
  const key = env.OPENAI_API_KEY;
  if (!key) return unavailable("chatgpt", started, "no api key");
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: buildPrompt(query),
        tools: [{ type: "web_search_preview" }]
      })
    });
    if (!res.ok) return unavailable("chatgpt", started, `http ${res.status}`);
    const data = (await res.json()) as { output_text?: string };
    const text = data.output_text ?? "";
    return { engine: "chatgpt", ok: true, text, urls: extractUrls(text), aioPresent: true, raw: data, latencyMs: Date.now() - started };
  } catch (e) {
    return unavailable("chatgpt", started, String(e));
  }
}

async function askPerplexity(env: Env, query: string): Promise<EngineAnswer> {
  const started = Date.now();
  const key = env.PERPLEXITY_API_KEY;
  if (!key) return unavailable("perplexity", started, "no api key");
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: buildPrompt(query) }]
      })
    });
    if (!res.ok) return unavailable("perplexity", started, `http ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      citations?: string[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      engine: "perplexity",
      ok: true,
      text,
      urls: [...new Set([...(data.citations ?? []), ...extractUrls(text)])],
      aioPresent: true,
      raw: data,
      latencyMs: Date.now() - started
    };
  } catch (e) {
    return unavailable("perplexity", started, String(e));
  }
}

async function askGemini(env: Env, query: string): Promise<EngineAnswer> {
  const started = Date.now();
  const key = env.GEMINI_API_KEY;
  if (!key) return unavailable("gemini", started, "no api key");
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(query) }] }],
          tools: [{ google_search: {} }]
        })
      }
    );
    if (!res.ok) return unavailable("gemini", started, `http ${res.status}`);
    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] };
      }[];
    };
    const cand = data.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    // Gemini moved links into a footnote block (see changelog 2026-07-24) — read both.
    const grounded = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.uri)
      .filter((u): u is string => Boolean(u));
    return {
      engine: "gemini",
      ok: true,
      text,
      urls: [...new Set([...grounded, ...extractUrls(text)])],
      aioPresent: true,
      raw: data,
      latencyMs: Date.now() - started
    };
  } catch (e) {
    return unavailable("gemini", started, String(e));
  }
}

/** Google AI Overviews + organic position, via a SERP provider. */
async function askGoogleAio(env: Env, query: string): Promise<EngineAnswer> {
  const started = Date.now();
  const key = env.SERP_API_KEY;
  if (!key) return unavailable("google_aio", started, "no api key");
  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "us");
    url.searchParams.set("hl", "en");
    url.searchParams.set("api_key", key);
    const res = await fetch(url);
    if (!res.ok) return unavailable("google_aio", started, `http ${res.status}`);
    const data = (await res.json()) as {
      ai_overview?: { text_blocks?: { snippet?: string }[]; references?: { link?: string }[] };
      organic_results?: { link?: string; position?: number }[];
    };
    const ao = data.ai_overview;
    const text = (ao?.text_blocks ?? []).map((b) => b.snippet ?? "").join(" ");
    const urls = (ao?.references ?? []).map((r) => r.link).filter((u): u is string => Boolean(u));
    return {
      engine: "google_aio",
      ok: true,
      text,
      urls,
      aioPresent: Boolean(ao),
      raw: data,
      latencyMs: Date.now() - started
    };
  } catch (e) {
    return unavailable("google_aio", started, String(e));
  }
}

function unavailable(engine: EngineId, started: number, error: string): EngineAnswer {
  return { engine, ok: false, text: "", urls: [], aioPresent: false, error, latencyMs: Date.now() - started };
}

export async function ask(
  env: Env,
  engine: EngineId,
  query: string,
  subjectHost: string
): Promise<EngineAnswer> {
  if (env.USE_ENGINE_MOCKS === "true") return mockAnswer(engine, query, subjectHost);
  switch (engine) {
    case "chatgpt":
    case "claude":
      return askOpenAI(env, query);
    case "perplexity":
      return askPerplexity(env, query);
    case "gemini":
      return askGemini(env, query);
    case "google_aio":
    case "copilot":
      return askGoogleAio(env, query);
    default:
      return unavailable(engine, Date.now(), "unknown engine");
  }
}

/** Organic position evidence for cause attribution. */
export async function organicRank(
  env: Env,
  query: string,
  subjectHost: string
): Promise<number | null> {
  if (env.USE_ENGINE_MOCKS === "true") {
    let seed = 0;
    for (const ch of query) seed = (seed * 17 + ch.charCodeAt(0)) % 97;
    return 1 + (seed % 12);
  }
  const key = env.SERP_API_KEY;
  if (!key) return null;
  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("gl", "us");
    url.searchParams.set("api_key", key);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { organic_results?: { link?: string; position?: number }[] };
    for (const r of data.organic_results ?? []) {
      if (r.link && r.link.includes(subjectHost)) return r.position ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
