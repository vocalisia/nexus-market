import type { Indicators } from "@/types/market";

// ─── Helpers ─────────────────────────────────────────────────

function sma(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] ?? 0;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function emaArray(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Legacy exports (used by tradePlan.ts) ──────────────────

export const lastSMA = sma;

export function lastEMA(prices: number[], period: number): number {
  const arr = emaArray(prices, period);
  return arr[arr.length - 1] ?? (prices[prices.length - 1] ?? 0);
}

export function bollingerBands(prices: number[], period = 20, mult = 2.0) {
  const bb = calculateBollinger(prices, period, mult);
  return { upper: bb.upper, middle: bb.middle, lower: bb.lower };
}

export function zScore(prices: number[], period = 20): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (prices[prices.length - 1] - mean) / std;
}

// ─── RSI (Wilder's smoothed, 14) ────────────────────────────

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;

  let rsi = 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return r2(rsi);
}

// ─── MACD (12, 26, 9) ───────────────────────────────────────

export function calculateMACD(prices: number[]): Indicators["macd"] {
  if (prices.length < 26) return { value: 0, signal: 0, histogram: 0, cross: "NONE" };

  const ema12 = emaArray(prices, 12);
  const ema26 = emaArray(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaArray(macdLine.slice(-30), 9);

  const value = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = value - signal;

  let cross: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (macdLine.length >= 3 && signalLine.length >= 3) {
    const prevHist = macdLine[macdLine.length - 3] - signalLine[signalLine.length - 3];
    if (prevHist < 0 && histogram > 0) cross = "BULLISH";
    if (prevHist > 0 && histogram < 0) cross = "BEARISH";
  }

  return { value: r2(value), signal: r2(signal), histogram: r2(histogram), cross };
}

// ─── Bollinger Bands (20, 2) ────────────────────────────────

export function calculateBollinger(prices: number[], period = 20, mult = 2): Indicators["bollinger"] {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, position: "INSIDE" };

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, p) => s + (p - middle) ** 2, 0) / period);

  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const current = prices[prices.length - 1];

  const position = current > upper ? "ABOVE" : current < lower ? "BELOW" : "INSIDE";
  return { upper: r2(upper), middle: r2(middle), lower: r2(lower), position };
}

// ─── SMA Cross (50 / 200) ───────────────────────────────────

export function calculateSMACross(prices: number[]): Indicators["smaCross"] {
  const sma50 = sma(prices, Math.min(50, prices.length));
  const sma200 = sma(prices, Math.min(200, prices.length));

  let signal: "GOLDEN" | "DEATH" | "NONE" = "NONE";
  if (prices.length >= 50) {
    const prev50 = sma(prices.slice(0, -1), Math.min(50, prices.length - 1));
    const prev200 = sma(prices.slice(0, -1), Math.min(200, prices.length - 1));
    if (prev50 < prev200 && sma50 >= sma200) signal = "GOLDEN";
    if (prev50 > prev200 && sma50 <= sma200) signal = "DEATH";
  }
  return { sma50: r2(sma50), sma200: r2(sma200), signal };
}

// ─── Volume Profile (price volatility proxy) ────────────────

export function calculateVolumeProfile(sparkline: number[]): Indicators["volumeProfile"] {
  if (sparkline.length < 24) return { current: 0, average: 0, ratio: 1, spike: false };

  const changes = sparkline.slice(1).map((p, i) => Math.abs(p - sparkline[i]));
  const recent = changes.slice(-6);
  const current = recent.reduce((a, b) => a + b, 0) / recent.length;
  const average = changes.reduce((a, b) => a + b, 0) / changes.length;
  const ratio = average > 0 ? current / average : 1;

  return { current: r2(current), average: r2(average), ratio: r2(ratio), spike: ratio > 1.5 };
}

// ─── ATR (Average True Range, 14) ───────────────────────────

export function calculateATR(prices: number[], period = 14): Indicators["atr"] {
  if (prices.length < period + 1) return { value: 0, percent: 0 };

  const trs: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    trs.push(Math.max(prices[i], prices[i - 1]) - Math.min(prices[i], prices[i - 1]));
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  const current = prices[prices.length - 1];
  return { value: r2(atr), percent: r2(current > 0 ? (atr / current) * 100 : 0) };
}

// ─── Compute All ────────────────────────────────────────────

export function computeAllIndicators(sparkline: number[]): Indicators {
  return {
    rsi: calculateRSI(sparkline),
    macd: calculateMACD(sparkline),
    bollinger: calculateBollinger(sparkline),
    smaCross: calculateSMACross(sparkline),
    volumeProfile: calculateVolumeProfile(sparkline),
    atr: calculateATR(sparkline),
  };
}

// ─── Per-indicator Score (0-100) + Human Label ──────────────

export interface IndicatorResult {
  score: number;
  label: string;
  signal: string;
  bullish: boolean;
}

export function scoreIndicators(ind: Indicators): Record<string, IndicatorResult> {
  const { rsi, macd, bollinger, smaCross, volumeProfile, atr } = ind;

  return {
    rsi: {
      score: rsi < 30 ? 80 : rsi < 40 ? 65 : rsi > 70 ? 20 : rsi > 60 ? 35 : 50,
      label: "RSI (14)",
      signal: rsi < 30 ? "Oversold" : rsi > 70 ? "Overbought" : rsi < 40 ? "Near oversold" : rsi > 60 ? "Near overbought" : "Neutral",
      bullish: rsi < 45,
    },
    macd: {
      score: macd.cross === "BULLISH" ? 85 : macd.cross === "BEARISH" ? 15 : macd.histogram > 0 ? 62 : 38,
      label: "MACD",
      signal: macd.cross === "BULLISH" ? "Bullish cross" : macd.cross === "BEARISH" ? "Bearish cross" : macd.histogram > 0 ? "Above signal" : "Below signal",
      bullish: macd.histogram > 0,
    },
    bollinger: {
      score: bollinger.position === "BELOW" ? 78 : bollinger.position === "ABOVE" ? 22 : 50,
      label: "Bollinger",
      signal: bollinger.position === "BELOW" ? "Below band (oversold)" : bollinger.position === "ABOVE" ? "Above band (overbought)" : "Inside bands",
      bullish: bollinger.position === "BELOW",
    },
    smaCross: {
      score: smaCross.signal === "GOLDEN" ? 90 : smaCross.signal === "DEATH" ? 10 : smaCross.sma50 > smaCross.sma200 ? 60 : 40,
      label: "SMA 50/200",
      signal: smaCross.signal === "GOLDEN" ? "Golden Cross" : smaCross.signal === "DEATH" ? "Death Cross" : smaCross.sma50 > smaCross.sma200 ? "Bullish trend" : "Bearish trend",
      bullish: smaCross.sma50 > smaCross.sma200,
    },
    volumeProfile: {
      score: volumeProfile.spike ? 70 : 50,
      label: "Volume",
      signal: volumeProfile.spike ? `Spike ${volumeProfile.ratio}x` : "Normal",
      bullish: volumeProfile.spike,
    },
    atr: {
      score: atr.percent > 5 ? 40 : atr.percent > 3 ? 45 : 55,
      label: "ATR",
      signal: atr.percent > 5 ? `High vol ${atr.percent}%` : atr.percent > 3 ? `Mid vol ${atr.percent}%` : `Low vol ${atr.percent}%`,
      bullish: atr.percent < 3,
    },
  };
}

// ─── Combined Score (only active indicators count) ──────────

export function computeCombinedScore(
  ind: Indicators,
  activeKeys: string[],
  change24h: number,
  sentiment = 50
): { score: number; direction: "UP" | "DOWN" | "NEUTRAL"; convergence: number } {
  const scores = scoreIndicators(ind);

  if (activeKeys.length === 0) {
    const basic = Math.round(ind.rsi * 0.4 + Math.min(100, Math.max(0, (change24h + 10) * 5)) * 0.35 + sentiment * 0.25);
    const s = Math.min(100, Math.max(0, basic));
    return { score: s, direction: s > 55 ? "UP" : s < 45 ? "DOWN" : "NEUTRAL", convergence: 0 };
  }

  let total = 0;
  let bullCount = 0;
  for (const key of activeKeys) {
    const s = scores[key];
    if (s) {
      total += s.score;
      if (s.bullish) bullCount++;
    }
  }

  const momentum = Math.min(100, Math.max(0, (change24h + 10) * 5));
  total += momentum * 0.3 + sentiment * 0.2;

  const avg = total / (activeKeys.length + 0.5);
  const score = Math.round(Math.min(100, Math.max(0, avg)));
  const convergence = Math.round((bullCount / activeKeys.length) * 100);

  return { score, direction: score > 55 ? "UP" : score < 45 ? "DOWN" : "NEUTRAL", convergence };
}
