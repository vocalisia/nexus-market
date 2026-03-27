"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CryptoAsset {
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
}

interface Signal {
  asset: string;
  type: string;
  message: string;
  severity: "high" | "medium" | "low";
}

interface PolymarketData {
  question: string;
  volume: number;
  liquidity: number;
  bestBid: number;
  bestAsk: number;
}

interface MarketData {
  crypto: CryptoAsset[];
  polymarket: PolymarketData[];
  signals: Signal[];
  lastUpdated: string;
}

type FilterCategory = "ALL" | "CRYPTO" | "FOREX" | "STOCKS" | "COMMODITIES";

function formatPrice(price: number): string {
  if (price >= 1000) {
    return (
      "$" +
      price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  } else if (price >= 1) {
    return "$" + price.toFixed(4);
  } else {
    return "$" + price.toFixed(6);
  }
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000)
    return "$" + (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return "$" + (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return "$" + (value / 1_000).toFixed(2) + "K";
  return "$" + value.toFixed(2);
}

function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return sign + change.toFixed(2) + "%";
}

function getScoreColor(score: number): string {
  if (score > 55) return "#00c087";
  if (score < 45) return "#f6465d";
  return "#f0b90b";
}

function getScoreArrow(direction: "UP" | "DOWN" | "NEUTRAL"): string {
  if (direction === "UP") return "↑";
  if (direction === "DOWN") return "↓";
  return "→";
}

function getChangeColor(change: number): string {
  return change >= 0 ? "#00c087" : "#f6465d";
}

function getSeverityIcon(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "🔴";
  if (severity === "medium") return "🟡";
  return "🟢";
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

const ACTIVE_FILTERS: FilterCategory[] = ["ALL", "CRYPTO"];
const ALL_FILTERS: FilterCategory[] = [
  "ALL",
  "CRYPTO",
  "FOREX",
  "STOCKS",
  "COMMODITIES",
];

export default function PredictionDashboard() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterCategory>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MarketData = await res.json();
      setMarketData(data);
      setError(null);
      setSelectedAssetId((prev) => {
        if (!prev && data.crypto && data.crypto.length > 0) {
          return data.crypto[0].id;
        }
        return prev;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const selectedAsset =
    marketData?.crypto?.find((a) => a.id === selectedAssetId) ??
    marketData?.crypto?.[0] ??
    null;

  const sparklineData =
    selectedAsset?.sparkline?.map((value, index) => ({ index, value })) ?? [];

  const isUptrend = selectedAsset ? selectedAsset.change7d >= 0 : true;
  const gradientId = isUptrend ? "greenGradient" : "redGradient";
  const strokeColor = isUptrend ? "#00c087" : "#f6465d";

  return (
    <div
      style={{ backgroundColor: "#0a0e17", minHeight: "100vh", fontFamily: "monospace" }}
      className="text-white"
    >
      {/* TOP BAR */}
      <div
        style={{ backgroundColor: "#111827", borderBottom: "1px solid #2d3548" }}
        className="flex items-center justify-between px-6 py-3 flex-wrap gap-3"
      >
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧠</span>
          <span
            style={{ color: "#00c087", letterSpacing: "0.15em" }}
            className="text-xl font-bold"
          >
            AI PREDICT
          </span>
        </div>

        {/* Live indicator + timestamp */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: "#00c087",
                boxShadow: "0 0 6px #00c087",
                animation: "livePulse 2s infinite",
              }}
            />
            <span
              style={{ color: "#00c087", fontSize: 13, letterSpacing: "0.1em" }}
            >
              LIVE
            </span>
          </div>
          {marketData?.lastUpdated && (
            <span style={{ color: "#4b5563", fontSize: 12 }}>
              MAJ: {formatTimestamp(marketData.lastUpdated)}
            </span>
          )}
        </div>

        {/* Category filters */}
        <div className="flex items-center gap-1">
          {ALL_FILTERS.map((cat) => {
            const isActive = ACTIVE_FILTERS.includes(cat);
            const isSelected = filter === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  if (isActive) setFilter(cat);
                }}
                style={{
                  backgroundColor: isSelected ? "#00c087" : "transparent",
                  color: isSelected
                    ? "#0a0e17"
                    : isActive
                    ? "#9ca3af"
                    : "#374151",
                  border: `1px solid ${
                    isSelected ? "#00c087" : isActive ? "#2d3548" : "#1f2937"
                  }`,
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 4,
                  cursor: isActive ? "pointer" : "not-allowed",
                  fontFamily: "monospace",
                  fontWeight: isSelected ? 700 : 400,
                  letterSpacing: "0.05em",
                  transition: "all 0.2s",
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div
            style={{ color: "#00c087", fontSize: 14, letterSpacing: "0.1em" }}
          >
            CHARGEMENT DES DONNEES...
          </div>
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div className="flex items-center justify-center py-6">
          <div
            style={{
              backgroundColor: "#1a0a0f",
              border: "1px solid #f6465d",
              color: "#f6465d",
              fontSize: 13,
              padding: "10px 20px",
              borderRadius: 6,
            }}
          >
            ERREUR: {error}
          </div>
        </div>
      )}

      {!loading && marketData && (
        <div className="px-4 py-4 space-y-4">
          {/* ASSET CARDS ROW */}
          <div
            style={{ overflowX: "auto", paddingBottom: 6 }}
            className="flex gap-3"
          >
            {marketData.crypto.map((asset) => {
              const isSelected = asset.id === selectedAssetId;
              const scoreColor = getScoreColor(asset.aiScore);
              return (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  style={{
                    minWidth: 172,
                    backgroundColor: isSelected ? "#1e2a3a" : "#1a1f2e",
                    border: `1px solid ${isSelected ? "#00c087" : "#2d3548"}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    textAlign: "left",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.2s",
                    boxShadow: isSelected
                      ? "0 0 12px rgba(0,192,135,0.15)"
                      : "none",
                  }}
                >
                  {/* Symbol + Name */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      style={{
                        color: "#e5e7eb",
                        fontWeight: 700,
                        fontSize: 15,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {asset.symbol}
                    </span>
                    <span style={{ color: "#4b5563", fontSize: 10 }}>
                      {asset.name}
                    </span>
                  </div>

                  {/* Price */}
                  <div
                    style={{
                      color: "#f9fafb",
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    {formatPrice(asset.price)}
                  </div>

                  {/* 24h change */}
                  <div
                    style={{
                      color: getChangeColor(asset.change24h),
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    {formatChange(asset.change24h)} 24h
                  </div>

                  {/* AI Score badge */}
                  <div
                    style={{
                      backgroundColor: "#0a0e17",
                      border: `1px solid ${scoreColor}`,
                      borderRadius: 4,
                      padding: "3px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        color: scoreColor,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      IA: {asset.aiScore}%{" "}
                      {getScoreArrow(asset.aiDirection)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* MAIN CHART AREA */}
          {selectedAsset && (
            <div
              style={{
                backgroundColor: "#1a1f2e",
                border: "1px solid #2d3548",
                borderRadius: 8,
                padding: "20px 24px",
              }}
            >
              {/* Chart header */}
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <span
                    style={{
                      color: "#f9fafb",
                      fontSize: 18,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {selectedAsset.symbol} &mdash; 7D
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>
                    {selectedAsset.name}
                  </span>
                </div>

                <div className="flex items-center gap-6 flex-wrap">
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>PRIX</div>
                    <div
                      style={{
                        color: "#f9fafb",
                        fontSize: 16,
                        fontWeight: 700,
                      }}
                    >
                      {formatPrice(selectedAsset.price)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>7J</div>
                    <div
                      style={{
                        color: getChangeColor(selectedAsset.change7d),
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      {formatChange(selectedAsset.change7d)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>VOLUME</div>
                    <div style={{ color: "#9ca3af", fontSize: 13 }}>
                      {formatVolume(selectedAsset.volume)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>
                      CAP. MARCHE
                    </div>
                    <div style={{ color: "#9ca3af", fontSize: 13 }}>
                      {formatVolume(selectedAsset.marketCap)}
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: "#0a0e17",
                      border: `1px solid ${getScoreColor(selectedAsset.aiScore)}`,
                      borderRadius: 6,
                      padding: "6px 14px",
                    }}
                  >
                    <div style={{ color: "#4b5563", fontSize: 10 }}>
                      SCORE IA
                    </div>
                    <div
                      style={{
                        color: getScoreColor(selectedAsset.aiScore),
                        fontSize: 18,
                        fontWeight: 700,
                      }}
                    >
                      {selectedAsset.aiScore}%{" "}
                      {getScoreArrow(selectedAsset.aiDirection)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recharts AreaChart */}
              {sparklineData.length > 0 ? (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sparklineData}
                      margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                    >
                      <defs>
                        <linearGradient
                          id="greenGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="rgba(0,192,135,0.3)"
                          />
                          <stop
                            offset="100%"
                            stopColor="rgba(0,0,0,0)"
                          />
                        </linearGradient>
                        <linearGradient
                          id="redGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="rgba(246,70,93,0.3)"
                          />
                          <stop
                            offset="100%"
                            stopColor="rgba(0,0,0,0)"
                          />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="index" hide />
                      <YAxis
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => formatPrice(v)}
                        tick={{
                          fill: "#4b5563",
                          fontSize: 10,
                          fontFamily: "monospace",
                        }}
                        axisLine={false}
                        tickLine={false}
                        width={88}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#111827",
                          border: "1px solid #2d3548",
                          borderRadius: 6,
                          fontFamily: "monospace",
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#4b5563" }}
                        itemStyle={{ color: strokeColor }}
                        formatter={(value: unknown) => [
                          formatPrice(Number(value ?? 0)),
                          "Prix",
                        ]}
                        labelFormatter={(label: unknown) => `Jour ${Number(label) + 1}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={strokeColor}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{
                          r: 4,
                          fill: strokeColor,
                          stroke: "#0a0e17",
                          strokeWidth: 2,
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  style={{
                    height: 220,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#374151",
                    fontSize: 13,
                  }}
                >
                  Donnees sparkline non disponibles
                </div>
              )}
            </div>
          )}

          {/* BOTTOM SECTION: two columns */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* LEFT: SIGNAUX IA */}
            <div
              style={{
                backgroundColor: "#1a1f2e",
                border: "1px solid #2d3548",
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span
                  style={{
                    color: "#00c087",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                  }}
                >
                  ▶ SIGNAUX IA
                </span>
                <span
                  style={{
                    backgroundColor: "#00c087",
                    color: "#0a0e17",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 10,
                  }}
                >
                  {marketData.signals.length}
                </span>
              </div>

              <div className="space-y-3">
                {marketData.signals.length === 0 ? (
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 13,
                      textAlign: "center",
                      padding: "20px 0",
                    }}
                  >
                    Aucun signal actif
                  </div>
                ) : (
                  marketData.signals.map((signal, i) => (
                    <div
                      key={i}
                      style={{
                        backgroundColor: "#0a0e17",
                        border: "1px solid #2d3548",
                        borderRadius: 6,
                        padding: "10px 14px",
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      >
                        {getSeverityIcon(signal.severity)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span
                            style={{
                              color: "#e5e7eb",
                              fontWeight: 700,
                              fontSize: 13,
                            }}
                          >
                            {signal.asset}
                          </span>
                          <span
                            style={{
                              color: "#4b5563",
                              fontSize: 10,
                              backgroundColor: "#111827",
                              padding: "1px 6px",
                              borderRadius: 4,
                              flexShrink: 0,
                            }}
                          >
                            {signal.type}
                          </span>
                        </div>
                        <div
                          style={{
                            color: "#9ca3af",
                            fontSize: 12,
                            lineHeight: 1.5,
                          }}
                        >
                          {signal.message}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* RIGHT: POLYMARKET SENTIMENT */}
            <div
              style={{
                backgroundColor: "#1a1f2e",
                border: "1px solid #2d3548",
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <span
                  style={{
                    color: "#f0b90b",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                  }}
                >
                  ▶ POLYMARKET SENTIMENT
                </span>
                <span
                  style={{
                    backgroundColor: "#f0b90b",
                    color: "#0a0e17",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 10,
                  }}
                >
                  {marketData.polymarket.length}
                </span>
              </div>

              <div className="space-y-3">
                {marketData.polymarket.length === 0 ? (
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 13,
                      textAlign: "center",
                      padding: "20px 0",
                    }}
                  >
                    Aucune donnee Polymarket
                  </div>
                ) : (
                  marketData.polymarket.map((market, i) => {
                    const yesPercent =
                      market.bestBid > 0
                        ? Math.round(market.bestBid * 100)
                        : 50;
                    return (
                      <div
                        key={i}
                        style={{
                          backgroundColor: "#0a0e17",
                          border: "1px solid #2d3548",
                          borderRadius: 6,
                          padding: "12px 14px",
                        }}
                      >
                        <div
                          style={{
                            color: "#e5e7eb",
                            fontSize: 12,
                            marginBottom: 8,
                            lineHeight: 1.5,
                            fontFamily: "sans-serif",
                          }}
                        >
                          {market.question}
                        </div>

                        {/* Progress bar */}
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: "#1f2937",
                            overflow: "hidden",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${yesPercent}%`,
                              backgroundColor: "#00c087",
                              borderRadius: 3,
                              transition: "width 0.5s ease",
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div>
                              <span
                                style={{ color: "#4b5563", fontSize: 10 }}
                              >
                                OUI{" "}
                              </span>
                              <span
                                style={{
                                  color: "#00c087",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {(market.bestBid * 100).toFixed(1)}c
                              </span>
                            </div>
                            <div>
                              <span
                                style={{ color: "#4b5563", fontSize: 10 }}
                              >
                                NON{" "}
                              </span>
                              <span
                                style={{
                                  color: "#f6465d",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {(market.bestAsk * 100).toFixed(1)}c
                              </span>
                            </div>
                          </div>
                          <div style={{ color: "#4b5563", fontSize: 11 }}>
                            Vol: {formatVolume(market.volume)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* DISCLAIMER */}
          <div
            style={{
              borderTop: "1px solid #1f2937",
              paddingTop: 16,
              textAlign: "center",
            }}
          >
            <p
              style={{
                color: "#374151",
                fontSize: 11,
                letterSpacing: "0.03em",
                fontFamily: "monospace",
              }}
            >
              Ceci n&apos;est pas un conseil financier. Les predictions IA sont indicatives uniquement.
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        ::-webkit-scrollbar {
          height: 4px;
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: #1a1f2e;
        }
        ::-webkit-scrollbar-thumb {
          background: #2d3548;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}
