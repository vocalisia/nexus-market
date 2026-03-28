import { NextResponse } from "next/server";
import type { Asset, Signal } from "@/types/market";
import { calculateRSI } from "@/lib/indicators";
import { computeAIScore, getDirection, generateSignal } from "@/lib/scoring";
import { correlatePolymarket, computePolymarketSentiment } from "@/lib/correlation";
import { fetchCoinGecko, fetchForex, fetchCommodities, fetchPolymarket } from "@/lib/providers";
import { buildTradePlan } from "@/lib/tradePlan";

export const revalidate = 60;

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";

// ─── Alpha Vantage (stocks only, optional) ──────────────────

const STOCK_MAP: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia",
  TSLA: "Tesla", GOOGL: "Alphabet", AMZN: "Amazon", META: "Meta",
};

async function fetchStocks(): Promise<Asset[]> {
  if (!AV_KEY) return [];

  const symbols = Object.keys(STOCK_MAP).slice(0, 3);
  const results = await Promise.allSettled(
    symbols.map(async (sym): Promise<Asset | null> => {
      try {
        // Fetch quote + intraday in parallel
        const [quoteRes, intradayRes] = await Promise.allSettled([
          fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${AV_KEY}`, { next: { revalidate: 120 } }),
          fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${sym}&interval=60min&outputsize=compact&apikey=${AV_KEY}`, { next: { revalidate: 120 } }),
        ]);

        // Parse quote
        let price = 0;
        let change24h = 0;
        if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
          const data = await quoteRes.value.json();
          const q = data["Global Quote"];
          if (!q?.["05. price"]) return null;
          price = parseFloat(q["05. price"]) || 0;
          change24h = parseFloat((q["10. change percent"] ?? "0").replace("%", "")) || 0;
        } else {
          return null;
        }

        // Parse intraday for sparkline
        let sparkline: number[] = [];
        if (intradayRes.status === "fulfilled" && intradayRes.value.ok) {
          const intradayData = await intradayRes.value.json();
          const timeSeries = intradayData["Time Series (60min)"];
          if (timeSeries) {
            const entries = Object.entries(timeSeries) as [string, Record<string, string>][];
            sparkline = entries
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, vals]) => parseFloat(vals["4. close"]) || 0)
              .filter((v) => v > 0);
          }
        }

        const rsi = calculateRSI(sparkline);
        const change7d = sparkline.length >= 2
          ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
          : 0;
        const score = computeAIScore(change24h, change7d, rsi, "STOCKS");

        return {
          id: sym.toLowerCase(),
          name: STOCK_MAP[sym] ?? sym,
          symbol: sym,
          category: "STOCKS" as const,
          price,
          change1h: 0, change24h, change7d,
          marketCap: 0, volume: 0, sparkline,
          aiScore: score,
          aiDirection: getDirection(score),
        };
      } catch {
        return null;
      }
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
    const [cryptoResult, forexResult, stocksResult, commodityResult] = await Promise.allSettled([
      fetchCoinGecko(sentiment),
      fetchForex(sentiment),
      fetchStocks(),
      fetchCommodities(AV_KEY, sentiment),
    ]);

    const allAssets: Asset[] = [
      ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : []),
      ...(forexResult.status === "fulfilled" ? forexResult.value : []),
      ...(commodityResult.status === "fulfilled" ? commodityResult.value : []),
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
