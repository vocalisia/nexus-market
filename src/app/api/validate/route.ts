import { NextResponse } from "next/server";
import type { AssetCategory } from "@/types/market";

const TD_KEY = process.env.TWELVE_DATA_API_KEY ?? "";

// ─── Fetch current price by asset category ──────────────────

async function fetchCryptoPrice(symbol: string): Promise<number | null> {
  // Map common symbols to CoinGecko IDs
  const idMap: Record<string, string> = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
    DOGE: "dogecoin", ADA: "cardano", DOT: "polkadot", AVAX: "avalanche-2",
    LINK: "chainlink", MATIC: "matic-network", UNI: "uniswap", LTC: "litecoin",
    XLM: "stellar", NEAR: "near", SUI: "sui",
  };
  const id = idMap[symbol.toUpperCase()] ?? symbol.toLowerCase();
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { next: { revalidate: 0 } },
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, { usd?: number }>;
    return data[id]?.usd ?? null;
  } catch {
    return null;
  }
}

async function fetchForexPrice(symbol: string): Promise<number | null> {
  // symbol like "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF"
  const [from, to] = symbol.split("/");
  if (!from || !to) return null;
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      { next: { revalidate: 0 } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { rates?: Record<string, number> };
    return data.rates?.[to] ?? null;
  } catch {
    return null;
  }
}

async function fetchCommodityPrice(symbol: string): Promise<number | null> {
  if (!TD_KEY) return null;
  // Map display symbols to Twelve Data symbols
  const tdMap: Record<string, string> = {
    "XAU/USD": "XAU/USD", "XAG/USD": "XAG/USD",
    "WTI": "CL", "NATGAS": "NG",
  };
  const tdSymbol = tdMap[symbol] ?? symbol;
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${tdSymbol}&apikey=${TD_KEY}`,
      { next: { revalidate: 0 } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { price?: string };
    return data.price ? parseFloat(data.price) : null;
  } catch {
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const category = searchParams.get("category") as AssetCategory | null;

  if (!symbol || !category) {
    return NextResponse.json(
      { error: "Missing required params: symbol, category" },
      { status: 400 },
    );
  }

  const validCategories: AssetCategory[] = ["CRYPTO", "FOREX", "COMMODITIES", "STOCKS"];
  if (!validCategories.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  let currentPrice: number | null = null;
  let source = "unknown";

  try {
    switch (category) {
      case "CRYPTO":
        currentPrice = await fetchCryptoPrice(symbol);
        source = "coingecko";
        break;
      case "FOREX":
        currentPrice = await fetchForexPrice(symbol);
        source = "frankfurter";
        break;
      case "COMMODITIES":
        currentPrice = await fetchCommodityPrice(symbol);
        source = "twelvedata";
        break;
      case "STOCKS":
        // Alpha Vantage could be added here if key available
        currentPrice = null;
        source = "unavailable";
        break;
    }
  } catch {
    // Handled below
  }

  if (!currentPrice || currentPrice <= 0) {
    return NextResponse.json(
      { error: "Price unavailable", symbol, category },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      symbol,
      currentPrice,
      fetchedAt: new Date().toISOString(),
      source,
    },
    { status: 200 },
  );
}
