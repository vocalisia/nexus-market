"use client";
import { useEffect, useRef, useCallback, useState } from "react";

// Binance symbol mapping: CoinGecko id → Binance symbol
// PAXG = Paxos Gold, 1:1 with troy oz gold — real-time gold price
const SYMBOL_MAP: Record<string, string> = {
  bitcoin:       "btcusdt",
  ethereum:      "ethusdt",
  solana:        "solusdt",
  ripple:        "xrpusdt",
  dogecoin:      "dogeusdt",
  cardano:       "adausdt",
  polkadot:      "dotusdt",
  "avalanche-2": "avaxusdt",
  chainlink:     "linkusdt",
  polygon:       "maticusdt",
  uniswap:       "uniusdt",
  litecoin:      "ltcusdt",
  stellar:       "xlmusdt",
  near:          "nearusdt",
  sui:           "suiusdt",
  "paxos-gold":  "paxgusdt",  // Gold real-time via PAXG token
};

export interface LivePrice {
  price: number;
  prevPrice: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export function useBinanceWs(assetIds: string[]): Record<string, LivePrice> {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    // Build stream list for all crypto assets
    const streams = assetIds
      .map((id) => SYMBOL_MAP[id])
      .filter(Boolean)
      .map((s) => `${s}@ticker`);

    if (streams.length === 0) return;

    const url = `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg.data) return;

          const d = msg.data;
          // d.s = symbol (e.g. "BTCUSDT"), d.c = current price, d.P = 24h change%, d.v = volume
          const symbol = (d.s as string)?.toLowerCase();
          if (!symbol) return;

          // Find the CoinGecko id for this symbol
          const assetId = Object.entries(SYMBOL_MAP).find(([, v]) => v === symbol)?.[0];
          if (!assetId) return;

          const newPrice = parseFloat(d.c) || 0;
          const change24h = parseFloat(d.P) || 0;
          const volume24h = parseFloat(d.v) || 0;
          const high24h = parseFloat(d.h) || 0;
          const low24h = parseFloat(d.l) || 0;

          setPrices((prev) => ({
            ...prev,
            [assetId]: {
              price: newPrice,
              prevPrice: prev[assetId]?.price ?? newPrice,
              change24h,
              volume24h,
              high24h,
              low24h,
              timestamp: Date.now(),
            },
          }));
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        // Reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available (SSR or blocked)
      reconnectTimer.current = setTimeout(connect, 5000);
    }
  }, [assetIds]);

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connect]);

  return prices;
}
