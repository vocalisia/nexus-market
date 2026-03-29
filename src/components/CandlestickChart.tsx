"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Candle } from "@/app/api/klines/route";
import type { ChartAnalysis } from "@/app/api/analyze/route";

const R = "var(--font-rajdhani), sans-serif";
const M = "var(--font-jetbrains), monospace";

const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;
type TF = typeof TIMEFRAMES[number];

function formatPrice(p: number): string {
  if (p >= 10000) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (p >= 100)   return "$" + p.toFixed(2);
  if (p >= 1)     return "$" + p.toFixed(4);
  return "$" + p.toFixed(6);
}

function formatVol(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000)         return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(0);
}

function formatAxisTime(ts: number, tf: TF): string {
  const d = new Date(ts);
  if (tf === "1d") return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatTooltipTime(ts: number, tf: TF): string {
  const d = new Date(ts);
  if (tf === "1d") {
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    + "  " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

interface HoverInfo {
  candle: Candle;
  x: number; // candle center x in SVG coords
  mouseX: number; // raw mouse x in container
  mouseY: number; // raw mouse y in container
}

// ─── SVG Candlestick Chart ────────────────────────────────────
function Chart({
  candles, width, height, tf, onHover, hovered,
}: {
  candles: Candle[];
  width: number;
  height: number;
  tf: TF;
  onHover: (info: HoverInfo | null) => void;
  hovered: HoverInfo | null;
}) {
  if (candles.length === 0) return null;

  const PAD_L = 64;
  const PAD_R = 10;
  const PAD_T = 12;
  const PAD_B = 28;
  const VOL_H = 36;
  const GAP   = 4;

  const chartH = height - PAD_T - PAD_B - VOL_H - GAP;
  const chartW = width - PAD_L - PAD_R;

  const prices = candles.flatMap((c) => [c.high, c.low]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pRange = maxP - minP || 1;
  const pad = pRange * 0.04;

  const minPad = minP - pad;
  const maxPad = maxP + pad;
  const pRangePad = maxPad - minPad;

  const volumes = candles.map((c) => c.volume);
  const maxVol = Math.max(...volumes) || 1;

  const n = candles.length;
  const step = chartW / n;
  const candleW = Math.max(1, step * 0.75);

  const toY  = (p: number) => PAD_T + chartH * (1 - (p - minPad) / pRangePad);
  const volY = (v: number) => PAD_T + chartH + GAP + VOL_H * (1 - v / maxVol);
  const toX  = (i: number) => PAD_L + i * step + step / 2;

  // Grid
  const gridCount = 5;
  const gridLevels = Array.from({ length: gridCount }, (_, i) =>
    minPad + (pRangePad * i) / (gridCount - 1)
  );

  // Time labels — ~6 evenly spaced
  const timeCount = Math.min(6, n);
  const timeIdxs = Array.from({ length: timeCount }, (_, i) =>
    Math.round((i / (timeCount - 1)) * (n - 1))
  );

  const lastClose = candles[n - 1].close;
  const lastY = toY(lastClose);

  // Hover crosshair
  const hoverY = hovered ? toY(hovered.candle.close) : null;
  const hoverX = hovered ? hovered.x : null;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Find nearest candle
    const relX = mx - PAD_L;
    if (relX < 0 || relX > chartW) { onHover(null); return; }
    const idx = Math.min(n - 1, Math.max(0, Math.floor(relX / step)));
    onHover({ candle: candles[idx], x: toX(idx), mouseX: mx, mouseY: my });
  }, [candles, n, step, chartW, onHover, toX]);

  return (
    <svg
      width={width} height={height}
      style={{ display: "block", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover(null)}
    >
      {/* Price grid */}
      {gridLevels.map((p, i) => {
        const y = toY(p);
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={width - PAD_R} y2={y}
              stroke="#1C2338" strokeWidth={1} strokeDasharray="3 4" />
            <text x={PAD_L - 5} y={y + 4} textAnchor="end"
              fontSize={9} fill="#2E3D55" fontFamily="monospace">
              {formatPrice(p)}
            </text>
          </g>
        );
      })}

      {/* Volume separator */}
      <line x1={PAD_L} y1={PAD_T + chartH + GAP} x2={width - PAD_R} y2={PAD_T + chartH + GAP}
        stroke="#1C2338" strokeWidth={1} />

      {/* Candles */}
      {candles.map((c, i) => {
        const x = toX(i);
        const bull = c.close >= c.open;
        const color = bull ? "#34D399" : "#FB7185";
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBot = toY(Math.min(c.open, c.close));
        const bodyH   = Math.max(1, bodyBot - bodyTop);
        const isHov   = hovered?.candle === c;
        const vY = volY(c.volume);
        const vH = Math.max(1, PAD_T + chartH + GAP + VOL_H - vY);

        return (
          <g key={i} opacity={hovered && !isHov ? 0.45 : 1}>
            {/* Wick */}
            <line x1={x} y1={toY(c.high)} x2={x} y2={toY(c.low)}
              stroke={color} strokeWidth={1} />
            {/* Body */}
            <rect x={x - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={color} stroke={color} strokeWidth={0.5}
              opacity={bull ? 0.85 : 0.7}
            />
            {/* Volume */}
            <rect x={x - candleW / 2} y={vY}
              width={candleW} height={vH}
              fill={color} opacity={isHov ? 0.5 : 0.2}
            />
          </g>
        );
      })}

      {/* Current price dashed line */}
      <line x1={PAD_L} y1={lastY} x2={width - PAD_R} y2={lastY}
        stroke="#F59E0B" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
      <rect x={width - PAD_R - 60} y={lastY - 9} width={58} height={17}
        fill="#0A0F1A" stroke="#F59E0B60" rx={2} />
      <text x={width - PAD_R - 4} y={lastY + 4} textAnchor="end"
        fontSize={9} fill="#F59E0B" fontFamily="monospace" fontWeight="bold">
        {formatPrice(lastClose)}
      </text>

      {/* Crosshair */}
      {hovered && hoverX !== null && hoverY !== null && (
        <>
          {/* Vertical */}
          <line x1={hoverX} y1={PAD_T} x2={hoverX} y2={height - PAD_B}
            stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
          {/* Horizontal */}
          <line x1={PAD_L} y1={hoverY} x2={width - PAD_R} y2={hoverY}
            stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
          {/* Price label on Y axis */}
          <rect x={2} y={hoverY - 8} width={PAD_L - 4} height={16} fill="#1C2338" rx={2} />
          <text x={PAD_L - 7} y={hoverY + 4} textAnchor="end"
            fontSize={9} fill="#94A3B8" fontFamily="monospace">
            {formatPrice(hovered.candle.close)}
          </text>
        </>
      )}

      {/* Time axis */}
      {timeIdxs.map((idx) => {
        const x = toX(idx);
        return (
          <text key={idx} x={x} y={height - 6} textAnchor="middle"
            fontSize={9} fill="#2E3D55" fontFamily="monospace">
            {formatAxisTime(candles[idx].time, tf)}
          </text>
        );
      })}

      {/* VOL label */}
      <text x={PAD_L - 5} y={PAD_T + chartH + GAP + 11}
        textAnchor="end" fontSize={8} fill="#1E293B" fontFamily="monospace">VOL</text>
    </svg>
  );
}

// ─── Tooltip panel ────────────────────────────────────────────
function Tooltip({ info, tf, containerW }: { info: HoverInfo; tf: TF; containerW: number }) {
  const c = info.candle;
  const bull = c.close >= c.open;
  const pctMove = ((c.close - c.open) / c.open) * 100;

  // Position: avoid right overflow
  const TW = 200;
  const left = info.mouseX + 16 + TW > containerW ? info.mouseX - TW - 12 : info.mouseX + 16;
  const top  = Math.max(8, info.mouseY - 60);

  return (
    <div style={{
      position: "absolute", top, left,
      background: "#0D1117", border: "1px solid #1E293B",
      borderRadius: 6, padding: "10px 12px",
      fontFamily: M, fontSize: 11, color: "#94A3B8",
      pointerEvents: "none", zIndex: 10,
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
      minWidth: TW,
    }}>
      {/* Date / time */}
      <div style={{
        fontSize: 10, color: "#475569", marginBottom: 8,
        borderBottom: "1px solid #1E293B", paddingBottom: 6,
        letterSpacing: "0.05em",
      }}>
        {formatTooltipTime(c.time, tf)}
      </div>

      {/* OHLCV */}
      {[
        { label: "Open",   value: formatPrice(c.open),  color: "#94A3B8" },
        { label: "High",   value: formatPrice(c.high),  color: "#34D399" },
        { label: "Low",    value: formatPrice(c.low),   color: "#FB7185" },
        { label: "Close",  value: formatPrice(c.close), color: bull ? "#34D399" : "#FB7185" },
        { label: "Volume", value: formatVol(c.volume),  color: "#64748B" },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
          <span style={{ color: "#334155" }}>{label}</span>
          <span style={{ color, fontWeight: 600 }}>{value}</span>
        </div>
      ))}

      {/* % move */}
      <div style={{
        marginTop: 6, paddingTop: 6, borderTop: "1px solid #1E293B",
        display: "flex", justifyContent: "space-between",
      }}>
        <span style={{ color: "#334155" }}>Variation</span>
        <span style={{ color: bull ? "#34D399" : "#FB7185", fontWeight: 700 }}>
          {pctMove >= 0 ? "+" : ""}{pctMove.toFixed(3)}%
        </span>
      </div>
    </div>
  );
}

// ─── Analysis Panel ──────────────────────────────────────────
function AnalysisPanel({ analysis, symbol, onClose }: { analysis: ChartAnalysis; symbol: string; onClose: () => void }) {
  const dirCfg = {
    BUY:  { color: "#34D399", bg: "#34D39915", icon: "▲ ACHAT", border: "#34D39940" },
    SELL: { color: "#FB7185", bg: "#FB718515", icon: "▼ VENTE", border: "#FB718540" },
    WAIT: { color: "#F59E0B", bg: "#F59E0B15", icon: "◆ ATTENTE", border: "#F59E0B40" },
  }[analysis.direction];

  const confColor = analysis.confidence >= 70 ? "#34D399" : analysis.confidence >= 50 ? "#F59E0B" : "#FB7185";

  function fmtP(p: number): string {
    if (p >= 10000) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 0 });
    if (p >= 100)   return "$" + p.toFixed(2);
    if (p >= 1)     return "$" + p.toFixed(4);
    return "$" + p.toFixed(6);
  }

  return (
    <div style={{
      background: "#080C14", borderTop: `2px solid ${dirCfg.border}`,
      padding: "16px 18px", fontFamily: M,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{
          padding: "4px 14px", borderRadius: 4,
          background: dirCfg.bg, border: `1px solid ${dirCfg.border}`,
          color: dirCfg.color, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em",
        }}>
          {dirCfg.icon}
        </div>
        <div>
          <span style={{ fontSize: 10, color: "#475569" }}>CONFIANCE </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: confColor }}>{analysis.confidence}%</span>
        </div>
        <div style={{ fontSize: 11, color: "#475569", flex: 1 }}>{analysis.summary}</div>
        <button onClick={onClose} style={{
          background: "transparent", border: "1px solid #1E293B",
          color: "#334155", cursor: "pointer", padding: "3px 8px",
          borderRadius: 4, fontSize: 11, fontFamily: M,
        }}>✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Left: reasons */}
        <div>
          <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 6 }}>ANALYSE</div>
          {analysis.reasons.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 11, color: "#64748B" }}>
              <span style={{ color: dirCfg.color, flexShrink: 0 }}>→</span>
              <span>{r}</span>
            </div>
          ))}
        </div>

        {/* Right: levels */}
        <div>
          <div style={{ fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 6 }}>NIVEAUX CLÉS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { label: "ENTRÉE",  value: fmtP(analysis.suggestedEntry), color: "#94A3B8" },
              { label: "TP2",     value: fmtP(analysis.suggestedTP2),   color: "#34D399" },
              { label: "TP1",     value: fmtP(analysis.suggestedTP1),   color: "#4ade80" },
              { label: "SL",      value: fmtP(analysis.suggestedSL),    color: "#FB7185" },
              { label: "R:R",     value: analysis.riskReward,           color: "#F59E0B" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#334155" }}>{label}</span>
                <span style={{ color, fontWeight: 700 }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Support / Resistance */}
          <div style={{ marginTop: 10, fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>SUPPORTS</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {analysis.keyLevels.support.map((lvl, i) => (
              <span key={i} style={{
                fontSize: 10, color: "#34D399", background: "#34D39910",
                padding: "1px 6px", borderRadius: 3, border: "1px solid #34D39930",
              }}>{fmtP(lvl)}</span>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>RÉSISTANCES</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {analysis.keyLevels.resistance.map((lvl, i) => (
              <span key={i} style={{
                fontSize: 10, color: "#FB7185", background: "#FB718510",
                padding: "1px 6px", borderRadius: 3, border: "1px solid #FB718530",
              }}>{fmtP(lvl)}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 9, color: "#1E293B", textAlign: "right" }}>
        Analyse IA · {symbol} · powered by Claude
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────
export function CandlestickChart({
  assetId,
  category,
  currentPrice,
}: {
  assetId: string;
  category: string;
  currentPrice: number;
}) {
  const [tf, setTf] = useState<TF>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 600, height: 380 });
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setDims({ width: Math.max(300, w), height: 380 });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHovered(null);
    setAnalysis(null);
    try {
      const res = await fetch(`/api/klines?symbol=${assetId}&interval=${tf}&category=${category}`);
      const data = await res.json() as { candles: Candle[]; error?: string };
      if (data.error) throw new Error(data.error);
      setCandles(data.candles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, [assetId, tf, category]);

  useEffect(() => { void load(); }, [load]);

  const runAnalysis = useCallback(async () => {
    if (candles.length < 10 || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: assetId, tf, candles }),
      });
      const data = await res.json() as ChartAnalysis & { error?: string };
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Analyse échouée");
    } finally {
      setAnalyzing(false);
    }
  }, [candles, assetId, tf, analyzing]);

  // Header OHLC: show hovered candle or last candle
  const displayCandle = hovered?.candle ?? candles[candles.length - 1];
  const prevCandle = hovered
    ? candles[candles.indexOf(hovered.candle) - 1]
    : candles[candles.length - 2];
  const pctChange = displayCandle && prevCandle
    ? ((displayCandle.close - prevCandle.close) / prevCandle.close) * 100
    : null;

  // unused but kept for prop compatibility
  void currentPrice;

  return (
    <div style={{ background: "#05070D" }}>
      {/* Timeframe selector + OHLC bar */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 12px",
        borderBottom: "1px solid #1C2338", alignItems: "center", flexWrap: "wrap",
      }}>
        {TIMEFRAMES.map((t) => (
          <button key={t} onClick={() => setTf(t)} style={{
            fontFamily: M, fontSize: 11, fontWeight: 700,
            padding: "3px 9px", cursor: "pointer",
            border: `1px solid ${tf === t ? "#F59E0B" : "#1C2338"}`,
            background: tf === t ? "#F59E0B15" : "transparent",
            color: tf === t ? "#F59E0B" : "#475569",
            borderRadius: 3, transition: "all 0.12s",
          }}>{t.toUpperCase()}</button>
        ))}

        {displayCandle && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, fontFamily: M, fontSize: 10, alignItems: "center", flexWrap: "wrap" }}>
            {hovered && (
              <span style={{ color: "#334155", fontSize: 9, letterSpacing: "0.06em" }}>
                {formatAxisTime(displayCandle.time, tf)}
              </span>
            )}
            <span style={{ color: "#475569" }}>O <span style={{ color: "#94A3B8" }}>{formatPrice(displayCandle.open)}</span></span>
            <span style={{ color: "#475569" }}>H <span style={{ color: "#34D399" }}>{formatPrice(displayCandle.high)}</span></span>
            <span style={{ color: "#475569" }}>L <span style={{ color: "#FB7185" }}>{formatPrice(displayCandle.low)}</span></span>
            <span style={{ color: "#475569" }}>C <span style={{ color: "#F59E0B" }}>{formatPrice(displayCandle.close)}</span></span>
            {pctChange !== null && (
              <span style={{ color: pctChange >= 0 ? "#34D399" : "#FB7185", fontWeight: 700 }}>
                {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%
              </span>
            )}
          </div>
        )}

        {/* Claude analysis button */}
        <button
          onClick={runAnalysis}
          disabled={analyzing || loading || candles.length < 10}
          style={{
            marginLeft: displayCandle ? 8 : "auto",
            fontFamily: M, fontSize: 10, fontWeight: 700,
            padding: "3px 10px", cursor: analyzing ? "wait" : "pointer",
            border: "1px solid #7C3AED60",
            background: analyzing ? "#7C3AED20" : "#7C3AED15",
            color: analyzing ? "#A78BFA" : "#7C3AED",
            borderRadius: 3, transition: "all 0.12s",
            opacity: loading || candles.length < 10 ? 0.4 : 1,
            letterSpacing: "0.06em",
          }}
        >
          {analyzing ? "⟳ ANALYSE..." : "✦ CLAUDE"}
        </button>
      </div>

      {/* Chart area */}
      <div ref={containerRef} style={{ width: "100%", minHeight: 380, position: "relative" }}>
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            fontFamily: M, fontSize: 12, color: "#334155", letterSpacing: "0.15em",
          }}>CHARGEMENT...</div>
        )}
        {error && !loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            fontFamily: R, fontSize: 13, color: "#475569", gap: 8,
          }}>
            <span>Données indisponibles</span>
            <button onClick={load} style={{
              fontFamily: M, fontSize: 11, padding: "4px 12px",
              background: "#1C2338", border: "1px solid #334155",
              color: "#94A3B8", cursor: "pointer", borderRadius: 4,
            }}>Réessayer</button>
          </div>
        )}
        {!loading && !error && candles.length > 0 && (
          <>
            <Chart
              candles={candles}
              width={dims.width}
              height={dims.height}
              tf={tf}
              onHover={setHovered}
              hovered={hovered}
            />
            {hovered && (
              <Tooltip info={hovered} tf={tf} containerW={dims.width} />
            )}
          </>
        )}
      </div>

      {/* Claude analysis panel */}
      {analyzeError && (
        <div style={{
          padding: "10px 16px", background: "#1C0A0A",
          borderTop: "1px solid #FB718530",
          fontFamily: M, fontSize: 11, color: "#FB7185",
        }}>
          ⚠ {analyzeError}
        </div>
      )}
      {analysis && (
        <AnalysisPanel
          analysis={analysis}
          symbol={assetId}
          onClose={() => setAnalysis(null)}
        />
      )}
    </div>
  );
}
