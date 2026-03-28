import { NextResponse } from "next/server";

export const revalidate = 60;

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";

// ─── Types ───────────────────────────────────────────────────

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
}

interface Asset {
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
  category: "CRYPTO" | "FOREX" | "STOCKS" | "COMMODITIES";
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

// ─── RSI ─────────────────────────────────────────────────────

function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

// ─── AI Score ────────────────────────────────────────────────

function computeAIScore(change24h: number, change7d: number, rsi: number): number {
  const rsiScore = rsi;
  const c24 = Math.min(100, Math.max(0, (change24h + 10) * 5));
  const c7d = Math.min(100, Math.max(0, (change7d + 20) * 2.5));
  return Math.round(Math.min(100, Math.max(0, rsiScore * 0.4 + c24 * 0.35 + c7d * 0.25)));
}

function getDirection(score: number): "UP" | "DOWN" | "NEUTRAL" {
  if (score > 55) return "UP";
  if (score < 45) return "DOWN";
  return "NEUTRAL";
}

// ─── Signal Generation ──────────────────────────────────────

function generateSignal(name: string, symbol: string, rsi: number, change24h: number, change7d: number, score: number, direction: "UP" | "DOWN" | "NEUTRAL"): Signal | null {
  const parts: string[] = [];
  let severity: "low" | "medium" | "high" = "low";

  if (rsi < 30) { parts.push("RSI oversold"); severity = "high"; }
  else if (rsi > 70) { parts.push("RSI overbought"); severity = "high"; }
  else if (rsi < 40) { parts.push("RSI approaching oversold"); severity = "medium"; }
  else if (rsi > 60) { parts.push("RSI approaching overbought"); severity = "medium"; }

  if (change24h > 5) { parts.push("momentum bullish"); if (severity === "low") severity = "medium"; }
  else if (change24h < -5) { parts.push("momentum bearish"); if (severity === "low") severity = "medium"; }

  if (change7d > 15) { parts.push("strong 7d uptrend"); severity = "high"; }
  else if (change7d < -15) { parts.push("strong 7d downtrend"); severity = "high"; }

  if (parts.length === 0) return null;

  return {
    asset: `${name} (${symbol.toUpperCase()})`,
    type: direction === "UP" ? "BUY" : direction === "DOWN" ? "SELL" : "WATCH",
    message: `${parts.join(" + ")} — AI confidence ${score}/100`,
    severity,
  };
}

// ─── Alpha Vantage Helpers ──────────────────────────────────

interface AVQuote {
  "Global Quote": {
    "01. symbol": string;
    "05. price": string;
    "09. change": string;
    "10. change percent": string;
  };
}

interface AVForexRate {
  "Realtime Currency Exchange Rate": {
    "1. From_Currency Code": string;
    "5. Exchange Rate": string;
  };
}

async function fetchAVQuote(symbol: string): Promise<{ price: number; changePercent: number } | null> {
  if (!AV_KEY) return null;
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${AV_KEY}`,
      { next: { revalidate: 120 } }
    );
    const data = (await res.json()) as AVQuote;
    const q = data["Global Quote"];
    if (!q || !q["05. price"]) return null;
    return {
      price: parseFloat(q["05. price"]) || 0,
      changePercent: parseFloat((q["10. change percent"] ?? "0").replace("%", "")) || 0,
    };
  } catch { return null; }
}

async function fetchAVForex(from: string, to: string): Promise<number | null> {
  if (!AV_KEY) return null;
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${AV_KEY}`,
      { next: { revalidate: 120 } }
    );
    const data = (await res.json()) as AVForexRate;
    const rate = data["Realtime Currency Exchange Rate"];
    if (!rate) return null;
    return parseFloat(rate["5. Exchange Rate"]) || null;
  } catch { return null; }
}

function makeAsset(id: string, name: string, symbol: string, price: number, change24h: number, category: Asset["category"]): Asset {
  const score = computeAIScore(change24h, 0, 50);
  return {
    id, name, symbol, price,
    change1h: 0, change24h, change7d: 0,
    marketCap: 0, volume: 0, sparkline: [],
    aiScore: score, aiDirection: getDirection(score),
    category,
  };
}

// ─── Route Handler ──────────────────────────────────────────

export async function GET() {
  try {
    // 1. CoinGecko — expanded to top 15 cryptos
    const cgUrl =
      "https://api.coingecko.com/api/v3/coins/markets" +
      "?vs_currency=usd" +
      "&ids=bitcoin,ethereum,solana,ripple,dogecoin,cardano,polkadot,avalanche-2,chainlink,polygon,uniswap,litecoin,stellar,near,sui" +
      "&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d";

    // 2. Polymarket
    const pmUrl = "https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false&order=volume&ascending=false";

    // 3. Alpha Vantage — Stocks, Forex, Commodities (parallel)
    const stockSymbols = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META"];
    const forexPairs = [
      { from: "EUR", to: "USD" },
      { from: "GBP", to: "USD" },
      { from: "USD", to: "JPY" },
      { from: "USD", to: "CHF" },
      { from: "AUD", to: "USD" },
    ];
    const commoditySymbols = [
      { symbol: "XAUUSD", name: "Gold (XAU)", id: "gold" },
      { symbol: "XAGUSD", name: "Silver (XAG)", id: "silver" },
    ];

    // Fire all requests in parallel
    const [cgResponse, pmResponse, ...avResults] = await Promise.allSettled([
      fetch(cgUrl, { next: { revalidate: 60 } }),
      fetch(pmUrl, { next: { revalidate: 60 } }),
      // Stocks (limit to 3 on free tier to avoid rate limits)
      ...stockSymbols.slice(0, 3).map((s) => fetchAVQuote(s)),
      // Forex
      ...forexPairs.slice(0, 3).map((p) => fetchAVForex(p.from, p.to)),
      // Commodities
      ...commoditySymbols.map((c) => fetchAVForex(c.symbol.slice(0, 3), "USD")),
    ]);

    // ─── Process Crypto ─────────────────────────────────────
    let cryptoData: CoinGeckoMarket[] = [];
    if (cgResponse.status === "fulfilled" && cgResponse.value.ok) {
      cryptoData = (await cgResponse.value.json()) as CoinGeckoMarket[];
    }

    const crypto: Asset[] = cryptoData.map((coin) => {
      const sparkline = coin.sparkline_in_7d?.price ?? [];
      const rsi = calculateRSI(sparkline);
      const change1h = coin.price_change_percentage_1h_in_currency ?? 0;
      const change24h = coin.price_change_percentage_24h_in_currency ?? 0;
      const change7d = coin.price_change_percentage_7d_in_currency ?? 0;
      const aiScore = computeAIScore(change24h, change7d, rsi);
      return {
        id: coin.id, name: coin.name, symbol: coin.symbol,
        price: coin.current_price, change1h, change24h, change7d,
        marketCap: coin.market_cap, volume: coin.total_volume,
        sparkline, aiScore, aiDirection: getDirection(aiScore),
        category: "CRYPTO" as const,
      };
    });

    // ─── Process Stocks ─────────────────────────────────────
    const stocks: Asset[] = [];
    const stockNames: Record<string, string> = { AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia", TSLA: "Tesla", GOOGL: "Alphabet", AMZN: "Amazon", META: "Meta" };
    for (let i = 0; i < Math.min(3, stockSymbols.length); i++) {
      const r = avResults[i];
      if (r.status === "fulfilled" && r.value) {
        const q = r.value as { price: number; changePercent: number };
        const sym = stockSymbols[i];
        stocks.push(makeAsset(sym.toLowerCase(), stockNames[sym] ?? sym, sym, q.price, q.changePercent, "STOCKS"));
      }
    }

    // ─── Process Forex ──────────────────────────────────────
    const forex: Asset[] = [];
    const forexOffset = 3;
    for (let i = 0; i < Math.min(3, forexPairs.length); i++) {
      const r = avResults[forexOffset + i];
      if (r.status === "fulfilled" && r.value) {
        const rate = r.value as number;
        const pair = forexPairs[i];
        const sym = `${pair.from}/${pair.to}`;
        forex.push(makeAsset(sym.toLowerCase().replace("/", ""), sym, sym, rate, 0, "FOREX"));
      }
    }

    // ─── Process Commodities ────────────────────────────────
    const commodities: Asset[] = [];
    const comOffset = forexOffset + 3;
    for (let i = 0; i < commoditySymbols.length; i++) {
      const r = avResults[comOffset + i];
      if (r.status === "fulfilled" && r.value) {
        const rate = r.value as number;
        const c = commoditySymbols[i];
        commodities.push(makeAsset(c.id, c.name, c.symbol, rate, 0, "COMMODITIES"));
      }
    }

    // ─── Signals ────────────────────────────────────────────
    const signals: Signal[] = [];
    for (const c of crypto) {
      const rsi = calculateRSI(c.sparkline);
      const signal = generateSignal(c.name, c.symbol, rsi, c.change24h, c.change7d, c.aiScore, c.aiDirection);
      if (signal) signals.push(signal);
    }

    // ─── Polymarket ─────────────────────────────────────────
    let pmRaw: PolymarketMarket[] = [];
    if (pmResponse.status === "fulfilled" && pmResponse.value.ok) {
      pmRaw = (await pmResponse.value.json()) as PolymarketMarket[];
    }

    const polymarket: PolymarketResult[] = pmRaw.slice(0, 20).map((m) => {
      let bestBid = Number(m.bestBid) || 0;
      let bestAsk = Number(m.bestAsk) || 0;
      if (!bestBid && !bestAsk && m.outcomePrices) {
        try {
          const prices: string[] = JSON.parse(m.outcomePrices);
          if (prices.length >= 2) {
            bestBid = parseFloat(prices[0]) || 0;
            bestAsk = parseFloat(prices[1]) || 0;
          }
        } catch { /* ignore */ }
      }
      return {
        question: m.question ?? m.title ?? "Unknown",
        volume: Number(m.volume) || 0,
        liquidity: Number(m.liquidity) || 0,
        bestBid, bestAsk,
      };
    });

    return NextResponse.json({
      crypto,
      stocks,
      forex,
      commodities,
      polymarket,
      lastUpdated: new Date().toISOString(),
      signals,
    }, {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to fetch market data",
      detail: error instanceof Error ? error.message : "Unknown",
      crypto: [], stocks: [], forex: [], commodities: [],
      polymarket: [], lastUpdated: new Date().toISOString(), signals: [],
    }, { status: 500 });
  }
}
