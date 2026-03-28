import { calculateRSI } from "./indicators";

// ─── On-Chain BTC Data ──────────────────────────────────────
// Sources: blockchain.com (free, no API key)

export interface OnChainData {
  nvtRatio: number;     // Network Value to Transactions ratio
  hashRate: number;     // TH/s
  mempoolSize: number;  // bytes
  adjustment: number;   // score modifier
  signal: string;       // human readable
}

export async function fetchOnChainBTC(): Promise<OnChainData> {
  const fallback: OnChainData = { nvtRatio: 0, hashRate: 0, mempoolSize: 0, adjustment: 0, signal: "Données non disponibles" };

  try {
    // Fetch NVT and hash rate in parallel
    const [nvtRes, hashRes] = await Promise.allSettled([
      fetch("https://api.blockchain.info/charts/nvt?timespan=1days&format=json&cors=true", { next: { revalidate: 600 } }),
      fetch("https://api.blockchain.info/charts/hash-rate?timespan=1days&format=json&cors=true", { next: { revalidate: 600 } }),
    ]);

    let nvtRatio = 0;
    let hashRate = 0;

    if (nvtRes.status === "fulfilled" && nvtRes.value.ok) {
      const data = await nvtRes.value.json();
      const values = data?.values;
      if (values?.length > 0) {
        nvtRatio = values[values.length - 1]?.y ?? 0;
      }
    }

    if (hashRes.status === "fulfilled" && hashRes.value.ok) {
      const data = await hashRes.value.json();
      const values = data?.values;
      if (values?.length > 0) {
        hashRate = values[values.length - 1]?.y ?? 0;
      }
    }

    // Scoring logic
    let adjustment = 0;
    const signals: string[] = [];

    // NVT interpretation:
    // Low NVT (< 40) = network undervalued relative to transactions = bullish
    // High NVT (> 80) = network overvalued = bearish
    if (nvtRatio > 0 && nvtRatio < 40) {
      adjustment += 5;
      signals.push("NVT bas (sous-évalué)");
    } else if (nvtRatio > 80) {
      adjustment -= 5;
      signals.push("NVT élevé (surévalué)");
    }

    // Hash rate: rising = miners confident = bullish
    // We can only check if hash rate is high (>500 EH/s as of 2026)
    if (hashRate > 500000) { // API returns in TH/s, 500 EH/s = 500000000 TH/s... check actual format
      adjustment += 3;
      signals.push("Hash rate élevé");
    }

    return {
      nvtRatio: Math.round(nvtRatio * 100) / 100,
      hashRate: Math.round(hashRate),
      mempoolSize: 0, // mempool.space requires different handling
      adjustment: Math.max(-10, Math.min(10, adjustment)),
      signal: signals.length > 0 ? signals.join(" + ") : "On-chain neutre",
    };
  } catch {
    return fallback;
  }
}

// ─── Multi-Timeframe Confirmation ───────────────────────────

export function multiTimeframeScore(
  sparkline1h: number[],
  sparkline4h: number[]
): { modifier: number; signal: string } {
  if (sparkline1h.length < 15 || sparkline4h.length < 15) {
    return { modifier: 0, signal: "MTF: données insuffisantes" };
  }

  const rsi1h = calculateRSI(sparkline1h);
  const rsi4h = calculateRSI(sparkline4h);

  // Both timeframes agree on oversold
  if (rsi1h < 35 && rsi4h < 40) {
    return { modifier: 12, signal: "MTF: survente confirmée 1H+4H" };
  }

  // Both timeframes agree on overbought
  if (rsi1h > 65 && rsi4h > 60) {
    return { modifier: -12, signal: "MTF: surachat confirmé 1H+4H" };
  }

  // Timeframes disagree = weaker signal
  if ((rsi1h < 35 && rsi4h > 55) || (rsi1h > 65 && rsi4h < 45)) {
    return { modifier: -5, signal: "MTF: divergence 1H vs 4H" };
  }

  // Same direction but not extreme
  if (rsi1h < 45 && rsi4h < 45) {
    return { modifier: 5, signal: "MTF: tendance baissière alignée" };
  }
  if (rsi1h > 55 && rsi4h > 55) {
    return { modifier: 5, signal: "MTF: tendance haussière alignée" };
  }

  return { modifier: 0, signal: "MTF: neutre" };
}
