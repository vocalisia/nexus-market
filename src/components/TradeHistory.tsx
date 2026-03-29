"use client";
import type { PerformanceMemory, AlertRecord } from "@/lib/memoryEngine";

const R = "var(--font-rajdhani), sans-serif";
const M = "var(--font-jetbrains), monospace";

// ─── Formatters ───────────────────────────────────────────────

function fmtPrice(p: number | undefined): string {
  if (!p) return "—";
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return "$" + p.toFixed(4);
  return "$" + p.toFixed(6);
}

function fmtPct(a: number, b: number): string {
  const pct = ((b - a) / a) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// ─── TradingView URL ──────────────────────────────────────────

function tvUrl(symbol: string, category: string): string {
  const s = symbol.toUpperCase();
  if (category === "FOREX") {
    const clean = s.replace("/", "");
    return `https://www.tradingview.com/chart/?symbol=FX:${clean}`;
  }
  if (category === "COMMODITIES") {
    const map: Record<string, string> = {
      "XAU/USD": "TVC:GOLD", "GOLD": "TVC:GOLD",
      "XAG/USD": "TVC:SILVER", "SILVER": "TVC:SILVER",
      "WTI": "NYMEX:CL1!", "OIL": "NYMEX:CL1!",
      "NATGAS": "NYMEX:NG1!", "GAS": "NYMEX:NG1!",
    };
    const tv = map[s] ?? `TVC:${s}`;
    return `https://www.tradingview.com/chart/?symbol=${tv}`;
  }
  // CRYPTO default
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${s}USDT`;
}

// ─── Level Badge ──────────────────────────────────────────────

function LevelBadge({ level }: { level?: "TP2" | "TP1" | "SL" | "NONE" }) {
  if (!level || level === "NONE") return null;
  const cfg = {
    TP2: { bg: "#34D39920", color: "#34D399", label: "TP2 ✅" },
    TP1: { bg: "#4ade8020", color: "#4ade80", label: "TP1 ✅" },
    SL:  { bg: "#FB718520", color: "#FB7185", label: "SL ❌"  },
  }[level];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, fontFamily: M, letterSpacing: "0.06em",
      padding: "2px 7px", borderRadius: 3, background: cfg.bg, color: cfg.color,
    }}>{cfg.label}</span>
  );
}

// ─── Row ──────────────────────────────────────────────────────

function Row({ r }: { r: AlertRecord }) {
  const win     = r.result === "WIN";
  const loss    = r.result === "LOSS";
  const neutral = r.result === "NEUTRAL";

  const resultColor = win ? "#34D399" : loss ? "#FB7185" : "#475569";
  const resultIcon  = win ? "✅" : loss ? "❌" : "⚪";
  const ppSign      = r.points >= 0 ? "+" : "";
  const isBuy       = r.type === "BUY";
  const typeColor   = isBuy ? "#4ade80" : "#f87171";
  const movePct     = ((r.priceAtValidation - r.priceAtSignal) / r.priceAtSignal * 100);
  const link        = tvUrl(r.symbol, r.category);

  // Always show levels grid — display "—" for missing values
  const entry   = r.entry   && r.entry   > 0 ? r.entry   : r.priceAtSignal;
  const sl      = r.stopLoss && r.stopLoss > 0 ? r.stopLoss : null;
  const tp1     = r.target1  && r.target1  > 0 ? r.target1  : null;
  const tp2     = r.target2  && r.target2  > 0 ? r.target2  : null;

  const slPct   = sl  && entry ? fmtPct(entry, sl)  : null;
  const tp1Pct  = tp1 && entry ? fmtPct(entry, tp1) : null;
  const tp2Pct  = tp2 && entry ? fmtPct(entry, tp2) : null;

  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: "1px solid #0F1424",
      fontFamily: M,
    }}>

      {/* ── Ligne 1 : result · symbol · direction · sévérité · PP ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{resultIcon}</span>
        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 14, color: "#CBD5E1" }}>{r.symbol}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: R, color: typeColor,
          letterSpacing: "0.08em", padding: "1px 6px",
          border: `1px solid ${typeColor}40`, borderRadius: 3,
        }}>{r.type}</span>
        <span style={{
          fontSize: 10,
          color: r.severity === "HIGH" ? "#FB7185" : r.severity === "MEDIUM" ? "#F59E0B" : "#64748B",
        }}>{r.severity}</span>
        <a
          href={link} target="_blank" rel="noopener noreferrer"
          style={{
            fontSize: 9, fontWeight: 700, fontFamily: M,
            padding: "2px 6px", borderRadius: 3,
            background: "#1C2338", color: "#60A5FA",
            textDecoration: "none", border: "1px solid #2563EB40",
          }}
          onClick={(e) => e.stopPropagation()}
        >TV ↗</a>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 13, color: neutral ? "#475569" : resultColor }}>
          {neutral ? "—" : `${ppSign}${r.points.toFixed(2)} PP`}
        </span>
      </div>

      {/* ── Ligne 2 : date + heure du signal (prominent) ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "5px 8px", marginBottom: 6,
        background: "#0A0D18", borderRadius: 4,
        border: "1px solid #1C2338", fontSize: 11, fontFamily: M,
      }}>
        <span style={{ fontSize: 9, color: "#334155", letterSpacing: "0.08em" }}>SIGNAL ENVOYÉ</span>
        <span style={{ color: "#94A3B8", fontWeight: 700 }}>
          {new Date(r.generatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
        </span>
        <span style={{ color: "#F59E0B", fontWeight: 700, fontSize: 13 }}>
          {new Date(r.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span style={{ color: "#1E293B" }}>·</span>
        <span style={{ fontSize: 9, color: "#334155" }}>PRIX SIGNAL</span>
        <span style={{ color: "#64748B" }}>{fmtPrice(r.priceAtSignal)}</span>
      </div>

      {/* ── Ligne 3 : grille ENTRÉE / SL / TP1 / TP2 ── */}
      <div style={{
        display: "flex", gap: 0, borderRadius: 5, overflow: "hidden",
        border: "1px solid #1C2338", fontSize: 11, marginBottom: 6,
      }}>
        {/* ENTRÉE */}
        <div style={{ flex: 1, padding: "7px 9px", background: "#05070D", borderRight: "1px solid #1C2338" }}>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.07em", marginBottom: 3 }}>ENTRÉE</div>
          <div style={{ color: "#CBD5E1", fontWeight: 700 }}>{fmtPrice(entry)}</div>
        </div>

        {/* SL */}
        <div style={{
          flex: 1, padding: "7px 9px", borderRight: "1px solid #1C2338",
          background: loss && r.levelHit === "SL" ? "#FB718510" : "#05070D",
        }}>
          <div style={{ fontSize: 9, color: "#FB718570", letterSpacing: "0.07em", marginBottom: 3 }}>STOP LOSS</div>
          <div style={{ color: sl ? "#FB7185" : "#334155", fontWeight: 700 }}>{sl ? fmtPrice(sl) : "—"}</div>
          {slPct && <div style={{ fontSize: 9, color: "#FB718555", marginTop: 1 }}>{slPct}</div>}
        </div>

        {/* TP1 */}
        <div style={{
          flex: 1, padding: "7px 9px",
          borderRight: "1px solid #1C2338",
          background: win && r.levelHit === "TP1" ? "#4ade8010" : "#05070D",
        }}>
          <div style={{ fontSize: 9, color: "#4ade8070", letterSpacing: "0.07em", marginBottom: 3 }}>TARGET 1</div>
          <div style={{ color: tp1 ? "#4ade80" : "#334155", fontWeight: 700 }}>{tp1 ? fmtPrice(tp1) : "—"}</div>
          {tp1Pct && <div style={{ fontSize: 9, color: "#4ade8055", marginTop: 1 }}>{tp1Pct}</div>}
        </div>

        {/* TP2 */}
        <div style={{
          flex: 1, padding: "7px 9px",
          background: win && r.levelHit === "TP2" ? "#34D39910" : "#05070D",
        }}>
          <div style={{ fontSize: 9, color: "#34D39970", letterSpacing: "0.07em", marginBottom: 3 }}>TARGET 2</div>
          <div style={{ color: tp2 ? "#34D399" : "#334155", fontWeight: 700 }}>{tp2 ? fmtPrice(tp2) : "—"}</div>
          {tp2Pct && <div style={{ fontSize: 9, color: "#34D39955", marginTop: 1 }}>{tp2Pct}</div>}
        </div>
      </div>

      {/* ── Ligne 4 : résultat validation ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10 }}>
        <LevelBadge level={r.levelHit} />
        <span style={{ color: "#334155" }}>validation:</span>
        <span style={{ color: movePct >= 0 ? "#34D399" : "#FB7185", fontWeight: 600 }}>
          {fmtPrice(r.priceAtValidation)} ({movePct >= 0 ? "+" : ""}{movePct.toFixed(2)}%)
        </span>
        <span style={{ color: "#1E293B", marginLeft: "auto" }}>
          {new Date(r.validatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
          {" "}
          <span style={{ color: "#334155" }}>
            {new Date(r.validatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────

export function TradeHistory({ memory }: { memory: PerformanceMemory }) {
  const history  = [...memory.history].reverse();
  const decisive = memory.totalWins + memory.totalLosses;

  const tp2Count = history.filter((r) => r.levelHit === "TP2").length;
  const tp1Count = history.filter((r) => r.levelHit === "TP1").length;
  const slCount  = history.filter((r) => r.levelHit === "SL").length;

  return (
    <div style={{ fontFamily: R }}>

      {/* ── Header stats ── */}
      <div style={{
        padding: "12px 14px", borderBottom: "1px solid #1C2338",
        display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#F1F5F9", fontFamily: M }}>
            {decisive > 0 ? `${memory.globalWinRate}%` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}>WIN RATE</div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: M,
            color: memory.totalPoints >= 0 ? "#34D399" : "#FB7185" }}>
            {memory.totalPoints >= 0 ? "+" : ""}{memory.totalPoints.toFixed(2)} PP
          </div>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}>TOTAL</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginLeft: "auto", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#34D399" }}>✅ {memory.totalWins}W</span>
          <span style={{ fontSize: 11, color: "#FB7185" }}>❌ {memory.totalLosses}L</span>
          <span style={{ fontSize: 11, color: "#64748B" }}>⚪ {memory.totalNeutrals}N</span>
          {tp2Count > 0 && <span style={{ fontSize: 10, color: "#34D399" }}>TP2×{tp2Count}</span>}
          {tp1Count > 0 && <span style={{ fontSize: 10, color: "#4ade80" }}>TP1×{tp1Count}</span>}
          {slCount  > 0 && <span style={{ fontSize: 10, color: "#FB7185" }}>SL×{slCount}</span>}
        </div>
      </div>

      {/* ── Phase badge ── */}
      <div style={{
        padding: "6px 14px", borderBottom: "1px solid #1C2338",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
          padding: "2px 8px", borderRadius: 3, fontFamily: M,
          background: memory.learningPhase === "FULL" ? "#34D39920" :
                      memory.learningPhase === "ACTIVE" ? "#3B82F620" :
                      memory.learningPhase === "WARMING" ? "#F59E0B20" : "#1C2338",
          color: memory.learningPhase === "FULL" ? "#34D399" :
                 memory.learningPhase === "ACTIVE" ? "#60A5FA" :
                 memory.learningPhase === "WARMING" ? "#F59E0B" : "#475569",
        }}>{memory.learningPhase}</span>
        <span style={{ fontSize: 10, color: "#475569" }}>
          {memory.totalValidated} validations · {Math.max(0, 20 - memory.totalValidated)} restantes pour WARMING
        </span>
        <span style={{ fontSize: 9, color: "#1E293B", marginLeft: "auto" }}>
          cliquer TV ↗ pour vérifier sur TradingView
        </span>
      </div>

      {/* ── Rows ── */}
      {history.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#334155", fontSize: 13 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          Aucune validation encore.
          <br />
          <span style={{ fontSize: 11, color: "#1E293B" }}>
            Les alertes sont validées automatiquement après 1h (crypto) ou quand SL/TP est atteint.
          </span>
        </div>
      ) : (
        history.map((r) => <Row key={r.alertId + r.validatedAt} r={r} />)
      )}
    </div>
  );
}
