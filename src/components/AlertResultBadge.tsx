"use client";
import type { AlertValidation } from "@/lib/memoryEngine";
import type { AssetCategory } from "@/types/market";
import { VALIDATION_WINDOWS_MS } from "@/lib/memoryEngine";

interface AlertResultBadgeProps {
  validation: AlertValidation | undefined;
  generatedAt: string;
  category: AssetCategory | undefined;
}

function formatCountdown(remainingMs: number): string {
  const totalMins = Math.ceil(remainingMs / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h${m > 0 ? m + "min" : ""}`;
  return `${m}min`;
}

export function AlertResultBadge({ validation, generatedAt, category }: AlertResultBadgeProps) {
  const now = Date.now();
  const age = now - new Date(generatedAt).getTime();
  const windowMs = category ? VALIDATION_WINDOWS_MS[category].medium : 4 * 60 * 60 * 1000;
  const remaining = windowMs - age;

  // No validation yet — check if window has passed
  if (!validation || validation.status === "PENDING") {
    if (remaining > 0) {
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 8px",
            borderRadius: "4px",
            fontSize: "11px",
            fontWeight: 600,
            background: "rgba(245,158,11,0.1)",
            border: "1px solid #F59E0B",
            color: "#F59E0B",
            animation: "pulse 2s infinite",
          }}
        >
          ⏳ Validation dans {formatCountdown(remaining)}
        </span>
      );
    }
    // Window passed but still pending
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 600,
          background: "rgba(245,158,11,0.1)",
          border: "1px solid #F59E0B",
          color: "#F59E0B",
        }}
      >
        ⏳ Validation en cours…
      </span>
    );
  }

  if (validation.status === "WIN") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 700,
          background: "rgba(52,211,153,0.15)",
          border: "1px solid #34D399",
          color: "#34D399",
        }}
      >
        ✅ VALIDÉ &nbsp;{validation.points > 0 ? "+" : ""}{validation.points} PP
      </span>
    );
  }

  if (validation.status === "LOSS") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 700,
          background: "rgba(251,113,133,0.15)",
          border: "1px solid #FB7185",
          color: "#FB7185",
        }}
      >
        ❌ INVALIDE &nbsp;{validation.points} PP
      </span>
    );
  }

  if (validation.status === "NEUTRAL") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 600,
          background: "rgba(100,116,139,0.1)",
          border: "1px solid #475569",
          color: "#64748B",
        }}
      >
        ⚪ NEUTRE &nbsp;±0 PP
      </span>
    );
  }

  if (validation.status === "SKIPPED") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          fontWeight: 500,
          background: "rgba(100,116,139,0.05)",
          border: "1px solid #334155",
          color: "#475569",
        }}
      >
        — données indisponibles
      </span>
    );
  }

  return null;
}
