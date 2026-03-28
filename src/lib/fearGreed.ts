// ─── Fear & Greed Index ─────────────────────────────────────
// Source: alternative.me (free, no API key, crypto-focused)

export interface FearGreedData {
  value: number;        // 0-100
  classification: string; // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
  timestamp: number;
}

export async function fetchFearGreed(): Promise<FearGreedData> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      next: { revalidate: 300 }, // cache 5 min
    });
    if (!res.ok) return { value: 50, classification: "Neutral", timestamp: Date.now() };

    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) return { value: 50, classification: "Neutral", timestamp: Date.now() };

    return {
      value: parseInt(entry.value) || 50,
      classification: entry.value_classification ?? "Neutral",
      timestamp: parseInt(entry.timestamp) * 1000 || Date.now(),
    };
  } catch {
    return { value: 50, classification: "Neutral", timestamp: Date.now() };
  }
}

// Score adjustment based on Fear & Greed
// Extreme Fear (0-25) = contrarian BUY signal (+15 pts)
// Extreme Greed (75-100) = contrarian SELL signal (-15 pts)
export function fearGreedAdjustment(fgValue: number): number {
  if (fgValue <= 15) return 15;  // Extreme fear = strong buy
  if (fgValue <= 25) return 10;  // Fear = buy
  if (fgValue <= 35) return 5;   // Mild fear
  if (fgValue <= 55) return 0;   // Neutral
  if (fgValue <= 65) return -3;  // Mild greed
  if (fgValue <= 75) return -8;  // Greed
  return -15;                     // Extreme greed = strong sell
}
