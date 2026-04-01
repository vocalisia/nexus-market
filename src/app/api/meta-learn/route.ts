import { NextResponse } from "next/server";
import { MODEL_VARIANTS } from "@/lib/modelVariants";
import type { VariantId } from "@/lib/modelVariants";
import type { PerformanceMemory, IndicatorWeights } from "@/lib/memoryEngine";
import { computeAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// ─── Redis helpers ────────────────────────────────────────────

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL  ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

function authHeaders() {
  return {
    Authorization: `Bearer ${REDIS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function redisGet(key: string): Promise<string | null> {
  const res = await fetch(`${REDIS_URL}/get/${key}`, {
    headers: authHeaders(), cache: "no-store",
  });
  const json = await res.json() as { result: string | null };
  return json.result ?? null;
}

async function redisSet(key: string, value: string): Promise<void> {
  await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify([["SET", key, value]]),
  });
}

// ─── Composite score for ranking ─────────────────────────────
// Combines win rate + profit factor + EV, requires min samples

const MIN_TRADES = 10;

function compositeScore(m: PerformanceMemory): number {
  const decisive = m.totalWins + m.totalLosses;
  if (decisive < MIN_TRADES) return -1; // not eligible
  const analytics = computeAnalytics(m.history);
  const wr = m.globalWinRate / 100;           // 0-1
  const pf = Math.min(analytics.profitFactor, 5); // cap at 5 to avoid ∞ dominating
  const ev = Math.max(0, analytics.expectedValue); // only positive EV counts
  // Weighted composite: win rate matters most, then profit factor, then EV
  return (wr * 0.5) + (pf / 5 * 0.3) + (ev * 0.2);
}

// ─── Weight blending ──────────────────────────────────────────
// Blend: 65% own weights + 35% best variant weights
// Only applied when best is ≥15% better score than own

const BLEND_RATIO = 0.35; // how much of the best variant to mix in
const MIN_SCORE_GAP = 0.10; // best must be 10+ points better (composite scale)

function blendWeights(own: IndicatorWeights, best: IndicatorWeights): IndicatorWeights {
  const result = {} as IndicatorWeights;
  for (const key of Object.keys(own) as (keyof IndicatorWeights)[]) {
    result[key] = parseFloat(
      ((1 - BLEND_RATIO) * own[key] + BLEND_RATIO * best[key]).toFixed(3)
    );
  }
  return result;
}

// ─── Report type ──────────────────────────────────────────────

export interface MetaLearnReport {
  runAt: string;
  bestVariant: VariantId | null;
  bestScore: number;
  scores: Record<VariantId, { score: number; eligible: boolean; decisive: number }>;
  blended: VariantId[]; // variants that received a weight blend
  skipped: VariantId[]; // variants with too few trades
  message: string;
}

// ─── POST /api/meta-learn ─────────────────────────────────────

export async function POST() {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 503 });
  }

  const VARIANTS: VariantId[] = ["1", "2", "3", "4"];

  // 1. Load all variant memories from Redis
  const memories: Record<VariantId, PerformanceMemory | null> = {} as Record<VariantId, PerformanceMemory | null>;
  await Promise.all(
    VARIANTS.map(async (v) => {
      const key = v === "1" ? "nexus_memory_v1" : `nexus_memory_v${v}`;
      try {
        const raw = await redisGet(key);
        memories[v] = raw ? JSON.parse(raw) as PerformanceMemory : null;
      } catch {
        memories[v] = null;
      }
    })
  );

  // 2. Score each variant
  const scores: MetaLearnReport["scores"] = {} as MetaLearnReport["scores"];
  for (const v of VARIANTS) {
    const m = memories[v];
    if (!m) {
      scores[v] = { score: -1, eligible: false, decisive: 0 };
      continue;
    }
    const decisive = m.totalWins + m.totalLosses;
    const score = compositeScore(m);
    scores[v] = { score: parseFloat(score.toFixed(4)), eligible: score >= 0, decisive };
  }

  // 3. Find best eligible variant
  let bestVariant: VariantId | null = null;
  let bestScore = -1;
  for (const v of VARIANTS) {
    if (scores[v].eligible && scores[v].score > bestScore) {
      bestScore = scores[v].score;
      bestVariant = v;
    }
  }

  const blended: VariantId[] = [];
  const skipped: VariantId[] = [];

  // 4. Blend weights from best → underperformers
  if (bestVariant !== null) {
    const bestMemory = memories[bestVariant]!;

    for (const v of VARIANTS) {
      if (v === bestVariant) continue;

      const m = memories[v];
      if (!m || !scores[v].eligible) {
        skipped.push(v);
        continue;
      }

      const scoreDiff = bestScore - scores[v].score;
      if (scoreDiff < MIN_SCORE_GAP) {
        // Close enough — no blend needed
        continue;
      }

      // Blend weights
      const newWeights = blendWeights(m.weights, bestMemory.weights);
      const updated: PerformanceMemory = {
        ...m,
        weights: newWeights,
        lastWeightUpdate: new Date().toISOString(),
      };

      const key = v === "1" ? "nexus_memory_v1" : `nexus_memory_v${v}`;
      await redisSet(key, JSON.stringify({ ...updated, history: updated.history.slice(-200) }));
      blended.push(v);
    }
  }

  // 5. Save report
  const report: MetaLearnReport = {
    runAt: new Date().toISOString(),
    bestVariant,
    bestScore: parseFloat(bestScore.toFixed(4)),
    scores,
    blended,
    skipped,
    message: bestVariant
      ? blended.length > 0
        ? `V${bestVariant} (${MODEL_VARIANTS[bestVariant].name}) est le meilleur — poids propagés vers V${blended.join(", V")}`
        : `V${bestVariant} est le meilleur mais les autres sont proches — aucun blend nécessaire`
      : "Pas assez de données (min ${MIN_TRADES} trades par variant)",
  };

  await redisSet("nexus_meta_report", JSON.stringify(report));

  return NextResponse.json(report);
}

// ─── GET /api/meta-learn — fetch last report ──────────────────

export async function GET() {
  if (!REDIS_URL || !REDIS_TOKEN) return NextResponse.json(null);
  try {
    const raw = await redisGet("nexus_meta_report");
    if (!raw) return NextResponse.json(null);
    return NextResponse.json(JSON.parse(raw) as MetaLearnReport);
  } catch {
    return NextResponse.json(null);
  }
}
