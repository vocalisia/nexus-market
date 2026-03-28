import { NextResponse } from "next/server";

export const revalidate = 60;

// --- Types ---

interface CoinGeckoMarket {
  id: string;
  name: string;
  symbol: string;
  current_price: number;
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_24h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
  market_cap: number;
  total_volume: number;
  sparkline_in_7d: { price: number[] } | null;
}

interface PolymarketMarket {
  question?: string;
  title?: string;
  volume?: number;
  liquidity?: number;
  bestBid?: number;
  bestAsk?: number;
  outcomePrices?: string;
  outcomes?: string;
}

interface CryptoResult {
  id: string;
  name: string;
  symbol: string;
  price: number;
  change1h: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume: number;
  sparkline: number[];
  aiScore: number;
  aiDirection: "UP" | "DOWN" | "NEUTRAL";
}

interface PolymarketResult {
  question: string;
  volume: number;
  liquidity: number;
  bestBid: number;
  bestAsk: number;
}

interface Signal {
  asset: string;
  type: string;
  message: string;
  severity: "low" | "medium" | "high";
}

// --- RSI Calculation ---

function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) {
    return 50; // not enough data, return neutral
  }

  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));

  // Initial averages over first `period` values
  const slice = (arr: number[], start: number, len: number) =>
    arr.slice(start, start + len);

  const avgGain =
    slice(gains, 0, period).reduce((a, b) => a + b, 0) / period;
  const avgLoss =
    slice(losses, 0, period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100;

  let rs = avgGain / avgLoss;
  let rsi = 100 - 100 / (1 + rs);

  // Smooth with Wilder's method for remaining periods
  for (let i = period; i < gains.length; i++) {
    const smoothGain = (avgGain * (period - 1) + gains[i]) / period;
    const smoothLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = smoothLoss === 0 ? 100 : smoothGain / smoothLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  return Math.round(rsi * 100) / 100;
}

// --- AI Score Calculation ---

function computeAIScore(
  change24h: number,
  change7d: number,
  rsi: number
): number {
  // Normalise each component to 0-100
  const rsiScore = rsi; // already 0-100

  // 24h change: clamp between -10% and +10%, map to 0-100
  const change24hScore = Math.min(100, Math.max(0, (change24h + 10) * 5));

  // 7d change: clamp between -20% and +20%, map to 0-100
  const change7dScore = Math.min(100, Math.max(0, (change7d + 20) * 2.5));

  // Weighted average: RSI 40%, 24h 35%, 7d 25%
  const score =
    rsiScore * 0.4 + change24hScore * 0.35 + change7dScore * 0.25;

  return Math.round(Math.min(100, Math.max(0, score)));
}

function getDirection(score: number): "UP" | "DOWN" | "NEUTRAL" {
  if (score > 55) return "UP";
  if (score < 45) return "DOWN";
  return "NEUTRAL";
}

// --- Signal Generation ---

function generateSignal(
  name: string,
  symbol: string,
  rsi: number,
  change24h: number,
  change7d: number,
  score: number,
  direction: "UP" | "DOWN" | "NEUTRAL"
): Signal | null {
  const parts: string[] = [];
  let severity: "low" | "medium" | "high" = "low";

  // RSI conditions
  if (rsi < 30) {
    parts.push("RSI oversold");
    severity = "high";
  } else if (rsi > 70) {
    parts.push("RSI overbought");
    severity = "high";
  } else if (rsi < 40) {
    parts.push("RSI approaching oversold");
    severity = "medium";
  } else if (rsi > 60) {
    parts.push("RSI approaching overbought");
    severity = "medium";
  }

  // Momentum conditions
  if (change24h > 5) {
    parts.push("momentum bullish");
    if (severity === "low") severity = "medium";
  } else if (change24h < -5) {
    parts.push("momentum bearish");
    if (severity === "low") severity = "medium";
  }

  // 7d trend
  if (change7d > 15) {
    parts.push("strong 7d uptrend");
    severity = "high";
  } else if (change7d < -15) {
    parts.push("strong 7d downtrend");
    severity = "high";
  }

  // Only emit a signal when there's something to say
  if (parts.length === 0) return null;

  const message = parts.join(" + ");
  const type = direction === "UP" ? "BUY" : direction === "DOWN" ? "SELL" : "WATCH";

  return {
    asset: `${name} (${symbol.toUpperCase()})`,
    type,
    message: `${message} — AI confidence ${score}/100`,
    severity,
  };
}

// --- Route Handler ---

export async function GET() {
  try {
    // 1. Fetch CoinGecko data
    const cgUrl =
      "https://api.coingecko.com/api/v3/coins/markets" +
      "?vs_currency=usd" +
      "&ids=bitcoin,ethereum,solana,ripple,dogecoin,cardano" +
      "&order=market_cap_desc" +
      "&sparkline=true" +
      "&price_change_percentage=1h,24h,7d";

    // 2. Fetch Polymarket data
    const pmUrl =
      "https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false&order=volume&ascending=false";

    const [cgResponse, pmResponse] = await Promise.allSettled([
      fetch(cgUrl, { next: { revalidate: 60 } }),
      fetch(pmUrl, { next: { revalidate: 60 } }),
    ]);

    // --- Process CoinGecko ---
    let cryptoData: CoinGeckoMarket[] = [];

    if (
      cgResponse.status === "fulfilled" &&
      cgResponse.value.ok
    ) {
      cryptoData = (await cgResponse.value.json()) as CoinGeckoMarket[];
    }

    const crypto: CryptoResult[] = cryptoData.map((coin) => {
      const sparkline = coin.sparkline_in_7d?.price ?? [];
      const rsi = calculateRSI(sparkline);

      const change1h = coin.price_change_percentage_1h_in_currency ?? 0;
      const change24h = coin.price_change_percentage_24h_in_currency ?? 0;
      const change7d = coin.price_change_percentage_7d_in_currency ?? 0;

      const aiScore = computeAIScore(change24h, change7d, rsi);
      const aiDirection = getDirection(aiScore);

      return {
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        price: coin.current_price,
        change1h,
        change24h,
        change7d,
        marketCap: coin.market_cap,
        volume: coin.total_volume,
        sparkline,
        aiScore,
        aiDirection,
      };
    });

    // --- Generate Signals ---
    const signals: Signal[] = [];

    for (const c of crypto) {
      const sparkline = c.sparkline;
      const rsi = calculateRSI(sparkline);
      const signal = generateSignal(
        c.name,
        c.symbol,
        rsi,
        c.change24h,
        c.change7d,
        c.aiScore,
        c.aiDirection
      );
      if (signal) signals.push(signal);
    }

    // --- Process Polymarket ---
    let pmRaw: PolymarketMarket[] = [];

    if (
      pmResponse.status === "fulfilled" &&
      pmResponse.value.ok
    ) {
      pmRaw = (await pmResponse.value.json()) as PolymarketMarket[];
    }

    const polymarket: PolymarketResult[] = pmRaw
      .slice(0, 20)
      .map((m) => {
        // Attempt to parse best bid/ask from outcomePrices if available
        let bestBid = m.bestBid ?? 0;
        let bestAsk = m.bestAsk ?? 0;

        if (!bestBid && !bestAsk && m.outcomePrices) {
          try {
            const prices: string[] = JSON.parse(m.outcomePrices);
            if (prices.length >= 2) {
              bestBid = parseFloat(prices[0]) || 0;
              bestAsk = parseFloat(prices[1]) || 0;
            }
          } catch {
            // ignore parse errors
          }
        }

        return {
          question: m.question ?? m.title ?? "Unknown",
          volume: Number(m.volume) || 0,
          liquidity: Number(m.liquidity) || 0,
          bestBid: Number(bestBid) || 0,
          bestAsk: Number(bestAsk) || 0,
        };
      });

    return NextResponse.json(
      {
        crypto,
        polymarket,
        lastUpdated: new Date().toISOString(),
        signals,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Failed to fetch market data",
        detail: message,
        crypto: [],
        polymarket: [],
        lastUpdated: new Date().toISOString(),
        signals: [],
      },
      { status: 500 }
    );
  }
}
