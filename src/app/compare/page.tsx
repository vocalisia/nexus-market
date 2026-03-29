"use client";
import { useEffect, useState, useCallback } from "react";
import { MODEL_VARIANTS } from "@/lib/modelVariants";
import type { VariantId } from "@/lib/modelVariants";
import type { PerformanceMemory } from "@/lib/memoryEngine";
import { computeAnalytics } from "@/lib/analytics";
import type { MetaLearnReport } from "@/app/api/meta-learn/route";

// ─── Per-variant snapshot ─────────────────────────────────────

interface VariantSnapshot {
  id: VariantId;
  memory: PerformanceMemory | null;
}

// ─── Helpers ──────────────────────────────────────────────────

const M = "var(--font-jetbrains), monospace";

function cell(value: string, color?: string) {
  return (
    <td style={{
      padding: "10px 14px", textAlign: "right",
      fontSize: "13px", fontWeight: 600, color: color ?? "#94A3B8",
      borderBottom: "1px solid #0F172A",
    }}>
      {value}
    </td>
  );
}

function headerCell(label: string) {
  return (
    <th style={{
      padding: "8px 14px", textAlign: "right", fontSize: "10px",
      fontWeight: 700, color: "#475569", letterSpacing: "0.08em",
      borderBottom: "1px solid #1E293B", background: "#050810",
    }}>
      {label}
    </th>
  );
}

function ppColor(v: number) { return v >= 0 ? "#34D399" : "#FB7185"; }
function wrColor(v: number) { return v >= 60 ? "#34D399" : v >= 45 ? "#F59E0B" : "#FB7185"; }

// ─── Page ─────────────────────────────────────────────────────

export default function ComparePage() {
  const [snapshots, setSnapshots] = useState<VariantSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [metaReport, setMetaReport] = useState<MetaLearnReport | null>(null);
  const [metaRunning, setMetaRunning] = useState(false);

  useEffect(() => {
    const variants: VariantId[] = ["1", "2", "3", "4"];
    Promise.all(
      variants.map(async (v) => {
        try {
          const res = await fetch(`/api/memory?variant=${v}`);
          const data = res.ok ? (await res.json()) as PerformanceMemory | null : null;
          return { id: v, memory: data };
        } catch {
          return { id: v, memory: null };
        }
      })
    ).then((results) => {
      setSnapshots(results);
      setLoading(false);
    });
    // Load last meta-learn report
    fetch("/api/meta-learn").then((r) => r.json()).then((d) => {
      if (d) setMetaReport(d as MetaLearnReport);
    }).catch(() => {});
  }, []);

  const runMetaLearn = useCallback(async () => {
    setMetaRunning(true);
    try {
      const res = await fetch("/api/meta-learn", { method: "POST" });
      const report = await res.json() as MetaLearnReport;
      setMetaReport(report);
    } catch { /* ignore */ } finally {
      setMetaRunning(false);
    }
  }, []);

  const best = snapshots.reduce<VariantId | null>((acc, s) => {
    if (!s.memory || s.memory.totalValidated < 5) return acc;
    if (!acc) return s.id;
    const prev = snapshots.find((x) => x.id === acc)?.memory;
    if (!prev) return s.id;
    return s.memory.globalWinRate > prev.globalWinRate ? s.id : acc;
  }, null);

  return (
    <div style={{ minHeight: "100vh", background: "#05070D", color: "#F1F5F9", fontFamily: M, padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "0.12em" }}>
              NEXUS <span style={{ color: "#F59E0B" }}>COMPARE</span>
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#475569" }}>
              Comparaison des 4 modèles de prédiction · données live Upstash
            </p>
          </div>
          <a href="/" style={{
            padding: "6px 14px", border: "1px solid #1E293B", borderRadius: "6px",
            color: "#475569", fontSize: "11px", textDecoration: "none",
          }}>
            ← Dashboard
          </a>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontSize: "13px" }}>
            Chargement des données…
          </div>
        ) : (
          <>
            {/* Model cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
              {snapshots.map((s) => {
                const cfg = MODEL_VARIANTS[s.id];
                const m = s.memory;
                const isBest = s.id === best;
                return (
                  <div key={s.id} style={{
                    background: "rgba(15,23,42,0.8)",
                    border: `1px solid ${isBest ? "#F59E0B" : "#1E293B"}`,
                    borderRadius: "10px", padding: "16px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                      <div>
                        <div style={{
                          fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
                          color: isBest ? "#F59E0B" : "#64748B",
                          marginBottom: "2px",
                        }}>
                          V{s.id} {isBest ? "★ BEST" : ""}
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#F1F5F9" }}>
                          {cfg.name}
                        </div>
                      </div>
                      <a
                        href={`/?v=${s.id}`}
                        onClick={() => { if (typeof window !== "undefined") localStorage.setItem("nexus_variant", s.id); }}
                        style={{
                          padding: "3px 10px", fontSize: "10px", fontWeight: 700,
                          border: "1px solid #1E293B", borderRadius: "4px",
                          color: "#64748B", textDecoration: "none", background: "transparent",
                        }}
                      >
                        Tester
                      </a>
                    </div>
                    <div style={{ fontSize: "10px", color: "#475569", marginBottom: "12px" }}>
                      {cfg.description}
                    </div>
                    {!m || m.totalValidated === 0 ? (
                      <div style={{ fontSize: "11px", color: "#334155" }}>Pas encore de données</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "11px", color: "#475569" }}>Win Rate</span>
                          <span style={{ fontSize: "14px", fontWeight: 700, color: wrColor(m.globalWinRate) }}>
                            {m.globalWinRate}%
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "11px", color: "#475569" }}>PP Total</span>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: ppColor(m.totalPoints) }}>
                            {m.totalPoints >= 0 ? "+" : ""}{m.totalPoints}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "11px", color: "#475569" }}>Validés</span>
                          <span style={{ fontSize: "11px", color: "#94A3B8" }}>
                            {m.totalWins}W / {m.totalLosses}L / {m.totalNeutrals}N
                          </span>
                        </div>
                        {(() => {
                          const a = computeAnalytics(m.history);
                          return (
                            <>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: "11px", color: "#475569" }}>Profit Factor</span>
                                <span style={{ fontSize: "13px", fontWeight: 700, color: a.profitFactor >= 1 ? "#34D399" : "#FB7185" }}>
                                  {a.profitFactor >= 99 ? "∞" : a.profitFactor.toFixed(2)}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: "11px", color: "#475569" }}>EV / Trade</span>
                                <span style={{ fontSize: "11px", fontWeight: 600, color: a.expectedValue >= 0 ? "#34D399" : "#FB7185" }}>
                                  {a.expectedValue >= 0 ? "+" : ""}{a.expectedValue} PP
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detailed table */}
            <div style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1E293B", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #1E293B" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748B", letterSpacing: "0.08em" }}>
                  TABLEAU COMPARATIF DÉTAILLÉ
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 14px", textAlign: "left", fontSize: "10px", fontWeight: 700, color: "#475569", letterSpacing: "0.08em", borderBottom: "1px solid #1E293B", background: "#050810" }}>
                        MÉTRIQUE
                      </th>
                      {snapshots.map((s) => (
                        <th key={s.id} style={{
                          padding: "8px 14px", textAlign: "right", fontSize: "10px", fontWeight: 700,
                          letterSpacing: "0.08em", borderBottom: "1px solid #1E293B", background: "#050810",
                          color: s.id === best ? "#F59E0B" : "#475569",
                        }}>
                          V{s.id} · {MODEL_VARIANTS[s.id].name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Win Rate", get: (m: PerformanceMemory) => `${m.globalWinRate}%`, color: (m: PerformanceMemory) => wrColor(m.globalWinRate) },
                      { label: "PP Total", get: (m: PerformanceMemory) => `${m.totalPoints >= 0 ? "+" : ""}${m.totalPoints}`, color: (m: PerformanceMemory) => ppColor(m.totalPoints) },
                      { label: "Signaux validés", get: (m: PerformanceMemory) => `${m.totalValidated}` },
                      { label: "Wins", get: (m: PerformanceMemory) => `${m.totalWins}`, color: () => "#34D399" },
                      { label: "Losses", get: (m: PerformanceMemory) => `${m.totalLosses}`, color: () => "#FB7185" },
                      { label: "Phase", get: (m: PerformanceMemory) => m.learningPhase },
                    ].map(({ label, get, color }) => (
                      <tr key={label}>
                        <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748B", borderBottom: "1px solid #0F172A" }}>
                          {label}
                        </td>
                        {snapshots.map((s) => {
                          if (!s.memory || s.memory.totalValidated === 0) return cell("—");
                          return cell(get(s.memory), color ? color(s.memory) : undefined);
                        })}
                      </tr>
                    ))}
                    {/* Analytics rows */}
                    {[
                      {
                        label: "Profit Factor",
                        get: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return a.profitFactor >= 99 ? "∞" : a.profitFactor.toFixed(2);
                        },
                        color: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return a.profitFactor >= 1 ? "#34D399" : "#FB7185";
                        },
                      },
                      {
                        label: "EV / Trade (PP)",
                        get: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return `${a.expectedValue >= 0 ? "+" : ""}${a.expectedValue}`;
                        },
                        color: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return ppColor(a.expectedValue);
                        },
                      },
                      {
                        label: "Max Drawdown (PP)",
                        get: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return `-${a.maxDrawdown}`;
                        },
                        color: (m: PerformanceMemory) => {
                          const a = computeAnalytics(m.history);
                          return a.maxDrawdown > 10 ? "#FB7185" : "#64748B";
                        },
                      },
                    ].map(({ label, get, color }) => (
                      <tr key={label}>
                        <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748B", borderBottom: "1px solid #0F172A" }}>
                          {label}
                        </td>
                        {snapshots.map((s) => {
                          if (!s.memory || s.memory.totalValidated === 0) return cell("—");
                          return cell(get(s.memory), color(s.memory));
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ─── Meta-Learn Panel ─── */}
            <div style={{
              marginTop: "24px",
              background: "rgba(124,58,237,0.06)",
              border: "1px solid #7C3AED40",
              borderRadius: "10px", padding: "18px 20px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#A78BFA", letterSpacing: "0.1em" }}>
                    ✦ META-LEARNING
                  </div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>
                    Analyse les 4 variants · propage les poids du meilleur vers les autres
                  </div>
                </div>
                <button
                  onClick={() => void runMetaLearn()}
                  disabled={metaRunning}
                  style={{
                    fontFamily: M, fontSize: 11, fontWeight: 700,
                    padding: "6px 16px", cursor: metaRunning ? "wait" : "pointer",
                    border: "1px solid #7C3AED80",
                    background: metaRunning ? "#7C3AED20" : "#7C3AED15",
                    color: metaRunning ? "#A78BFA" : "#7C3AED",
                    borderRadius: 5, letterSpacing: "0.08em",
                  }}
                >
                  {metaRunning ? "⟳ EN COURS..." : "▶ LANCER"}
                </button>
              </div>

              {metaReport ? (
                <div>
                  {/* Message */}
                  <div style={{
                    fontSize: "12px", color: "#94A3B8",
                    padding: "8px 12px", background: "#0D1117",
                    borderRadius: "6px", marginBottom: "14px",
                    border: "1px solid #1E293B",
                  }}>
                    {metaReport.message}
                  </div>

                  {/* Scores grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", marginBottom: "12px" }}>
                    {(["1","2","3","4"] as VariantId[]).map((v) => {
                      const s = metaReport.scores[v];
                      const isBest = v === metaReport.bestVariant;
                      const wasBlended = metaReport.blended.includes(v);
                      const wasSkipped = metaReport.skipped.includes(v);
                      return (
                        <div key={v} style={{
                          padding: "10px 12px",
                          background: "#0A0F1A",
                          border: `1px solid ${isBest ? "#7C3AED" : "#1E293B"}`,
                          borderRadius: "6px",
                        }}>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: isBest ? "#A78BFA" : "#475569", marginBottom: "4px" }}>
                            V{v} {isBest ? "★ BEST" : ""}
                          </div>
                          <div style={{ fontSize: "18px", fontWeight: 700, color: s.eligible ? "#F1F5F9" : "#334155" }}>
                            {s.eligible ? s.score.toFixed(3) : "—"}
                          </div>
                          <div style={{ fontSize: "9px", color: "#334155", marginTop: "2px" }}>
                            {s.decisive} trades
                          </div>
                          {wasBlended && (
                            <div style={{ fontSize: "9px", color: "#7C3AED", marginTop: "4px", letterSpacing: "0.06em" }}>
                              ↑ POIDS BLEND
                            </div>
                          )}
                          {wasSkipped && (
                            <div style={{ fontSize: "9px", color: "#334155", marginTop: "4px" }}>
                              ≤15 trades
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Last run */}
                  <div style={{ fontSize: "10px", color: "#1E293B" }}>
                    Dernier run : {new Date(metaReport.runAt).toLocaleString("fr-FR")} · Auto toutes les 6h
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#334155", textAlign: "center", padding: "20px 0" }}>
                  Aucun run encore — clique sur LANCER pour comparer les variants maintenant
                </div>
              )}
            </div>

            {/* Legend */}
            <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "16px" }}>
              {(["1", "2", "3", "4"] as VariantId[]).map((v) => (
                <div key={v} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#F59E0B", minWidth: "20px" }}>V{v}</span>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8" }}>{MODEL_VARIANTS[v].name}</div>
                    <div style={{ fontSize: "10px", color: "#475569" }}>{MODEL_VARIANTS[v].description}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
