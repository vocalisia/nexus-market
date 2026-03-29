"use client";
import { useState, useEffect, useCallback } from "react";
import {
  loadMemory, saveMemory, createEmptyMemory, loadMemoryFromServer,
  setActiveVariant,
} from "@/lib/memoryEngine";
import type { PerformanceMemory } from "@/lib/memoryEngine";

export function useMemory(variant = "1"): {
  memory: PerformanceMemory;
  resetMemory: () => void;
  winRateTrend: () => "UP" | "DOWN" | "STABLE";
} {
  const [memory, setMemory] = useState<PerformanceMemory>(createEmptyMemory);

  // Set variant in module state so addAlertRecord uses the right keys
  useEffect(() => {
    setActiveVariant(variant);
  }, [variant]);

  useEffect(() => {
    setActiveVariant(variant);
    // Try server first (survives browser clears + PC reboots), fall back to localStorage
    loadMemoryFromServer(variant).then((serverMemory) => {
      if (serverMemory) {
        setMemory(serverMemory);
        try {
          const key = variant === "1" ? "nexus_memory" : `nexus_memory_v${variant}`;
          localStorage.setItem(key, JSON.stringify(serverMemory));
        } catch { /* ignore */ }
      } else {
        setMemory(loadMemory());
      }
    }).catch(() => {
      setMemory(loadMemory());
    });
  }, [variant]);

  // Resync from server every 60s to catch cron validations
  useEffect(() => {
    const interval = setInterval(() => {
      loadMemoryFromServer(variant).then((m) => { if (m) setMemory(m); }).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [variant]);

  const resetMemory = useCallback(() => {
    const fresh = createEmptyMemory();
    saveMemory(fresh);
    setMemory(fresh);
  }, []);

  const winRateTrend = useCallback((): "UP" | "DOWN" | "STABLE" => {
    const h = memory.history;
    if (h.length < 20) return "STABLE";
    const recent10 = h.slice(-10).filter((r) => r.result !== "NEUTRAL");
    const prev10   = h.slice(-20, -10).filter((r) => r.result !== "NEUTRAL");
    if (recent10.length === 0 || prev10.length === 0) return "STABLE";
    const recentWR = recent10.filter((r) => r.result === "WIN").length / recent10.length;
    const prevWR   = prev10.filter((r) => r.result === "WIN").length / prev10.length;
    if (recentWR > prevWR + 0.05) return "UP";
    if (recentWR < prevWR - 0.05) return "DOWN";
    return "STABLE";
  }, [memory]);

  return { memory, resetMemory, winRateTrend };
}
