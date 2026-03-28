import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Binance symbol map (crypto) ─────────────────────────────
const BINANCE: Record<string, string> = {
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

// ─── Interval mapping ─────────────────────────────────────────
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

// ─── Binance fetch ────────────────────────────────────────────
async function fetchBinance(symbol: string, interval: string): Promise<Candle[]> {
  const binSym = BINANCE[symbol];
  const binInt = BINANCE_INTERVAL[interval] ?? "1h";
  if (!binSym) throw new Error("Unknown symbol");

  const url = `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${binInt}&limit=120`;
  const res = await fetch(url, { next: { revalidate: 30 } });
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
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`TwelveData ${res.status}`);

  interface TDBar { datetime: string; open: string; high: string; low: string; close: string; volume?: string }
  const data = await res.json() as { values?: TDBar[] };
  if (!data.values) throw new Error("No data from TwelveData");

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
      candles = await fetchBinance(symbol, interval);
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
