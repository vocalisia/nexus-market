import { IndicatorsSync } from "@ixjb94/indicators";
import type { Indicators } from "@/types/market";

// Shared library instance (synchronous, no async needed)
const lib = new IndicatorsSync();

// ─── Helpers ─────────────────────────────────────────────────

function lastOf(arr: number[]): number {
  return arr.length > 0 ? (arr[arr.length - 1] ?? 0) : 0;
}

/** Manual SMA for variable-window calculations (legacy support) */
function smaManual(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data[data.length - 1] ?? 0;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Legacy exports (used by tradePlan.ts) ──────────────────

export const lastSMA = smaManual;

export function lastEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const arr = lib.ema(prices, period);
  return lastOf(arr);
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
  const result = lib.rsi(prices, period);
  if (result.length === 0) return 50;
  return r2(lastOf(result));
}

// ─── MACD (12, 26, 9) ───────────────────────────────────────

export function calculateMACD(prices: number[]): Indicators["macd"] {
  if (prices.length < 26) return { value: 0, signal: 0, histogram: 0, cross: "NONE" };

  const [macdArr, signalArr, histArr] = lib.macd(prices, 12, 26, 9);

  if (macdArr.length === 0) return { value: 0, signal: 0, histogram: 0, cross: "NONE" };

  const value = lastOf(macdArr);
  const signal = lastOf(signalArr);
  const histogram = lastOf(histArr);

  let cross: "BULLISH" | "BEARISH" | "NONE" = "NONE";
  if (histArr.length >= 2) {
    const prevHist = histArr[histArr.length - 2] ?? 0;
    if (prevHist < 0 && histogram > 0) cross = "BULLISH";
    if (prevHist > 0 && histogram < 0) cross = "BEARISH";
  }

  return { value: r2(value), signal: r2(signal), histogram: r2(histogram), cross };
}

// ─── Bollinger Bands (20, 2) ────────────────────────────────

export function calculateBollinger(
  prices: number[],
  period = 20,
  mult = 2
): Indicators["bollinger"] {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, position: "INSIDE" };

  const [lowerArr, middleArr, upperArr] = lib.bbands(prices, period, mult);

  if (upperArr.length === 0) return { upper: 0, middle: 0, lower: 0, position: "INSIDE" };

  const upper = lastOf(upperArr);
  const middle = lastOf(middleArr);
  const lower = lastOf(lowerArr);
  const current = prices[prices.length - 1];

  const position = current > upper ? "ABOVE" : current < lower ? "BELOW" : "INSIDE";
  return { upper: r2(upper), middle: r2(middle), lower: r2(lower), position };
}

// ─── SMA Cross (50 / 200) ───────────────────────────────────

export function calculateSMACross(prices: number[]): Indicators["smaCross"] {
  const sma50 = smaManual(prices, Math.min(50, prices.length));
  const sma200 = smaManual(prices, Math.min(200, prices.length));

  let signal: "GOLDEN" | "DEATH" | "NONE" = "NONE";
  if (prices.length >= 50) {
    const prev = prices.slice(0, -1);
    const prev50 = smaManual(prev, Math.min(50, prev.length));
    const prev200 = smaManual(prev, Math.min(200, prev.length));
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

  // lib.atr(high, low, close, period) — use prices as proxy for all three
  const result = lib.atr(prices, prices, prices, period);
  if (result.length === 0) return { value: 0, percent: 0 };

  const atr = lastOf(result);
  const current = prices[prices.length - 1];
  return { value: r2(atr), percent: r2(current > 0 ? (atr / current) * 100 : 0) };
}

// ─── ADX (Average Directional Index) ────────────────────────

/**
 * @param highs  - array of high prices
 * @param lows   - array of low prices
 * @param closes - array of close prices (unused by lib but kept for API symmetry)
 * @param period - default 14
 * @returns ADX value 0-100
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  const minLen = Math.min(highs.length, lows.length, closes.length);
  if (minLen < period * 2) return 0;

  const h = highs.slice(0, minLen);
  const l = lows.slice(0, minLen);

  const result = lib.adx(h, l, period);
  if (result.length === 0) return 0;

  return r2(Math.min(100, Math.max(0, lastOf(result))));
}

// ─── StochRSI ───────────────────────────────────────────────

/**
 * @param prices - close prices
 * @param period - default 14
 * @returns { k, d } in 0-100 range
 */
export function calculateStochRSI(
  prices: number[],
  period = 14
): { k: number; d: number } {
  // Library requires at least period * 2 data points
  if (prices.length < period * 2) return { k: 50, d: 50 };

  // stochrsi returns values in 0-1 range
  const result = lib.stochrsi(prices, period);
  if (result.length === 0) return { k: 50, d: 50 };

  const rawK = lastOf(result) * 100;
  const k = r2(Math.min(100, Math.max(0, rawK)));

  // D = SMA-3 of K (use last 3 stochrsi values)
  const tail = result.slice(-3).map((v) => Math.min(100, Math.max(0, v * 100)));
  const d = r2(tail.reduce((a, b) => a + b, 0) / tail.length);

  return { k, d };
}

// ─── OBV (On Balance Volume) ────────────────────────────────

/**
 * @param closes  - close price array
 * @param volumes - volume array aligned with closes
 * @returns { value, rising }
 */
export function calculateOBV(
  closes: number[],
  volumes: number[]
): { value: number; rising: boolean } {
  const size = Math.min(closes.length, volumes.length);
  if (size < 2) return { value: 0, rising: false };

  const result = lib.obv(closes.slice(0, size), volumes.slice(0, size));
  if (result.length < 2) return { value: 0, rising: false };

  const value = lastOf(result);
  const prev = result[result.length - 2] ?? 0;
  return { value: r2(value), rising: value > prev };
}

// ─── SAR (Parabolic Stop And Reverse) ───────────────────────

/**
 * @param highs - array of high prices
 * @param lows  - array of low prices
 * @returns current SAR value
 */
export function calculateSAR(highs: number[], lows: number[]): number {
  const size = Math.min(highs.length, lows.length);
  if (size < 2) return 0;

  const result = lib.psar(highs.slice(0, size), lows.slice(0, size), 0.02, 0.2);
  if (result.length === 0) return 0;

  return r2(lastOf(result));
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
    // New indicators — sparkline used as proxy for high/low/close/volume
    adx: calculateADX(sparkline, sparkline, sparkline),
    stochRsi: calculateStochRSI(sparkline),
    obv: calculateOBV(sparkline, sparkline.map(() => 1)), // uniform weight (no real volume)
    sar: calculateSAR(sparkline, sparkline),
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
  const { rsi, macd, bollinger, smaCross, volumeProfile, atr, adx, stochRsi, obv } = ind;

  return {
    rsi: {
      score: rsi < 30 ? 80 : rsi < 40 ? 65 : rsi > 70 ? 20 : rsi > 60 ? 35 : 50,
      label: "RSI (14)",
      signal:
        rsi < 30
          ? "Oversold"
          : rsi > 70
            ? "Overbought"
            : rsi < 40
              ? "Near oversold"
              : rsi > 60
                ? "Near overbought"
                : "Neutral",
      bullish: rsi < 45,
    },
    macd: {
      score:
        macd.cross === "BULLISH" ? 85 : macd.cross === "BEARISH" ? 15 : macd.histogram > 0 ? 62 : 38,
      label: "MACD",
      signal:
        macd.cross === "BULLISH"
          ? "Bullish cross"
          : macd.cross === "BEARISH"
            ? "Bearish cross"
            : macd.histogram > 0
              ? "Above signal"
              : "Below signal",
      bullish: macd.histogram > 0,
    },
    bollinger: {
      score: bollinger.position === "BELOW" ? 78 : bollinger.position === "ABOVE" ? 22 : 50,
      label: "Bollinger",
      signal:
        bollinger.position === "BELOW"
          ? "Below band (oversold)"
          : bollinger.position === "ABOVE"
            ? "Above band (overbought)"
            : "Inside bands",
      bullish: bollinger.position === "BELOW",
    },
    smaCross: {
      score:
        smaCross.signal === "GOLDEN"
          ? 90
          : smaCross.signal === "DEATH"
            ? 10
            : smaCross.sma50 > smaCross.sma200
              ? 60
              : 40,
      label: "SMA 50/200",
      signal:
        smaCross.signal === "GOLDEN"
          ? "Golden Cross"
          : smaCross.signal === "DEATH"
            ? "Death Cross"
            : smaCross.sma50 > smaCross.sma200
              ? "Bullish trend"
              : "Bearish trend",
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
      signal:
        atr.percent > 5
          ? `High vol ${atr.percent}%`
          : atr.percent > 3
            ? `Mid vol ${atr.percent}%`
            : `Low vol ${atr.percent}%`,
      bullish: atr.percent < 3,
    },
    adx: {
      score: adx > 50 ? 75 : adx > 25 ? 60 : 40,
      label: "ADX",
      signal:
        adx > 50
          ? `Strong trend (${adx})`
          : adx > 25
            ? `Trending (${adx})`
            : `Weak/ranging (${adx})`,
      bullish: adx > 25,
    },
    stochRsi: {
      score:
        stochRsi.k < 20 ? 80 : stochRsi.k < 40 ? 65 : stochRsi.k > 80 ? 20 : stochRsi.k > 60 ? 35 : 50,
      label: "Stoch RSI",
      signal:
        stochRsi.k < 20
          ? "Oversold"
          : stochRsi.k > 80
            ? "Overbought"
            : stochRsi.k < 40
              ? "Near oversold"
              : stochRsi.k > 60
                ? "Near overbought"
                : "Neutral",
      bullish: stochRsi.k < 40,
    },
    obv: {
      score: obv.rising ? 65 : 35,
      label: "OBV",
      signal: obv.rising ? "Rising (bullish pressure)" : "Falling (bearish pressure)",
      bullish: obv.rising,
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
    const basic = Math.round(
      ind.rsi * 0.4 +
        Math.min(100, Math.max(0, (change24h + 10) * 5)) * 0.35 +
        sentiment * 0.25
    );
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

// ─── Candlestick Pattern Detection (from stockbot) ──────────
// Bullish engulfing: previous candle red, current candle green + bigger body
// Bearish engulfing: previous candle green, current candle red + bigger body

export interface CandlestickResult {
  bullishEngulfing: boolean;
  bearishEngulfing: boolean;
  pattern: string;
}

export function detectCandlestickPatterns(prices: number[]): CandlestickResult {
  if (prices.length < 3) return { bullishEngulfing: false, bearishEngulfing: false, pattern: "NONE" };

  const n = prices.length;
  const c0 = prices[n - 3] ?? 0; // open of prev candle (approx)
  const c1 = prices[n - 2] ?? 0; // close of prev candle = open of current
  const c2 = prices[n - 1] ?? 0; // close of current candle

  const prevBody = c1 - c0;
  const currBody = c2 - c1;

  // Bullish engulfing: prev was red (down), current is green (up) and bigger
  const bullishEngulfing = prevBody < 0 && currBody > 0 && Math.abs(currBody) > Math.abs(prevBody) * 1.2;
  // Bearish engulfing: prev was green (up), current is red (down) and bigger
  const bearishEngulfing = prevBody > 0 && currBody < 0 && Math.abs(currBody) > Math.abs(prevBody) * 1.2;

  const pattern = bullishEngulfing ? "BULLISH_ENGULFING"
    : bearishEngulfing ? "BEARISH_ENGULFING"
    : "NONE";

  return { bullishEngulfing, bearishEngulfing, pattern };
}

// ─── Support / Resistance Detection (from stockbot) ─────────
// Finds local extremes in the price series as S/R zones
// Signal is stronger when price is near a key level

export interface SupportResistance {
  nearSupport: boolean;
  nearResistance: boolean;
  supportLevel: number;
  resistanceLevel: number;
  distanceToSupport: number;   // % distance
  distanceToResistance: number; // % distance
}

export function detectSupportResistance(prices: number[], lookback = 30): SupportResistance {
  const empty: SupportResistance = {
    nearSupport: false, nearResistance: false,
    supportLevel: 0, resistanceLevel: 0,
    distanceToSupport: 100, distanceToResistance: 100,
  };
  if (prices.length < lookback) return empty;

  const window = prices.slice(-lookback);
  const current = prices[prices.length - 1] ?? 0;
  if (current === 0) return empty;

  // Find local lows (supports) and highs (resistances) with 3-bar pivot
  const lows: number[] = [];
  const highs: number[] = [];
  for (let i = 2; i < window.length - 2; i++) {
    const p = window[i] ?? 0;
    const prev1 = window[i - 1] ?? 0;
    const prev2 = window[i - 2] ?? 0;
    const next1 = window[i + 1] ?? 0;
    const next2 = window[i + 2] ?? 0;
    if (p <= prev1 && p <= prev2 && p <= next1 && p <= next2) lows.push(p);
    if (p >= prev1 && p >= prev2 && p >= next1 && p >= next2) highs.push(p);
  }

  if (lows.length === 0 && highs.length === 0) return empty;

  // Closest support below current price
  const supports = lows.filter((l) => l < current).sort((a, b) => b - a);
  const resistances = highs.filter((h) => h > current).sort((a, b) => a - b);

  const supportLevel = supports[0] ?? 0;
  const resistanceLevel = resistances[0] ?? Infinity;

  const distS = supportLevel > 0 ? ((current - supportLevel) / current) * 100 : 100;
  const distR = resistanceLevel < Infinity ? ((resistanceLevel - current) / current) * 100 : 100;

  // "Near" = within 1.5% of level
  return {
    nearSupport: distS < 1.5,
    nearResistance: distR < 1.5,
    supportLevel,
    resistanceLevel: resistanceLevel === Infinity ? 0 : resistanceLevel,
    distanceToSupport: parseFloat(distS.toFixed(2)),
    distanceToResistance: parseFloat(distR.toFixed(2)),
  };
}

// ─── RSI Divergence Detection ────────────────────────────────
// Bullish: price lower low + RSI higher low  → reversal UP signal
// Bearish: price higher high + RSI lower high → reversal DOWN signal
// Splits last 30 candles into two halves and compares extremes

export interface DivergenceResult {
  bullish: boolean;
  bearish: boolean;
  strength: "strong" | "weak" | "none";
}

export function detectRSIDivergence(prices: number[]): DivergenceResult {
  if (prices.length < 30) return { bullish: false, bearish: false, strength: "none" };

  const window = 30;
  const recent = prices.slice(-window);
  const half = Math.floor(window / 2);

  // Compute RSI series over the full price history
  const rsiArr = lib.rsi(prices, 14).filter((v) => !isNaN(v) && v > 0);
  if (rsiArr.length < window) return { bullish: false, bearish: false, strength: "none" };
  const recentRSI = rsiArr.slice(-window);

  const p1 = recent.slice(0, half);
  const p2 = recent.slice(half);
  const r1 = recentRSI.slice(0, half);
  const r2 = recentRSI.slice(half);

  const minP1 = Math.min(...p1);
  const minP2 = Math.min(...p2);
  const minR1 = Math.min(...r1);
  const minR2 = Math.min(...r2);

  const maxP1 = Math.max(...p1);
  const maxP2 = Math.max(...p2);
  const maxR1 = Math.max(...r1);
  const maxR2 = Math.max(...r2);

  // Bullish divergence: price lower low but RSI higher low (>3pt gap = real signal)
  const bullish = minP2 < minP1 * 0.998 && minR2 > minR1 + 3;
  // Bearish divergence: price higher high but RSI lower high (>3pt gap)
  const bearish = maxP2 > maxP1 * 1.002 && maxR2 < maxR1 - 3;

  const strength = bullish || bearish ? "strong" : "none";
  return { bullish, bearish, strength };
}

// ─── Multi-Timeframe RSI Alignment ──────────────────────────
// Downsamples hourly sparkline to simulate 4H bars (group by 4)
// Returns: 1H RSI + 4H RSI — signal is stronger when both agree

export interface MultiTFResult {
  rsi1h: number;
  rsi4h: number;
  aligned: boolean;      // both timeframes agree on direction
  direction: "UP" | "DOWN" | "NEUTRAL";
  alignmentStrength: number; // 0-100 — distance both RSIs are from 50
}

export function computeMultiTF(prices: number[]): MultiTFResult {
  if (prices.length < 16) {
    return { rsi1h: 50, rsi4h: 50, aligned: false, direction: "NEUTRAL", alignmentStrength: 0 };
  }

  // 1H RSI — direct
  const rsi1h = calculateRSI(prices, 14);

  // 4H bars — take every 4th close from hourly prices
  const bars4h: number[] = [];
  for (let i = 3; i < prices.length; i += 4) {
    bars4h.push(prices[i] ?? 0);
  }
  const rsi4h = bars4h.length >= 14 ? calculateRSI(bars4h, 14) : 50;

  // Alignment: both timeframes must agree on direction
  const up1h   = rsi1h < 45;   // 1H oversold → bullish
  const up4h   = rsi4h < 45;   // 4H oversold → bullish
  const down1h = rsi1h > 55;
  const down4h = rsi4h > 55;

  const alignedUp   = up1h   && up4h;
  const alignedDown = down1h && down4h;
  const aligned = alignedUp || alignedDown;

  const direction = alignedUp ? "UP" : alignedDown ? "DOWN" : "NEUTRAL";

  // Strength: how far both RSIs are from neutral (50) in the same direction
  const dist1h = Math.abs(rsi1h - 50);
  const dist4h = Math.abs(rsi4h - 50);
  const alignmentStrength = aligned ? Math.round((dist1h + dist4h) / 2) : 0;

  return { rsi1h, rsi4h, aligned, direction, alignmentStrength };
}

// ─── Volume Anomaly Detection ────────────────────────────────
// Detects abnormal volume spikes vs rolling average
// Uses price velocity as a volume proxy when real volume unavailable

export interface VolumeAnomalyResult {
  isSpike: boolean;
  ratio: number;       // current / average (e.g. 2.3 = 130% above average)
  direction: "UP" | "DOWN" | "NEUTRAL"; // which direction the spike favors
}

export function detectVolumeAnomaly(prices: number[], lookback = 20): VolumeAnomalyResult {
  if (prices.length < lookback + 2) {
    return { isSpike: false, ratio: 1, direction: "NEUTRAL" };
  }

  // Use absolute candle range (price move per bar) as volume proxy
  const ranges: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    ranges.push(Math.abs((prices[i] ?? 0) - (prices[i - 1] ?? 0)));
  }

  const recent = ranges.slice(-lookback);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length || 1;
  const last = recent[recent.length - 1] ?? 0;
  const ratio = parseFloat((last / avg).toFixed(2));

  const isSpike = ratio >= 2.0; // 2× average = significant spike

  // Direction: check if last price move is up or down
  const lastPrice = prices[prices.length - 1] ?? 0;
  const prevPrice = prices[prices.length - 2] ?? lastPrice;
  const direction = lastPrice > prevPrice ? "UP" : lastPrice < prevPrice ? "DOWN" : "NEUTRAL";

  return { isSpike, ratio, direction };
}
