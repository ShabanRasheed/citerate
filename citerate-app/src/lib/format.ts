/**
 * Formatters. The app never inlines a number format — the rules live here so a
 * rate reads identically in the sidebar, a table, a chart tooltip, and the PDF.
 */
import { CAUSE_LABEL, type Cause } from "./scoring";

/** 0.4231 → "42%". Rates are whole percents everywhere except the score unit. */
export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Signed delta in points, never a percentage of a percentage. */
export function delta(current: number | null, previous: number | null): { text: string; tone: "up" | "down" | "flat" } {
  if (current === null || previous === null) return { text: "—", tone: "flat" };
  const points = Math.round((current - previous) * 100);
  if (points === 0) return { text: "0 pts", tone: "flat" };
  return {
    text: `${points > 0 ? "+" : "−"}${Math.abs(points)} pts`,
    tone: points > 0 ? "up" : "down"
  };
}

export function band(low: number | null, high: number | null): string {
  if (low === null || high === null) return "";
  return `${pct(low)}–${pct(high)} band`;
}

export function ratio(cited: number, runs: number): string {
  return `${cited}/${runs} runs`;
}

/** 2026-07-24 in the user's locale-independent house format: "24 Jul 2026". */
export function day(input: string | number | Date): string {
  const d = typeof input === "number" ? new Date(input * 1000) : new Date(input);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function shortDay(input: string): string {
  return new Date(input).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function relative(unixSeconds: number | null): string {
  if (!unixSeconds) return "never";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 90) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} d ago`;
  return day(unixSeconds);
}

export const causeLabel = (cause: Cause | null): string => (cause ? CAUSE_LABEL[cause] : "Cited");

export const causeKey = (cause: Cause | null): "aio" | "rank" | "tech" | "other" | "cited" => {
  switch (cause) {
    case "aio_displacement": return "aio";
    case "ranking_decline": return "rank";
    case "technical_decay": return "tech";
    case "unexplained": return "other";
    default: return "cited";
  }
};

export const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  google_aio: "Google AIO",
  copilot: "Copilot",
  claude: "Claude"
};

export function engineLabel(slug: string): string {
  return ENGINE_LABEL[slug] ?? slug;
}

/** Confidence below the floor is never dressed up as a diagnosis. */
export function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "";
  return `confidence ${confidence.toFixed(2)}`;
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0]! : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || base.slice(0, 2).toUpperCase();
}
