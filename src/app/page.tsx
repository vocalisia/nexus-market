"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { computeAllIndicators, scoreIndicators, computeCombinedScore } from "@/lib/indicators";
import type { IndicatorResult } from "@/lib/indicators";
import { useBinanceWs } from "@/lib/useBinanceWs";
import { useAlerts, getFreshness, getAgeText } from "@/lib/useAlerts";
import type { Alert } from "@/lib/useAlerts";

// ─── Types ───────────────────────────────────────────────────

interface TradePlan {
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

interface Asset {
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
  category: "CRYPTO" | "FOREX" | "STOCKS" | "COMMODITIES";
  tradePlan?: TradePlan;
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
  correlatedAssets: string[];
}

interface MarketData {
  assets: Asset[];
  polymarket: PolymarketData[];
  signals: Signal[];
  lastUpdated: string;
}

type FilterCategory = "ALL" | "CRYPTO" | "FOREX" | "STOCKS" | "COMMODITIES";

// ─── Formatters ──────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return "$" + price.toFixed(4);
  return "$" + price.toFixed(6);
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return "$" + (value / 1_000_000_000).toFixed(2) + "B";
  if (value >= 1_000_000) return "$" + (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return "$" + (value / 1_000).toFixed(2) + "K";
  return "$" + value.toFixed(2);
}

function formatChange(change: number): string {
  return (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
}

function getScoreColor(score: number): string {
  if (score > 55) return "#34D399";
  if (score < 45) return "#FB7185";
  return "#F59E0B";
}

function getChangeColor(change: number): string {
  return change >= 0 ? "#34D399" : "#FB7185";
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

// ─── Flash Price Component ───────────────────────────────────

function FlashPrice({ price, prevPrice, style }: { price: number; prevPrice?: number; style?: React.CSSProperties }) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(prevPrice ?? price);

  useEffect(() => {
    if (price > prevRef.current) setFlash("up");
    else if (price < prevRef.current) setFlash("down");
    prevRef.current = price;

    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  return (
    <span style={{
      ...style,
      transition: "color 0.3s",
      color: flash === "up" ? "#34D399" : flash === "down" ? "#FB7185" : (style?.color ?? "#F1F5F9"),
      textShadow: flash ? `0 0 8px ${flash === "up" ? "#34D39960" : "#FB718560"}` : "none",
    }}>
      {formatPrice(price)}
    </span>
  );
}

// ─── Chart Components ────────────────────────────────────────

function SparklineChart({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 800, H = 200, P = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const cW = W - P * 2;
  const cH = H - P * 2;

  const pts = data.map((v, i): [number, number] => [
    P + (i / (data.length - 1)) * cW,
    P + cH - ((v - min) / range) * cH,
  ]);

  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = [...pts.map(([x, y]) => `${x},${y}`), `${W - P},${H - P}`, `${P},${H - P}`].join(" ");
  const last = pts[pts.length - 1];
  const gridYs = [0.25, 0.5, 0.75].map((p) => P + cH * (1 - p));

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <filter id="glow-line">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="85%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {gridYs.map((y, i) => (
        <line key={i} x1={P} y1={y} x2={W - P} y2={y}
          stroke="#1C2338" strokeWidth="1" strokeDasharray="4 6" />
      ))}

      {/* Area fill */}
      <polygon points={area} fill="url(#area-fill)" />

      {/* Main line */}
      <polyline points={line} fill="none" stroke={color} strokeWidth="2.5"
        strokeLinejoin="round" filter="url(#glow-line)" />

      {/* End dot */}
      <circle cx={last[0]} cy={last[1]} r="5" fill={color} filter="url(#glow-line)" />
      <circle cx={last[0]} cy={last[1]} r="9" fill={color} fillOpacity="0.15" />
    </svg>
  );
}

function CardSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const sampled = data.filter((_, i) => i % 5 === 0);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const pts = sampled.map((v, i) => {
    const x = (i / (sampled.length - 1)) * 180;
    const y = 24 - ((v - min) / range) * 22;
    return `${x},${y}`;
  });
  return (
    <svg width="100%" height="28" viewBox="0 0 180 28" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

// ─── Constants ───────────────────────────────────────────────

const ACTIVE_FILTERS: FilterCategory[] = ["ALL", "CRYPTO", "FOREX", "STOCKS", "COMMODITIES"];
const ALL_FILTERS: FilterCategory[] = ["ALL", "CRYPTO", "FOREX", "STOCKS", "COMMODITIES"];

const R = "var(--font-rajdhani), sans-serif";  // Rajdhani
const M = "var(--font-jetbrains), monospace";   // JetBrains Mono

// ─── Dashboard ───────────────────────────────────────────────

export default function PredictionDashboard() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterCategory>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndicators, setActiveIndicators] = useState<string[]>(["rsi", "macd", "bollinger"]);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);

  // Alert system
  const { alerts, latestCritical, unreadCount, processSignals, dismissBanner, markAllRead } = useAlerts();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/markets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MarketData = await res.json();
      setMarketData(data);
      setError(null);
      setSelectedAssetId((prev) => {
        if (!prev && data.assets?.length > 0) return data.assets[0].id;
        return prev;
      });
      // Process signals into alerts
      if (data.signals?.length > 0) {
        processSignals(data.signals, data.assets);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [processSignals]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Update alert ages every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Live crypto prices via Binance WebSocket
  const cryptoIds = useMemo(() => (marketData?.assets ?? []).filter((a) => a.category === "CRYPTO").map((a) => a.id), [marketData]);
  const livePrices = useBinanceWs(cryptoIds);

  // Merge live prices into assets
  const allAssets: Asset[] = useMemo(() => {
    const base = marketData?.assets ?? [];
    return base.map((asset) => {
      const live = livePrices[asset.id];
      if (!live) return asset;
      return { ...asset, price: live.price, change24h: live.change24h };
    });
  }, [marketData, livePrices]);

  const filteredAssets = filter === "ALL"
    ? allAssets
    : allAssets.filter((a) => a.category === filter);

  const selectedAsset =
    allAssets.find((a) => a.id === selectedAssetId) ??
    filteredAssets[0] ??
    null;
  const chartColor = selectedAsset
    ? selectedAsset.change7d >= 0 ? "#34D399" : "#FB7185"
    : "#34D399";

  const selectedIndicators = useMemo(() => {
    if (!selectedAsset?.sparkline?.length) return null;
    return computeAllIndicators(selectedAsset.sparkline);
  }, [selectedAsset?.id, selectedAsset?.sparkline]);

  const indicatorResults = useMemo(() => {
    if (!selectedIndicators) return null;
    return scoreIndicators(selectedIndicators);
  }, [selectedIndicators]);

  const enhancedScore = useMemo(() => {
    if (!selectedIndicators || !selectedAsset) return null;
    return computeCombinedScore(selectedIndicators, activeIndicators, selectedAsset.change24h);
  }, [selectedIndicators, activeIndicators, selectedAsset?.change24h]);

  const tickerItems = allAssets.length > 0
    ? [...allAssets, ...allAssets]
    : [];

  return (
    <div style={{ backgroundColor: "#05070D", minHeight: "100vh" }}>

      {/* ═══════════════════════════════════════════════
          HEADER
      ═══════════════════════════════════════════════ */}
      <header style={{ backgroundColor: "#080B14", borderBottom: "1px solid #1C2338", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 24px", height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <polygon points="11,1 21,21 1,21" fill="#F59E0B" />
              <polygon points="11,7 17,19 5,19" fill="#05070D" />
            </svg>
            <span style={{ fontFamily: R, fontWeight: 700, fontSize: 17, letterSpacing: "0.14em", color: "#F1F5F9" }}>
              NEXUS <span style={{ color: "#F59E0B" }}>MARKET</span>
            </span>
          </div>

          {/* Live + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#F59E0B", flexShrink: 0 }} />
              <span style={{ fontFamily: R, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", color: "#F59E0B" }}>LIVE</span>
            </div>
            {marketData?.lastUpdated && (
              <span style={{ fontFamily: M, color: "#475569", fontSize: 12 }}>
                {formatTimestamp(marketData.lastUpdated)}
              </span>
            )}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {ALL_FILTERS.map((cat) => {
              const active = ACTIVE_FILTERS.includes(cat);
              const selected = filter === cat;
              return (
                <button key={cat}
                  onClick={() => { if (active) setFilter(cat); }}
                  style={{
                    fontFamily: R, fontWeight: 700, fontSize: 11,
                    letterSpacing: "0.1em", padding: "4px 12px",
                    border: `1px solid ${selected ? "#F59E0B" : active ? "#1C2338" : "#0D1020"}`,
                    backgroundColor: selected ? "#F59E0B12" : "transparent",
                    color: selected ? "#F59E0B" : active ? "#64748B" : "#1C2338",
                    cursor: active ? "pointer" : "not-allowed",
                    borderRadius: 1,
                    transition: "all 0.15s",
                  }}
                >{cat}</button>
              );
            })}
          {/* Alert Bell */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => { setShowAlertPanel(!showAlertPanel); if (!showAlertPanel) markAllRead(); }}
              style={{
                background: "#0F1424", border: `1px solid ${unreadCount > 0 ? "#F59E0B40" : "#1C2338"}`,
                borderRadius: 6, width: 40, height: 40, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, transition: "border-color 0.2s", position: "relative",
              }}
            >
              {"\uD83D\uDD14"}
              {unreadCount > 0 && (
                <span style={{
                  position: "absolute", top: -6, right: -6,
                  background: "#dc2626", color: "#fff",
                  fontSize: 10, fontWeight: 700, fontFamily: M,
                  minWidth: 18, height: 18, borderRadius: 9,
                  border: "2px solid #05070D",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 3px",
                }}>{unreadCount}</span>
              )}
            </button>

            {/* Alert Panel */}
            {showAlertPanel && (
              <div style={{
                position: "absolute", top: 48, right: 0, width: 420,
                background: "#0A0D18", border: "1px solid #1C2338",
                borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
                zIndex: 100, overflow: "hidden", maxHeight: "70vh", overflowY: "auto",
              }}>
                <div style={{
                  background: "#111827", padding: "12px 16px",
                  borderBottom: "1px solid #1C2338",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <span style={{ fontFamily: R, fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", color: "#94A3B8" }}>ALERTES</span>
                  <span style={{ fontFamily: M, fontSize: 11, color: "#475569" }}>{alerts.length} alertes</span>
                </div>

                {alerts.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "#334155", fontSize: 13, fontFamily: R }}>Aucune alerte active</div>
                ) : (
                  alerts.map((alert) => {
                    const freshness = getFreshness(alert.generatedAt);
                    const barColor = freshness === "FRESH" ? "#dc2626" : freshness === "WARM" ? "#f97316" : freshness === "OLD" ? "#475569" : "#1e293b";
                    const textColor = freshness === "FRESH" ? "#f87171" : freshness === "WARM" ? "#fb923c" : freshness === "OLD" ? "#94a3b8" : "#475569";
                    const timeColor = freshness === "FRESH" ? "#f87171" : freshness === "WARM" ? "#fb923c" : freshness === "OLD" ? "#475569" : "#334155";
                    const isExpired = freshness === "EXPIRED";
                    const typeStyle = alert.type === "SELL"
                      ? { bg: "rgba(220,38,38,0.2)", color: "#f87171", border: "rgba(220,38,38,0.3)" }
                      : alert.type === "BUY"
                      ? { bg: "rgba(34,197,94,0.2)", color: "#4ade80", border: "rgba(34,197,94,0.3)" }
                      : { bg: "rgba(234,179,8,0.2)", color: "#facc15", border: "rgba(234,179,8,0.3)" };
                    const freshPercent = freshness === "FRESH" ? 95 : freshness === "WARM" ? 50 : freshness === "OLD" ? 15 : 0;

                    return (
                      <div key={alert.id} style={{
                        padding: "12px 16px", borderBottom: "1px solid #111827",
                        display: "flex", gap: 12, opacity: isExpired ? 0.4 : 1,
                      }}>
                        <div style={{ width: 3, borderRadius: 2, flexShrink: 0, alignSelf: "stretch", minHeight: 40, background: barColor }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontFamily: R, fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", color: textColor, textDecoration: isExpired ? "line-through" : "none" }}>
                              {alert.asset}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", fontFamily: M,
                                padding: "2px 6px", borderRadius: 2,
                                background: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}`,
                                opacity: isExpired ? 0.4 : 1,
                              }}>{alert.type}</span>
                              <span style={{ fontSize: 10, fontFamily: M, color: timeColor, whiteSpace: "nowrap" }}>
                                {getAgeText(alert.generatedAt)}{isExpired ? " \u00B7 EXPIR\u00C9" : ""}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontFamily: R, fontSize: 12, color: isExpired ? "#334155" : "#64748b", marginBottom: 6 }}>
                            {isExpired ? "Signal trop ancien" : alert.message}
                          </div>
                          {!isExpired && alert.entry && (
                            <div style={{ display: "flex", gap: 10, fontFamily: M, fontSize: 11 }}>
                              <span><span style={{ color: "#475569" }}>Entry </span><span style={{ color: "#94a3b8" }}>${alert.entry.toLocaleString()}</span></span>
                              {alert.stopLoss && <span><span style={{ color: "#475569" }}>SL </span><span style={{ color: "#94a3b8" }}>${alert.stopLoss.toLocaleString()}</span></span>}
                              {alert.target1 && <span><span style={{ color: "#475569" }}>T1 </span><span style={{ color: "#94a3b8" }}>${alert.target1.toLocaleString()}</span></span>}
                            </div>
                          )}
                          {!isExpired && (
                            <div style={{ marginTop: 6, height: 2, background: "#1e293b", borderRadius: 1, overflow: "hidden" }}>
                              <div className="score-bar-fill" style={{ height: "100%", width: `${freshPercent}%`, background: barColor, borderRadius: 1 }} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════
          CRITICAL BANNER (persists until dismissed)
      ═══════════════════════════════════════════════ */}
      {latestCritical && (
        <div style={{
          background: "linear-gradient(90deg, #7f1d1d, #dc2626)",
          borderBottom: "1px solid #ef4444",
          padding: "10px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          animation: "pulse-banner 2s infinite",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, flexWrap: "wrap" }}>
            <span style={{
              background: "#ef4444", border: "1px solid #fca5a5",
              padding: "2px 8px", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.12em", borderRadius: 2, fontFamily: R,
            }}>{"\uD83D\uDD34"} CRITIQUE</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: R, letterSpacing: "0.06em" }}>
                {latestCritical.asset} — {latestCritical.type}
              </div>
              <div style={{ fontSize: 13, color: "#fca5a5", fontFamily: R }}>{latestCritical.message}</div>
            </div>
            {latestCritical.entry && (
              <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: M }}>
                <span><span style={{ color: "#fca5a5" }}>Entry </span><b style={{ color: "#fff" }}>${latestCritical.entry.toLocaleString()}</b></span>
                {latestCritical.stopLoss && <span><span style={{ color: "#fca5a5" }}>SL </span><b style={{ color: "#fff" }}>${latestCritical.stopLoss.toLocaleString()}</b></span>}
                {latestCritical.target1 && <span><span style={{ color: "#fca5a5" }}>T1 </span><b style={{ color: "#fff" }}>${latestCritical.target1.toLocaleString()}</b></span>}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "#fca5a5", fontFamily: M }}>{"\u23F1"} {getAgeText(latestCritical.generatedAt)}</span>
            <button onClick={dismissBanner} style={{
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
              color: "#fff", cursor: "pointer", width: 24, height: 24,
              borderRadius: 3, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
            }}>{"\u2715"}</button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          TICKER TAPE
      ═══════════════════════════════════════════════ */}
      {tickerItems.length > 0 && (
        <div className="ticker-wrap" style={{ backgroundColor: "#06080F", borderBottom: "1px solid #1C2338", height: 34, overflow: "hidden", display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "0 14px", borderRight: "1px solid #1C2338", flexShrink: 0, height: "100%" }}>
            <span style={{ fontFamily: R, fontSize: 10, letterSpacing: "0.15em", color: "#475569", fontWeight: 700 }}>MARKET TICKER</span>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div className="ticker-track" style={{ fontFamily: M, alignItems: "center", height: 34 }}>
              {tickerItems.map((asset, i) => {
                const up = asset.change24h >= 0;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 22px", borderRight: "1px solid #1C2338", height: 34, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.1em", fontFamily: R }}>{asset.symbol.toUpperCase()}</span>
                    <FlashPrice price={asset.price} prevPrice={livePrices[asset.id]?.prevPrice} style={{ fontSize: 12, color: "#F1F5F9" }} />
                    <span style={{ fontSize: 11, color: up ? "#34D399" : "#FB7185" }}>{formatChange(asset.change24h)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          LOADING
      ═══════════════════════════════════════════════ */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 120 }}>
          <div style={{ fontFamily: M, color: "#F59E0B", fontSize: 13, letterSpacing: "0.15em" }}>
            LOADING MARKET DATA<span className="cursor-blink">_</span>
          </div>
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <div style={{ fontFamily: M, backgroundColor: "#120508", border: "1px solid #FB718560", color: "#FB7185", fontSize: 12, padding: "10px 20px", letterSpacing: "0.05em" }}>
            ▲ ERROR: {error}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          MAIN CONTENT
      ═══════════════════════════════════════════════ */}
      {!loading && marketData && (
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── ASSET CARDS ── */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {filteredAssets.map((asset) => {
              const isSelected = asset.id === selectedAssetId;
              const changeColor = getChangeColor(asset.change24h);
              const scoreColor = getScoreColor(asset.aiScore);
              const dir = asset.aiDirection;
              return (
                <button key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  style={{
                    minWidth: 165,
                    flexShrink: 0,
                    backgroundColor: isSelected ? "#0F1424" : "#0A0D18",
                    border: `1px solid ${isSelected ? "#F59E0B30" : "#1C2338"}`,
                    borderLeft: `3px solid ${isSelected ? "#F59E0B" : "#1C2338"}`,
                    padding: "12px 14px 0",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.18s",
                    boxShadow: isSelected ? "inset 0 0 40px #F59E0B06" : "none",
                  }}
                >
                  {/* Symbol + direction */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontFamily: R, fontWeight: 700, fontSize: 14, color: "#F1F5F9", letterSpacing: "0.1em" }}>
                      {asset.symbol.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, color: scoreColor, fontFamily: M }}>
                      {dir === "UP" ? "↑" : dir === "DOWN" ? "↓" : "→"}
                    </span>
                  </div>

                  {/* Price */}
                  <div style={{ fontFamily: M, fontWeight: 700, fontSize: 16, marginBottom: 6, letterSpacing: "-0.02em" }}>
                    <FlashPrice price={asset.price} prevPrice={livePrices[asset.id]?.prevPrice} style={{ color: "#F1F5F9", fontFamily: M, fontWeight: 700, fontSize: 16 }} />
                  </div>

                  {/* Change + Score */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: M, fontSize: 12, color: changeColor }}>
                      {formatChange(asset.change24h)}
                    </span>
                    <span style={{ fontFamily: R, fontWeight: 700, fontSize: 11, color: scoreColor, border: `1px solid ${scoreColor}40`, padding: "1px 5px", letterSpacing: "0.05em" }}>
                      {asset.aiScore}
                    </span>
                  </div>

                  {/* Mini sparkline flush to card bottom */}
                  <div style={{ marginLeft: -14, marginRight: -14 }}>
                    <CardSparkline data={asset.sparkline} color={changeColor} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── MAIN GRID: Chart + Stats ── */}
          {selectedAsset && (
            <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 14 }}>

              {/* CHART PANEL */}
              <div style={{ backgroundColor: "#0A0D18", border: "1px solid #1C2338" }}>

                {/* Chart header */}
                <div style={{ padding: "12px 20px", borderBottom: "1px solid #1C2338", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: R, fontWeight: 700, fontSize: 16, letterSpacing: "0.1em", color: "#F1F5F9" }}>
                      {selectedAsset.symbol.toUpperCase()} / USD
                    </span>
                    <span style={{ fontFamily: R, fontSize: 11, color: "#475569", letterSpacing: "0.1em" }}>
                      {selectedAsset.name.toUpperCase()}
                    </span>
                  </div>
                  <span style={{ fontFamily: R, fontWeight: 700, fontSize: 10, color: "#475569", letterSpacing: "0.15em", border: "1px solid #1C2338", padding: "3px 9px" }}>
                    7 DAYS
                  </span>
                </div>

                {/* Chart area */}
                <div style={{ position: "relative", height: 260, padding: "16px 20px 12px", overflow: "hidden" }}>
                  <div className="scan-line" />
                  {selectedAsset.sparkline?.length > 0 ? (
                    <SparklineChart data={selectedAsset.sparkline} color={chartColor} />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: M, color: "#1C2338", fontSize: 12, letterSpacing: "0.15em" }}>
                      NO SPARKLINE DATA
                    </div>
                  )}
                </div>
              </div>

              {/* STATS PANEL */}
              <div style={{ backgroundColor: "#0A0D18", border: "1px solid #1C2338", padding: "20px" }}>

                {/* Name */}
                <div style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.18em", marginBottom: 4 }}>
                  {selectedAsset.name.toUpperCase()}
                </div>

                {/* Big price */}
                <div style={{ fontFamily: M, fontWeight: 700, fontSize: 30, letterSpacing: "-0.03em", lineHeight: 1.05, marginBottom: 10 }}>
                  <FlashPrice price={selectedAsset.price} prevPrice={livePrices[selectedAsset.id]?.prevPrice} style={{ color: "#F1F5F9", fontFamily: M, fontWeight: 700, fontSize: 30 }} />
                </div>

                {/* 24h badge */}
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  backgroundColor: selectedAsset.change24h >= 0 ? "#34D39912" : "#FB718512",
                  border: `1px solid ${selectedAsset.change24h >= 0 ? "#34D39930" : "#FB718530"}`,
                  padding: "4px 10px", marginBottom: 18,
                }}>
                  <span style={{ fontFamily: M, fontWeight: 700, fontSize: 13, color: getChangeColor(selectedAsset.change24h) }}>
                    {formatChange(selectedAsset.change24h)}
                  </span>
                  <span style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.1em" }}>24H</span>
                </div>

                <div style={{ height: 1, backgroundColor: "#1C2338", marginBottom: 16 }} />

                {/* Change grid 1h/24h/7d */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {([["1H", selectedAsset.change1h], ["24H", selectedAsset.change24h], ["7D", selectedAsset.change7d]] as [string, number][]).map(([label, value]) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.12em", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontFamily: M, fontWeight: 700, fontSize: 12, color: getChangeColor(value) }}>{formatChange(value)}</div>
                    </div>
                  ))}
                </div>

                {/* Volume + MCap */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                  {([["VOLUME", formatVolume(selectedAsset.volume)], ["MCAP", formatVolume(selectedAsset.marketCap)]] as [string, string][]).map(([label, value]) => (
                    <div key={label}>
                      <div style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.12em", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontFamily: M, fontSize: 12, color: "#94A3B8" }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ height: 1, backgroundColor: "#1C2338", marginBottom: 16 }} />

                {/* AI Score block */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: R, fontWeight: 700, fontSize: 11, color: "#A78BFA", letterSpacing: "0.14em" }}>◈ AI SCORE</span>
                    <span style={{ fontFamily: R, fontSize: 10, letterSpacing: "0.1em", color: "#A78BFA50" }}>
                      {selectedAsset.aiDirection === "UP" ? "↑ BULLISH" : selectedAsset.aiDirection === "DOWN" ? "↓ BEARISH" : "→ NEUTRAL"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
                    <span style={{ fontFamily: M, fontWeight: 700, fontSize: 34, color: getScoreColor(selectedAsset.aiScore), letterSpacing: "-0.03em" }}>
                      {selectedAsset.aiScore}
                    </span>
                    <span style={{ fontFamily: R, fontSize: 14, color: "#475569" }}>/100</span>
                  </div>
                  {/* Bar track */}
                  <div style={{ height: 3, backgroundColor: "#1C2338", overflow: "hidden" }}>
                    <div className="score-bar-fill" style={{ height: "100%", width: `${selectedAsset.aiScore}%`, backgroundColor: getScoreColor(selectedAsset.aiScore) }} />
                  </div>
                </div>

                {/* TRADE PLAN */}
                {selectedAsset.tradePlan && selectedAsset.tradePlan.direction !== "WAIT" && (
                  <>
                    <div style={{ height: 1, backgroundColor: "#1C2338", margin: "16px 0" }} />
                    <div>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", color: "#F59E0B" }}>◈ TRADE PLAN</span>
                        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em",
                          color: selectedAsset.tradePlan.direction === "LONG" ? "#34D399" : "#FB7185",
                          border: `1px solid ${selectedAsset.tradePlan.direction === "LONG" ? "#34D39940" : "#FB718540"}`,
                          padding: "1px 6px",
                        }}>
                          {selectedAsset.tradePlan.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}
                        </span>
                      </div>

                      {/* Entry / Stop / Targets */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
                        {([
                          { label: "ENTRÉE",  val: selectedAsset.tradePlan.entry,   pct: null,                                          color: "#F1F5F9" },
                          { label: "STOP",    val: selectedAsset.tradePlan.stopLoss, pct: selectedAsset.tradePlan.stopPercent,           color: "#FB7185" },
                          { label: "CIBLE 1", val: selectedAsset.tradePlan.target1,  pct: selectedAsset.tradePlan.target1Percent,        color: "#34D399" },
                          { label: "CIBLE 2", val: selectedAsset.tradePlan.target2,  pct: selectedAsset.tradePlan.target2Percent,        color: "#34D399" },
                        ] as { label: string; val: number; pct: number | null; color: string }[]).map(({ label, val, pct, color }) => (
                          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4 }}>
                            <span style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.1em", width: 50, flexShrink: 0 }}>{label}</span>
                            <span style={{ fontFamily: M, fontSize: 12, color, flex: 1, textAlign: "right" }}>{formatPrice(val)}</span>
                            {pct !== null && (
                              <span style={{ fontFamily: M, fontSize: 10, color: pct >= 0 ? "#34D399" : "#FB7185", width: 44, textAlign: "right", flexShrink: 0 }}>
                                {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Strategy + reasons */}
                      <div style={{ fontFamily: R, fontWeight: 700, fontSize: 10, color: "#F59E0B80", letterSpacing: "0.12em", marginBottom: 5 }}>
                        {selectedAsset.tradePlan.strategy.toUpperCase()}
                      </div>
                      {selectedAsset.tradePlan.reasons.map((r, i) => (
                        <div key={i} style={{ fontFamily: R, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>· {r}</div>
                      ))}
                    </div>
                  </>
                )}

                {selectedAsset.tradePlan?.direction === "WAIT" && (
                  <>
                    <div style={{ height: 1, backgroundColor: "#1C2338", margin: "16px 0" }} />
                    <div style={{ fontFamily: R, fontSize: 11, color: "#1C2338", letterSpacing: "0.1em", textAlign: "center", padding: "8px 0" }}>
                      ◈ NO CLEAR TRADE SETUP
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── INDICATORS PANEL ── */}
          {selectedAsset && indicatorResults && (
            <div style={{ backgroundColor: "#0A0D18", border: "1px solid #1C2338" }}>
              {/* Toggle button */}
              <button
                onClick={() => setShowIndicators(!showIndicators)}
                style={{
                  width: "100%", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: "transparent", border: "none", borderBottom: showIndicators ? "1px solid #1C2338" : "none",
                  cursor: "pointer", fontFamily: R,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", color: "#F59E0B" }}>
                    {showIndicators ? "▼" : "▶"} INDICATORS
                  </span>
                  <span style={{ fontFamily: M, fontSize: 10, fontWeight: 700, color: "#F59E0B", backgroundColor: "#F59E0B15", border: "1px solid #F59E0B30", padding: "1px 7px" }}>
                    {activeIndicators.length}/6
                  </span>
                  {enhancedScore && (
                    <span style={{
                      fontFamily: M, fontSize: 11, fontWeight: 700, padding: "2px 8px",
                      color: enhancedScore.direction === "UP" ? "#34D399" : enhancedScore.direction === "DOWN" ? "#FB7185" : "#F59E0B",
                      backgroundColor: enhancedScore.direction === "UP" ? "#34D39915" : enhancedScore.direction === "DOWN" ? "#FB718515" : "#F59E0B15",
                      border: `1px solid ${enhancedScore.direction === "UP" ? "#34D39930" : enhancedScore.direction === "DOWN" ? "#FB718530" : "#F59E0B30"}`,
                    }}>
                      ENHANCED: {enhancedScore.score}% {enhancedScore.direction === "UP" ? "↑" : enhancedScore.direction === "DOWN" ? "↓" : "→"}
                      {enhancedScore.convergence > 0 && ` · ${enhancedScore.convergence}% convergence`}
                    </span>
                  )}
                </div>
                <span style={{ color: "#475569", fontSize: 11, fontFamily: R }}>
                  {showIndicators ? "Masquer" : "Afficher les indicateurs"}
                </span>
              </button>

              {/* Indicator toggles + results */}
              {showIndicators && (
                <div style={{ padding: "14px 18px" }}>
                  {/* Toggle buttons */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                    {Object.entries(indicatorResults).map(([key, ind]) => {
                      const isActive = activeIndicators.includes(key);
                      const color = ind.bullish ? "#34D399" : "#FB7185";
                      return (
                        <button
                          key={key}
                          onClick={() => setActiveIndicators((prev) =>
                            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                          )}
                          style={{
                            padding: "6px 14px", borderRadius: 4, cursor: "pointer",
                            fontFamily: M, fontSize: 11, fontWeight: isActive ? 700 : 400,
                            backgroundColor: isActive ? `${color}15` : "#0F1424",
                            border: `1px solid ${isActive ? `${color}50` : "#1C2338"}`,
                            color: isActive ? color : "#475569",
                            transition: "all 0.2s",
                          }}
                        >
                          {isActive ? "✓ " : ""}{ind.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Active indicator details */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                    {activeIndicators.map((key) => {
                      const ind = indicatorResults[key] as IndicatorResult | undefined;
                      if (!ind) return null;
                      const barColor = ind.bullish ? "#34D399" : "#FB7185";
                      return (
                        <div key={key} style={{ backgroundColor: "#0F1424", border: "1px solid #1C2338", padding: "10px 14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontFamily: R, fontWeight: 700, fontSize: 12, color: "#94A3B8", letterSpacing: "0.08em" }}>
                              {ind.label}
                            </span>
                            <span style={{ fontFamily: M, fontSize: 13, fontWeight: 700, color: barColor }}>
                              {ind.score}/100
                            </span>
                          </div>
                          {/* Score bar */}
                          <div style={{ height: 4, backgroundColor: "#1C2338", borderRadius: 2, marginBottom: 6, overflow: "hidden" }}>
                            <div className="score-bar-fill" style={{ height: "100%", width: `${ind.score}%`, backgroundColor: barColor, borderRadius: 2 }} />
                          </div>
                          <div style={{ fontFamily: R, fontSize: 11, color: barColor }}>
                            {ind.signal}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── BOTTOM GRID: Signals + Polymarket ── */}
          <div className="bottom-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

            {/* AI SIGNALS */}
            <div style={{ backgroundColor: "#0A0D18", border: "1px solid #1C2338" }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid #1C2338", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: R, fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", color: "#A78BFA" }}>▶ AI SIGNALS</span>
                <span style={{ fontFamily: M, fontSize: 10, fontWeight: 700, color: "#A78BFA", backgroundColor: "#A78BFA15", border: "1px solid #A78BFA30", padding: "1px 7px" }}>
                  {marketData.signals.length}
                </span>
              </div>
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                {marketData.signals.length === 0 ? (
                  <div style={{ fontFamily: M, color: "#1C2338", fontSize: 12, textAlign: "center", padding: "28px 0", letterSpacing: "0.1em" }}>
                    NO ACTIVE SIGNALS
                  </div>
                ) : marketData.signals.map((signal, i) => {
                  const sevColor = signal.severity === "high" ? "#FB7185" : signal.severity === "medium" ? "#F59E0B" : "#34D399";
                  const typeColor = signal.type === "BUY" ? "#34D399" : signal.type === "SELL" ? "#FB7185" : "#F59E0B";
                  return (
                    <div key={i} style={{ backgroundColor: "#06080F", border: "1px solid #1C2338", borderLeft: `3px solid ${sevColor}`, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 13, color: "#F1F5F9" }}>{signal.asset}</span>
                        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 11, color: typeColor, border: `1px solid ${typeColor}40`, padding: "1px 7px", letterSpacing: "0.1em", flexShrink: 0 }}>
                          {signal.type}
                        </span>
                      </div>
                      <div style={{ fontFamily: M, color: "#475569", fontSize: 11, lineHeight: 1.55 }}>{signal.message}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* POLYMARKET */}
            <div style={{ backgroundColor: "#0A0D18", border: "1px solid #1C2338" }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid #1C2338", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: R, fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", color: "#F59E0B" }}>▶ POLYMARKET ODDS</span>
                <span style={{ fontFamily: M, fontSize: 10, fontWeight: 700, color: "#F59E0B", backgroundColor: "#F59E0B15", border: "1px solid #F59E0B30", padding: "1px 7px" }}>
                  {marketData.polymarket.length}
                </span>
              </div>
              <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                {marketData.polymarket.length === 0 ? (
                  <div style={{ fontFamily: M, color: "#1C2338", fontSize: 12, textAlign: "center", padding: "28px 0", letterSpacing: "0.1em" }}>
                    NO POLYMARKET DATA
                  </div>
                ) : marketData.polymarket.slice(0, 8).map((market, i) => {
                  const yes = market.bestBid > 0 ? Math.round(market.bestBid * 100) : 50;
                  const no = 100 - yes;
                  return (
                    <div key={i} style={{ backgroundColor: "#06080F", border: "1px solid #1C2338", padding: "12px" }}>
                      <div style={{ fontFamily: R, fontSize: 13, color: "#94A3B8", marginBottom: 10, lineHeight: 1.4 }}>
                        {market.question}
                      </div>
                      {/* Dual bar */}
                      <div style={{ height: 3, display: "flex", overflow: "hidden", marginBottom: 8 }}>
                        <div style={{ width: `${yes}%`, height: "100%", backgroundColor: "#34D399", transition: "width 0.5s ease" }} />
                        <div style={{ flex: 1, height: "100%", backgroundColor: "#FB7185" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 16 }}>
                          <div>
                            <span style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.1em" }}>YES </span>
                            <span style={{ fontFamily: M, fontSize: 12, fontWeight: 700, color: "#34D399" }}>{yes}%</span>
                          </div>
                          <div>
                            <span style={{ fontFamily: R, fontSize: 10, color: "#475569", letterSpacing: "0.1em" }}>NO </span>
                            <span style={{ fontFamily: M, fontSize: 12, fontWeight: 700, color: "#FB7185" }}>{no}%</span>
                          </div>
                        </div>
                        <span style={{ fontFamily: M, color: "#475569", fontSize: 11 }}>{formatVolume(market.volume)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* DISCLAIMER */}
          <div style={{ borderTop: "1px solid #1C2338", paddingTop: 14, textAlign: "center" }}>
            <p style={{ fontFamily: M, color: "#1C2338", fontSize: 11, letterSpacing: "0.06em" }}>
              THIS IS NOT FINANCIAL ADVICE — AI PREDICTIONS ARE INDICATIVE ONLY
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
