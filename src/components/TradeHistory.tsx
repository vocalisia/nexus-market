"use client";
import type { PerformanceMemory, AlertRecord } from "@/lib/memoryEngine";

const R = "var(--font-rajdhani), sans-serif";
const M = "var(--font-jetbrains), monospace";

function formatPrice(p: number): string {
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return "$" + p.toFixed(4);
  return "$" + p.toFixed(6);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

function Row({ r }: { r: AlertRecord }) {
  const win = r.result === "WIN";
  const loss = r.result === "LOSS";
  const neutral = r.result === "NEUTRAL";

  const resultColor = win ? "#34D399" : loss ? "#FB7185" : "#64748B";
  const resultIcon = win ? "✅" : loss ? "❌" : "⚪";
  const ppSign = r.points >= 0 ? "+" : "";
  const typeColor = r.type === "BUY" ? "#4ade80" : "#f87171";
  const movePct = ((r.priceAtValidation - r.priceAtSignal) / r.priceAtSignal * 100);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "18px 80px 44px 90px 90px 64px 52px",
      gap: 6,
      padding: "8px 14px",
      borderBottom: "1px solid #0F1424",
      alignItems: "center",
      fontSize: 11,
      fontFamily: M,
    }}>
      {/* Icon */}
      <span style={{ fontSize: 13 }}>{resultIcon}</span>

      {/* Symbol + type */}
      <div>
        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 12, color: "#CBD5E1" }}>{r.symbol}</span>
        {" "}
        <span style={{
          fontSize: 9, fontWeight: 700, fontFamily: R,
          color: typeColor, letterSpacing: "0.08em",
        }}>{r.type}</span>
      </div>

      {/* Severity */}
      <span style={{
        fontSize: 9, color:
          r.severity === "HIGH" ? "#FB7185" :
          r.severity === "MEDIUM" ? "#F59E0B" : "#64748B",
        fontFamily: R, letterSpacing: "0.06em",
      }}>{r.severity}</span>

      {/* Price at signal */}
      <span style={{ color: "#475569" }}>{formatPrice(r.priceAtSignal)}</span>

      {/* Price at validation */}
      <span style={{ color: "#94A3B8" }}>{formatPrice(r.priceAtValidation)}</span>

      {/* Move % */}
      <span style={{ color: movePct >= 0 ? "#34D399" : "#FB7185" }}>
        {movePct >= 0 ? "+" : ""}{movePct.toFixed(2)}%
      </span>

      {/* PP */}
      <span style={{
        fontWeight: 700, textAlign: "right",
        color: neutral ? "#64748B" : resultColor,
      }}>
        {neutral ? "—" : `${ppSign}${r.points.toFixed(2)}`}
        {!neutral && <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>PP</span>}
      </span>
    </div>
  );
}

export function TradeHistory({ memory }: { memory: PerformanceMemory }) {
  const history = [...memory.history].reverse(); // newest first
  const decisive = memory.totalWins + memory.totalLosses;

  return (
    <div style={{ fontFamily: R }}>
      {/* Header summary */}
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
          <div style={{ fontSize: 16, fontWeight: 700, color: memory.totalPoints >= 0 ? "#34D399" : "#FB7185", fontFamily: M }}>
            {memory.totalPoints >= 0 ? "+" : ""}{memory.totalPoints.toFixed(2)} PP
          </div>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}>TOTAL</div>
        </div>
        <div style={{ display: "flex", gap: 12, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: "#34D399" }}>✅ {memory.totalWins}W</span>
          <span style={{ fontSize: 11, color: "#FB7185" }}>❌ {memory.totalLosses}L</span>
          <span style={{ fontSize: 11, color: "#64748B" }}>⚪ {memory.totalNeutrals}N</span>
        </div>
      </div>

      {/* Phase badge */}
      <div style={{ padding: "6px 14px", borderBottom: "1px solid #1C2338", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", padding: "2px 8px",
          borderRadius: 3, fontFamily: M,
          background: memory.learningPhase === "FULL" ? "#34D39920" :
                      memory.learningPhase === "ACTIVE" ? "#3B82F620" :
                      memory.learningPhase === "WARMING" ? "#F59E0B20" : "#1C2338",
          color: memory.learningPhase === "FULL" ? "#34D399" :
                 memory.learningPhase === "ACTIVE" ? "#60A5FA" :
                 memory.learningPhase === "WARMING" ? "#F59E0B" : "#475569",
        }}>{memory.learningPhase}</span>
        <span style={{ fontSize: 10, color: "#475569" }}>
          {memory.totalValidated} validations · encore {Math.max(0, 20 - memory.totalValidated)} pour WARMING
        </span>
      </div>

      {/* Column headers */}
      {history.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "18px 80px 44px 90px 90px 64px 52px",
          gap: 6, padding: "6px 14px",
          borderBottom: "1px solid #1C2338",
          fontSize: 9, color: "#334155", fontFamily: M, letterSpacing: "0.06em",
        }}>
          <span />
          <span>ASSET</span>
          <span>SEV</span>
          <span>ENTRÉE</span>
          <span>VALIDATION</span>
          <span>MOVE</span>
          <span style={{ textAlign: "right" }}>PP</span>
        </div>
      )}

      {/* Rows */}
      {history.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#334155", fontSize: 13 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          Aucune validation encore.
          <br />
          <span style={{ fontSize: 11, color: "#1E293B" }}>Les alertes BUY/SELL sont validées après 4h (crypto).</span>
        </div>
      ) : (
        history.map((r) => <Row key={r.alertId + r.validatedAt} r={r} />)
      )}
    </div>
  );
}
