"use client";
import { useEffect, useCallback } from "react";
import type { Alert } from "@/lib/useAlerts";
import type { AlertValidation } from "@/lib/memoryEngine";
import {
  calculatePP, calculatePPFromLevels,
  VALIDATION_WINDOWS_MS, addAlertRecord, setActiveVariant,
} from "@/lib/memoryEngine";

interface UseAlertValidationProps {
  alerts: Alert[];
  onValidated: (alertId: string, validation: AlertValidation) => void;
  variant?: string;
}

export function useAlertValidation({ alerts, onValidated, variant = "1" }: UseAlertValidationProps): void {
  // Ensure the correct variant is active before any record is written
  useEffect(() => {
    setActiveVariant(variant);
  }, [variant]);

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

        // Use level-based validation when TradePlan levels are available
        const entryPrice = alert.entry ?? alert.price;
        const hasLevels = entryPrice > 0 && alert.stopLoss && alert.target1;

        let points: number;
        let result: "WIN" | "LOSS" | "NEUTRAL";
        let levelHit: "TP2" | "TP1" | "SL" | "NONE" | undefined;

        if (hasLevels) {
          const lvl = calculatePPFromLevels(
            alert.type as "BUY" | "SELL",
            entryPrice,
            currentPrice,
            alert.stopLoss!,
            alert.target1!,
            alert.target2,
          );
          points = lvl.points;
          result = lvl.result;
          levelHit = lvl.levelHit;
        } else {
          // Fallback: generic % threshold
          const pp = calculatePP(
            alert.type as "BUY" | "SELL",
            alert.price,
            currentPrice,
            alert.category!,
          );
          points = pp.points;
          result = pp.result;
        }

        const validation: AlertValidation = {
          status: result,
          priceAtValidation: currentPrice,
          validatedAt: new Date().toISOString(),
          points,
          windowUsed: "short",
        };

        onValidated(alert.id, validation);

        // Only decisive results are stored in history (NEUTRAL = keep retrying)
        if (result === "NEUTRAL") continue;

        const defaultSnapshot = {
          rsi: 50, adx: 0, stochRsiK: 50, macdCross: "NONE" as const,
          bollingerPos: "INSIDE" as const, obvRising: false,
          regime: "RANGING" as const, fearGreed: 50, aiScore: 50,
        };

        setActiveVariant(variant); // re-assert variant right before saving
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
          entry: entryPrice,
          stopLoss: alert.stopLoss,
          target1: alert.target1,
          target2: alert.target2,
          levelHit,
        });
      } catch {
        // Silent — will retry on next cycle
      }
    }
  }, [alerts, onValidated, variant]);

  // Polling every 5 minutes
  useEffect(() => {
    validatePending();
    const interval = setInterval(validatePending, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [validatePending]);
}
