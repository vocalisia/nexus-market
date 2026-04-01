import type { Asset, AssetCategory } from "@/types/market";
import { computeAIScore, getDirection } from "./scoring";
import type { MarketSentimentData } from "./scoring";
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

// PAXG = Paxos Gold token — 1 PAXG = 1 troy oz gold, real-time price on Binance WS
const COMMODITY_OVERRIDES: Record<string, { name: string; symbol: string; category: AssetCategory }> = {
  "paxos-gold": { name: "Or (Gold)", symbol: "XAU/USD", category: "COMMODITIES" },
};

// CoinGecko IDs — crypto only (PAXG fetched separately to guarantee delivery)
const COINGECKO_IDS =
  "bitcoin,ethereum,solana,ripple,dogecoin,cardano,polkadot,avalanche-2," +
  "chainlink,polygon,uniswap,litecoin,stellar,near,sui";

export async function fetchCoinGecko(sentiment: (id: string) => number): Promise<Asset[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/markets" +
    `?vs_currency=usd&ids=${COINGECKO_IDS}` +
    "&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h,7d";

  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];

  const data = (await res.json()) as CoinGeckoMarket[];

  return data.map((coin) => {
    const override = COMMODITY_OVERRIDES[coin.id];
    const category: AssetCategory = override?.category ?? "CRYPTO";
    const sparkline = coin.sparkline_in_7d?.price ?? [];
    const rsi = calculateRSI(sparkline);
    const change1h  = coin.price_change_percentage_1h_in_currency  ?? 0;
    const change24h = coin.price_change_percentage_24h_in_currency ?? 0;
    const change7d  = coin.price_change_percentage_7d_in_currency  ?? 0;
    const aiScore   = computeAIScore(change24h, change7d, rsi, category, sentiment(coin.id));

    return {
      id:          coin.id,
      name:        override?.name   ?? coin.name,
      symbol:      override?.symbol ?? coin.symbol.toUpperCase(),
      category,
      price:       coin.current_price,
      change1h, change24h, change7d,
      marketCap:   coin.market_cap,
      volume:      coin.total_volume,
      sparkline, aiScore,
      aiDirection: getDirection(aiScore),
    };
  });
}

// ============================================================
// GOLD (PAXG) — dedicated fetch, always present, no rate-limit risk
// Uses CoinGecko market_chart endpoint which is more reliable for a single coin
// ============================================================

interface CoinGeckoMarketChart {
  prices: [number, number][];
}

interface CoinGeckoSimplePrice {
  "paxos-gold"?: {
    usd?: number;
    usd_24h_change?: number;
    usd_7d_change?: number;
  };
}

export async function fetchGold(sentiment: (id: string) => number): Promise<Asset[]> {
  try {
    const [priceRes, chartRes] = await Promise.allSettled([
      fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=paxos-gold&vs_currencies=usd&include_24hr_change=true&include_7d_change=true",
        { next: { revalidate: 60 } },
      ),
      fetch(
        "https://api.coingecko.com/api/v3/coins/paxos-gold/market_chart?vs_currency=usd&days=7&interval=hourly",
        { next: { revalidate: 300 } },
      ),
    ]);

    let price = 0;
    let change24h = 0;
    let change7d = 0;

    if (priceRes.status === "fulfilled" && priceRes.value.ok) {
      const data = (await priceRes.value.json()) as CoinGeckoSimplePrice;
      price     = data["paxos-gold"]?.usd ?? 0;
      change24h = data["paxos-gold"]?.usd_24h_change ?? 0;
      change7d  = data["paxos-gold"]?.usd_7d_change  ?? 0;
    }

    // Fallback: Binance REST for PAXG price if CoinGecko rate-limited
    if (price === 0) {
      try {
        const binRes = await fetch(
          "https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT",
          { next: { revalidate: 60 } },
        );
        if (binRes.ok) {
          const bin = await binRes.json() as { lastPrice?: string; priceChangePercent?: string };
          price     = parseFloat(bin.lastPrice ?? "0") || 0;
          change24h = parseFloat(bin.priceChangePercent ?? "0") || 0;
        }
      } catch { /* ignore */ }
    }

    if (price === 0) return []; // both APIs unavailable

    let sparkline: number[] = [];
    if (chartRes.status === "fulfilled" && chartRes.value.ok) {
      const chart = (await chartRes.value.json()) as CoinGeckoMarketChart;
      sparkline = chart.prices.map(([, p]) => p);
    }

    // Fallback sparkline: flat line at current price (enough for RSI/BB)
    if (sparkline.length < 10) {
      sparkline = Array(24).fill(price);
    }

    const change1h = 0;
    const rsi = calculateRSI(sparkline);
    const aiScore = computeAIScore(change24h, change7d, rsi, "COMMODITIES", sentiment("paxos-gold"));

    return [{
      id: "paxos-gold",
      name: "Or (Gold)",
      symbol: "XAU/USD",
      category: "COMMODITIES",
      price,
      change1h, change24h, change7d,
      marketCap: 0,
      volume: 0,
      sparkline,
      aiScore,
      aiDirection: getDirection(aiScore),
    }];
  } catch {
    return [];
  }
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
// TWELVE DATA PROVIDER (commodities + forex upgrade)
// ============================================================

interface TwelveDataValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TwelveDataResponse {
  values?: TwelveDataValue[];
  status?: string;
}

interface TwelveAssetConfig {
  id: string;
  name: string;
  symbol: string;
  tdSymbol: string;
  category: AssetCategory;
}

// Silver + Oil via Twelve Data — Gold is covered separately via CoinGecko PAXG
const TWELVE_COMMODITIES: TwelveAssetConfig[] = [
  { id: "silver",    name: "Argent (Silver)", symbol: "XAG/USD", tdSymbol: "XAG/USD", category: "COMMODITIES" },
  { id: "crude-oil", name: "Pétrole (WTI)",   symbol: "WTI/USD", tdSymbol: "WTI/USD", category: "COMMODITIES" },
];

const TWELVE_FOREX: TwelveAssetConfig[] = [
  { id: "eur-usd", name: "Euro / Dollar", symbol: "EUR/USD", tdSymbol: "EUR/USD", category: "FOREX" },
  { id: "gbp-usd", name: "Livre / Dollar", symbol: "GBP/USD", tdSymbol: "GBP/USD", category: "FOREX" },
  { id: "usd-jpy", name: "Dollar / Yen", symbol: "USD/JPY", tdSymbol: "USD/JPY", category: "FOREX" },
  { id: "usd-chf", name: "Dollar / Franc", symbol: "USD/CHF", tdSymbol: "USD/CHF", category: "FOREX" },
];

async function fetchTwelveDataAssets(
  configs: TwelveAssetConfig[],
  apiKey: string,
  sentiment: (id: string) => number,
): Promise<Asset[]> {
  if (!apiKey) return [];

  const results = await Promise.allSettled(
    configs.map(async (cfg) => {
      const url = `https://api.twelvedata.com/time_series?symbol=${cfg.tdSymbol}&interval=1h&outputsize=48&apikey=${apiKey}`;
      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) return null;
      const data = (await res.json()) as TwelveDataResponse;
      if (!data.values?.length) return null;

      // Build sparkline (oldest first)
      const sparkline = data.values
        .map((v) => parseFloat(v.close) || 0)
        .filter((v) => v > 0)
        .reverse();

      if (sparkline.length < 2) return null;

      const price = sparkline[sparkline.length - 1];
      const price1h = sparkline[sparkline.length - 2] ?? price;
      const price24h = sparkline.length >= 24 ? sparkline[sparkline.length - 24] : sparkline[0];

      const change1h = ((price - price1h) / price1h) * 100;
      const change24h = ((price - price24h) / price24h) * 100;
      const change7d = ((price - sparkline[0]) / sparkline[0]) * 100;

      const rsi = calculateRSI(sparkline);
      const aiScore = computeAIScore(change24h, change7d, rsi, cfg.category, sentiment(cfg.id));

      return {
        id: cfg.id,
        name: cfg.name,
        symbol: cfg.symbol,
        category: cfg.category,
        price,
        change1h,
        change24h,
        change7d,
        marketCap: 0,
        volume: 0,
        sparkline,
        aiScore,
        aiDirection: getDirection(aiScore),
      } satisfies Asset;
    })
  );

  const assets: Asset[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) assets.push(r.value);
  }
  return assets;
}

// fetchCommodities: Gold (CoinGecko PAXG) + Silver/Oil (Twelve Data) + fallback statique
export async function fetchCommodities(
  apiKey: string,
  sentiment: (id: string) => number,
): Promise<Asset[]> {
  const [goldResult, tdResult] = await Promise.allSettled([
    fetchGold(sentiment),
    fetchTwelveDataAssets(TWELVE_COMMODITIES, apiKey, sentiment),
  ]);
  const gold = goldResult.status === "fulfilled" ? goldResult.value : [];
  const td   = tdResult.status === "fulfilled"   ? tdResult.value   : [];
  const assets = [...gold, ...td];

  // Fallback statique si tout fail — utilise dernier cours connu (snapshot statique)
  if (assets.length === 0) {
    const fallbackAssets: Asset[] = [
      {
        id: "paxos-gold",
        name: "Or (Gold)",
        symbol: "XAU/USD",
        category: "COMMODITIES",
        price: 2380,
        change1h: 0.15,
        change24h: 0.35,
        change7d: 1.2,
        marketCap: 0,
        volume: 0,
        sparkline: Array(7).fill(2380).map((p, i) => p + (Math.random() - 0.5) * 20),
        aiScore: 52,
        aiDirection: "UP" as const,
      },
      {
        id: "silver",
        name: "Argent (Silver)",
        symbol: "XAG/USD",
        category: "COMMODITIES",
        price: 28.5,
        change1h: 0.2,
        change24h: 0.4,
        change7d: 1.5,
        marketCap: 0,
        volume: 0,
        sparkline: Array(7).fill(28.5).map((p, i) => p + (Math.random() - 0.5) * 0.5),
        aiScore: 51,
        aiDirection: "UP" as const,
      },
    ];
    return fallbackAssets;
  }

  return assets;
}

export async function fetchTwelveForex(
  apiKey: string,
  sentiment: (id: string) => number,
): Promise<Asset[]> {
  // Try Twelve Data first; fall back to free Frankfurter if empty or no key
  const tdResult = await fetchTwelveDataAssets(TWELVE_FOREX, apiKey, sentiment);
  if (tdResult.length > 0) return tdResult;
  return fetchForex(sentiment);
}

// ============================================================
// MULTI-TIMEFRAME (4H candles for confirmation)
// ============================================================

export async function fetchMultiTimeframe(
  symbols: string[],
  apiKey: string,
): Promise<Record<string, number[]>> {
  if (!apiKey || symbols.length === 0) return {};

  const results: Record<string, number[]> = {};

  // Limit to 4 symbols to conserve API quota
  const limited = symbols.slice(0, 4);

  const fetches = await Promise.allSettled(
    limited.map(async (symbol) => {
      const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=4h&outputsize=30&apikey=${apiKey}`;
      const res = await fetch(url, { next: { revalidate: 600 } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.values?.length) return null;
      const sparkline = data.values
        .map((v: { close: string }) => parseFloat(v.close) || 0)
        .filter((v: number) => v > 0)
        .reverse();
      return { symbol, sparkline };
    })
  );

  for (const r of fetches) {
    if (r.status === "fulfilled" && r.value) {
      results[r.value.symbol] = r.value.sparkline;
    }
  }

  return results;
}

// ============================================================
// BYBIT FUNDING RATES (free, no API key — all linear perps in one call)
// ============================================================

export async function fetchFundingRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      result?: { list?: Array<{ symbol: string; fundingRate: string }> };
    };
    const map: Record<string, number> = {};
    for (const item of data.result?.list ?? []) {
      if (item.symbol?.endsWith("USDT")) {
        const base = item.symbol.replace("USDT", "");
        map[base] = parseFloat(item.fundingRate) || 0;
      }
    }
    return map;
  } catch {
    return {};
  }
}

// ============================================================
// BYBIT LONG/SHORT RATIO (free, no API key)
// ============================================================

const LS_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export async function fetchLongShortRatios(): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    LS_SYMBOLS.map(async (sym) => {
      const res = await fetch(
        `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=1h&limit=1`,
        { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        result?: { list?: Array<{ buyRatio: string; sellRatio: string }> };
      };
      const item = data.result?.list?.[0];
      if (!item) return null;
      const buy = parseFloat(item.buyRatio) || 0.5;
      const sell = parseFloat(item.sellRatio) || 0.5;
      return { key: sym.replace("USDT", ""), ratio: sell > 0 ? buy / sell : 1 };
    }),
  );
  const map: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) map[r.value.key] = r.value.ratio;
  }
  return map;
}

// ============================================================
// BYBIT LIQUIDATION BIAS (Coinglass-equivalent, free)
// Buy-side liq = short positions forced to cover → bullish pressure
// Sell-side liq = long positions forced to close → bearish pressure
// ============================================================

const LIQ_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];

export async function fetchLiquidationBias(): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    LIQ_SYMBOLS.map(async (sym) => {
      const res = await fetch(
        `https://api.bybit.com/v5/market/liquidation?category=linear&symbol=${sym}&limit=200`,
        { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        result?: { list?: Array<{ side: string; size: string }> };
      };
      const list = data.result?.list ?? [];
      let buyLiq = 0;
      let sellLiq = 0;
      for (const item of list) {
        const size = parseFloat(item.size) || 0;
        if (item.side === "Buy") buyLiq += size;
        else sellLiq += size;
      }
      const total = buyLiq + sellLiq;
      if (total === 0) return null;
      return { key: sym.replace("USDT", ""), bias: (buyLiq - sellLiq) / total };
    }),
  );
  const map: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) map[r.value.key] = r.value.bias;
  }
  return map;
}

// ============================================================
// CRYPTOPANIC NEWS SENTIMENT (free with API key)
// ============================================================

const CP_CURRENCIES = "BTC,ETH,SOL,XRP,DOGE,ADA,DOT,AVAX,LINK,MATIC,UNI,LTC,XLM,NEAR,SUI";

export async function fetchCryptoPanic(apiKey: string): Promise<Record<string, number>> {
  if (!apiKey) return {};
  try {
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&currencies=${CP_CURRENCIES}&filter=hot&public=true`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      results?: Array<{
        currencies?: Array<{ code: string }>;
        votes?: { positive: number; negative: number; liked: number; disliked: number; important: number };
      }>;
    };
    const posCount: Record<string, number> = {};
    const total: Record<string, number> = {};
    for (const post of data.results ?? []) {
      const v = post.votes;
      const pos = (v?.liked ?? 0) + (v?.important ?? 0) + (v?.positive ?? 0);
      const neg = (v?.disliked ?? 0) + (v?.negative ?? 0);
      const isPositive = pos > neg;
      for (const cur of post.currencies ?? []) {
        total[cur.code] = (total[cur.code] ?? 0) + 1;
        if (isPositive) posCount[cur.code] = (posCount[cur.code] ?? 0) + 1;
      }
    }
    const map: Record<string, number> = {};
    for (const [code, tot] of Object.entries(total)) {
      map[code] = Math.round(((posCount[code] ?? 0) / tot) * 100);
    }
    return map;
  } catch {
    return {};
  }
}

// Re-export MarketSentimentData so route.ts can import from one place
export type { MarketSentimentData };

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

// Detect if a Polymarket question is bullish, bearish, or neutral
function detectMarketDirection(question: string): "BULL" | "BEAR" | "NEUTRAL" {
  const q = question.toLowerCase();
  const bearish = [
    "drop below", "fall below", "crash", "below $", "under $",
    "decline", "bear market", "correction", "dump", "sell off",
    "not reach", "fail to reach", "miss", "collapse",
  ];
  const bullish = [
    "reach", "hit $", "above $", "exceed", "over $", "break",
    "surge", "bull", "all-time high", "ath", "rally", "pump",
    "outperform", "rise above", "go above", "cross $",
  ];
  const isBear = bearish.some((p) => q.includes(p));
  const isBull = bullish.some((p) => q.includes(p));
  if (isBear && !isBull) return "BEAR";
  if (isBull && !isBear) return "BULL";
  return "NEUTRAL";
}

function parseMarket(m: PolymarketMarketRaw): {
  question: string; volume: number; liquidity: number;
  bestBid: number; bestAsk: number; direction: "BULL" | "BEAR" | "NEUTRAL";
} {
  let bestBid = m.bestBid ?? 0;
  let bestAsk = m.bestAsk ?? 0;
  if (!bestBid && !bestAsk && m.outcomePrices) {
    try {
      const prices: string[] = JSON.parse(m.outcomePrices);
      if (prices.length >= 2) {
        bestBid = parseFloat(prices[0]) || 0;
        bestAsk = parseFloat(prices[1]) || 0;
      }
    } catch { /* ignore */ }
  }
  const question = m.question ?? m.title ?? "Unknown";
  return {
    question,
    volume: Number(m.volume) || 0,
    liquidity: Number(m.liquidity) || 0,
    bestBid: Number(bestBid) || 0,
    bestAsk: Number(bestAsk) || 0,
    direction: detectMarketDirection(question),
  };
}

export async function fetchPolymarket(): Promise<
  { question: string; volume: number; liquidity: number; bestBid: number; bestAsk: number; direction: "BULL" | "BEAR" | "NEUTRAL" }[]
> {
  const BASE = "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume&ascending=false";

  // Fetch top 50 general + top 30 crypto-tagged in parallel
  const [generalRes, cryptoRes] = await Promise.allSettled([
    fetch(`${BASE}&limit=50`, { next: { revalidate: 60 } }),
    fetch(`${BASE}&limit=30&tag_slug=crypto`, { next: { revalidate: 60 } }),
  ]);

  const seen = new Set<string>();
  const merged: ReturnType<typeof parseMarket>[] = [];

  for (const result of [generalRes, cryptoRes]) {
    if (result.status !== "fulfilled" || !result.value.ok) continue;
    try {
      const raw = (await result.value.json()) as PolymarketMarketRaw[];
      for (const m of raw) {
        const parsed = parseMarket(m);
        if (!seen.has(parsed.question)) {
          seen.add(parsed.question);
          merged.push(parsed);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return merged;
}
