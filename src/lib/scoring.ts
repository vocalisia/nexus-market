import type { AssetCategory, AIDirection, Signal } from "@/types/market";
import { calculateRSI, calculateADX, calculateStochRSI } from "./indicators";
import { isMarketOpen } from "./marketHours";
import { DEFAULT_WEIGHTS } from "./memoryEngine";
import type { IndicatorWeights } from "./memoryEngine";

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

export function generateSignal(
  name: string,
  symbol: string,
  rsi: number,
  change24h: number,
  change7d: number,
  score: number,
  direction: AIDirection,
  category: AssetCategory,
  sparkline: number[] = []
): Signal | null {
  // Block signals on closed markets
  const status = isMarketOpen(category);
  if (!status.isOpen) return null;

  // ADX filter: ignore RSI signals in ranging markets
  let adx = 0;
  if (sparkline.length >= 20) {
    // Use sparkline as proxy for high/low/close (approximation from hourly close prices)
    adx = calculateADX(sparkline, sparkline, sparkline) ?? 0;
  }

  const t = SIGNAL_THRESHOLDS[category];
  const parts: string[] = [];
  let severity: "low" | "medium" | "high" = "low";

  if (rsi < t.rsiOversold && adx > 25) { parts.push("RSI oversold"); severity = "high"; }
  else if (rsi > t.rsiOverbought && adx > 25) { parts.push("RSI overbought"); severity = "high"; }
  else if (rsi < t.rsiWarnLow) { parts.push("RSI approaching oversold"); severity = "medium"; }
  else if (rsi > t.rsiWarnHigh) { parts.push("RSI approaching overbought"); severity = "medium"; }

  if (change24h > t.momentum24h) { parts.push("momentum bullish"); if (severity === "low") severity = "medium"; }
  else if (change24h < -t.momentum24h) { parts.push("momentum bearish"); if (severity === "low") severity = "medium"; }

  if (change7d > t.trend7d) { parts.push("strong 7d uptrend"); severity = "high"; }
  else if (change7d < -t.trend7d) { parts.push("strong 7d downtrend"); severity = "high"; }

  // Ranging market: downgrade severity if ADX is very low
  if (adx > 0 && adx < 20 && parts.length > 0) {
    severity = "low";
  }

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

  if (parts.length === 0) return null;

  // Upgrade to high when ADX is strong and RSI is at an extreme
  if (adx > 30 && (rsi < t.rsiOversold || rsi > t.rsiOverbought) && severity !== "high") {
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
