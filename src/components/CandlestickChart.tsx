"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Candle } from "@/app/api/klines/route";

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

function formatTime(ts: number, tf: TF): string {
  const d = new Date(ts);
  if (tf === "1d") return d.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// ─── SVG Candlestick Chart ────────────────────────────────────
function Chart({ candles, width, height, tf }: { candles: Candle[]; width: number; height: number; tf: TF }) {
  if (candles.length === 0) return null;

  const PAD_L = 60; // price axis
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 40; // time axis
  const VOL_H = 40; // volume section height

  const chartH = height - PAD_T - PAD_B - VOL_H - 4;
  const chartW = width - PAD_L - PAD_R;

  const prices = candles.flatMap((c) => [c.high, c.low]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pRange = maxP - minP || 1;

  const volumes = candles.map((c) => c.volume);
  const maxVol = Math.max(...volumes) || 1;

  const toY = (p: number) => PAD_T + chartH - ((p - minP) / pRange) * chartH;
  const volY = (v: number) => PAD_T + chartH + 4 + VOL_H - (v / maxVol) * VOL_H;

  const n = candles.length;
  const candleW = Math.max(1, (chartW / n) * 0.8);
  const step = chartW / n;
  const toX = (i: number) => PAD_L + i * step + step / 2;

  // Price grid lines (4 levels)
  const gridLevels = Array.from({ length: 4 }, (_, i) => minP + (pRange * i) / 3);

  // Time labels — show ~5 evenly spaced
  const timeIdxs = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1];

  // Current price (last close)
  const lastClose = candles[n - 1].close;
  const lastY = toY(lastClose);

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Background */}
      <rect width={width} height={height} fill="transparent" />

      {/* Price grid */}
      {gridLevels.map((p, i) => {
        const y = toY(p);
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={width - PAD_R} y2={y}
              stroke="#1C2338" strokeWidth={1} strokeDasharray="3 3" />
            <text x={PAD_L - 4} y={y + 4} textAnchor="end"
              fontSize={9} fill="#334155" fontFamily="monospace">
              {formatPrice(p)}
            </text>
          </g>
        );
      })}

      {/* Candles */}
      {candles.map((c, i) => {
        const x = toX(i);
        const bull = c.close >= c.open;
        const color = bull ? "#34D399" : "#FB7185";
        const bodyTop    = toY(Math.max(c.open, c.close));
        const bodyBot    = toY(Math.min(c.open, c.close));
        const bodyH      = Math.max(1, bodyBot - bodyTop);
        const wickTop    = toY(c.high);
        const wickBot    = toY(c.low);
        const vY         = volY(c.volume);
        const vH         = Math.max(1, PAD_T + chartH + 4 + VOL_H - vY);

        return (
          <g key={i}>
            {/* Wick */}
            <line x1={x} y1={wickTop} x2={x} y2={wickBot}
              stroke={color} strokeWidth={1} opacity={0.8} />
            {/* Body */}
            <rect
              x={x - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={bull ? color : color}
              stroke={color} strokeWidth={0.5}
              opacity={bull ? 0.9 : 0.75}
            />
            {/* Volume bar */}
            <rect
              x={x - candleW / 2} y={vY}
              width={candleW} height={vH}
              fill={color} opacity={0.25}
            />
          </g>
        );
      })}

      {/* Current price line */}
      <line x1={PAD_L} y1={lastY} x2={width - PAD_R} y2={lastY}
        stroke="#F59E0B" strokeWidth={1} strokeDasharray="4 2" opacity={0.7} />
      <rect x={width - PAD_R - 56} y={lastY - 9} width={54} height={16}
        fill="#F59E0B20" stroke="#F59E0B40" rx={2} />
      <text x={width - PAD_R - 3} y={lastY + 4} textAnchor="end"
        fontSize={9} fill="#F59E0B" fontFamily="monospace" fontWeight="bold">
        {formatPrice(lastClose)}
      </text>

      {/* Time axis */}
      {timeIdxs.map((idx) => {
        if (idx >= n) return null;
        const x = toX(idx);
        const label = formatTime(candles[idx].time, tf);
        return (
          <text key={idx} x={x} y={height - 6} textAnchor="middle"
            fontSize={9} fill="#334155" fontFamily="monospace">
            {label}
          </text>
        );
      })}

      {/* Volume label */}
      <text x={PAD_L - 4} y={PAD_T + chartH + 4 + 10}
        textAnchor="end" fontSize={8} fill="#1E293B" fontFamily="monospace">VOL</text>
    </svg>
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
  const [dims, setDims] = useState({ width: 600, height: 340 });

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setDims({ width: Math.max(300, w), height: 340 });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  // Last candle stats
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pctChange = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;

  return (
    <div style={{ background: "#05070D" }}>
      {/* Timeframe selector */}
      <div style={{
        display: "flex", gap: 4, padding: "10px 16px",
        borderBottom: "1px solid #1C2338", alignItems: "center",
      }}>
        {TIMEFRAMES.map((t) => (
          <button key={t} onClick={() => setTf(t)} style={{
            fontFamily: M, fontSize: 11, fontWeight: 700,
            padding: "3px 10px", cursor: "pointer",
            border: `1px solid ${tf === t ? "#F59E0B" : "#1C2338"}`,
            background: tf === t ? "#F59E0B15" : "transparent",
            color: tf === t ? "#F59E0B" : "#475569",
            borderRadius: 3, transition: "all 0.12s",
          }}>{t.toUpperCase()}</button>
        ))}
        {last && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontFamily: M, fontSize: 10 }}>
            <span style={{ color: "#475569" }}>O <span style={{ color: "#94A3B8" }}>{formatPrice(last.open)}</span></span>
            <span style={{ color: "#475569" }}>H <span style={{ color: "#34D399" }}>{formatPrice(last.high)}</span></span>
            <span style={{ color: "#475569" }}>L <span style={{ color: "#FB7185" }}>{formatPrice(last.low)}</span></span>
            <span style={{ color: "#475569" }}>C <span style={{ color: "#F59E0B" }}>{formatPrice(last.close)}</span></span>
            {pctChange !== null && (
              <span style={{ color: pctChange >= 0 ? "#34D399" : "#FB7185", fontWeight: 700 }}>
                {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div ref={containerRef} style={{ width: "100%", minHeight: 340, position: "relative" }}>
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
            <span>Données indisponibles pour ce timeframe</span>
            <button onClick={load} style={{
              fontFamily: M, fontSize: 11, padding: "4px 12px",
              background: "#1C2338", border: "1px solid #334155",
              color: "#94A3B8", cursor: "pointer", borderRadius: 4,
            }}>Réessayer</button>
          </div>
        )}
        {!loading && !error && candles.length > 0 && (
          <Chart candles={candles} width={dims.width} height={dims.height} tf={tf} />
        )}
      </div>
    </div>
  );
}
