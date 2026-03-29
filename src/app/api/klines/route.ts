import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Crypto symbol maps ───────────────────────────────────────
const CRYPTO_USDT: Record<string, string> = {
  bitcoin: "BTC-USDT", ethereum: "ETH-USDT", solana: "SOL-USDT",
  ripple: "XRP-USDT", dogecoin: "DOGE-USDT", cardano: "ADA-USDT",
  polkadot: "DOT-USDT", "avalanche-2": "AVAX-USDT", chainlink: "LINK-USDT",
  polygon: "MATIC-USDT", uniswap: "UNI-USDT", litecoin: "LTC-USDT",
  stellar: "XLM-USDT", near: "NEAR-USDT", sui: "SUI-USDT",
};

// ─── TwelveData symbol map ────────────────────────────────────
const TWELVE: Record<string, string> = {
  "eur-usd": "EUR/USD", "gbp-usd": "GBP/USD",
  "usd-jpy": "USD/JPY", "usd-chf": "USD/CHF",
  "xau-usd": "XAU/USD", "xag-usd": "XAG/USD",
  "wti-oil": "WTI/USD", "nat-gas": "NATGAS/USD",
  aapl: "AAPL", msft: "MSFT", nvda: "NVDA",
  tsla: "TSLA", googl: "GOOGL", amzn: "AMZN", meta: "META",
};

// ─── Interval maps ────────────────────────────────────────────
// OKX: 1m 3m 5m 15m 30m 1H 2H 4H 6H 12H 1D
const OKX_INTERVAL: Record<string, string> = {
  "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "4h": "4H", "1d": "1D",
};
// Bybit spot: 1 3 5 15 30 60 120 240 360 720 D W M
const BYBIT_INTERVAL: Record<string, string> = {
  "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "4h": "240", "1d": "D",
};
// Binance
const BINANCE_INTERVAL: Record<string, string> = {
  "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};
// CoinGecko OHLC days (free tier granularity)
const COINGECKO_DAYS: Record<string, number> = {
  "5m": 1, "15m": 1, "30m": 1,
  "1h": 7, "4h": 14, "1d": 90,
};
// TwelveData
const TWELVE_INTERVAL: Record<string, string> = {
  "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "1h", "4h": "4h", "1d": "1day",
};

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; NexusMarket/1.0)",
  "Accept": "application/json",
};

// ─── OKX (primary for crypto) ────────────────────────────────
async function fetchOKX(symbol: string, interval: string): Promise<Candle[]> {
  const sym = CRYPTO_USDT[symbol];
  if (!sym) throw new Error("Unknown symbol");
  const bar = OKX_INTERVAL[interval] ?? "1H";

  const url = `https://www.okx.com/api/v5/market/candles?instId=${sym}&bar=${bar}&limit=120`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`OKX ${res.status}`);

  interface OKXResp { code: string; data: string[][] }
  const data = await res.json() as OKXResp;
  if (data.code !== "0") throw new Error(`OKX code ${data.code}`);

  // Newest-first → reverse; format: [ts, o, h, l, c, vol, ...]
  return data.data.reverse().map(([t, o, h, l, c, v]) => ({
    time: parseInt(t),
    open: parseFloat(o),
    high: parseFloat(h),
    low: parseFloat(l),
    close: parseFloat(c),
    volume: parseFloat(v),
  }));
}

// ─── Bybit (fallback 1) ───────────────────────────────────────
async function fetchBybit(symbol: string, interval: string): Promise<Candle[]> {
  const sym = CRYPTO_USDT[symbol]?.replace("-", ""); // BTC-USDT → BTCUSDT
  if (!sym) throw new Error("Unknown symbol");
  const int = BYBIT_INTERVAL[interval] ?? "60";

  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${int}&limit=120`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Bybit ${res.status}`);

  interface BybitResp { retCode: number; result: { list: string[][] } }
  const data = await res.json() as BybitResp;
  if (data.retCode !== 0) throw new Error(`Bybit retCode ${data.retCode}`);

  return data.result.list.reverse().map(([t, o, h, l, c, v]) => ({
    time: parseInt(t),
    open: parseFloat(o),
    high: parseFloat(h),
    low: parseFloat(l),
    close: parseFloat(c),
    volume: parseFloat(v),
  }));
}

// ─── Binance (fallback 2) ─────────────────────────────────────
async function fetchBinance(symbol: string, interval: string): Promise<Candle[]> {
  const sym = CRYPTO_USDT[symbol]?.replace("-", ""); // BTC-USDT → BTCUSDT
  if (!sym) throw new Error("Unknown symbol");
  const int = BINANCE_INTERVAL[interval] ?? "1h";

  const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${int}&limit=120`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Binance ${res.status}`);

  const raw = (await res.json()) as [number, string, string, string, string, string][];
  return raw.map(([t, o, h, l, c, v]) => ({
    time: t,
    open: parseFloat(o),
    high: parseFloat(h),
    low: parseFloat(l),
    close: parseFloat(c),
    volume: parseFloat(v),
  }));
}

// ─── CoinGecko OHLC (fallback 3 — always works) ──────────────
async function fetchCoinGecko(symbol: string, interval: string): Promise<Candle[]> {
  const days = COINGECKO_DAYS[interval] ?? 7;
  const url = `https://api.coingecko.com/api/v3/coins/${symbol}/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

  const raw = await res.json() as [number, number, number, number, number][];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("No CoinGecko data");

  return raw.map(([t, o, h, l, c]) => ({
    time: t,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 0,
  }));
}

// ─── TwelveData ───────────────────────────────────────────────
async function fetchTwelve(symbol: string, interval: string): Promise<Candle[]> {
  const tdSym = TWELVE[symbol];
  const tdInt = TWELVE_INTERVAL[interval] ?? "1h";
  const key = process.env.TWELVE_DATA_API_KEY ?? "";
  if (!tdSym || !key) throw new Error("Unknown symbol or no API key");

  const url = `https://api.twelvedata.com/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=120&apikey=${key}&format=JSON`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`TwelveData ${res.status}`);

  interface TDBar { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
  const data = await res.json() as { values?: TDBar[]; message?: string };
  if (!data.values) throw new Error(data.message ?? "No TwelveData response");

  return data.values.reverse().map((b) => ({
    time: new Date(b.datetime).getTime(),
    open: parseFloat(b.open),
    high: parseFloat(b.high),
    low: parseFloat(b.low),
    close: parseFloat(b.close),
    volume: parseFloat(b.volume ?? "0"),
  }));
}

// ─── Route ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol") ?? "";
  const interval = searchParams.get("interval") ?? "1h";
  const category = searchParams.get("category") ?? "CRYPTO";

  try {
    let candles: Candle[];

    if (category === "CRYPTO") {
      // Try OKX → Bybit → Binance → CoinGecko
      const sources = [fetchOKX, fetchBybit, fetchBinance, fetchCoinGecko];
      let lastErr = new Error("No source available");
      let success = false;
      candles = [];

      for (const source of sources) {
        try {
          candles = await source(symbol, interval);
          success = true;
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
        }
      }

      if (!success) throw lastErr;
    } else {
      candles = await fetchTwelve(symbol, interval);
    }

    return NextResponse.json({ candles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown", candles: [] },
      { status: 500 }
    );
  }
}
