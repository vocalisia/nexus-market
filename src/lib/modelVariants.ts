// ─── Model variant configurations ────────────────────────────
// Each variant has different signal generation and scoring parameters.
// Performance is tracked separately per variant in memory/Redis.

export type VariantId = "1" | "2" | "3" | "4";

export interface ModelVariantConfig {
  id: VariantId;
  name: string;
  description: string;
  /** ADX below this value = ranging market → RSI signals silenced */
  adxGate: number;
  /** Minimum simultaneous indicators needed for a MEDIUM severity signal */
  minPartsForMedium: number;
  /** If true, only HIGH severity signals are generated (no MEDIUM) */
  highOnly: boolean;
  /** Multiplier applied to Fear & Greed score adjustment */
  fearGreedMult: number;
  /** Multiplier applied to market sentiment adjustment (funding/LS/liquidations/news) */
  sentimentMult: number;
}

export const MODEL_VARIANTS: Record<VariantId, ModelVariantConfig> = {
  "1": {
    id: "1",
    name: "BALANCED",
    description: "ADX≥20 · 2 indicateurs · seuil 0.4%",
    adxGate: 20,
    minPartsForMedium: 2,
    highOnly: false,
    fearGreedMult: 1.0,
    sentimentMult: 1.0,
  },
  "2": {
    id: "2",
    name: "AGRESSIF",
    description: "ADX≥15 · 1 indicateur · Fear&Greed ×1.5",
    adxGate: 15,
    minPartsForMedium: 1,
    highOnly: false,
    fearGreedMult: 1.5,
    sentimentMult: 1.2,
  },
  "3": {
    id: "3",
    name: "CONSERVATEUR",
    description: "ADX≥25 · HIGH only · sentiment ×0.7",
    adxGate: 25,
    minPartsForMedium: 3,
    highOnly: true,
    fearGreedMult: 0.8,
    sentimentMult: 0.7,
  },
  "4": {
    id: "4",
    name: "SENTIMENT-FIRST",
    description: "ADX≥20 · Polymarket+Funding ×2",
    adxGate: 20,
    minPartsForMedium: 2,
    highOnly: false,
    fearGreedMult: 2.0,
    sentimentMult: 2.0,
  },
};

export const DEFAULT_VARIANT: VariantId = "1";

/** Production URL per variant deployment */
export const VARIANT_URLS: Record<VariantId, string> = {
  "1": "https://prediction-dashboard-one.vercel.app",
  "2": "https://prediction-dashboard-two.vercel.app",
  "3": "https://prediction-dashboard-three.vercel.app",
  "4": "https://prediction-dashboard-four.vercel.app",
};

/** Redis key per variant */
export function redisKey(variant: VariantId): string {
  return `nexus_memory_v${variant}`;
}

/** localStorage key per variant */
export function localKey(variant: VariantId): string {
  return variant === "1" ? "nexus_memory" : `nexus_memory_v${variant}`;
}
