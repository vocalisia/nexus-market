import { calculateATR, calculateADX } from "./indicators";

// ─── Market Regime Detection ────────────────────────────────
// HMM-lite approximation using ATR + ADX + trend slope

export type Regime = "BULL" | "BEAR" | "RANGING" | "TRANSITION";

export interface RegimeData {
  regime: Regime;
  confidence: number;  // 0-100
  label: string;       // French label for UI
  scoreModifier: number; // adjustment to AI score
}

export function detectRegime(closes: number[], period = 20): RegimeData {
  if (closes.length < period + 5) {
    return { regime: "TRANSITION", confidence: 0, label: "Données insuffisantes", scoreModifier: 0 };
  }

  // 1. Volatility via ATR
  const atrResult = calculateATR(closes, 14);
  const volatility = atrResult.percent; // ATR as % of price

  // 2. Trend direction: slope of last `period` closes
  const recentClose = closes[closes.length - 1];
  const pastClose = closes[closes.length - period] ?? closes[0];
  const trendPct = ((recentClose - pastClose) / pastClose) * 100;

  // 3. ADX for trend strength
  const adx = calculateADX(closes, closes, closes, 14);

  // Decision tree
  if (adx < 20 && volatility < 2) {
    return {
      regime: "RANGING",
      confidence: Math.min(90, 50 + (20 - adx) * 2),
      label: "March\u00e9 plat (ranging)",
      scoreModifier: -10, // penalize signals in ranging
    };
  }

  if (trendPct > 0 && adx > 25) {
    const conf = Math.min(95, 50 + adx + Math.abs(trendPct));
    return {
      regime: "BULL",
      confidence: Math.round(conf),
      label: "Tendance haussi\u00e8re",
      scoreModifier: 8, // boost buy signals
    };
  }

  if (trendPct < 0 && adx > 25) {
    const conf = Math.min(95, 50 + adx + Math.abs(trendPct));
    return {
      regime: "BEAR",
      confidence: Math.round(conf),
      label: "Tendance baissi\u00e8re",
      scoreModifier: -8, // boost sell signals (lower score)
    };
  }

  return {
    regime: "TRANSITION",
    confidence: 30,
    label: "Transition (attendre)",
    scoreModifier: -5,
  };
}

// Color for regime display
export function regimeColor(regime: Regime): string {
  switch (regime) {
    case "BULL": return "#34D399";
    case "BEAR": return "#FB7185";
    case "RANGING": return "#F59E0B";
    case "TRANSITION": return "#64748B";
  }
}
