import { NextResponse } from "next/server";
import type { Asset, Signal } from "@/types/market";
import { calculateRSI, computeAIScore, getDirection, generateSignal } from "@/lib/scoring";
import { correlatePolymarket, computePolymarketSentiment } from "@/lib/correlation";
import { fetchCoinGecko, fetchForex, fetchCommodities, fetchPolymarket } from "@/lib/providers";
import { buildTradePlan } from "@/lib/tradePlan";

export const revalidate = 60;

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";

// ─── Alpha Vantage (stocks only, optional) ──────────────────

interface AVQuote {
  "Global Quote": {
    "05. price": string;
    "10. change percent": string;
  };
}

const STOCK_MAP: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia",
  TSLA: "Tesla", GOOGL: "Alphabet", AMZN: "Amazon", META: "Meta",
};

async function fetchStocks(): Promise<Asset[]> {
  if (!AV_KEY) return [];

  const symbols = Object.keys(STOCK_MAP).slice(0, 3); // free tier limit
  const results = await Promise.allSettled(
    symbols.map(async (sym): Promise<Asset | null> => {
      const res = await fetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${AV_KEY}`,
        { next: { revalidate: 120 } }
      );
      const data = (await res.json()) as AVQuote;
      const q = data["Global Quote"];
      if (!q?.["05. price"]) return null;

      const price = parseFloat(q["05. price"]) || 0;
      const change24h = parseFloat((q["10. change percent"] ?? "0").replace("%", "")) || 0;
      const score = computeAIScore(change24h, 0, 50, "STOCKS");

      return {
        id: sym.toLowerCase(),
        name: STOCK_MAP[sym] ?? sym,
        symbol: sym,
        category: "STOCKS",
        price,
        change1h: 0, change24h, change7d: 0,
        marketCap: 0, volume: 0, sparkline: [],
        aiScore: score,
        aiDirection: getDirection(score),
      };
    })
  );

  const assets: Asset[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) assets.push(r.value);
  }
  return assets;
}

// ─── Route Handler ──────────────────────────────────────────

export async function GET() {
  try {
    // 1. Fetch Polymarket first (needed for sentiment correlation)
    const pmRaw = await fetchPolymarket().catch(() => []);
    const polymarket = correlatePolymarket(pmRaw);

    const sentiment = (assetId: string) => computePolymarketSentiment(assetId, polymarket);

    // 2. Fetch all asset classes in parallel
    const [cryptoResult, forexResult, stocksResult] = await Promise.allSettled([
      fetchCoinGecko(sentiment),
      fetchForex(sentiment),
      fetchStocks(),
    ]);

    const commodityAssets = fetchCommodities(sentiment); // sync

    const allAssets: Asset[] = [
      ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : []),
      ...(forexResult.status === "fulfilled" ? forexResult.value : []),
      ...commodityAssets,
      ...(stocksResult.status === "fulfilled" ? stocksResult.value : []),
    ];

    // 3. Generate signals + trade plans for all assets
    const signals: Signal[] = [];
    const assetsWithPlans: Asset[] = allAssets.map((a) => {
      const rsi = calculateRSI(a.sparkline);
      const signal = generateSignal(
        a.name, a.symbol, rsi,
        a.change24h, a.change7d,
        a.aiScore, a.aiDirection, a.category
      );
      if (signal) signals.push(signal);

      return {
        ...a,
        tradePlan: buildTradePlan(
          a.sparkline, rsi,
          a.change24h, a.change7d,
          a.aiScore, a.category
        ),
      };
    });

    return NextResponse.json(
      { assets: assetsWithPlans, polymarket, signals, lastUpdated: new Date().toISOString() },
      { status: 200, headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Failed to fetch market data",
        detail: error instanceof Error ? error.message : "Unknown",
        assets: [], polymarket: [], signals: [],
        lastUpdated: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
