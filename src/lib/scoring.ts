import type { AssetCategory, AIDirection, Signal } from "@/types/market";
import { calculateRSI, calculateADX, calculateStochRSI } from "./indicators";
import { isMarketOpen } from "./marketHours";
import { DEFAULT_WEIGHTS } from "./memoryEngine";
import type { IndicatorWeights } from "./memoryEngine";

// ─── Market microstructure sentiment (crypto only) ───────────

export interface MarketSentimentData {
  fundingRate?: number;     // Bybit: 0.0001 = 0.01%; positive = longs pay shorts (bearish pressure)
  lsRatio?: number;         // Long/Short ratio; > 1 = more longs than shorts
  newsSentiment?: number;   // CryptoPanic: 0-100, 50 = neutral
  liquidationBias?: number; // -1 to +1: positive = more short liq (bullish), negative = more long liq
}

/**
 * Returns a score adjustment (-15 to +15) based on crypto microstructure signals.
 * Only applies to CRYPTO assets; call only when category === "CRYPTO".
 */
export function computeSentimentAdjustment(data: MarketSentimentData): number {
  let adj = 0;

  // Funding rate: positive funding = market over-leveraged long → bearish pressure
  // 0.0001 (0.01%) → ±4 pts; 0.0002 (0.02%) → capped at ±8 pts
  if (data.fundingRate !== undefined) {
    const frAdj = -(data.fundingRate / 0.0001) * 4;
    adj += Math.min(8, Math.max(-8, frAdj));
  }

  // Long/Short ratio
  if (data.lsRatio !== undefined) {
    if (data.lsRatio > 1.5) adj += 5;
    else if (data.lsRatio > 1.3) adj += 3;
    else if (data.lsRatio < 0.67) adj -= 5;
    else if (data.lsRatio < 0.77) adj -= 3;
  }

  // News sentiment (0-100 → centered at 50 → ±5 pts max)
  if (data.newsSentiment !== undefined) {
    adj += (data.newsSentiment - 50) * 0.1;
  }

  // Liquidation bias (-1 to +1 → ±5 pts max)
  if (data.liquidationBias !== undefined) {
    adj += data.liquidationBias * 5;
  }

  return Math.min(15, Math.max(-15, adj));
}

// --- Category-specific scoring configs ---

interface ScoringConfig {
  rsiWeight: number;
  change24hWeight: number;
  change7dWeight: number;
  sentimentWeight: number;
  change24hRange: [number, number];
  change7dRange: [number, number];
}

const SCORING_CONFIGS: Record<AssetCategory, ScoringConfig> = {
  CRYPTO: {
    rsiWeight: 0.35,
    change24hWeight: 0.30,
    change7dWeight: 0.20,
    sentimentWeight: 0.15,
    change24hRange: [-10, 10],
    change7dRange: [-20, 20],
  },
  FOREX: {
    rsiWeight: 0.40,
    change24hWeight: 0.20,
    change7dWeight: 0.15,
    sentimentWeight: 0.25,
    change24hRange: [-2, 2],
    change7dRange: [-5, 5],
  },
  COMMODITIES: {
    rsiWeight: 0.35,
    change24hWeight: 0.25,
    change7dWeight: 0.20,
    sentimentWeight: 0.20,
    change24hRange: [-5, 5],
    change7dRange: [-10, 10],
  },
  STOCKS: {
    rsiWeight: 0.30,
    change24hWeight: 0.35,
    change7dWeight: 0.25,
    sentimentWeight: 0.10,
    change24hRange: [-5, 5],
    change7dRange: [-15, 15],
  },
};

function normalize(value: number, min: number, max: number): number {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function computeAIScore(
  change24h: number,
  change7d: number,
  rsi: number,
  category: AssetCategory,
  sentiment = 50,
  adx = 0,
  stochRsiK = 50,
  weights: IndicatorWeights = DEFAULT_WEIGHTS,
): number {
  const cfg = SCORING_CONFIGS[category];

  const rsiScore = rsi * weights.rsi;
  const ch24 = normalize(change24h, cfg.change24hRange[0], cfg.change24hRange[1]);
  const ch7d = normalize(change7d, cfg.change7dRange[0], cfg.change7dRange[1]);
  const sentimentWeighted = sentiment * weights.polymarket;

  const baseScore =
    rsiScore * cfg.rsiWeight +
    ch24 * cfg.change24hWeight +
    ch7d * cfg.change7dWeight +
    sentimentWeighted * cfg.sentimentWeight;

  const adxMod = (adx > 25 ? 5 : adx > 0 ? -10 : 0) * weights.adx;
  const stochMod = (stochRsiK < 20 ? 8 : stochRsiK > 80 ? -8 : 0) * weights.stochRsi;

  return Math.round(Math.min(100, Math.max(0, baseScore + adxMod + stochMod)));
}

export function getDirection(score: number): AIDirection {
  if (score > 55) return "UP";
  if (score < 45) return "DOWN";
  return "NEUTRAL";
}

// --- Signal Generation (category-aware thresholds) ---

interface SignalThresholds {
  rsiOversold: number;
  rsiOverbought: number;
  rsiWarnLow: number;
  rsiWarnHigh: number;
  momentum24h: number;
  trend7d: number;
}

const SIGNAL_THRESHOLDS: Record<AssetCategory, SignalThresholds> = {
  CRYPTO:     { rsiOversold: 30, rsiOverbought: 70, rsiWarnLow: 40, rsiWarnHigh: 60, momentum24h: 5, trend7d: 15 },
  FOREX:      { rsiOversold: 25, rsiOverbought: 75, rsiWarnLow: 35, rsiWarnHigh: 65, momentum24h: 1, trend7d: 3  },
  COMMODITIES:{ rsiOversold: 28, rsiOverbought: 72, rsiWarnLow: 38, rsiWarnHigh: 62, momentum24h: 3, trend7d: 8  },
  STOCKS:     { rsiOversold: 30, rsiOverbought: 70, rsiWarnLow: 40, rsiWarnHigh: 60, momentum24h: 2, trend7d: 10 },
};

export interface SignalConfig {
  adxGate?: number;         // ADX below this = ranging; default 20
  minPartsForMedium?: number; // min simultaneous parts for MEDIUM; default 2
  highOnly?: boolean;       // only generate HIGH severity; default false
}

export function generateSignal(
  name: string,
  symbol: string,
  rsi: number,
  change24h: number,
  change7d: number,
  score: number,
  direction: AIDirection,
  category: AssetCategory,
  sparkline: number[] = [],
  cfg: SignalConfig = {},
): Signal | null {
  const adxGateThreshold = cfg.adxGate ?? 20;
  const minParts = cfg.minPartsForMedium ?? 2;
  const highOnly = cfg.highOnly ?? false;
  // Block signals on closed markets
  const status = isMarketOpen(category);
  if (!status.isOpen) return null;

  // ADX filter: ignore RSI signals in ranging markets
  let adx = 0;
  if (sparkline.length >= 20) {
    // Use sparkline as proxy for high/low/close (approximation from hourly close prices)
    adx = calculateADX(sparkline, sparkline, sparkline) ?? 0;
  }

  // Ranging market gate: ADX known (>0) and below threshold = flat market, no RSI signals
  const isRanging = adx > 0 && adx < adxGateThreshold;

  const t = SIGNAL_THRESHOLDS[category];
  const parts: string[] = [];
  let severity: "low" | "medium" | "high" = "low";

  // RSI extremes require confirmed trend (ADX > gate threshold)
  if (rsi < t.rsiOversold && adx > adxGateThreshold) { parts.push("RSI oversold"); severity = "high"; }
  else if (rsi > t.rsiOverbought && adx > adxGateThreshold) { parts.push("RSI overbought"); severity = "high"; }
  // "approaching" levels only fire in trending markets — silenced in ranging
  else if (rsi < t.rsiWarnLow && !isRanging) { parts.push("RSI approaching oversold"); severity = "medium"; }
  else if (rsi > t.rsiWarnHigh && !isRanging) { parts.push("RSI approaching overbought"); severity = "medium"; }

  if (change24h > t.momentum24h) { parts.push("momentum bullish"); if (severity === "low") severity = "medium"; }
  else if (change24h < -t.momentum24h) { parts.push("momentum bearish"); if (severity === "low") severity = "medium"; }

  if (change7d > t.trend7d) { parts.push("strong 7d uptrend"); severity = "high"; }
  else if (change7d < -t.trend7d) { parts.push("strong 7d downtrend"); severity = "high"; }

  // StochRSI confirmation bonus
  if (sparkline.length >= 20) {
    const stochRsi = calculateStochRSI(sparkline);
    if (stochRsi && stochRsi.k < 20 && direction === "UP") {
      parts.push("StochRSI oversold");
      if (severity === "low") severity = "medium";
    } else if (stochRsi && stochRsi.k > 80 && direction === "DOWN") {
      parts.push("StochRSI overbought");
      if (severity === "low") severity = "medium";
    }
  }

  // Enforce minimum parts requirement for MEDIUM signals
  if (severity === "medium" && parts.length < minParts) {
    parts.length = 0;
    severity = "low";
  }
  // Conservative variant: discard MEDIUM signals entirely
  if (highOnly && severity === "medium") {
    parts.length = 0;
    severity = "low";
  }

  // AI Score override — fires only when NO technical signal qualifies
  if (parts.length === 0) {
    if (score <= 38 && direction === "DOWN") {
      parts.push(`AI bearish conviction ${score}/100`);
      severity = score <= 32 ? "high" : "medium";
    } else if (score >= 62 && direction === "UP") {
      parts.push(`AI bullish conviction ${score}/100`);
      severity = score >= 68 ? "high" : "medium";
    }
  }

  if (parts.length === 0) return null;

  // Upgrade to high when ADX is strong and RSI is at an extreme
  if (adx > adxGateThreshold * 1.5 && (rsi < t.rsiOversold || rsi > t.rsiOverbought) && severity !== "high") {
    severity = "high";
  }

  const type = direction === "UP" ? "BUY" : direction === "DOWN" ? "SELL" : "WATCH";

  return {
    asset: `${name} (${symbol.toUpperCase()})`,
    type,
    message: `${parts.join(" + ")} \u2014 AI confidence ${score}/100`,
    severity,
    generatedAt: new Date().toISOString(),
  };
}
