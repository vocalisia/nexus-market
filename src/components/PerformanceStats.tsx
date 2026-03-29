"use client";
import { useMemo } from "react";
import type { PerformanceMemory } from "@/lib/memoryEngine";
import { computeAnalytics } from "@/lib/analytics";

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

// ─── Reusable atoms ───────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: "rgba(15,23,42,0.6)", border: "1px solid #1E293B",
      borderRadius: "8px", padding: "12px 16px", minWidth: "110px", flex: 1,
    }}>
      <div style={{ fontSize: "10px", color: "#64748B", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: color ?? "#F1F5F9" }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: "#475569", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 style={{ margin: "0 0 8px", fontSize: "11px", fontWeight: 700, color: "#64748B", letterSpacing: "0.08em" }}>
      {children}
    </h4>
  );
}

function WinRateBar({ rate, small }: { rate: number; small?: boolean }) {
  const color = rate >= 60 ? "#34D399" : rate >= 45 ? "#F59E0B" : "#FB7185";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ flex: 1, height: small ? "4px" : "6px", background: "#1E293B", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${rate}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: "11px", color, fontWeight: 600, minWidth: "32px" }}>{rate}%</span>
    </div>
  );
}

// ─── PP Sparkline ─────────────────────────────────────────────

function PPSparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return (
      <div style={{ height: "48px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "11px", color: "#334155" }}>Pas assez de données</span>
      </div>
    );
  }

  const W = 300;
  const H = 48;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const mapY = (v: number) => pad + ((max - v) / range) * (H - pad * 2);
  const mapX = (i: number) => (i / (data.length - 1)) * W;

  const points = data.map((v, i) => `${mapX(i).toFixed(1)},${mapY(v).toFixed(1)}`).join(" ");
  const fillBottom = `${mapX(data.length - 1)},${H} ${mapX(0)},${H}`;
  const final = data[data.length - 1];
  const color = final >= 0 ? "#34D399" : "#FB7185";
  const zeroY = mapY(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "48px" }}>
      {/* Zero line */}
      {min < 0 && max > 0 && (
        <line x1={0} y1={zeroY} x2={W} y2={zeroY}
          stroke="#334155" strokeWidth={0.8} strokeDasharray="3,3" />
      )}
      {/* Fill */}
      <polyline
        points={`${points} ${fillBottom}`}
        fill={`${color}18`} stroke="none"
      />
      {/* Line */}
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Last dot */}
      <circle cx={mapX(data.length - 1)} cy={mapY(final)} r={2.5} fill={color} />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────

export function PerformanceStats({ memory, onReset, winRateTrend }: PerformanceStatsProps) {
  const analytics = useMemo(() => computeAnalytics(memory.history), [memory.history]);

  const ppColor    = memory.totalPoints >= 0 ? "#34D399" : "#FB7185";
  const pfColor    = analytics.profitFactor >= 1.5 ? "#34D399"
                   : analytics.profitFactor >= 1.0 ? "#F59E0B" : "#FB7185";
  const evColor    = analytics.expectedValue >= 0 ? "#34D399" : "#FB7185";
  const topAssets  = Object.values(memory.byAsset)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, 5);

  const streakLabel = analytics.currentStreak.type === "NONE" ? "—"
    : `${analytics.currentStreak.count} ${analytics.currentStreak.type === "WIN" ? "WIN" : "LOSS"}`;
  const streakColor = analytics.currentStreak.type === "WIN" ? "#34D399"
    : analytics.currentStreak.type === "LOSS" ? "#FB7185" : "#64748B";

  const trendIcon = winRateTrend === "UP" ? "↑" : winRateTrend === "DOWN" ? "↓" : "→";

  return (
    <div style={{ padding: "0 0 16px 0" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#F1F5F9" }}>ANALYSE PERFORMANCE IA</h3>
          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#475569" }}>
            {memory.totalValidated} alertes validées · Phase {PHASE_LABELS[memory.learningPhase]}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{
            padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: 700,
            background: `${PHASE_COLORS[memory.learningPhase]}20`,
            border: `1px solid ${PHASE_COLORS[memory.learningPhase]}`,
            color: PHASE_COLORS[memory.learningPhase],
          }}>
            ● {PHASE_LABELS[memory.learningPhase]}
          </span>
          <button
            onClick={onReset}
            style={{
              padding: "3px 8px", background: "transparent", border: "1px solid #334155",
              borderRadius: "4px", color: "#475569", fontSize: "11px", cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* ── Degradation warning ── */}
      {memory.degradationStreak >= 5 && (
        <div style={{
          padding: "8px 12px", background: "rgba(251,113,133,0.1)", border: "1px solid #FB7185",
          borderRadius: "6px", fontSize: "12px", color: "#FB7185", marginBottom: "12px",
        }}>
          ⚠ {memory.degradationStreak} erreurs consécutives — réinitialisation auto des poids à 10
        </div>
      )}

      {/* ── KPIs row 1: core ── */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
        <StatCard
          label="Win Rate"
          value={`${memory.globalWinRate}%`}
          sub={`Tendance ${trendIcon}`}
          color={memory.globalWinRate >= 60 ? "#34D399" : memory.globalWinRate >= 45 ? "#F59E0B" : "#FB7185"}
        />
        <StatCard
          label="PP Total"
          value={`${memory.totalPoints >= 0 ? "+" : ""}${memory.totalPoints}`}
          sub={`${memory.totalWins}W / ${memory.totalLosses}L / ${memory.totalNeutrals}N`}
          color={ppColor}
        />
        <StatCard
          label="Profit Factor"
          value={analytics.profitFactor >= 99 ? "∞" : analytics.profitFactor.toFixed(2)}
          sub="Gains / Pertes"
          color={pfColor}
        />
        <StatCard
          label="EV / Trade"
          value={`${analytics.expectedValue >= 0 ? "+" : ""}${analytics.expectedValue}`}
          sub="PP espéré"
          color={evColor}
        />
      </div>

      {/* ── KPIs row 2: risk ── */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        <StatCard
          label="Série actuelle"
          value={streakLabel}
          sub={`Max: ${analytics.bestWinStreak}W / ${analytics.worstLossStreak}L`}
          color={streakColor}
        />
        <StatCard
          label="Max Drawdown"
          value={`-${analytics.maxDrawdown}`}
          sub="PP depuis sommet"
          color={analytics.maxDrawdown > 10 ? "#FB7185" : "#64748B"}
        />
        <StatCard
          label="Moy. WIN"
          value={`+${analytics.avgWinPP}`}
          sub="PP par victoire"
          color="#34D399"
        />
        <StatCard
          label="Moy. LOSS"
          value={`${analytics.avgLossPP}`}
          sub="PP par perte"
          color="#FB7185"
        />
      </div>

      {/* ── Cumulative PP sparkline ── */}
      <div style={{ marginBottom: "14px" }}>
        <SectionTitle>COURBE PP CUMULÉS (50 DERNIERS TRADES)</SectionTitle>
        <div style={{
          background: "rgba(15,23,42,0.6)", border: "1px solid #1E293B",
          borderRadius: "8px", padding: "8px 12px",
        }}>
          <PPSparkline data={analytics.cumulativePP} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            <span style={{ fontSize: "10px", color: "#334155" }}>
              {analytics.cumulativePP.length} pts tracés
            </span>
            <span style={{
              fontSize: "11px", fontWeight: 600,
              color: (analytics.cumulativePP[analytics.cumulativePP.length - 1] ?? 0) >= 0 ? "#34D399" : "#FB7185",
            }}>
              {analytics.cumulativePP.length > 0
                ? `${analytics.cumulativePP[analytics.cumulativePP.length - 1] >= 0 ? "+" : ""}${analytics.cumulativePP[analytics.cumulativePP.length - 1]} PP`
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Recent form ── */}
      <div style={{ marginBottom: "14px" }}>
        <SectionTitle>FORME RÉCENTE (10 DERNIERS DÉCISIFS)</SectionTitle>
        {analytics.recentForm.n === 0 ? (
          <span style={{ fontSize: "11px", color: "#334155" }}>Pas encore de données</span>
        ) : (
          <div style={{
            background: "rgba(15,23,42,0.6)", border: "1px solid #1E293B",
            borderRadius: "8px", padding: "10px 14px",
            display: "flex", alignItems: "center", gap: "16px",
          }}>
            <WinRateBar rate={analytics.recentForm.winRate} />
            <span style={{ fontSize: "11px", color: "#475569", whiteSpace: "nowrap" }}>
              {analytics.recentForm.wins}W / {analytics.recentForm.losses}L
            </span>
            <span style={{
              fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap",
              color: analytics.recentForm.totalPP >= 0 ? "#34D399" : "#FB7185",
            }}>
              {analytics.recentForm.totalPP >= 0 ? "+" : ""}{analytics.recentForm.totalPP} PP
            </span>
          </div>
        )}
      </div>

      {/* ── BUY vs SELL ── */}
      <div style={{ marginBottom: "14px" }}>
        <SectionTitle>PERFORMANCE BUY vs SELL</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(["BUY", "SELL"] as const).map((t) => {
            const s = analytics.byType[t];
            if (s.wins + s.losses === 0) return null;
            const color = t === "BUY" ? "#34D399" : "#FB7185";
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{
                  fontSize: "10px", fontWeight: 700, color,
                  background: `${color}20`, border: `1px solid ${color}40`,
                  padding: "1px 6px", borderRadius: "3px", minWidth: "38px", textAlign: "center",
                }}>
                  {t}
                </span>
                <WinRateBar rate={s.winRate} small />
                <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", minWidth: "55px" }}>
                  {s.wins}W / {s.losses}L
                </span>
                <span style={{
                  fontSize: "11px", fontWeight: 600,
                  color: s.totalPP >= 0 ? "#34D399" : "#FB7185",
                  minWidth: "52px", textAlign: "right",
                }}>
                  {s.totalPP >= 0 ? "+" : ""}{s.totalPP} PP
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── By conviction ── */}
      <div style={{ marginBottom: "14px" }}>
        <SectionTitle>WIN RATE PAR CONVICTION IA</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(Object.entries(analytics.byConviction) as [string, typeof analytics.byConviction["FORT >65"]][]).map(([label, s]) => {
            if (s.wins + s.losses === 0) return null;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", color: "#94A3B8", minWidth: "88px" }}>{label}</span>
                <WinRateBar rate={s.winRate} small />
                <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", minWidth: "55px" }}>
                  {s.wins}W / {s.losses}L
                </span>
                <span style={{
                  fontSize: "11px", fontWeight: 600,
                  color: s.avgPP >= 0 ? "#34D399" : "#FB7185",
                  minWidth: "52px", textAlign: "right",
                }}>
                  {s.avgPP >= 0 ? "+" : ""}{s.avgPP}/T
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── By regime ── */}
      <div style={{ marginBottom: "14px" }}>
        <SectionTitle>PERFORMANCE PAR RÉGIME</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(["BULL", "BEAR", "RANGING", "TRANSITION"] as const).map((regime) => {
            const s = memory.byRegime[regime];
            if (s.wins + s.losses === 0) return null;
            const labels: Record<string, string> = { BULL: "Hausse", BEAR: "Baisse", RANGING: "Plat", TRANSITION: "Transition" };
            return (
              <div key={regime} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", color: "#94A3B8", minWidth: "72px" }}>{labels[regime]}</span>
                <WinRateBar rate={s.winRate} small />
                <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", minWidth: "55px" }}>
                  {s.wins}W / {s.losses}L
                </span>
                <span style={{
                  fontSize: "11px", fontWeight: 600,
                  color: s.totalPoints >= 0 ? "#34D399" : "#FB7185",
                  minWidth: "52px", textAlign: "right",
                }}>
                  {s.totalPoints >= 0 ? "+" : ""}{s.totalPoints} PP
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── By category ── */}
      {Object.keys(analytics.byCategory).length > 1 && (
        <div style={{ marginBottom: "14px" }}>
          <SectionTitle>PERFORMANCE PAR CATÉGORIE</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {Object.entries(analytics.byCategory)
              .sort(([, a], [, b]) => b.totalPP - a.totalPP)
              .map(([cat, s]) => {
                if (s.wins + s.losses === 0) return null;
                return (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "10px", color: "#94A3B8", minWidth: "90px" }}>{cat}</span>
                    <WinRateBar rate={s.winRate} small />
                    <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", minWidth: "55px" }}>
                      {s.wins}W / {s.losses}L
                    </span>
                    <span style={{
                      fontSize: "11px", fontWeight: 600,
                      color: s.totalPP >= 0 ? "#34D399" : "#FB7185",
                      minWidth: "52px", textAlign: "right",
                    }}>
                      {s.totalPP >= 0 ? "+" : ""}{s.totalPP} PP
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Top assets ── */}
      {topAssets.length > 0 && (
        <div style={{ marginBottom: "14px" }}>
          <SectionTitle>TOP ACTIFS (PP)</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {topAssets.map((a) => (
              <div key={a.symbol} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>{a.symbol.toUpperCase()}</span>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <span style={{ fontSize: "10px", color: "#475569" }}>
                    {a.winRate}% ({a.wins}W/{a.losses}L)
                  </span>
                  <span style={{
                    fontSize: "12px", fontWeight: 700,
                    color: a.totalPoints >= 0 ? "#34D399" : "#FB7185",
                    minWidth: "55px", textAlign: "right",
                  }}>
                    {a.totalPoints >= 0 ? "+" : ""}{a.totalPoints} PP
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Indicator weights (collapsed) ── */}
      <div>
        <SectionTitle>POIDS INDICATEURS (AUTO-LEARNING)</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {(Object.entries(memory.weights) as [string, number][]).map(([key, weight]) => {
            const isHigh = weight > 1.2;
            const isLow  = weight < 0.8;
            const color  = isHigh ? "#34D399" : isLow ? "#FB7185" : "#64748B";
            return (
              <div key={key} style={{
                padding: "2px 7px", background: "#0F172A",
                border: `1px solid ${color}40`, borderRadius: "4px",
                fontSize: "10px", color,
              }}>
                {key.toUpperCase()}: {weight.toFixed(2)}
              </div>
            );
          })}
        </div>
        {memory.lastWeightUpdate && (
          <p style={{ fontSize: "10px", color: "#334155", margin: "5px 0 0" }}>
            Dernière MAJ : {new Date(memory.lastWeightUpdate).toLocaleString("fr-FR")}
          </p>
        )}
      </div>

    </div>
  );
}
