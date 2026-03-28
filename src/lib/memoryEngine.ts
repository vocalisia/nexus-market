import type { AssetCategory } from "@/types/market";

// ─── Storage keys ────────────────────────────────────────────
export const MEMORY_STORAGE_KEY = "nexus_memory";
export const MEMORY_VERSION = 1;

// ─── Indicator weights ───────────────────────────────────────
export interface IndicatorWeights {
  rsi: number;
  adx: number;
  stochRsi: number;
  macd: number;
  bollinger: number;
  obv: number;
  fearGreed: number;
  polymarket: number;
  macro: number;
}

export const DEFAULT_WEIGHTS: IndicatorWeights = {
  rsi: 1.0, adx: 1.0, stochRsi: 1.0, macd: 1.0,
  bollinger: 1.0, obv: 1.0, fearGreed: 1.0, polymarket: 1.0, macro: 1.0,
};

// ─── Snapshot of indicators at signal time ───────────────────
export interface AlertIndicatorsSnapshot {
  rsi: number;
  adx: number;
  stochRsiK: number;
  macdCross: "BULLISH" | "BEARISH" | "NONE";
  bollingerPos: "ABOVE" | "INSIDE" | "BELOW";
  obvRising: boolean;
  regime: "BULL" | "BEAR" | "RANGING" | "TRANSITION";
  fearGreed: number;
  aiScore: number;
}

// ─── Validation result for one alert ─────────────────────────
export interface AlertValidation {
  status: "PENDING" | "WIN" | "LOSS" | "NEUTRAL" | "SKIPPED";
  priceAtValidation: number;
  validatedAt: string;
  points: number;
  windowUsed: "short" | "medium" | "long";
}

// ─── Historical record of a validated alert ──────────────────
export interface AlertRecord {
  alertId: string;
  asset: string;
  symbol: string;
  category: AssetCategory;
  type: "BUY" | "SELL";
  severity: "HIGH" | "MEDIUM" | "LOW";
  priceAtSignal: number;
  priceAtValidation: number;
  result: "WIN" | "LOSS" | "NEUTRAL";
  points: number;
  generatedAt: string;
  validatedAt: string;
  windowMs: number;
  snapshot: AlertIndicatorsSnapshot;
}

// ─── Per-asset stats ─────────────────────────────────────────
export interface AssetStats {
  asset: string;
  symbol: string;
  totalSignals: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number;
  totalPoints: number;
  avgPoints: number;
  lastSignalAt: string;
}

// ─── Per-regime stats ─────────────────────────────────────────
export interface RegimeStats {
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number;
  totalPoints: number;
}

// ─── Main performance memory ─────────────────────────────────
export interface PerformanceMemory {
  version: number;
  totalValidated: number;
  totalWins: number;
  totalLosses: number;
  totalNeutrals: number;
  totalPoints: number;
  globalWinRate: number;
  learningPhase: "COLD" | "WARMING" | "ACTIVE" | "FULL";
  weights: IndicatorWeights;
  lastWeightUpdate: string;
  byAsset: Record<string, AssetStats>;
  byRegime: {
    BULL: RegimeStats;
    BEAR: RegimeStats;
    RANGING: RegimeStats;
    TRANSITION: RegimeStats;
  };
  bySeverity: {
    HIGH: { wins: number; losses: number; winRate: number };
    MEDIUM: { wins: number; losses: number; winRate: number };
    LOW: { wins: number; losses: number; winRate: number };
  };
  history: AlertRecord[];
  lastUpdated: string;
  degradationStreak: number;
}

// ─── Validation thresholds ───────────────────────────────────
export const VALIDATION_THRESHOLDS: Record<AssetCategory, number> = {
  CRYPTO:      0.008,
  FOREX:       0.0015,
  COMMODITIES: 0.005,
  STOCKS:      0.005,
};

export const VALIDATION_WINDOWS_MS: Record<
  AssetCategory,
  { short: number; medium: number; long: number }
> = {
  CRYPTO:      { short: 1 * 60 * 60 * 1000,  medium: 4 * 60 * 60 * 1000,   long: 24 * 60 * 60 * 1000 },
  FOREX:       { short: 2 * 60 * 60 * 1000,  medium: 8 * 60 * 60 * 1000,   long: 24 * 60 * 60 * 1000 },
  COMMODITIES: { short: 4 * 60 * 60 * 1000,  medium: 12 * 60 * 60 * 1000,  long: 48 * 60 * 60 * 1000 },
  STOCKS:      { short: 4 * 60 * 60 * 1000,  medium: 24 * 60 * 60 * 1000,  long: 72 * 60 * 60 * 1000 },
};

// ─── PP calculation ──────────────────────────────────────────

export function calculatePP(
  type: "BUY" | "SELL",
  priceAtSignal: number,
  priceAtValidation: number,
  category: AssetCategory,
): { points: number; result: "WIN" | "LOSS" | "NEUTRAL" } {
  if (priceAtSignal <= 0) return { points: 0, result: "NEUTRAL" };

  const threshold = VALIDATION_THRESHOLDS[category];
  const pctMove = (priceAtValidation - priceAtSignal) / priceAtSignal;
  const predictedUp = type === "BUY";
  const directionCorrect = predictedUp ? pctMove > 0 : pctMove < 0;
  const amplitude = Math.abs(pctMove);

  if (amplitude < threshold) {
    return { points: 0, result: "NEUTRAL" };
  }

  const rawPoints = amplitude * 100;
  const points = directionCorrect
    ? +parseFloat(rawPoints.toFixed(2))
    : -parseFloat(rawPoints.toFixed(2));

  return { points, result: directionCorrect ? "WIN" : "LOSS" };
}

// ─── Learning phase ──────────────────────────────────────────

export function computeLearningPhase(
  totalValidated: number,
): PerformanceMemory["learningPhase"] {
  if (totalValidated < 20) return "COLD";
  if (totalValidated < 50) return "WARMING";
  if (totalValidated < 100) return "ACTIVE";
  return "FULL";
}

// ─── localStorage helpers ────────────────────────────────────

export function createEmptyMemory(): PerformanceMemory {
  return {
    version: MEMORY_VERSION,
    totalValidated: 0,
    totalWins: 0,
    totalLosses: 0,
    totalNeutrals: 0,
    totalPoints: 0,
    globalWinRate: 0,
    learningPhase: "COLD",
    weights: { ...DEFAULT_WEIGHTS },
    lastWeightUpdate: new Date().toISOString(),
    byAsset: {},
    byRegime: {
      BULL:       { wins: 0, losses: 0, neutrals: 0, winRate: 0, totalPoints: 0 },
      BEAR:       { wins: 0, losses: 0, neutrals: 0, winRate: 0, totalPoints: 0 },
      RANGING:    { wins: 0, losses: 0, neutrals: 0, winRate: 0, totalPoints: 0 },
      TRANSITION: { wins: 0, losses: 0, neutrals: 0, winRate: 0, totalPoints: 0 },
    },
    bySeverity: {
      HIGH:   { wins: 0, losses: 0, winRate: 0 },
      MEDIUM: { wins: 0, losses: 0, winRate: 0 },
      LOW:    { wins: 0, losses: 0, winRate: 0 },
    },
    history: [],
    lastUpdated: new Date().toISOString(),
    degradationStreak: 0,
  };
}

export function loadMemory(): PerformanceMemory {
  if (typeof window === "undefined") return createEmptyMemory();
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return createEmptyMemory();
    const parsed = JSON.parse(raw) as PerformanceMemory;
    if (parsed.version !== MEMORY_VERSION) return createEmptyMemory();
    return parsed;
  } catch {
    return createEmptyMemory();
  }
}

export function saveMemory(memory: PerformanceMemory): void {
  if (typeof window === "undefined") return;
  const trimmed = { ...memory, history: memory.history.slice(-200) };
  // 1. localStorage (fast, immediate)
  try {
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      const lighter = { ...memory, history: memory.history.slice(-50) };
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(lighter));
    } catch {
      // localStorage full — skip
    }
  }
  // 2. Server-side JSON file (survives browser clears + PC reboots)
  fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trimmed),
  }).catch(() => {
    // Fire-and-forget — don't block UI on network error
  });
}

export async function loadMemoryFromServer(): Promise<PerformanceMemory | null> {
  try {
    const res = await fetch("/api/memory");
    if (!res.ok) return null;
    const data = await res.json() as PerformanceMemory | null;
    if (!data || data.version !== MEMORY_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Add a validated alert record + trigger learning ─────────
// Imported lazily to avoid circular dependency
import { updateWeights, checkDegradation, partialWeightReset } from "./autoLearn";

export function addAlertRecord(record: AlertRecord): void {
  const memory = loadMemory();

  const updated: PerformanceMemory = {
    ...memory,
    totalValidated: memory.totalValidated + 1,
    totalWins:    record.result === "WIN"     ? memory.totalWins + 1     : memory.totalWins,
    totalLosses:  record.result === "LOSS"    ? memory.totalLosses + 1   : memory.totalLosses,
    totalNeutrals:record.result === "NEUTRAL" ? memory.totalNeutrals + 1 : memory.totalNeutrals,
    totalPoints:  parseFloat((memory.totalPoints + record.points).toFixed(2)),
    lastUpdated:  new Date().toISOString(),
  };

  // Global win rate
  const decisive = updated.totalWins + updated.totalLosses;
  updated.globalWinRate = decisive > 0
    ? Math.round((updated.totalWins / decisive) * 100)
    : 0;

  // Learning phase
  updated.learningPhase = computeLearningPhase(updated.totalValidated);

  // Per-asset stats
  const assetKey = record.symbol;
  const prevAsset: AssetStats = memory.byAsset[assetKey] ?? {
    asset: record.asset, symbol: record.symbol,
    totalSignals: 0, wins: 0, losses: 0, neutrals: 0,
    winRate: 0, totalPoints: 0, avgPoints: 0, lastSignalAt: "",
  };
  const updatedAsset: AssetStats = {
    ...prevAsset,
    totalSignals: prevAsset.totalSignals + 1,
    wins:     record.result === "WIN"     ? prevAsset.wins + 1     : prevAsset.wins,
    losses:   record.result === "LOSS"    ? prevAsset.losses + 1   : prevAsset.losses,
    neutrals: record.result === "NEUTRAL" ? prevAsset.neutrals + 1 : prevAsset.neutrals,
    totalPoints: parseFloat((prevAsset.totalPoints + record.points).toFixed(2)),
    lastSignalAt: record.validatedAt,
  };
  const assetDecisive = updatedAsset.wins + updatedAsset.losses;
  updatedAsset.winRate = assetDecisive > 0
    ? Math.round((updatedAsset.wins / assetDecisive) * 100) : 0;
  updatedAsset.avgPoints = assetDecisive > 0
    ? parseFloat((updatedAsset.totalPoints / assetDecisive).toFixed(2)) : 0;
  updated.byAsset = { ...memory.byAsset, [assetKey]: updatedAsset };

  // Per-regime stats
  const regime = record.snapshot.regime;
  const prevRegime = memory.byRegime[regime];
  const updatedRegime = {
    ...prevRegime,
    wins:    record.result === "WIN"  ? prevRegime.wins + 1   : prevRegime.wins,
    losses:  record.result === "LOSS" ? prevRegime.losses + 1 : prevRegime.losses,
    neutrals:record.result === "NEUTRAL" ? prevRegime.neutrals + 1 : prevRegime.neutrals,
    totalPoints: parseFloat((prevRegime.totalPoints + record.points).toFixed(2)),
  };
  const regimeDecisive = updatedRegime.wins + updatedRegime.losses;
  updatedRegime.winRate = regimeDecisive > 0
    ? Math.round((updatedRegime.wins / regimeDecisive) * 100) : 0;
  updated.byRegime = { ...memory.byRegime, [regime]: updatedRegime };

  // Per-severity stats
  const sev = record.severity;
  const prevSev = memory.bySeverity[sev];
  const updatedSev = {
    wins:   record.result === "WIN"  ? prevSev.wins + 1   : prevSev.wins,
    losses: record.result === "LOSS" ? prevSev.losses + 1 : prevSev.losses,
    winRate: 0,
  };
  const sevDecisive = updatedSev.wins + updatedSev.losses;
  updatedSev.winRate = sevDecisive > 0
    ? Math.round((updatedSev.wins / sevDecisive) * 100) : 0;
  updated.bySeverity = { ...memory.bySeverity, [sev]: updatedSev };

  // Degradation detection
  const { newStreak, shouldReset } = checkDegradation(
    memory.degradationStreak,
    record.result,
  );
  updated.degradationStreak = newStreak;
  if (shouldReset) {
    updated.weights = partialWeightReset(updated.weights);
  }

  // Auto-learning — weight update
  if (!shouldReset && record.result !== "NEUTRAL") {
    updated.weights = updateWeights(updated.weights, record, updated.learningPhase);
    updated.lastWeightUpdate = new Date().toISOString();
  }

  // History FIFO-200
  updated.history = [...memory.history, record].slice(-200);

  saveMemory(updated);
}
