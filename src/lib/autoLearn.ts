import type { AssetCategory } from "@/types/market";
import type {
  AlertIndicatorsSnapshot,
  AlertRecord,
  IndicatorWeights,
  PerformanceMemory,
} from "./memoryEngine";

// ─── Auto-learning: weight bounds ────────────────────────────
const WEIGHT_BOUNDS = { min: 0.30, max: 1.80 };

function clampWeight(w: number): number {
  return Math.min(WEIGHT_BOUNDS.max, Math.max(WEIGHT_BOUNDS.min, w));
}

// ─── Learning rate by phase (aggressive after Hyper Alpha Arena insights) ──
function getLearningRate(phase: PerformanceMemory["learningPhase"]): number {
  switch (phase) {
    case "COLD":    return 0;
    case "WARMING": return 0.04;
    case "ACTIVE":  return 0.08;
    case "FULL":    return 0.10; // was 0.05 — faster adaptation to market changes
  }
}

// ─── Determine which indicators were active for a signal ─────
function getActiveIndicators(
  snapshot: AlertIndicatorsSnapshot,
  category: AssetCategory,
): (keyof IndicatorWeights)[] {
  const active: (keyof IndicatorWeights)[] = [];

  const rsiThresholds: Record<AssetCategory, number> = {
    CRYPTO: 30, FOREX: 25, COMMODITIES: 28, STOCKS: 30,
  };
  const rsiOversold = rsiThresholds[category];
  if (snapshot.rsi < rsiOversold || snapshot.rsi > (100 - rsiOversold)) {
    active.push("rsi");
  }

  if (snapshot.adx > 25) active.push("adx");
  if (snapshot.stochRsiK < 20 || snapshot.stochRsiK > 80) active.push("stochRsi");
  if (snapshot.macdCross !== "NONE") active.push("macd");
  if (snapshot.bollingerPos !== "INSIDE") active.push("bollinger");

  // OBV always active as volume confirmation
  active.push("obv");

  if (snapshot.fearGreed < 25 || snapshot.fearGreed > 75) active.push("fearGreed");

  return active;
}

// ─── Update weights based on a validated result ───────────────
export function updateWeights(
  currentWeights: IndicatorWeights,
  record: AlertRecord,
  phase: PerformanceMemory["learningPhase"],
): IndicatorWeights {
  if (phase === "COLD") return currentWeights;

  const lr = getLearningRate(phase);
  const activeIndicators = getActiveIndicators(record.snapshot, record.category);

  // Stronger signal = more weight adjustment
  const amplitudeConfidence = Math.min(1.0, Math.abs(record.points) / 3.0);
  const effectiveDelta = lr * amplitudeConfidence;

  const updated = { ...currentWeights };

  for (const indicator of activeIndicators) {
    if (record.result === "WIN") {
      updated[indicator] = clampWeight(updated[indicator] + effectiveDelta);
    } else if (record.result === "LOSS") {
      updated[indicator] = clampWeight(updated[indicator] - effectiveDelta);
    }
    // NEUTRAL: no weight change
  }

  return updated;
}

// ─── Degradation detection ────────────────────────────────────
export function checkDegradation(
  degradationStreak: number,
  result: "WIN" | "LOSS" | "NEUTRAL",
): { newStreak: number; shouldReset: boolean; resetReason?: string } {
  if (result === "WIN") {
    return { newStreak: 0, shouldReset: false };
  }
  if (result === "NEUTRAL") {
    return { newStreak: degradationStreak, shouldReset: false };
  }
  // LOSS
  const newStreak = degradationStreak + 1;
  if (newStreak >= 10) {
    return {
      newStreak: 0,
      shouldReset: true,
      resetReason: "10 erreurs consécutives — poids réinitialisés automatiquement",
    };
  }
  return { newStreak, shouldReset: false };
}

// ─── Partial weight reset (50% toward 1.0) ───────────────────
export function partialWeightReset(weights: IndicatorWeights): IndicatorWeights {
  const reset = {} as IndicatorWeights;
  for (const key of Object.keys(weights) as (keyof IndicatorWeights)[]) {
    reset[key] = parseFloat(((weights[key] + 1.0) / 2).toFixed(3));
  }
  return reset;
}
