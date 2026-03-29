import type { AssetCategory } from "@/types/market";

// ─── Storage keys ────────────────────────────────────────────
export const MEMORY_STORAGE_KEY = "nexus_memory"; // V1 legacy key
export const MEMORY_VERSION = 1;

// Active variant — set by useMemory on mount; defaults to "1"
let _variant: string = "1";
export function setActiveVariant(v: string): void { _variant = v; }
export function getActiveVariant(): string { return _variant; }
function storageKey(): string { return _variant === "1" ? MEMORY_STORAGE_KEY : `nexus_memory_v${_variant}`; }

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
  // TP/SL level tracking
  entry?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  levelHit?: "TP2" | "TP1" | "SL" | "NONE";
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
  CRYPTO:      0.002, // 0.2% — lowered so more 1h moves count as WIN/LOSS
  FOREX:       0.0010,
  COMMODITIES: 0.003,
  STOCKS:      0.003,
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

// ─── Level-based PP (TP1 / TP2 / SL hit) ────────────────────
//
// Points are expressed in R-multiples:
//   TP2 hit → +3 PP  (3:1 R:R)
//   TP1 hit → +2 PP  (2:1 R:R)
//   SL  hit → -1 PP  (risk unit)
//   NONE    →  0 PP  (still pending)
//
// This makes the score comparable across all assets and timeframes.

export function calculatePPFromLevels(
  type: "BUY" | "SELL",
  entry: number,
  current: number,
  stopLoss: number,
  target1: number,
  target2?: number,
): { points: number; result: "WIN" | "LOSS" | "NEUTRAL"; levelHit: "TP2" | "TP1" | "SL" | "NONE" } {
  if (entry <= 0) return { points: 0, result: "NEUTRAL", levelHit: "NONE" };
  const isLong = type === "BUY";

  const slHit  = isLong ? current <= stopLoss : current >= stopLoss;
  const tp2Hit = target2 !== undefined
    ? (isLong ? current >= target2 : current <= target2)
    : false;
  const tp1Hit = isLong ? current >= target1 : current <= target1;

  if (tp2Hit && target2 !== undefined) {
    return { points: 3, result: "WIN", levelHit: "TP2" };
  }
  if (tp1Hit) {
    return { points: 2, result: "WIN", levelHit: "TP1" };
  }
  if (slHit) {
    return { points: -1, result: "LOSS", levelHit: "SL" };
  }
  return { points: 0, result: "NEUTRAL", levelHit: "NONE" };
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
    const raw = localStorage.getItem(storageKey());
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
    localStorage.setItem(storageKey(), JSON.stringify(trimmed));
  } catch {
    try {
      const lighter = { ...memory, history: memory.history.slice(-50) };
      localStorage.setItem(storageKey(), JSON.stringify(lighter));
    } catch { /* localStorage full */ }
  }
  // 2. Upstash Redis (survives browser clears + PC reboots)
  fetch(`/api/memory?variant=${_variant}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trimmed),
  }).catch(() => { /* fire-and-forget */ });
}

export async function loadMemoryFromServer(variant = "1"): Promise<PerformanceMemory | null> {
  try {
    const res = await fetch(`/api/memory?variant=${variant}`);
    if (!res.ok) return null;
    const data = (await res.json()) as PerformanceMemory | null;
    if (!data || data.version !== MEMORY_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Add a validated alert record + trigger learning ─────────
// Imported lazily to avoid circular dependency
import { updateWeights, checkDegradation, partialWeightReset } from "./autoLearn";

// Pure function — takes existing memory, returns updated memory (no I/O)
export function updateMemoryWithRecord(
  memory: PerformanceMemory,
  record: AlertRecord,
): PerformanceMemory {

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

  return updated;
}

export function addAlertRecord(record: AlertRecord): void {
  const memory = loadMemory();
  const updated = updateMemoryWithRecord(memory, record);
  saveMemory(updated);
}
