import type { PolymarketEntry } from "@/types/market";

// ─── Asset ↔ Polymarket keyword rules ────────────────────────

interface CorrelationRule {
  assetIds: string[];
  keywords: string[];
}

const CORRELATION_RULES: CorrelationRule[] = [
  // ── Crypto ──────────────────────────────────────────────────
  { assetIds: ["bitcoin"],         keywords: ["bitcoin", "btc", "satoshi"] },
  { assetIds: ["ethereum"],        keywords: ["ethereum", "eth", "ether"] },
  { assetIds: ["solana"],          keywords: ["solana", "sol"] },
  { assetIds: ["ripple"],          keywords: ["ripple", "xrp"] },
  { assetIds: ["dogecoin"],        keywords: ["dogecoin", "doge"] },
  { assetIds: ["cardano"],         keywords: ["cardano", "ada"] },
  { assetIds: ["polkadot"],        keywords: ["polkadot", "dot"] },
  { assetIds: ["avalanche-2"],     keywords: ["avalanche", "avax"] },
  { assetIds: ["chainlink"],       keywords: ["chainlink", "link"] },
  { assetIds: ["polygon"],         keywords: ["polygon", "matic"] },
  { assetIds: ["uniswap"],         keywords: ["uniswap", "uni"] },
  { assetIds: ["litecoin"],        keywords: ["litecoin", "ltc"] },
  { assetIds: ["stellar"],         keywords: ["stellar", "xlm"] },
  { assetIds: ["near"],            keywords: ["near protocol", "near"] },
  { assetIds: ["sui"],             keywords: [" sui "] },

  // Broad crypto (affects all crypto assets)
  {
    assetIds: ["bitcoin", "ethereum", "solana", "ripple", "dogecoin",
               "cardano", "polkadot", "avalanche-2", "chainlink", "polygon",
               "uniswap", "litecoin", "stellar", "near", "sui"],
    keywords: ["crypto", "cryptocurrency", "blockchain", "defi", "nft",
               "sec", "etf", "altcoin", "web3", "digital asset"],
  },

  // ── Forex — geopolitical ────────────────────────────────────
  { assetIds: ["eur-usd", "gbp-usd"],  keywords: ["eu ", "europe", "european", "ecb", "boe", "brexit", "tariff", "nato"] },
  { assetIds: ["usd-jpy"],             keywords: ["japan", "boj", "yen", "japanese"] },
  { assetIds: ["usd-chf"],             keywords: ["switzerland", "swiss", "snb"] },

  // Broad macro → all forex
  {
    assetIds: ["eur-usd", "gbp-usd", "usd-jpy", "usd-chf"],
    keywords: ["dollar", "fed", "federal reserve", "interest rate", "treasury",
               "fomc", "inflation", "recession", "rate hike", "rate cut"],
  },

  // ── Commodities ─────────────────────────────────────────────
  { assetIds: ["xau-usd", "xag-usd"],  keywords: ["gold", "silver", "precious metal", "bullion"] },
  { assetIds: ["wti-oil", "nat-gas"],  keywords: ["oil", "opec", "crude", "energy", "natural gas", "pipeline", "petroleum", "brent"] },

  // Safe haven → gold + chf
  { assetIds: ["xau-usd", "usd-chf"],  keywords: ["recession", "war", "conflict", "sanctions", "safe haven", "geopolit"] },
];

// ─── Correlate markets to assets ─────────────────────────────

export function correlatePolymarket(
  markets: { question: string; volume: number; liquidity: number; bestBid: number; bestAsk: number; direction: "BULL" | "BEAR" | "NEUTRAL" }[]
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

// ─── Compute sentiment score (0–100) ─────────────────────────
// BULL market: high bestBid → bullish (→ high score)
// BEAR market: high bestBid → bearish (→ low score, inverted)
// NEUTRAL: bestBid used as-is

export function computePolymarketSentiment(
  assetId: string,
  polymarket: PolymarketEntry[]
): number {
  const correlated = polymarket.filter((p) => p.correlatedAssets.includes(assetId));
  if (correlated.length === 0) return 50; // neutral when no correlation

  let totalWeight = 0;
  let weightedSum = 0;

  for (const p of correlated) {
    const weight = Math.max(1, Math.log10(p.volume + 1));
    // Probability of YES outcome (0–1 → 0–100)
    const prob = p.bestBid * 100;
    // Directional adjustment: bear market → invert probability
    const score =
      p.direction === "BEAR" ? 100 - prob :
      p.direction === "BULL" ? prob :
      prob; // NEUTRAL: treat as bullish proxy

    weightedSum += score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0
    ? Math.round(Math.min(100, Math.max(0, weightedSum / totalWeight)))
    : 50;
}
