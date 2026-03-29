"use client";
/**
 * useServerAlerts — fetches alerts from Redis via /api/alerts
 *
 * The cron generates + validates all alerts server-side.
 * The browser is read-only: it just displays what the server computed.
 *
 * UI-only state (read, dismissedAt) is stored in localStorage
 * under a lightweight map keyed by alert id.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { StoredAlert } from "@/app/api/alerts/route";
import type { Alert, Freshness } from "@/lib/useAlerts";
import type { AlertValidation } from "@/lib/memoryEngine";
import type { VariantId } from "@/lib/modelVariants";

import { getFreshness } from "@/lib/useAlerts";

const UI_STATE_KEY = "nexus_alert_ui_state";
const REFRESH_MS   = 60_000; // re-fetch every 60s (cron runs hourly)

interface UiState {
  read:        Record<string, boolean>;
  dismissedAt: Record<string, string | null>;
}

function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    return raw ? (JSON.parse(raw) as UiState) : { read: {}, dismissedAt: {} };
  } catch { return { read: {}, dismissedAt: {} }; }
}

function saveUiState(s: UiState): void {
  try { localStorage.setItem(UI_STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function storedToAlert(s: StoredAlert, ui: UiState): Alert {
  let validation: AlertValidation | undefined;
  if (s.status !== "PENDING") {
    validation = {
      status:             s.status,
      priceAtValidation:  s.validationPrice ?? s.price,
      points:             s.points ?? 0,
      windowUsed:         "short" as const,
      validatedAt:        s.validatedAt ?? new Date().toISOString(),
    };
  }
  return {
    id:                 s.id,
    asset:              s.asset,
    symbol:             s.symbol,
    type:               s.type,
    message:            s.message,
    severity:           s.severity,
    price:              s.price,
    entry:              s.entry,
    stopLoss:           s.stopLoss,
    target1:            s.target1,
    target2:            s.target2,
    generatedAt:        s.generatedAt,
    dismissedAt:        ui.dismissedAt[s.id] ?? null,
    read:               ui.read[s.id] ?? false,
    category:           s.category,
    indicatorsSnapshot: s.indicatorsSnapshot,
    validation,
  };
}

export function useServerAlerts(variant: VariantId) {
  const [raw, setRaw]         = useState<StoredAlert[]>([]);
  const [uiState, setUiState] = useState<UiState>({ read: {}, dismissedAt: {} });
  const [latestCritical, setLatestCritical] = useState<Alert | null>(null);
  const uiRef = useRef<UiState>({ read: {}, dismissedAt: {} });

  // Load UI state on mount
  useEffect(() => {
    const s = loadUiState();
    uiRef.current = s;
    setUiState(s);
  }, []);

  // Fetch raw alerts from Redis
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`/api/alerts?variant=${variant}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as StoredAlert[];
      setRaw(data);
    } catch { /* silent */ }
  }, [variant]);

  useEffect(() => {
    fetchAlerts();
    const t = setInterval(fetchAlerts, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchAlerts]);

  // Recompute latestCritical whenever raw or uiState changes
  const alerts: Alert[] = raw.map((s) => storedToAlert(s, uiState));

  useEffect(() => {
    const critical = alerts.find(
      (a) => a.severity === "HIGH" && !a.dismissedAt && getFreshness(a.generatedAt) !== "EXPIRED"
    );
    setLatestCritical(critical ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, uiState]);

  // Mutators — UI state only
  const updateUi = useCallback((updater: (prev: UiState) => UiState) => {
    setUiState((prev) => {
      const next = updater(prev);
      uiRef.current = next;
      saveUiState(next);
      return next;
    });
  }, []);

  const dismissBanner = useCallback(() => {
    if (!latestCritical) return;
    const id = latestCritical.id;
    updateUi((prev) => ({
      ...prev,
      dismissedAt: { ...prev.dismissedAt, [id]: new Date().toISOString() },
    }));
    setLatestCritical(null);
  }, [latestCritical, updateUi]);

  const markAllRead = useCallback(() => {
    updateUi((prev) => {
      const reads = { ...prev.read };
      for (const a of alerts) reads[a.id] = true;
      return { ...prev, read: reads };
    });
  }, [alerts, updateUi]);

  const activeAlerts = alerts.filter(
    (a) => getFreshness(a.generatedAt) !== "EXPIRED"
  );
  const unreadCount = activeAlerts.filter((a) => !a.read).length;

  return {
    alerts:          activeAlerts,
    allAlerts:       alerts,
    rawAlerts:       raw,          // StoredAlert[] — full list for trade history panel
    latestCritical:  latestCritical && !latestCritical.dismissedAt ? latestCritical : null,
    unreadCount,
    dismissBanner,
    markAllRead,
    processSignals:  () => {},
    updateValidation: () => {},
    refetch:         fetchAlerts,
  };
}
