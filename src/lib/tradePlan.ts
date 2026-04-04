// ─── Trade Plan Generator ─────────────────────────────────────
// Combines:
//   - Strategy 3.11/3.12 (Single/Two Moving Averages crossover)
//   - Bollinger Band mean reversion (Str. 3.9)
//   - Z-score momentum filter (Str. 3.1)
//   - RSI extremes from scoring.ts
// Outputs structured entry/stop/target plan with 1:2 and 1:3 R/R

import type { AssetCategory, TradePlan } from "@/types/market";
import { lastSMA, lastEMA, bollingerBands, zScore, calculateATR } from "./indicators";

// ── Per-category stop-loss range (min%, max%) ────────────────
// Widened after analysis: 19/20 trades hit SL at 3% — crypto swings 5%+ hourly
const STOP_RANGE: Record<AssetCategory, [number, number]> = {
  CRYPTO:      [0.050, 0.120],  // was 3-8% → now 5-12%
  FOREX:       [0.008, 0.025],  // was 0.5-2% → now 0.8-2.5%
  COMMODITIES: [0.030, 0.070],  // was 2-5% → now 3-7%
  STOCKS:      [0.035, 0.090],  // was 2.5-7% → now 3.5-9%
};

export function buildTradePlan(
  prices: number[],
  rsi: number,
  change24h: number,
  change7d: number,
  aiScore: number,
  category: AssetCategory,
  forceDirection?: "LONG" | "SHORT",
): TradePlan {
  const price = prices[prices.length - 1] ?? 0;

  // Not enough data → no plan
  if (prices.length < 3 || price === 0) {
    return {
      direction: "WAIT",
      strategy: "Insufficient data",
      entry: price,
      stopLoss: 0,
      target1: 0,
      target2: 0,
      trailStop: 0,
      stopPercent: 0,
      target1Percent: 0,
      target2Percent: 0,
      confidence: aiScore,
      reasons: ["Need ≥3 price points"],
    };
  }

  // ── Indicators (adaptive to available data length) ───────────
  const n     = prices.length;
  const sma9  = lastSMA(prices, Math.min(9,  n));
  const sma21 = lastSMA(prices, Math.min(21, n));
  const ema9  = lastEMA(prices, Math.min(9,  n));
  const bb    = bollingerBands(prices, Math.min(20, n), 2.0);
  const z     = n >= 5 ? zScore(prices, Math.min(20, n)) : 0;

  const bbRange    = bb.upper - bb.lower;
  const bbPos      = bbRange > 0 ? (price - bb.lower) / bbRange : 0.5;
  const maBull     = sma9 > sma21;
  const rsiLow     = rsi < 35;
  const rsiHigh    = rsi > 65;
  const nearLowerBB = bbPos < 0.18;
  const nearUpperBB = bbPos > 0.82;

  // ── Score LONG and SHORT independently ──────────────────────
  const longReasons: string[]  = [];
  const shortReasons: string[] = [];
  let longScore  = 0;
  let shortScore = 0;

  // Strategy 3.12 — Two MAs crossover
  if (maBull) {
    longReasons.push(`SMA9 > SMA21 (uptrend)`);
    longScore += 1;
  } else {
    shortReasons.push(`SMA9 < SMA21 (downtrend)`);
    shortScore += 1;
  }

  // EMA fast vs price
  if (price > ema9) {
    longReasons.push(`Price above EMA9`);
    longScore += 1;
  } else {
    shortReasons.push(`Price below EMA9`);
    shortScore += 1;
  }

  // RSI signal
  if (rsiLow) {
    longReasons.push(`RSI ${rsi.toFixed(0)} — oversold bounce`);
    longScore += 2;
  } else if (rsiHigh) {
    shortReasons.push(`RSI ${rsi.toFixed(0)} — overbought`);
    shortScore += 2;
  } else if (rsi < 45) {
    longReasons.push(`RSI ${rsi.toFixed(0)} — weak`);
    longScore += 1;
  } else if (rsi > 55) {
    shortReasons.push(`RSI ${rsi.toFixed(0)} — elevated`);
    shortScore += 1;
  }

  // Bollinger Band position (Strategy 3.9 — mean reversion)
  if (nearLowerBB) {
    longReasons.push(`Near lower Bollinger Band`);
    longScore += 2;
  } else if (nearUpperBB) {
    shortReasons.push(`Near upper Bollinger Band`);
    shortScore += 2;
  }

  // Z-score momentum (Strategy 3.1)
  if (z < -1.2) {
    longReasons.push(`Z-score ${z.toFixed(1)} — below mean`);
    longScore += 1;
  } else if (z > 1.2) {
    shortReasons.push(`Z-score ${z.toFixed(1)} — above mean`);
    shortScore += 1;
  }

  // Pullback / bounce context
  if (change24h < -3 && change7d > 0) {
    longReasons.push(`Pullback in 7d uptrend`);
    longScore += 1;
  } else if (change24h > 3 && change7d < 0) {
    shortReasons.push(`Dead-cat bounce in downtrend`);
    shortScore += 1;
  }

  // ── Determine direction ──────────────────────────────────────
  const MIN_SCORE = 3;
  let direction: "LONG" | "SHORT" | "WAIT";
  let reasons: string[];

  if (forceDirection) {
    // Force direction to match the signal (avoids SL/TP inversion)
    direction = forceDirection;
    reasons   = forceDirection === "LONG" ? longReasons : shortReasons;
    if (reasons.length === 0) reasons = [forceDirection === "LONG" ? "Signal BUY" : "Signal SELL"];
  } else if (longScore >= MIN_SCORE && longScore > shortScore) {
    direction = "LONG";
    reasons   = longReasons;
  } else if (shortScore >= MIN_SCORE && shortScore > longScore) {
    direction = "SHORT";
    reasons   = shortReasons;
  } else {
    direction = "WAIT";
    reasons   = ["Mixed signals — no edge detected"];
  }

  // ── Strategy label ───────────────────────────────────────────
  const hasRSI    = rsiLow || rsiHigh;
  const hasBB     = nearLowerBB || nearUpperBB;

  let strategy: string;
  if (maBull && hasRSI) strategy = "MA Cross + RSI";
  else if (hasBB && hasRSI) strategy = "BB + RSI Reversion";
  else if (!maBull && hasRSI) strategy = "MA Cross + RSI";
  else if (hasBB) strategy = "BB Mean Reversion";
  else if (z < -1.5 || z > 1.5) strategy = "Z-Score Reversion";
  else strategy = "AI Momentum";

  // ── Stop-loss calculation (V3: ATR-based + BB fallback) ──────
  const [minStop, maxStop] = STOP_RANGE[category];
  const atr = calculateATR(prices, Math.min(14, n - 1));
  const atrPct = price > 0 ? (atr.value * 2.0) / price : 0; // 2.0x ATR = room for bounces

  let rawStopPct: number;
  if (atrPct > 0) {
    // V3: Utiliser ATR comme base (reflète la volatilité réelle)
    rawStopPct = atrPct;
  } else if (direction === "LONG") {
    // Fallback BB
    rawStopPct = bbRange > 0 ? (price - bb.lower) / price : (minStop + maxStop) / 2;
  } else if (direction === "SHORT") {
    rawStopPct = bbRange > 0 ? (bb.upper - price) / price : (minStop + maxStop) / 2;
  } else {
    rawStopPct = (minStop + maxStop) / 2;
  }

  const stopPct = Math.min(maxStop, Math.max(minStop, rawStopPct));

  const entry    = price;
  const stopLoss = direction === "SHORT"
    ? entry * (1 + stopPct)
    : entry * (1 - stopPct);

  const risk    = Math.abs(entry - stopLoss);
  const target1 = direction === "SHORT" ? entry - 2 * risk : entry + 2 * risk;
  const target2 = direction === "SHORT" ? entry - 3 * risk : entry + 3 * risk;

  return {
    direction,
    strategy,
    entry,
    stopLoss,
    target1,
    target2,
    trailStop: entry,  // Break Even: move SL here once TP1 is hit
    stopPercent:    ((stopLoss  - entry) / entry) * 100,
    target1Percent: ((target1  - entry) / entry) * 100,
    target2Percent: ((target2  - entry) / entry) * 100,
    confidence: aiScore,
    reasons,
  };
}
