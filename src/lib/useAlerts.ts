"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { isMarketOpen } from "./marketHours";
import type { AssetCategory } from "@/types/market";
import type { AlertIndicatorsSnapshot, AlertValidation } from "./memoryEngine";

export type { AlertIndicatorsSnapshot, AlertValidation };

export interface Alert {
  id: string;
  asset: string;
  symbol: string;
  type: "BUY" | "SELL" | "WATCH";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  price: number;
  entry?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  generatedAt: string;
  dismissedAt?: string | null;
  read: boolean;
  category?: AssetCategory;
  indicatorsSnapshot?: AlertIndicatorsSnapshot;
  validation?: AlertValidation;
}

export type Freshness = "FRESH" | "WARM" | "OLD" | "EXPIRED";

const STORAGE_KEY = "nexus_alerts_v2"; // bumped to discard old inverted SL/TP alerts
const MAX_ALERTS = 100;
const EXPIRE_MS = 60 * 60 * 1000; // 60 min

export function getFreshness(generatedAt: string): Freshness {
  const age = Date.now() - new Date(generatedAt).getTime();
  if (age < 15 * 60 * 1000) return "FRESH";   // 0-15 min
  if (age < 30 * 60 * 1000) return "WARM";    // 15-30 min
  if (age < 60 * 60 * 1000) return "OLD";     // 30-60 min
  return "EXPIRED";                             // 60+ min
}

export function getAgeText(generatedAt: string): string {
  const age = Date.now() - new Date(generatedAt).getTime();
  const mins = Math.floor(age / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  return `il y a ${hours}h${mins % 60 > 0 ? (mins % 60) + "min" : ""}`;
}

function loadAlerts(): Alert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Alert[];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: Alert[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)));
  } catch {
    // localStorage full or unavailable
  }
}

function isDuplicate(existing: Alert[], newAlert: { asset: string; type: string }): boolean {
  return existing.some(
    (a) =>
      a.asset === newAlert.asset &&
      a.type === newAlert.type &&
      Date.now() - new Date(a.generatedAt).getTime() < EXPIRE_MS // same asset+type within 60min = skip
  );
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [latestCritical, setLatestCritical] = useState<Alert | null>(null);
  // initialized: localStorage has been loaded; processSignals is gated on this
  const initialized = useRef(false);

  // Load from localStorage on mount — must complete before processSignals runs
  useEffect(() => {
    if (initialized.current) return;
    const stored = loadAlerts();
    // Mark ready BEFORE setting state so processSignals called synchronously
    // after this effect sees the correct prev
    initialized.current = true;
    setAlerts(stored);
    const critical = stored.find(
      (a) => a.severity === "HIGH" && !a.dismissedAt && getFreshness(a.generatedAt) !== "EXPIRED"
    );
    if (critical) setLatestCritical(critical);
  }, []);

  // Persist on change — skip the very first render (data came from localStorage)
  useEffect(() => {
    if (!initialized.current) return;
    saveAlerts(alerts);
  }, [alerts]);

  // Process new signals from API
  // Gated on initialized.current so localStorage is always in prev before dedup runs
  const processSignals = useCallback(
    (
      signals: Array<{ asset: string; type: string; message: string; severity: string; generatedAt?: string; indicatorsSnapshot?: AlertIndicatorsSnapshot }>,
      assets: Array<{ id: string; symbol: string; price: number; category: string; tradePlan?: { entry?: number; stopLoss?: number; target1?: number; target2?: number } }>
    ) => {
      if (!initialized.current) return; // wait for localStorage load
      setAlerts((prev) => {
        const toAdd: Alert[] = [];
        let newCritical: Alert | null = null;

        for (const signal of signals) {
          if (isDuplicate(prev, signal)) continue;

          const matchedAsset = assets.find((a) =>
            signal.asset.toLowerCase().includes(a.symbol.toLowerCase()) ||
            signal.asset.toLowerCase().includes(a.id.toLowerCase())
          );

          if (matchedAsset?.category) {
            const mkt = isMarketOpen(matchedAsset.category as AssetCategory);
            if (!mkt.isOpen) continue;
          }

          const alert: Alert = {
            id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            asset: signal.asset,
            symbol: matchedAsset?.symbol ?? signal.asset,
            type: (signal.type as "BUY" | "SELL" | "WATCH") ?? "WATCH",
            message: signal.message,
            severity: signal.severity === "high" ? "HIGH" : signal.severity === "medium" ? "MEDIUM" : "LOW",
            price: matchedAsset?.price ?? 0,
            entry: matchedAsset?.tradePlan?.entry,
            stopLoss: matchedAsset?.tradePlan?.stopLoss,
            target1: matchedAsset?.tradePlan?.target1,
            target2: matchedAsset?.tradePlan?.target2,
            generatedAt: signal.generatedAt ?? new Date().toISOString(),
            dismissedAt: null,
            read: false,
            category: (matchedAsset?.category as AssetCategory) ?? undefined,
            indicatorsSnapshot: signal.indicatorsSnapshot,
          };

          toAdd.push(alert);
          if (alert.severity === "HIGH") newCritical = alert;
        }

        if (newCritical) setLatestCritical(newCritical);
        if (toAdd.length === 0) return prev;
        return [...toAdd, ...prev].slice(0, MAX_ALERTS);
      });
    },
    [] // stable — no stale closure
  );

  const dismissBanner = useCallback(() => {
    if (!latestCritical) return;
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === latestCritical.id ? { ...a, dismissedAt: new Date().toISOString() } : a
      )
    );
    setLatestCritical(null);
  }, [latestCritical]);

  const markAllRead = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }, []);

  const clearExpired = useCallback(() => {
    setAlerts((prev) =>
      prev.filter((a) => Date.now() - new Date(a.generatedAt).getTime() < EXPIRE_MS)
    );
  }, []);

  const updateValidation = useCallback((alertId: string, validation: AlertValidation) => {
    setAlerts((prev) =>
      prev.map((a) => a.id === alertId ? { ...a, validation } : a)
    );
  }, []);

  const unreadCount = alerts.filter((a) => !a.read && getFreshness(a.generatedAt) !== "EXPIRED").length;
  const activeAlerts = alerts.filter((a) => {
    if (getFreshness(a.generatedAt) === "EXPIRED") return false;
    if (a.category && !isMarketOpen(a.category).isOpen) return false;
    return true;
  });

  return {
    alerts: activeAlerts,
    latestCritical: latestCritical && !latestCritical.dismissedAt ? latestCritical : null,
    unreadCount,
    processSignals,
    dismissBanner,
    markAllRead,
    clearExpired,
    updateValidation,
  };
}
