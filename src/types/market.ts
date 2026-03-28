export type AssetCategory = "CRYPTO" | "FOREX" | "COMMODITIES" | "STOCKS";

export type AIDirection = "UP" | "DOWN" | "NEUTRAL";

export interface TradePlan {
  direction: "LONG" | "SHORT" | "WAIT";
  strategy: string;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  stopPercent: number;
  target1Percent: number;
  target2Percent: number;
  confidence: number;
  reasons: string[];
}

export interface Indicators {
  rsi: number;
  macd: { value: number; signal: number; histogram: number; cross: "BULLISH" | "BEARISH" | "NONE" };
  bollinger: { upper: number; middle: number; lower: number; position: "ABOVE" | "INSIDE" | "BELOW" };
  smaCross: { sma50: number; sma200: number; signal: "GOLDEN" | "DEATH" | "NONE" };
  volumeProfile: { current: number; average: number; ratio: number; spike: boolean };
  atr: { value: number; percent: number };
}

export type IndicatorKey = "rsi" | "macd" | "bollinger" | "smaCross" | "volumeProfile" | "atr";

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  category: AssetCategory;
  price: number;
  change1h: number;
  change24h: number;
  change7d: number;
  marketCap: number;
  volume: number;
  sparkline: number[];
  aiScore: number;
  aiDirection: AIDirection;
  indicators?: Indicators;
  tradePlan?: TradePlan;
}

export interface PolymarketEntry {
  question: string;
  volume: number;
  liquidity: number;
  bestBid: number;
  bestAsk: number;
  correlatedAssets: string[];
}

export interface Signal {
  asset: string;
  type: string;
  message: string;
  severity: "high" | "medium" | "low";
}

export interface MarketData {
  assets: Asset[];
  polymarket: PolymarketEntry[];
  signals: Signal[];
  lastUpdated: string;
}
