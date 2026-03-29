import type { AlertRecord } from "./memoryEngine";

// ─── Output types ─────────────────────────────────────────────

export interface BucketStats {
  wins: number;
  losses: number;
  winRate: number;  // 0-100
  totalPP: number;
  avgPP: number;    // per decisive trade
}

export interface TradeAnalytics {
  profitFactor: number;    // gross wins PP / |gross losses PP|
  expectedValue: number;   // avg PP per decisive trade
  avgWinPP: number;
  avgLossPP: number;       // negative value
  currentStreak: { type: "WIN" | "LOSS" | "NONE"; count: number };
  bestWinStreak: number;
  worstLossStreak: number;
  maxDrawdown: number;     // max peak-to-trough decline in cumulative PP
  cumulativePP: number[];  // running PP per trade (for sparkline)
  byType: { BUY: BucketStats; SELL: BucketStats };
  byCategory: Record<string, BucketStats>;
  byConviction: {
    "FORT >65":   BucketStats;
    "MOYEN 50-65": BucketStats;
    "FAIBLE ≈50": BucketStats;
  };
  recentForm: BucketStats & { n: number };
}

// ─── Helpers ──────────────────────────────────────────────────

function emptyBucket(): BucketStats {
  return { wins: 0, losses: 0, winRate: 0, totalPP: 0, avgPP: 0 };
}

function finalizeBucket(b: BucketStats): BucketStats {
  const decisive = b.wins + b.losses;
  return {
    ...b,
    totalPP: parseFloat(b.totalPP.toFixed(2)),
    winRate: decisive > 0 ? Math.round((b.wins / decisive) * 100) : 0,
    avgPP:   decisive > 0 ? parseFloat((b.totalPP / decisive).toFixed(2)) : 0,
  };
}

function addRecord(b: BucketStats, r: AlertRecord): BucketStats {
  return {
    ...b,
    wins:     r.result === "WIN"  ? b.wins + 1   : b.wins,
    losses:   r.result === "LOSS" ? b.losses + 1 : b.losses,
    totalPP:  b.totalPP + r.points,
  };
}

// ─── Main computation ─────────────────────────────────────────

export function computeAnalytics(history: AlertRecord[]): TradeAnalytics {
  // Sorted oldest-first (history is already oldest-first from FIFO-200)
  const records = [...history].sort(
    (a, b) => new Date(a.validatedAt).getTime() - new Date(b.validatedAt).getTime(),
  );

  // --- Profit factor & EV ---
  let grossWin = 0;
  let grossLoss = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const r of records) {
    if (r.result === "WIN")  { grossWin  += r.points; winCount++; }
    if (r.result === "LOSS") { grossLoss += Math.abs(r.points); lossCount++; }
  }
  const profitFactor = grossLoss > 0 ? parseFloat((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0;
  const avgWinPP     = winCount  > 0 ? parseFloat((grossWin  / winCount).toFixed(2)) : 0;
  const avgLossPP    = lossCount > 0 ? -parseFloat((grossLoss / lossCount).toFixed(2)) : 0;
  const decisive     = winCount + lossCount;
  const expectedValue = decisive > 0
    ? parseFloat(((winCount / decisive * grossWin - lossCount / decisive * grossLoss) / decisive).toFixed(3))
    : 0;

  // --- Current streak ---
  let streak = 0;
  let streakType: "WIN" | "LOSS" | "NONE" = "NONE";
  for (let i = records.length - 1; i >= 0; i--) {
    const res = records[i].result;
    if (res === "NEUTRAL") continue; // neutrals don't break streaks
    if (streakType === "NONE") {
      streakType = res as "WIN" | "LOSS";
      streak = 1;
    } else if (res === streakType) {
      streak++;
    } else {
      break;
    }
  }

  // --- Best/worst streaks ---
  let bestWin = 0;
  let worstLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const r of records) {
    if (r.result === "WIN")  { curWin++; curLoss = 0; bestWin = Math.max(bestWin, curWin); }
    if (r.result === "LOSS") { curLoss++; curWin = 0; worstLoss = Math.max(worstLoss, curLoss); }
  }

  // --- Cumulative PP & max drawdown ---
  const cumulativePP: number[] = [];
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of records) {
    running = parseFloat((running + r.points).toFixed(2));
    cumulativePP.push(running);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // --- By type ---
  let buyBucket  = emptyBucket();
  let sellBucket = emptyBucket();
  for (const r of records) {
    if (r.type === "BUY")  buyBucket  = addRecord(buyBucket, r);
    if (r.type === "SELL") sellBucket = addRecord(sellBucket, r);
  }

  // --- By category ---
  const catMap: Record<string, BucketStats> = {};
  for (const r of records) {
    catMap[r.category] = addRecord(catMap[r.category] ?? emptyBucket(), r);
  }

  // --- By AI score conviction band ---
  // Conviction = distance of aiScore from 50
  let fortBucket  = emptyBucket();
  let moyenBucket = emptyBucket();
  let faibleBucket = emptyBucket();
  for (const r of records) {
    const dev = Math.abs((r.snapshot.aiScore ?? 50) - 50);
    if (dev >= 15)     fortBucket   = addRecord(fortBucket, r);
    else if (dev >= 7) moyenBucket  = addRecord(moyenBucket, r);
    else               faibleBucket = addRecord(faibleBucket, r);
  }

  // --- Recent form (last 10 decisive) ---
  const recent = records
    .filter((r) => r.result !== "NEUTRAL")
    .slice(-10);
  let recentBucket = emptyBucket();
  for (const r of recent) recentBucket = addRecord(recentBucket, r);

  return {
    profitFactor,
    expectedValue,
    avgWinPP,
    avgLossPP,
    currentStreak: { type: streakType, count: streak },
    bestWinStreak: bestWin,
    worstLossStreak: worstLoss,
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    cumulativePP: cumulativePP.slice(-50), // last 50 for sparkline
    byType: {
      BUY:  finalizeBucket(buyBucket),
      SELL: finalizeBucket(sellBucket),
    },
    byCategory: Object.fromEntries(
      Object.entries(catMap).map(([k, v]) => [k, finalizeBucket(v)]),
    ),
    byConviction: {
      "FORT >65":    finalizeBucket(fortBucket),
      "MOYEN 50-65": finalizeBucket(moyenBucket),
      "FAIBLE ≈50":  finalizeBucket(faibleBucket),
    },
    recentForm: { ...finalizeBucket(recentBucket), n: recent.length },
  };
}
