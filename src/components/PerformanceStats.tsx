"use client";
import type { PerformanceMemory } from "@/lib/memoryEngine";

interface PerformanceStatsProps {
  memory: PerformanceMemory;
  onReset: () => void;
  winRateTrend: "UP" | "DOWN" | "STABLE";
}

const PHASE_COLORS: Record<PerformanceMemory["learningPhase"], string> = {
  COLD:    "#64748B",
  WARMING: "#F59E0B",
  ACTIVE:  "#3B82F6",
  FULL:    "#34D399",
};

const PHASE_LABELS: Record<PerformanceMemory["learningPhase"], string> = {
  COLD:    "FROID",
  WARMING: "CHAUFFE",
  ACTIVE:  "ACTIF",
  FULL:    "COMPLET",
};

const TREND_ICON: Record<"UP" | "DOWN" | "STABLE", string> = {
  UP:     "↑",
  DOWN:   "↓",
  STABLE: "→",
};

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.6)",
        border: "1px solid #1E293B",
        borderRadius: "8px",
        padding: "12px 16px",
        minWidth: "120px",
        flex: 1,
      }}
    >
      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, color: color ?? "#F1F5F9" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function WinRateBar({ rate }: { rate: number }) {
  const color = rate >= 60 ? "#34D399" : rate >= 45 ? "#F59E0B" : "#FB7185";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "6px", background: "#1E293B", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${rate}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: "11px", color, fontWeight: 600, minWidth: "32px" }}>{rate}%</span>
    </div>
  );
}

export function PerformanceStats({ memory, onReset, winRateTrend }: PerformanceStatsProps) {
  const ppColor = memory.totalPoints >= 0 ? "#34D399" : "#FB7185";
  const topAssets = Object.values(memory.byAsset)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, 5);

  return (
    <div style={{ padding: "0 0 16px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#F1F5F9" }}>
            IA PERFORMANCE
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#475569" }}>
            Auto-validation des alertes BUY/SELL
          </p>
        </div>
        <button
          onClick={onReset}
          style={{
            padding: "4px 10px",
            background: "transparent",
            border: "1px solid #334155",
            borderRadius: "4px",
            color: "#475569",
            fontSize: "11px",
            cursor: "pointer",
          }}
          title="Remettre à zéro la mémoire"
        >
          Réinitialiser
        </button>
      </div>

      {/* Phase indicator */}
      <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            padding: "2px 10px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 700,
            background: `${PHASE_COLORS[memory.learningPhase]}20`,
            border: `1px solid ${PHASE_COLORS[memory.learningPhase]}`,
            color: PHASE_COLORS[memory.learningPhase],
          }}
        >
          ● {PHASE_LABELS[memory.learningPhase]}
        </span>
        <span style={{ fontSize: "11px", color: "#475569" }}>
          {memory.totalValidated} alertes validées
        </span>
        {memory.learningPhase === "COLD" && (
          <span style={{ fontSize: "11px", color: "#F59E0B" }}>
            ({20 - memory.totalValidated} pour activer l'apprentissage)
          </span>
        )}
      </div>

      {/* Main stats */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        <StatCard
          label="Win Rate"
          value={`${memory.globalWinRate}%`}
          sub={`Tendance ${TREND_ICON[winRateTrend]}`}
          color={memory.globalWinRate >= 60 ? "#34D399" : memory.globalWinRate >= 45 ? "#F59E0B" : "#FB7185"}
        />
        <StatCard
          label="PP Total"
          value={`${memory.totalPoints >= 0 ? "+" : ""}${memory.totalPoints}`}
          sub="Points de Précision"
          color={ppColor}
        />
        <StatCard
          label="Alertes"
          value={String(memory.totalValidated)}
          sub={`${memory.totalWins}W / ${memory.totalLosses}L / ${memory.totalNeutrals}N`}
        />
        <StatCard
          label="Phase IA"
          value={PHASE_LABELS[memory.learningPhase]}
          color={PHASE_COLORS[memory.learningPhase]}
        />
      </div>

      {/* Degradation warning */}
      {memory.degradationStreak >= 5 && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(251,113,133,0.1)",
            border: "1px solid #FB7185",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#FB7185",
            marginBottom: "16px",
          }}
        >
          ⚠️ {memory.degradationStreak} erreurs consécutives — réinitialisation auto à 10
        </div>
      )}

      {/* By regime */}
      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 600, color: "#64748B" }}>
          PERFORMANCE PAR RÉGIME
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(["BULL", "BEAR", "RANGING", "TRANSITION"] as const).map((regime) => {
            const s = memory.byRegime[regime];
            const total = s.wins + s.losses;
            if (total === 0) return null;
            const labels: Record<string, string> = {
              BULL: "Hausse", BEAR: "Baisse", RANGING: "Plat", TRANSITION: "Transition",
            };
            return (
              <div key={regime} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "11px", color: "#94A3B8", minWidth: "80px" }}>
                  {labels[regime]}
                </span>
                <WinRateBar rate={s.winRate} />
                <span style={{ fontSize: "11px", color: "#475569", minWidth: "70px", textAlign: "right" }}>
                  {s.wins}W / {s.losses}L
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top assets */}
      {topAssets.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 600, color: "#64748B" }}>
            TOP ACTIFS (PP)
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {topAssets.map((a) => (
              <div key={a.symbol} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>{a.symbol}</span>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: "#475569" }}>
                    {a.winRate}% win ({a.wins}W/{a.losses}L)
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: a.totalPoints >= 0 ? "#34D399" : "#FB7185",
                      minWidth: "55px",
                      textAlign: "right",
                    }}
                  >
                    {a.totalPoints >= 0 ? "+" : ""}{a.totalPoints} PP
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indicator weights */}
      <div>
        <h4 style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: 600, color: "#64748B" }}>
          POIDS INDICATEURS
        </h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {(Object.entries(memory.weights) as [string, number][]).map(([key, weight]) => {
            const isHigh = weight > 1.2;
            const isLow = weight < 0.8;
            const color = isHigh ? "#34D399" : isLow ? "#FB7185" : "#64748B";
            return (
              <div
                key={key}
                style={{
                  padding: "3px 8px",
                  background: "#0F172A",
                  border: `1px solid ${color}40`,
                  borderRadius: "4px",
                  fontSize: "10px",
                  color,
                }}
              >
                {key.toUpperCase()}: {weight.toFixed(2)}
              </div>
            );
          })}
        </div>
        {memory.lastWeightUpdate && (
          <p style={{ fontSize: "10px", color: "#334155", margin: "6px 0 0" }}>
            Dernière mise à jour : {new Date(memory.lastWeightUpdate).toLocaleString("fr-FR")}
          </p>
        )}
      </div>
    </div>
  );
}
