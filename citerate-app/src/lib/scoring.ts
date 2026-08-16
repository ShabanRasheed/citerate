/**
 * Scoring and cause attribution — the rules /how-it-works promises.
 * Keep this file and that page in sync; when a rule changes, bump METHOD_VERSION
 * and write a changelog entry so affected charts show a flagged discontinuity
 * instead of a silent correction.
 */

export const METHOD_VERSION = "1.3";
export const CONFIDENCE_FLOOR = 0.6;

export type Cause = "aio_displacement" | "ranking_decline" | "technical_decay" | "unexplained";

export interface RunResult {
  cited: boolean;
  mentioned: boolean;
  aioPresent: boolean;
  competitorHosts: string[];
}

export interface Evidence {
  runs: RunResult[];
  organicRank: number | null;
  rankHeld: boolean;      // position stable over the trailing window
  techPass: boolean;      // fetchable, indexable, structured
}

export interface Verdict {
  runs: number;
  citedRuns: number;
  mentionRuns: number;
  citationRate: number;
  cause: Cause | null;
  confidence: number | null;
  competitors: string[];
}

/** Citation rate is computed over runs, never over a single lucky answer. */
export function citationRate(citedRuns: number, runs: number): number {
  if (runs <= 0) return 0;
  return Number((citedRuns / runs).toFixed(4));
}

/**
 * Wilson score interval — the confidence band drawn on every trend chart.
 * Week-over-week movement inside the band is labeled "within noise".
 */
export function confidenceBand(citedRuns: number, runs: number, z = 1.96): [number, number] {
  if (runs === 0) return [0, 0];
  const p = citedRuns / runs;
  const denom = 1 + (z * z) / runs;
  const centre = p + (z * z) / (2 * runs);
  const margin = z * Math.sqrt((p * (1 - p)) / runs + (z * z) / (4 * runs * runs));
  return [
    Number(Math.max(0, (centre - margin) / denom).toFixed(4)),
    Number(Math.min(1, (centre + margin) / denom).toFixed(4))
  ];
}

/** True when a delta is smaller than the two bands' overlap — i.e. noise. */
export function isWithinNoise(
  a: { cited: number; runs: number },
  b: { cited: number; runs: number }
): boolean {
  const [aLow, aHigh] = confidenceBand(a.cited, a.runs);
  const [bLow, bHigh] = confidenceBand(b.cited, b.runs);
  return aLow <= bHigh && bLow <= aHigh;
}

/**
 * Attribute the cause for an uncited query.
 * Weighs four pieces of evidence, then either names a cause with confidence or
 * returns "unexplained". A diagnosis tool that always has a diagnosis is a
 * horoscope, so nothing below CONFIDENCE_FLOOR gets a label.
 */
export function attribute(ev: Evidence): { cause: Cause; confidence: number } {
  const runs = ev.runs.length || 1;
  const aioShare = ev.runs.filter((r) => r.aioPresent).length / runs;
  const competitorShare =
    ev.runs.filter((r) => r.competitorHosts.length > 0).length / runs;

  let score: Record<Cause, number> = {
    aio_displacement: 0,
    ranking_decline: 0,
    technical_decay: 0,
    unexplained: 0
  };

  // Technical decay is checked first: if engines cannot read the page, nothing
  // else explains anything.
  if (!ev.techPass) score.technical_decay += 0.7;

  // Ranking decline: the position actually moved.
  if (ev.organicRank !== null && ev.organicRank > 8) score.ranking_decline += 0.45;
  if (!ev.rankHeld) score.ranking_decline += 0.35;

  // AIO displacement: an answer appeared, the rank held, the page is healthy,
  // and somebody else got cited.
  if (aioShare >= 0.66) score.aio_displacement += 0.4;
  if (ev.rankHeld && ev.organicRank !== null && ev.organicRank <= 5) score.aio_displacement += 0.3;
  if (ev.techPass) score.aio_displacement += 0.1;
  if (competitorShare >= 0.66) score.aio_displacement += 0.15;

  // No AI answer at all and the rank held → we genuinely do not know.
  if (aioShare === 0 && ev.rankHeld && ev.techPass) score.unexplained += 0.8;

  const [cause, raw] = (Object.entries(score) as [Cause, number][]).sort((a, b) => b[1] - a[1])[0]!;
  const confidence = Number(Math.min(0.99, raw).toFixed(2));

  if (cause === "unexplained" || confidence < CONFIDENCE_FLOOR) {
    return { cause: "unexplained", confidence };
  }
  return { cause, confidence };
}

export function summarize(ev: Evidence): Verdict {
  const runs = ev.runs.length;
  const citedRuns = ev.runs.filter((r) => r.cited).length;
  const mentionRuns = ev.runs.filter((r) => !r.cited && r.mentioned).length;
  const competitors = [...new Set(ev.runs.flatMap((r) => r.competitorHosts))];

  if (citedRuns === runs && runs > 0) {
    return { runs, citedRuns, mentionRuns, citationRate: 1, cause: null, confidence: null, competitors };
  }

  const { cause, confidence } = attribute(ev);
  return {
    runs,
    citedRuns,
    mentionRuns,
    citationRate: citationRate(citedRuns, runs),
    cause,
    confidence,
    competitors
  };
}

/** Cause mix across a whole scan, for the cause-separation bar. */
export function causeMix(verdicts: Verdict[]): Record<"aio" | "rank" | "tech" | "other", number> {
  const uncited = verdicts.filter((v) => v.citationRate < 1 && v.cause);
  const total = uncited.length || 1;
  const count = (c: Cause) => uncited.filter((v) => v.cause === c).length / total;
  return {
    aio: Number(count("aio_displacement").toFixed(3)),
    rank: Number(count("ranking_decline").toFixed(3)),
    tech: Number(count("technical_decay").toFixed(3)),
    other: Number(count("unexplained").toFixed(3))
  };
}

export const CAUSE_LABEL: Record<Cause, string> = {
  aio_displacement: "AIO displacement",
  ranking_decline: "Ranking decline",
  technical_decay: "Technical decay",
  unexplained: "Other / unexplained"
};
