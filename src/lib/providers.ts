import type { Asset, AssetCategory } from "@/types/market";
import { computeAIScore, getDirection } from "./scoring";
import { calculateRSI } from "./indicators";

// ============================================================
// COINGECKO PROVIDER (crypto - no API key needed)
// ============================================================

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

export async function fetchCoinGecko(sentiment: (id: string) => number): Promise<Asset[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets" +
    "?vs_currency=usd" +
    "&ids=bitcoin,ethereum,solana,ripple,dogecoin,cardano,polkadot,avalanche-2,chainlink,polygon,uniswap,litecoin,stellar,near,sui" +
    "&order=market_cap_desc" +
    "&sparkline=true" +
    "&price_change_percentage=1h,24h,7d";

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];

  const data = (await res.json()) as CoinGeckoMarket[];

  return data.map((coin) => {
    const sparkline = coin.sparkline_in_7d?.price ?? [];
    const rsi = calculateRSI(sparkline);
    const change1h = coin.price_change_percentage_1h_in_currency ?? 0;
    const change24h = coin.price_change_percentage_24h_in_currency ?? 0;
    const change7d = coin.price_change_percentage_7d_in_currency ?? 0;
    const aiScore = computeAIScore(change24h, change7d, rsi, "CRYPTO", sentiment(coin.id));

    return {
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      category: "CRYPTO" as AssetCategory,
      price: coin.current_price,
      change1h,
      change24h,
      change7d,
      marketCap: coin.market_cap,
      volume: coin.total_volume,
      sparkline,
      aiScore,
      aiDirection: getDirection(aiScore),
    };
  });
}

// ============================================================
// FRANKFURTER PROVIDER (forex - free, no API key)
// ============================================================

interface FrankfurterLatest {
  rates: Record<string, number>;
}

interface FrankfurterTimeSeries {
  rates: Record<string, Record<string, number>>;
}

interface ForexPairConfig {
  id: string;
  name: string;
  symbol: string;
  from: string;
  to: string;
}

const FOREX_PAIRS: ForexPairConfig[] = [
  { id: "eur-usd", name: "Euro / Dollar", symbol: "EUR/USD", from: "EUR", to: "USD" },
  { id: "gbp-usd", name: "Livre / Dollar", symbol: "GBP/USD", from: "GBP", to: "USD" },
  { id: "usd-jpy", name: "Dollar / Yen", symbol: "USD/JPY", from: "USD", to: "JPY" },
  { id: "usd-chf", name: "Dollar / Franc", symbol: "USD/CHF", from: "USD", to: "CHF" },
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchForex(sentiment: (id: string) => number): Promise<Asset[]> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600_000);

  // Fetch time series for sparklines + latest rates
  const currencies = "EUR,GBP,JPY,CHF,USD";
  const tsUrl = `https://api.frankfurter.app/${toDateStr(sevenDaysAgo)}..${toDateStr(now)}?from=USD&to=${currencies}`;
  const latestUrl = `https://api.frankfurter.app/latest?from=USD&to=${currencies}`;

  const [tsRes, latestRes] = await Promise.allSettled([
    fetch(tsUrl, { next: { revalidate: 120 } }),
    fetch(latestUrl, { next: { revalidate: 120 } }),
  ]);

  let timeSeries: FrankfurterTimeSeries = { rates: {} };
  let latest: FrankfurterLatest = { rates: {} };

  if (tsRes.status === "fulfilled" && tsRes.value.ok) {
    timeSeries = (await tsRes.value.json()) as FrankfurterTimeSeries;
  }
  if (latestRes.status === "fulfilled" && latestRes.value.ok) {
    latest = (await latestRes.value.json()) as FrankfurterLatest;
  }

  const dates = Object.keys(timeSeries.rates).sort();

  return FOREX_PAIRS.map((pair) => {
    // Build sparkline from time series
    const sparkline: number[] = [];
    for (const date of dates) {
      const dayRates = timeSeries.rates[date];
      if (!dayRates) continue;

      let rate: number;
      if (pair.from === "USD") {
        rate = dayRates[pair.to] ?? 0;
      } else {
        const usdToTarget = dayRates[pair.from] ?? 1;
        rate = 1 / usdToTarget;
      }
      if (rate > 0) sparkline.push(rate);
    }

    // Current price from latest
    let price: number;
    if (pair.from === "USD") {
      price = latest.rates[pair.to] ?? sparkline[sparkline.length - 1] ?? 0;
    } else {
      const usdToFrom = latest.rates[pair.from] ?? 1;
      price = 1 / usdToFrom;
    }

    const change1h = 0; // daily data, no hourly granularity
    const change24h = sparkline.length >= 2
      ? ((sparkline[sparkline.length - 1] - sparkline[sparkline.length - 2]) / sparkline[sparkline.length - 2]) * 100
      : 0;
    const change7d = sparkline.length >= 2
      ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
      : 0;

    const rsi = calculateRSI(sparkline);
    const aiScore = computeAIScore(change24h, change7d, rsi, "FOREX", sentiment(pair.id));

    return {
      id: pair.id,
      name: pair.name,
      symbol: pair.symbol,
      category: "FOREX" as AssetCategory,
      price,
      change1h,
      change24h,
      change7d,
      marketCap: 0,
      volume: 0,
      sparkline,
      aiScore,
      aiDirection: getDirection(aiScore),
    };
  });
}

// ============================================================
// COMMODITIES PROVIDER (Alpha Vantage API)
// ============================================================

interface AVQuote {
  "Global Quote": {
    "01. symbol": string;
    "05. price": string;
    "09. change": string;
    "10. change percent": string;
  };
}

interface CommodityMeta {
  id: string;
  name: string;
  symbol: string;
  avSymbol: string;
}

const COMMODITY_META: CommodityMeta[] = [
  { id: "xau-usd", name: "Or (Gold)", symbol: "XAU/USD", avSymbol: "GLD" },
  { id: "xag-usd", name: "Argent (Silver)", symbol: "XAG/USD", avSymbol: "SLV" },
  { id: "wti-oil", name: "Petrole WTI", symbol: "WTI", avSymbol: "USO" },
];

export async function fetchCommodities(
  apiKey: string,
  sentiment: (id: string) => number,
): Promise<Asset[]> {
  if (!apiKey) return [];

  const fetchQuote = (avSymbol: string): Promise<Response> =>
    fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${apiKey}`,
      { next: { revalidate: 300 } },
    );

  const results = await Promise.allSettled(
    COMMODITY_META.map((c) => fetchQuote(c.avSymbol)),
  );

  const assets: Asset[] = [];

  for (let i = 0; i < COMMODITY_META.length; i++) {
    const meta = COMMODITY_META[i];
    const result = results[i];

    if (result.status === "rejected" || !result.value.ok) continue;

    let data: AVQuote;
    try {
      data = (await result.value.json()) as AVQuote;
    } catch {
      continue;
    }

    const quote = data["Global Quote"];
    if (!quote || !quote["05. price"]) continue;

    const price = parseFloat(quote["05. price"]) || 0;
    const changePercent = parseFloat(
      (quote["10. change percent"] ?? "0").replace("%", ""),
    ) || 0;

    const rsi = calculateRSI([]);
    const aiScore = computeAIScore(changePercent, 0, rsi, "COMMODITIES", sentiment(meta.id));

    assets.push({
      id: meta.id,
      name: meta.name,
      symbol: meta.symbol,
      category: "COMMODITIES" as AssetCategory,
      price,
      change1h: 0,
      change24h: changePercent,
      change7d: 0,
      marketCap: 0,
      volume: 0,
      sparkline: [],
      aiScore,
      aiDirection: getDirection(aiScore),
    });
  }

  return assets;
}

// ============================================================
// POLYMARKET PROVIDER (free, no API key)
// ============================================================

interface PolymarketMarketRaw {
  question?: string;
  title?: string;
  volume?: number;
  liquidity?: number;
  bestBid?: number;
  bestAsk?: number;
  outcomePrices?: string;
}

export async function fetchPolymarket(): Promise<
  { question: string; volume: number; liquidity: number; bestBid: number; bestAsk: number }[]
> {
  const url =
    "https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false&order=volume&ascending=false";

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];

  const raw = (await res.json()) as PolymarketMarketRaw[];

  return raw.slice(0, 20).map((m) => {
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
}
