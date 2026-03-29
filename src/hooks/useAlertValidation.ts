"use client";
import { useEffect, useCallback } from "react";
import type { Alert } from "@/lib/useAlerts";
import type { AlertValidation } from "@/lib/memoryEngine";
import { calculatePP, VALIDATION_WINDOWS_MS, addAlertRecord } from "@/lib/memoryEngine";

interface UseAlertValidationProps {
  alerts: Alert[];
  onValidated: (alertId: string, validation: AlertValidation) => void;
}

export function useAlertValidation({ alerts, onValidated }: UseAlertValidationProps): void {
  const validatePending = useCallback(async () => {
    const now = Date.now();

    const pendingAlerts = alerts.filter((a) => {
      if (a.type === "WATCH") return false;
      if (a.validation?.status !== undefined && a.validation.status !== "PENDING") return false;
      if (!a.category) return false;
      if (!a.price || a.price <= 0) return false;

      const windows = VALIDATION_WINDOWS_MS[a.category];
      const age = now - new Date(a.generatedAt).getTime();
      // Validate after short window (1h crypto), up to 7 days to catch overnight/weekend
      return age >= windows.short && age <= 7 * 24 * 60 * 60 * 1000;
    });

    if (pendingAlerts.length === 0) return;

    // Max 3 validations per cycle to avoid API flooding
    for (const alert of pendingAlerts.slice(0, 3)) {
      try {
        const res = await fetch(
          `/api/validate?symbol=${encodeURIComponent(alert.symbol)}&category=${alert.category}`,
        );
        if (!res.ok) continue;

        const { currentPrice } = (await res.json()) as { currentPrice: number };
        if (!currentPrice || currentPrice <= 0) continue;

        const { points, result } = calculatePP(
          alert.type as "BUY" | "SELL",
          alert.price,
          currentPrice,
          alert.category!,
        );

        const validation: AlertValidation = {
          status: result,
          priceAtValidation: currentPrice,
          validatedAt: new Date().toISOString(),
          points,
          windowUsed: "medium",
        };

        onValidated(alert.id, validation);

        // Store in memory — record all results (WIN/LOSS/NEUTRAL)
        const defaultSnapshot = {
          rsi: 50, adx: 0, stochRsiK: 50, macdCross: "NONE" as const,
          bollingerPos: "INSIDE" as const, obvRising: false,
          regime: "RANGING" as const, fearGreed: 50, aiScore: 50,
        };
        addAlertRecord({
          alertId: alert.id,
          asset: alert.asset,
          symbol: alert.symbol,
          category: alert.category!,
          type: alert.type as "BUY" | "SELL",
          severity: alert.severity,
          priceAtSignal: alert.price,
          priceAtValidation: currentPrice,
          result,
          points,
          generatedAt: alert.generatedAt,
          validatedAt: new Date().toISOString(),
          windowMs: VALIDATION_WINDOWS_MS[alert.category!].short,
          snapshot: alert.indicatorsSnapshot ?? defaultSnapshot,
        });
      } catch {
        // Silent — will retry on next cycle
      }
    }
  }, [alerts, onValidated]);

  // Polling every 5 minutes
  useEffect(() => {
    validatePending();
    const interval = setInterval(validatePending, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [validatePending]);
}
