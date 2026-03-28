export type AssetCategory = "CRYPTO" | "FOREX" | "COMMODITIES";

export type AIDirection = "UP" | "DOWN" | "NEUTRAL";

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
