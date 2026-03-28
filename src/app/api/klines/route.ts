import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Symbol maps ──────────────────────────────────────────────
const CRYPTO_SYM: Record<string, string> = {
  bitcoin: "BTCUSDT", ethereum: "ETHUSDT", solana: "SOLUSDT",
  ripple: "XRPUSDT", dogecoin: "DOGEUSDT", cardano: "ADAUSDT",
  polkadot: "DOTUSDT", "avalanche-2": "AVAXUSDT", chainlink: "LINKUSDT",
  polygon: "MATICUSDT", uniswap: "UNIUSDT", litecoin: "LTCUSDT",
  stellar: "XLMUSDT", near: "NEARUSDT", sui: "SUIUSDT",
};

// ─── TwelveData symbol map (forex / commodities / stocks) ────
const TWELVE: Record<string, string> = {
  "eur-usd": "EUR/USD", "gbp-usd": "GBP/USD",
  "usd-jpy": "USD/JPY", "usd-chf": "USD/CHF",
  "xau-usd": "XAU/USD", "xag-usd": "XAG/USD",
  "wti-oil": "WTI/USD", "nat-gas": "NATGAS/USD",
  aapl: "AAPL", msft: "MSFT", nvda: "NVDA",
  tsla: "TSLA", googl: "GOOGL", amzn: "AMZN", meta: "META",
};

// ─── Interval maps ────────────────────────────────────────────
const BYBIT_INTERVAL: Record<string, string> = {
  "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "4h": "240", "1d": "D",
};
const BINANCE_INTERVAL: Record<string, string> = {
  "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};
const TWELVE_INTERVAL: Record<string, string> = {
  "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "1h", "4h": "4h", "1d": "1day",
};

export interface Candle {
  time: number;  // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Bybit fetch (primary for crypto) ────────────────────────
async function fetchBybit(symbol: string, interval: string): Promise<Candle[]> {
  const sym = CRYPTO_SYM[symbol];
  const int = BYBIT_INTERVAL[interval] ?? "60";
  if (!sym) throw new Error("Unknown symbol");

  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${int}&limit=120`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit ${res.status}`);

  interface BybitResp { retCode: number; result: { list: string[][] } }
  const data = await res.json() as BybitResp;
  if (data.retCode !== 0) throw new Error(`Bybit retCode ${data.retCode}`);

  // Bybit returns newest-first → reverse for chronological order
  return data.result.list.reverse().map(([t, o, h, l, c, v]) => ({
    time: parseInt(t),
    open: parseFloat(o),
    high: parseFloat(h),
    low: parseFloat(l),
    close: parseFloat(c),
    volume: parseFloat(v),
  }));
}

// ─── Binance fetch (fallback for crypto) ─────────────────────
async function fetchBinance(symbol: string, interval: string): Promise<Candle[]> {
  const sym = CRYPTO_SYM[symbol];
  const int = BINANCE_INTERVAL[interval] ?? "1h";
  if (!sym) throw new Error("Unknown symbol");

  const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${int}&limit=120`;
  const res = await fetch(url);
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

// ─── TwelveData fetch ─────────────────────────────────────────
async function fetchTwelve(symbol: string, interval: string): Promise<Candle[]> {
  const tdSym = TWELVE[symbol];
  const tdInt = TWELVE_INTERVAL[interval] ?? "1h";
  const key = process.env.TWELVE_DATA_API_KEY ?? "";
  if (!tdSym || !key) throw new Error("Unknown symbol or no API key");

  const url = `https://api.twelvedata.com/time_series?symbol=${tdSym}&interval=${tdInt}&outputsize=120&apikey=${key}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData ${res.status}`);

  interface TDBar { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
  const data = await res.json() as { values?: TDBar[]; message?: string };
  if (!data.values) throw new Error(data.message ?? "No data from TwelveData");

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
      try {
        candles = await fetchBybit(symbol, interval);
      } catch {
        candles = await fetchBinance(symbol, interval);
      }
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
