import type { PolymarketEntry } from "@/types/market";

// --- Polymarket <-> Asset keyword correlation ---

interface CorrelationRule {
  assetIds: string[];
  keywords: string[];
}

const CORRELATION_RULES: CorrelationRule[] = [
  // Crypto
  { assetIds: ["bitcoin"], keywords: ["bitcoin", "btc", "crypto"] },
  { assetIds: ["ethereum"], keywords: ["ethereum", "eth"] },
  { assetIds: ["solana"], keywords: ["solana", "sol"] },
  { assetIds: ["ripple"], keywords: ["ripple", "xrp"] },

  // Forex - geopolitical
  { assetIds: ["eur-usd", "gbp-usd"], keywords: ["eu", "european", "europe", "brexit", "ecb", "boe", "tariff"] },
  { assetIds: ["usd-jpy"], keywords: ["japan", "boj", "yen", "japanese"] },
  { assetIds: ["usd-chf"], keywords: ["switzerland", "swiss", "snb"] },

  // Commodities
  { assetIds: ["xau-usd", "xag-usd"], keywords: ["gold", "silver", "precious", "inflation", "fed rate", "bullion"] },
  { assetIds: ["wti-oil", "nat-gas"], keywords: ["oil", "opec", "crude", "energy", "natural gas", "pipeline", "petroleum"] },

  // Broad macro
  { assetIds: ["xau-usd", "usd-chf"], keywords: ["recession", "war", "conflict", "sanctions", "safe haven"] },
  { assetIds: ["eur-usd", "gbp-usd", "usd-jpy", "usd-chf"], keywords: ["dollar", "fed", "interest rate", "treasury", "fomc"] },
];

export function correlatePolymarket(
  markets: { question: string; volume: number; liquidity: number; bestBid: number; bestAsk: number }[]
): PolymarketEntry[] {
  return markets.map((m) => {
    const q = m.question.toLowerCase();
    const matched = new Set<string>();

    for (const rule of CORRELATION_RULES) {
      for (const kw of rule.keywords) {
        if (q.includes(kw)) {
          for (const id of rule.assetIds) matched.add(id);
          break;
        }
      }
    }

    return { ...m, correlatedAssets: [...matched] };
  });
}

export function computePolymarketSentiment(
  assetId: string,
  polymarket: PolymarketEntry[]
): number {
  const correlated = polymarket.filter((p) => p.correlatedAssets.includes(assetId));
  if (correlated.length === 0) return 50; // neutral when no correlation

  // Weighted average of bestBid (higher bid = more bullish sentiment)
  let totalWeight = 0;
  let weightedSum = 0;

  for (const p of correlated) {
    const weight = Math.max(1, Math.log10(p.volume + 1));
    weightedSum += p.bestBid * 100 * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? Math.round(Math.min(100, Math.max(0, weightedSum / totalWeight)))
    : 50;
}
