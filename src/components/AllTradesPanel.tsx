"use client";
/**
 * AllTradesPanel — affiche TOUS les trades depuis Redis
 * (PENDING en cours + WIN + LOSS + NEUTRAL)
 * avec Entry, SL, TP1, TP2 et bouton TradingView pour vérifier manuellement.
 */
import { useState } from "react";
import type { StoredAlert } from "@/app/api/alerts/route";

const R = "var(--font-rajdhani), sans-serif";
const M = "var(--font-jetbrains), monospace";

type Filter = "ALL" | "PENDING" | "WIN" | "LOSS" | "NEUTRAL";

// ─── Helpers ─────────────────────────────────────────────────

function fmtPrice(p: number | undefined): string {
  if (!p) return "—";
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return "$" + p.toFixed(4);
  return "$" + p.toFixed(6);
}

function fmtPct(from: number, to: number): string {
  const pct = ((to - from) / from) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function tvUrl(symbol: string, category: string): string {
  const s = symbol.toUpperCase();
  if (category === "FOREX") return `https://www.tradingview.com/chart/?symbol=FX:${s.replace("/", "")}`;
  if (category === "COMMODITIES") {
    const map: Record<string, string> = {
      "XAU/USD": "TVC:GOLD", "GOLD": "TVC:GOLD",
      "XAG/USD": "TVC:SILVER", "SILVER": "TVC:SILVER",
      "WTI": "NYMEX:CL1!", "NATGAS": "NYMEX:NG1!",
    };
    return `https://www.tradingview.com/chart/?symbol=${map[s] ?? "TVC:" + s}`;
  }
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${s}USDT`;
}

// ─── Status badge ─────────────────────────────────────────────

function StatusBadge({ status }: { status: StoredAlert["status"] }) {
  const cfg = {
    PENDING: { bg: "#F59E0B20", color: "#F59E0B", label: "⏳ EN COURS" },
    WIN:     { bg: "#34D39920", color: "#34D399", label: "✅ WIN"      },
    LOSS:    { bg: "#FB718520", color: "#FB7185", label: "❌ LOSS"     },
    NEUTRAL: { bg: "#47556920", color: "#64748B", label: "⚪ NEUTRE"   },
  }[status];
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, fontFamily: M, letterSpacing: "0.06em",
      padding: "2px 7px", borderRadius: 3, background: cfg.bg, color: cfg.color,
      flexShrink: 0,
    }}>{cfg.label}</span>
  );
}

// ─── Level badge ──────────────────────────────────────────────

function LevelBadge({ level }: { level?: StoredAlert["levelHit"] }) {
  if (!level || level === "NONE") return null;
  const cfg = {
    TP2: { color: "#34D399", label: "TP2 — +3R" },
    TP1: { color: "#4ade80", label: "TP1 — +2R" },
    BE:  { color: "#60A5FA", label: "BE  — +1R" },
    SL:  { color: "#FB7185", label: "SL  — -1R" },
  }[level];
  return <span style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>;
}

// ─── Trade Row ────────────────────────────────────────────────

function TradeRow({ t }: { t: StoredAlert }) {
  const isBuy      = t.type === "BUY";
  const typeColor  = isBuy ? "#4ade80" : "#f87171";
  const hasLevels  = !!(t.entry && t.stopLoss && t.target1);
  const isPending  = t.status === "PENDING";

  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: "1px solid #0F1424",
      fontFamily: M,
      background: isPending ? "#070D1B" : "transparent",
    }}>

      {/* ── Ligne 1 : statut · symbole · direction · sévérité · date · TV ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <StatusBadge status={t.status} />

        <span style={{ fontFamily: R, fontWeight: 700, fontSize: 14, color: "#CBD5E1" }}>
          {t.symbol}
        </span>

        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: R, color: typeColor,
          letterSpacing: "0.08em", padding: "1px 6px",
          border: `1px solid ${typeColor}40`, borderRadius: 3,
        }}>{t.type}</span>

        <span style={{
          fontSize: 10,
          color: t.severity === "HIGH" ? "#FB7185" : t.severity === "MEDIUM" ? "#F59E0B" : "#64748B",
        }}>{t.severity}</span>

        <span style={{ fontSize: 10, color: "#334155" }}>{fmtDate(t.generatedAt)}</span>

        <a
          href={tvUrl(t.symbol, t.category)}
          target="_blank" rel="noopener noreferrer"
          style={{
            fontSize: 9, fontWeight: 700, fontFamily: M,
            padding: "2px 8px", borderRadius: 3,
            background: "#1C2338", color: "#60A5FA",
            textDecoration: "none", border: "1px solid #2563EB40",
          }}
        >TV ↗</a>

        {/* PP pour trades résolus */}
        {!isPending && t.points !== undefined && (
          <span style={{
            marginLeft: "auto", fontWeight: 700, fontSize: 13,
            color: t.points >= 0 ? "#34D399" : "#FB7185",
          }}>
            {t.points >= 0 ? "+" : ""}{t.points.toFixed(2)} PP
          </span>
        )}
      </div>

      {/* ── Ligne 2 : niveaux Entry / SL / TP1 / TP2 ── */}
      {hasLevels ? (
        <div style={{
          display: "flex", gap: 0, borderRadius: 6, overflow: "hidden",
          border: "1px solid #1C2338", fontSize: 11,
        }}>
          {/* Signal price */}
          <div style={{ flex: 1, padding: "8px 10px", borderRight: "1px solid #1C2338", background: "#05070D" }}>
            <div style={{ fontSize: 9, color: "#334155", marginBottom: 3 }}>PRIX SIGNAL</div>
            <div style={{ color: "#64748B" }}>{fmtPrice(t.price)}</div>
          </div>

          {/* Entry */}
          <div style={{ flex: 1, padding: "8px 10px", borderRight: "1px solid #1C2338", background: "#05070D" }}>
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 3 }}>ENTRÉE</div>
            <div style={{ color: "#CBD5E1", fontWeight: 700 }}>{fmtPrice(t.entry)}</div>
          </div>

          {/* SL */}
          <div style={{
            flex: 1, padding: "8px 10px", borderRight: "1px solid #1C2338",
            background: t.levelHit === "SL" ? "#FB718510" : "#05070D",
          }}>
            <div style={{ fontSize: 9, color: "#FB718580", marginBottom: 3 }}>STOP LOSS</div>
            <div style={{ color: "#FB7185", fontWeight: 700 }}>{fmtPrice(t.stopLoss)}</div>
            <div style={{ fontSize: 9, color: "#FB718560" }}>{fmtPct(t.entry!, t.stopLoss!)}</div>
          </div>

          {/* TP1 */}
          <div style={{
            flex: 1, padding: "8px 10px",
            borderRight: t.target2 ? "1px solid #1C2338" : "none",
            background: t.levelHit === "TP1" ? "#4ade8010" : "#05070D",
          }}>
            <div style={{ fontSize: 9, color: "#4ade8080", marginBottom: 3 }}>TARGET 1</div>
            <div style={{ color: "#4ade80", fontWeight: 700 }}>{fmtPrice(t.target1)}</div>
            <div style={{ fontSize: 9, color: "#4ade8060" }}>{fmtPct(t.entry!, t.target1!)}</div>
          </div>

          {/* TP2 */}
          {t.target2 && (
            <div style={{
              flex: 1, padding: "8px 10px",
              background: t.levelHit === "TP2" ? "#34D39910" : "#05070D",
            }}>
              <div style={{ fontSize: 9, color: "#34D39980", marginBottom: 3 }}>TARGET 2</div>
              <div style={{ color: "#34D399", fontWeight: 700 }}>{fmtPrice(t.target2)}</div>
              <div style={{ fontSize: 9, color: "#34D39960" }}>{fmtPct(t.entry!, t.target2)}</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#334155" }}>
          Prix signal: {fmtPrice(t.price)} — niveaux non disponibles
        </div>
      )}

      {/* ── Ligne 3 : résultat validation ── */}
      {!isPending && (
        <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", fontSize: 10 }}>
          <LevelBadge level={t.levelHit} />
          {t.validationPrice && (
            <>
              <span style={{ color: "#334155" }}>prix validation:</span>
              <span style={{
                color: t.validationPrice >= t.price ? "#34D399" : "#FB7185",
                fontWeight: 600,
              }}>
                {fmtPrice(t.validationPrice)} ({fmtPct(t.price, t.validationPrice)})
              </span>
            </>
          )}
          {t.validatedAt && (
            <span style={{ color: "#1E293B", marginLeft: "auto" }}>
              validé {fmtDate(t.validatedAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────

export function AllTradesPanel({ trades }: { trades: StoredAlert[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const sorted  = [...trades].sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
  const filtered = filter === "ALL" ? sorted : sorted.filter((t) => t.status === filter);

  const counts = {
    ALL:     sorted.length,
    PENDING: sorted.filter((t) => t.status === "PENDING").length,
    WIN:     sorted.filter((t) => t.status === "WIN").length,
    LOSS:    sorted.filter((t) => t.status === "LOSS").length,
    NEUTRAL: sorted.filter((t) => t.status === "NEUTRAL").length, // Expiré sans record
  };

  const decisive = counts.WIN + counts.LOSS;
  const winRate  = decisive > 0 ? Math.round((counts.WIN / decisive) * 100) : null;

  const filterBtns: { key: Filter; label: string; color: string }[] = [
    { key: "ALL",     label: `Tous (${counts.ALL})`,           color: "#64748B" },
    { key: "PENDING", label: `⏳ En cours (${counts.PENDING})`, color: "#F59E0B" },
    { key: "WIN",     label: `✅ WIN (${counts.WIN})`,          color: "#34D399" },
    { key: "LOSS",    label: `❌ LOSS (${counts.LOSS})`,        color: "#FB7185" },
    { key: "NEUTRAL", label: `⏱️ Expiré (${counts.NEUTRAL})`,   color: "#334155" },
  ];

  return (
    <div style={{ fontFamily: R }}>

      {/* ── Stats header ── */}
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid #1C2338",
        display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
        background: "#111827",
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F1F5F9", fontFamily: M }}>
            {winRate !== null ? `${winRate}%` : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.1em" }}>WIN RATE</div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#F59E0B" }}>⏳ {counts.PENDING} en cours</span>
          <span style={{ fontSize: 11, color: "#34D399" }}>✅ {counts.WIN} W</span>
          <span style={{ fontSize: 11, color: "#FB7185" }}>❌ {counts.LOSS} L</span>
          <span style={{ fontSize: 11, color: "#64748B" }}>⚪ {counts.NEUTRAL} N</span>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#1E293B" }}>
          TV ↗ = vérifier sur TradingView
        </span>
      </div>

      {/* ── Filtres ── */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 14px",
        borderBottom: "1px solid #1C2338", flexWrap: "wrap",
        background: "#0A0D18",
      }}>
        {filterBtns.map(({ key, label, color }) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            fontFamily: M, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            padding: "3px 8px", borderRadius: 3, cursor: "pointer",
            background: filter === key ? color + "20" : "transparent",
            color: filter === key ? color : "#334155",
            border: `1px solid ${filter === key ? color + "40" : "#1C2338"}`,
            transition: "all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* ── Rows ── */}
      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#334155", fontSize: 13 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
          {filter === "ALL"
            ? "Aucun trade encore — le cron génère les signaux toutes les heures."
            : `Aucun trade "${filter}" pour le moment.`}
        </div>
      ) : (
        filtered.map((t) => <TradeRow key={t.id} t={t} />)
      )}
    </div>
  );
}
