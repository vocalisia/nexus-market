"use client";

import { useState, useEffect, useCallback } from "react";

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
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return "$" + price.toFixed(4);
  }
  return "$" + price.toFixed(6);
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return "$" + (value / 1_000_000_000).toFixed(2) + "B";
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
  if (direction === "UP") return "\u2191";
  if (direction === "DOWN") return "\u2193";
  return "\u2192";
}

function getChangeColor(change: number): string {
  return change >= 0 ? "#00c087" : "#f6465d";
}

function getSeverityIcon(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "\uD83D\uDD34";
  if (severity === "medium") return "\uD83D\uDFE1";
  return "\uD83D\uDFE2";
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function SparklineChart({ data, width, height, color }: { data: number[]; width: number; height: number; color: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * chartW;
    const y = padding + chartH - ((v - min) / range) * chartH;
    return `${x},${y}`;
  });

  const areaPoints = [...points, `${padding + chartW},${padding + chartH}`, `${padding},${padding + chartH}`];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={areaPoints.join(" ")} fill={`url(#grad-${color.replace("#", "")})`} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const sampled = data.filter((_, i) => i % 4 === 0);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const points = sampled.map((v, i) => {
    const x = (i / (sampled.length - 1)) * 60;
    const y = 20 - ((v - min) / range) * 18;
    return `${x},${y}`;
  });
  return (
    <svg width={60} height={22} viewBox="0 0 60 22">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

const ACTIVE_FILTERS: FilterCategory[] = ["ALL", "CRYPTO"];
const ALL_FILTERS: FilterCategory[] = ["ALL", "CRYPTO", "FOREX", "STOCKS", "COMMODITIES"];

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
        if (!prev && data.crypto?.length > 0) return data.crypto[0].id;
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

  const selectedAsset = marketData?.crypto?.find((a) => a.id === selectedAssetId) ?? marketData?.crypto?.[0] ?? null;
  const isUptrend = selectedAsset ? selectedAsset.change7d >= 0 : true;
  const strokeColor = isUptrend ? "#00c087" : "#f6465d";

  return (
    <div style={{ backgroundColor: "#0a0e17", minHeight: "100vh", fontFamily: "monospace" }} className="text-white">
      {/* TOP BAR */}
      <div style={{ backgroundColor: "#111827", borderBottom: "1px solid #2d3548" }} className="flex items-center justify-between px-6 py-3 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{"\uD83E\uDDE0"}</span>
          <span style={{ color: "#00c087", letterSpacing: "0.15em" }} className="text-xl font-bold">AI PREDICT</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", backgroundColor: "#00c087", boxShadow: "0 0 6px #00c087", animation: "livePulse 2s infinite" }} />
            <span style={{ color: "#00c087", fontSize: 13, letterSpacing: "0.1em" }}>LIVE</span>
          </div>
          {marketData?.lastUpdated && (
            <span style={{ color: "#4b5563", fontSize: 12 }}>MAJ: {formatTimestamp(marketData.lastUpdated)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {ALL_FILTERS.map((cat) => {
            const isActive = ACTIVE_FILTERS.includes(cat);
            const isSelected = filter === cat;
            return (
              <button key={cat} onClick={() => { if (isActive) setFilter(cat); }}
                style={{
                  backgroundColor: isSelected ? "#00c087" : "transparent",
                  color: isSelected ? "#0a0e17" : isActive ? "#9ca3af" : "#374151",
                  border: `1px solid ${isSelected ? "#00c087" : isActive ? "#2d3548" : "#1f2937"}`,
                  fontSize: 11, padding: "4px 10px", borderRadius: 4,
                  cursor: isActive ? "pointer" : "not-allowed",
                  fontFamily: "monospace", fontWeight: isSelected ? 700 : 400,
                  letterSpacing: "0.05em", transition: "all 0.2s",
                }}
              >{cat}</button>
            );
          })}
        </div>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div style={{ color: "#00c087", fontSize: 14, letterSpacing: "0.1em" }}>CHARGEMENT DES DONNEES...</div>
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div className="flex items-center justify-center py-6">
          <div style={{ backgroundColor: "#1a0a0f", border: "1px solid #f6465d", color: "#f6465d", fontSize: 13, padding: "10px 20px", borderRadius: 6 }}>
            ERREUR: {error}
          </div>
        </div>
      )}

      {!loading && marketData && (
        <div className="px-4 py-4 space-y-4">
          {/* ASSET CARDS ROW */}
          <div style={{ overflowX: "auto", paddingBottom: 6 }} className="flex gap-3">
            {marketData.crypto.map((asset) => {
              const isSelected = asset.id === selectedAssetId;
              const scoreColor = getScoreColor(asset.aiScore);
              const changeColor = getChangeColor(asset.change24h);
              return (
                <button key={asset.id} onClick={() => setSelectedAssetId(asset.id)}
                  style={{
                    minWidth: 180, backgroundColor: isSelected ? "#1e2a3a" : "#1a1f2e",
                    border: `1px solid ${isSelected ? "#00c087" : "#2d3548"}`,
                    borderRadius: 8, padding: "12px 14px", textAlign: "left", cursor: "pointer",
                    flexShrink: 0, transition: "all 0.2s",
                    boxShadow: isSelected ? "0 0 12px rgba(0,192,135,0.15)" : "none",
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ color: "#e5e7eb", fontWeight: 700, fontSize: 15, letterSpacing: "0.05em", textTransform: "uppercase" }}>{asset.symbol}</span>
                    <MiniSparkline data={asset.sparkline} color={changeColor} />
                  </div>
                  <div style={{ color: "#f9fafb", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{formatPrice(asset.price)}</div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: changeColor, fontSize: 12 }}>{formatChange(asset.change24h)}</span>
                    <span style={{ color: scoreColor, fontSize: 11, fontWeight: 700, border: `1px solid ${scoreColor}`, borderRadius: 4, padding: "2px 6px" }}>
                      IA: {asset.aiScore}% {getScoreArrow(asset.aiDirection)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* MAIN CHART AREA */}
          {selectedAsset && (
            <div style={{ backgroundColor: "#1a1f2e", border: "1px solid #2d3548", borderRadius: 8, padding: "20px 24px" }}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <span style={{ color: "#f9fafb", fontSize: 18, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{selectedAsset.symbol} &mdash; 7D</span>
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>{selectedAsset.name}</span>
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>PRIX</div>
                    <div style={{ color: "#f9fafb", fontSize: 16, fontWeight: 700 }}>{formatPrice(selectedAsset.price)}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>7J</div>
                    <div style={{ color: getChangeColor(selectedAsset.change7d), fontSize: 14, fontWeight: 600 }}>{formatChange(selectedAsset.change7d)}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>VOLUME</div>
                    <div style={{ color: "#9ca3af", fontSize: 13 }}>{formatVolume(selectedAsset.volume)}</div>
                  </div>
                  <div>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>CAP. MARCHE</div>
                    <div style={{ color: "#9ca3af", fontSize: 13 }}>{formatVolume(selectedAsset.marketCap)}</div>
                  </div>
                  <div style={{ backgroundColor: "#0a0e17", border: `1px solid ${getScoreColor(selectedAsset.aiScore)}`, borderRadius: 6, padding: "6px 14px" }}>
                    <div style={{ color: "#4b5563", fontSize: 10 }}>SCORE IA</div>
                    <div style={{ color: getScoreColor(selectedAsset.aiScore), fontSize: 18, fontWeight: 700 }}>
                      {selectedAsset.aiScore}% {getScoreArrow(selectedAsset.aiDirection)}
                    </div>
                  </div>
                </div>
              </div>

              {/* SVG Chart */}
              {selectedAsset.sparkline?.length > 0 ? (
                <div style={{ width: "100%", height: 220, overflow: "hidden" }}>
                  <SparklineChart data={selectedAsset.sparkline} width={900} height={220} color={strokeColor} />
                </div>
              ) : (
                <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 13 }}>
                  Donnees sparkline non disponibles
                </div>
              )}
            </div>
          )}

          {/* BOTTOM SECTION */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* SIGNAUX IA */}
            <div style={{ backgroundColor: "#1a1f2e", border: "1px solid #2d3548", borderRadius: 8, padding: "18px 20px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ color: "#00c087", fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>{"\u25B6"} SIGNAUX IA</span>
                <span style={{ backgroundColor: "#00c087", color: "#0a0e17", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{marketData.signals.length}</span>
              </div>
              <div className="space-y-3">
                {marketData.signals.length === 0 ? (
                  <div style={{ color: "#374151", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Aucun signal actif</div>
                ) : (
                  marketData.signals.map((signal, i) => (
                    <div key={i} style={{ backgroundColor: "#0a0e17", border: "1px solid #2d3548", borderRadius: 6, padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{getSeverityIcon(signal.severity)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span style={{ color: "#e5e7eb", fontWeight: 700, fontSize: 13 }}>{signal.asset}</span>
                          <span style={{ color: "#4b5563", fontSize: 10, backgroundColor: "#111827", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>{signal.type}</span>
                        </div>
                        <div style={{ color: "#9ca3af", fontSize: 12, lineHeight: 1.5 }}>{signal.message}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* POLYMARKET SENTIMENT */}
            <div style={{ backgroundColor: "#1a1f2e", border: "1px solid #2d3548", borderRadius: 8, padding: "18px 20px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span style={{ color: "#f0b90b", fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>{"\u25B6"} POLYMARKET SENTIMENT</span>
                <span style={{ backgroundColor: "#f0b90b", color: "#0a0e17", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{marketData.polymarket.length}</span>
              </div>
              <div className="space-y-3" style={{ maxHeight: 400, overflowY: "auto" }}>
                {marketData.polymarket.length === 0 ? (
                  <div style={{ color: "#374151", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Aucune donnee Polymarket</div>
                ) : (
                  marketData.polymarket.slice(0, 8).map((market, i) => {
                    const yesPercent = market.bestBid > 0 ? Math.round(market.bestBid * 100) : 50;
                    return (
                      <div key={i} style={{ backgroundColor: "#0a0e17", border: "1px solid #2d3548", borderRadius: 6, padding: "12px 14px" }}>
                        <div style={{ color: "#e5e7eb", fontSize: 12, marginBottom: 8, lineHeight: 1.5, fontFamily: "sans-serif" }}>{market.question}</div>
                        <div style={{ height: 6, borderRadius: 3, backgroundColor: "#1f2937", overflow: "hidden", marginBottom: 8 }}>
                          <div style={{ height: "100%", width: `${yesPercent}%`, backgroundColor: "#00c087", borderRadius: 3, transition: "width 0.5s ease" }} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div>
                              <span style={{ color: "#4b5563", fontSize: 10 }}>OUI </span>
                              <span style={{ color: "#00c087", fontSize: 12, fontWeight: 700 }}>{(market.bestBid * 100).toFixed(1)}c</span>
                            </div>
                            <div>
                              <span style={{ color: "#4b5563", fontSize: 10 }}>NON </span>
                              <span style={{ color: "#f6465d", fontSize: 12, fontWeight: 700 }}>{(market.bestAsk * 100).toFixed(1)}c</span>
                            </div>
                          </div>
                          <div style={{ color: "#4b5563", fontSize: 11 }}>Vol: {formatVolume(market.volume)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* DISCLAIMER */}
          <div style={{ borderTop: "1px solid #1f2937", paddingTop: 16, textAlign: "center" }}>
            <p style={{ color: "#374151", fontSize: 11, letterSpacing: "0.03em", fontFamily: "monospace" }}>
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
        ::-webkit-scrollbar { height: 4px; width: 4px; }
        ::-webkit-scrollbar-track { background: #1a1f2e; }
        ::-webkit-scrollbar-thumb { background: #2d3548; border-radius: 2px; }
      `}</style>
    </div>
  );
}