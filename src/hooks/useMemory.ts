"use client";
import { useState, useEffect, useCallback } from "react";
import { loadMemory, saveMemory, createEmptyMemory, loadMemoryFromServer } from "@/lib/memoryEngine";
import type { PerformanceMemory } from "@/lib/memoryEngine";

export function useMemory(): {
  memory: PerformanceMemory;
  resetMemory: () => void;
  winRateTrend: () => "UP" | "DOWN" | "STABLE";
} {
  const [memory, setMemory] = useState<PerformanceMemory>(createEmptyMemory);

  useEffect(() => {
    // Try server first (survives browser clears + PC reboots), fall back to localStorage
    loadMemoryFromServer().then((serverMemory) => {
      if (serverMemory) {
        setMemory(serverMemory);
        // Sync back to localStorage so it's available immediately next time
        try {
          localStorage.setItem("nexus_memory", JSON.stringify(serverMemory));
        } catch { /* ignore */ }
      } else {
        setMemory(loadMemory());
      }
    }).catch(() => {
      setMemory(loadMemory());
    });
  }, []);

  // Resync every 30s to catch background validations
  useEffect(() => {
    const interval = setInterval(() => setMemory(loadMemory()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const resetMemory = useCallback(() => {
    const fresh = createEmptyMemory();
    saveMemory(fresh);
    setMemory(fresh);
  }, []);

  const winRateTrend = useCallback((): "UP" | "DOWN" | "STABLE" => {
    const h = memory.history;
    if (h.length < 20) return "STABLE";
    const recent10 = h.slice(-10).filter((r) => r.result !== "NEUTRAL");
    const prev10 = h.slice(-20, -10).filter((r) => r.result !== "NEUTRAL");
    if (recent10.length === 0 || prev10.length === 0) return "STABLE";
    const recentWR = recent10.filter((r) => r.result === "WIN").length / recent10.length;
    const prevWR = prev10.filter((r) => r.result === "WIN").length / prev10.length;
    if (recentWR > prevWR + 0.05) return "UP";
    if (recentWR < prevWR - 0.05) return "DOWN";
    return "STABLE";
  }, [memory]);

  return { memory, resetMemory, winRateTrend };
}
