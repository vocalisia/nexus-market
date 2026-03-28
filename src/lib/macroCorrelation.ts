import type { Asset } from "@/types/market";

// ─── Macro Correlation Adjustments ──────────────────────────
// Adjusts AI scores based on known cross-asset correlations

interface MacroContext {
  usdStrength: number;   // positive = USD strong, negative = USD weak
  btcVolatility: number; // 7d volatility as %
  riskAppetite: number;  // positive = risk-on, negative = risk-off
}

// Compute macro context from all assets
export function computeMacroContext(assets: Asset[]): MacroContext {
  // USD strength from EUR/USD (inverse relationship)
  const eurUsd = assets.find((a) => a.id === "eur-usd");
  const usdStrength = eurUsd ? -eurUsd.change24h : 0; // EUR down = USD strong

  // BTC volatility as risk proxy
  const btc = assets.find((a) => a.id === "bitcoin");
  const btcVolatility = btc?.sparkline?.length
    ? computeVolatility(btc.sparkline)
    : 0;

  // Risk appetite: BTC + stocks up = risk-on, down = risk-off
  const riskAssets = assets.filter(
    (a) => a.id === "bitcoin" || a.id === "ethereum" || a.category === "STOCKS"
  );
  const avgChange = riskAssets.length > 0
    ? riskAssets.reduce((sum, a) => sum + a.change24h, 0) / riskAssets.length
    : 0;

  return { usdStrength, btcVolatility, riskAppetite: avgChange };
}

function computeVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => Math.abs((p - prices[i]) / prices[i]) * 100);
  return returns.reduce((a, b) => a + b, 0) / returns.length;
}

// ─── Correlation Rules ──────────────────────────────────────

interface CorrelationRule {
  assetIds: string[];
  condition: (ctx: MacroContext) => boolean;
  adjustment: number; // points to add/subtract from AI score
  reason: string;
}

const RULES: CorrelationRule[] = [
  // USD strong → Gold bearish
  {
    assetIds: ["xau-usd", "xag-usd"],
    condition: (ctx) => ctx.usdStrength > 0.5,
    adjustment: -8,
    reason: "USD fort = pression baissière métaux",
  },
  // USD strong → BTC bearish
  {
    assetIds: ["bitcoin", "ethereum"],
    condition: (ctx) => ctx.usdStrength > 0.5,
    adjustment: -5,
    reason: "USD fort = pression baissière crypto",
  },
  // USD weak → Gold bullish
  {
    assetIds: ["xau-usd", "xag-usd"],
    condition: (ctx) => ctx.usdStrength < -0.5,
    adjustment: +8,
    reason: "USD faible = soutien métaux précieux",
  },
  // High volatility (VIX proxy) → Gold safe haven
  {
    assetIds: ["xau-usd"],
    condition: (ctx) => ctx.btcVolatility > 3,
    adjustment: +10,
    reason: "Volatilité élevée = refuge or",
  },
  // High volatility → BTC risk-off
  {
    assetIds: ["bitcoin", "ethereum"],
    condition: (ctx) => ctx.btcVolatility > 5,
    adjustment: -10,
    reason: "Volatilité extrême = risk-off crypto",
  },
  // Risk-on → crypto bullish
  {
    assetIds: ["bitcoin", "ethereum", "solana", "ripple"],
    condition: (ctx) => ctx.riskAppetite > 2,
    adjustment: +5,
    reason: "Risk-on = soutien crypto",
  },
  // Risk-off → crypto bearish
  {
    assetIds: ["bitcoin", "ethereum", "solana", "ripple"],
    condition: (ctx) => ctx.riskAppetite < -2,
    adjustment: -5,
    reason: "Risk-off = pression crypto",
  },
  // Oil up → commodities bullish
  {
    assetIds: ["xau-usd", "xag-usd", "nat-gas"],
    condition: (ctx) => ctx.riskAppetite > 1,
    adjustment: +3,
    reason: "Momentum commodités positif",
  },
];

// Get macro adjustment for a specific asset
export function getMacroAdjustment(
  assetId: string,
  ctx: MacroContext
): { adjustment: number; reasons: string[] } {
  let totalAdjust = 0;
  const reasons: string[] = [];

  for (const rule of RULES) {
    if (rule.assetIds.includes(assetId) && rule.condition(ctx)) {
      totalAdjust += rule.adjustment;
      reasons.push(`${rule.adjustment > 0 ? "+" : ""}${rule.adjustment} ${rule.reason}`);
    }
  }

  // Clamp to ±15
  totalAdjust = Math.max(-15, Math.min(15, totalAdjust));

  return { adjustment: totalAdjust, reasons };
}
