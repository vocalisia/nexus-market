/**
 * /api/cron — Server-side signal engine
 *
 * Called by Vercel cron every hour. For each variant (1-4):
 *   1. Fetch live market data (shared, one call)
 *   2. Generate signals with variant-specific config
 *   3. Dedup + save new alerts to Redis
 *   4. Validate pending alerts (age ≥ 1h)
 *   5. Update PerformanceMemory in Redis
 *
 * The browser becomes read-only: it just displays what the server computed.
 */

import { NextResponse } from "next/server";
import type { Asset } from "@/types/market";
import type { VariantId } from "@/lib/modelVariants";
import { MODEL_VARIANTS } from "@/lib/modelVariants";
import type { AlertIndicatorsSnapshot } from "@/lib/memoryEngine";
import { calculatePP, calculatePPFromLevels, VALIDATION_WINDOWS_MS } from "@/lib/memoryEngine";
import { addAlertRecordServer, loadMemoryServer } from "@/lib/serverMemory";
import { generateSignal, computeSentimentAdjustment } from "@/lib/scoring";
import type { SignalConfig } from "@/lib/scoring";
import {
  calculateRSI, calculateADX, calculateStochRSI, computeAllIndicators,
} from "@/lib/indicators";
import { buildTradePlan } from "@/lib/tradePlan";
import { fetchFearGreed, fearGreedAdjustment } from "@/lib/fearGreed";
import { detectRegime } from "@/lib/regimeDetection";
import { computeMacroContext, getMacroAdjustment } from "@/lib/macroCorrelation";
import { correlatePolymarket, computePolymarketSentiment } from "@/lib/correlation";
import {
  fetchCoinGecko, fetchTwelveForex, fetchCommodities, fetchPolymarket,
  fetchFundingRates, fetchLongShortRatios, fetchCryptoPanic, fetchLiquidationBias,
} from "@/lib/providers";
import type { StoredAlert } from "@/app/api/alerts/route";

export const dynamic  = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: up to 5 min

// ─── Env ──────────────────────────────────────────────────────

const REDIS_URL      = (process.env.UPSTASH_REDIS_REST_URL  ?? "").replace(/\/$/, "");
const REDIS_TOKEN    = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const TD_KEY         = process.env.TWELVE_DATA_API_KEY ?? "";
const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY ?? "";

// ─── Redis helpers ────────────────────────────────────────────

function auth() {
  return { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" };
}

async function redisGet(key: string): Promise<string | null> {
  try {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: auth(), cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json() as { result: string | null };
    return json.result ?? null;
  } catch { return null; }
}

async function redisSet(key: string, value: string): Promise<void> {
  await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST", headers: auth(),
    body: JSON.stringify([["SET", key, value]]),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

function alertKey(v: VariantId): string { return `nexus_alerts_v${v}`; }

async function loadAlerts(v: VariantId): Promise<StoredAlert[]> {
  const raw = await redisGet(alertKey(v));
  if (!raw) return [];
  try { return JSON.parse(raw) as StoredAlert[]; } catch { return []; }
}

async function saveAlerts(v: VariantId, alerts: StoredAlert[]): Promise<void> {
  await redisSet(alertKey(v), JSON.stringify(alerts.slice(-100)));
}

// ─── Current price fetch (for validation) ─────────────────────

async function fetchCurrentPrice(symbol: string, category: string): Promise<number | null> {
  try {
    if (category === "CRYPTO") {
      const idMap: Record<string, string> = {
        BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
        DOGE: "dogecoin", ADA: "cardano", DOT: "polkadot", AVAX: "avalanche-2",
        LINK: "chainlink", MATIC: "matic-network", UNI: "uniswap", LTC: "litecoin",
        XLM: "stellar", NEAR: "near", SUI: "sui",
      };
      const id = idMap[symbol.toUpperCase()] ?? symbol.toLowerCase();
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { cache: "no-store" },
      );
      const data = await res.json() as Record<string, { usd?: number }>;
      return data[id]?.usd ?? null;
    }
    if (category === "FOREX") {
      const [from, to] = symbol.split("/");
      if (!from || !to) return null;
      const res = await fetch(
        `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      const data = await res.json() as { rates?: Record<string, number> };
      return data.rates?.[to] ?? null;
    }
    if (category === "COMMODITIES") {
      // Gold: fetch PAXG from CoinGecko (free, no API key, 1:1 troy oz)
      if (symbol === "XAU/USD" || symbol === "GOLD" || symbol === "PAXG") {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=paxos-gold&vs_currencies=usd",
          { cache: "no-store" },
        );
        const data = await res.json() as Record<string, { usd?: number }>;
        return data["paxos-gold"]?.usd ?? null;
      }
      if (TD_KEY) {
        const tdMap: Record<string, string> = { "XAG/USD": "XAG/USD", "WTI": "CL", "NATGAS": "NG" };
        const tdSym = tdMap[symbol] ?? symbol;
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${tdSym}&apikey=${TD_KEY}`,
          { cache: "no-store" },
        );
        const data = await res.json() as { price?: string };
        return data.price ? parseFloat(data.price) : null;
      }
      return null;
    }
    return null;
  } catch { return null; }
}

// ─── Dedup constants ──────────────────────────────────────────

const DEDUP_MS  = 4 * 60 * 60 * 1000; // 4h — same signal can't fire twice

// ─── Process one variant ──────────────────────────────────────

interface CronResult {
  variant: VariantId;
  generated: number;
  validated: number;
  errors: string[];
}

async function processVariant(
  variant: VariantId,
  assets: Asset[],
  fearGreedValue: number,
): Promise<CronResult> {
  const errors: string[] = [];
  const cfg = MODEL_VARIANTS[variant];
  const signalCfg: SignalConfig = {
    adxGate: cfg.adxGate,
    minPartsForMedium: cfg.minPartsForMedium,
    highOnly: cfg.highOnly,
  };

  // 1. Load existing alerts
  const existing = await loadAlerts(variant);
  const now = Date.now();

  // Build dedup map from pending alerts
  const dedupMap = new Map<string, number>();
  for (const a of existing) {
    if (a.status === "PENDING") {
      dedupMap.set(`${a.symbol}_${a.type}`, new Date(a.generatedAt).getTime());
    }
  }

  const macroCtx = computeMacroContext(assets);

  // 2. Generate new signals
  const newAlerts: StoredAlert[] = [];
  for (const asset of assets) {
    const rsi    = calculateRSI(asset.sparkline);
    const regime = detectRegime(asset.sparkline);
    const { adjustment } = getMacroAdjustment(asset.id, macroCtx);
    const fgAdj = asset.category === "CRYPTO"
      ? fearGreedAdjustment(fearGreedValue) * cfg.fearGreedMult : 0;
    const adjustedScore = Math.min(100, Math.max(0,
      asset.aiScore + adjustment + regime.scoreModifier + fgAdj
    ));
    const adjustedDir = adjustedScore > 55 ? "UP" as const
      : adjustedScore < 45 ? "DOWN" as const : "NEUTRAL" as const;

    const signal = generateSignal(
      asset.name, asset.symbol, rsi,
      asset.change24h, asset.change7d,
      adjustedScore, adjustedDir,
      asset.category, asset.sparkline, signalCfg,
    );
    if (!signal) continue;

    // Dedup check
    const dk = `${asset.symbol}_${signal.type}`;
    const lastFired = dedupMap.get(dk);
    if (lastFired && now - lastFired < DEDUP_MS) continue;

    // Build trade plan
    const tradePlan = buildTradePlan(
      asset.sparkline, rsi, asset.change24h, asset.change7d,
      adjustedScore, asset.category,
      signal.type === "BUY" ? "LONG" : "SHORT",
    );

    // Build indicators snapshot
    const ind    = computeAllIndicators(asset.sparkline);
    const adxVal = calculateADX(asset.sparkline, asset.sparkline, asset.sparkline) ?? 0;
    const stoch  = calculateStochRSI(asset.sparkline);
    const snapshot: AlertIndicatorsSnapshot = {
      rsi,
      adx:         adxVal,
      stochRsiK:   stoch?.k ?? 50,
      macdCross:   ind.macd.cross,
      bollingerPos: ind.bollinger.position,
      obvRising:   ind.obv.rising,
      regime:      regime.regime,
      fearGreed:   fearGreedValue,
      aiScore:     adjustedScore,
    };

    const alert: StoredAlert = {
      id: `v${variant}_${asset.symbol}_${signal.type}_${now}`,
      variant,
      asset: asset.name,
      symbol: asset.symbol,
      type: signal.type as "BUY" | "SELL",
      message: signal.message,
      severity: signal.severity.toUpperCase() as "HIGH" | "MEDIUM" | "LOW",
      price: asset.price,
      entry: tradePlan?.entry,
      stopLoss: tradePlan?.stopLoss,
      target1: tradePlan?.target1,
      target2: tradePlan?.target2,
      category: asset.category,
      generatedAt: new Date().toISOString(),
      status: "PENDING",
      indicatorsSnapshot: snapshot,
    };

    newAlerts.push(alert);
    dedupMap.set(dk, now);
  }

  // 3. Validate pending alerts
  let validatedCount = 0;
  const updatedExisting: StoredAlert[] = [];

  for (const alert of existing) {
    // Already decided — keep as-is but expire after 7 days
    if (alert.status !== "PENDING") {
      const age = now - new Date(alert.generatedAt).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) updatedExisting.push(alert);
      continue;
    }

    const age = now - new Date(alert.generatedAt).getTime();
    const windows = VALIDATION_WINDOWS_MS[alert.category];

    // Too old (7 days) — expire
    if (age > 7 * 24 * 60 * 60 * 1000) {
      updatedExisting.push({ ...alert, status: "NEUTRAL", validatedAt: new Date().toISOString() });
      continue;
    }

    // Too young — not yet
    if (age < windows.short) {
      updatedExisting.push(alert);
      continue;
    }

    // Fetch current price
    const currentPrice = await fetchCurrentPrice(alert.symbol, alert.category);
    if (!currentPrice) {
      updatedExisting.push(alert); // retry next cron
      continue;
    }

    // Level-based or % threshold
    const hasLevels = alert.entry && alert.stopLoss && alert.target1;
    let result: "WIN" | "LOSS" | "NEUTRAL";
    let points: number;
    let levelHit: "TP2" | "TP1" | "SL" | "NONE" | undefined;

    if (hasLevels) {
      const lvl = calculatePPFromLevels(
        alert.type, alert.entry!, currentPrice,
        alert.stopLoss!, alert.target1!, alert.target2,
      );
      result = lvl.result; points = lvl.points; levelHit = lvl.levelHit;
    } else {
      const pp = calculatePP(alert.type, alert.price, currentPrice, alert.category);
      result = pp.result; points = pp.points;
    }

    // NEUTRAL → keep retrying
    if (result === "NEUTRAL") {
      updatedExisting.push(alert);
      continue;
    }

    // Decisive result — record in memory
    try {
      const defaultSnap: AlertIndicatorsSnapshot = {
        rsi: 50, adx: 0, stochRsiK: 50, macdCross: "NONE",
        bollingerPos: "INSIDE", obvRising: false,
        regime: "RANGING", fearGreed: 50, aiScore: 50,
      };
      await addAlertRecordServer(variant, {
        alertId: alert.id,
        asset: alert.asset,
        symbol: alert.symbol,
        category: alert.category,
        type: alert.type,
        severity: alert.severity,
        priceAtSignal: alert.price,
        priceAtValidation: currentPrice,
        result,
        points,
        generatedAt: alert.generatedAt,
        validatedAt: new Date().toISOString(),
        windowMs: windows.short,
        snapshot: alert.indicatorsSnapshot ?? defaultSnap,
        entry: alert.entry,
        stopLoss: alert.stopLoss,
        target1: alert.target1,
        target2: alert.target2,
        levelHit,
      });
      validatedCount++;
    } catch (e) {
      errors.push(`Memory update failed for ${alert.symbol}: ${String(e)}`);
    }

    updatedExisting.push({
      ...alert,
      status: result,
      validatedAt: new Date().toISOString(),
      validationPrice: currentPrice,
      points,
      levelHit,
    });
  }

  // 4. Merge and save
  const merged = [...updatedExisting, ...newAlerts].slice(-100);
  await saveAlerts(variant, merged);

  return { variant, generated: newAlerts.length, validated: validatedCount, errors };
}

// ─── GET /api/cron — called by Vercel cron ────────────────────

export async function GET() {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 503 });
  }

  const startedAt = new Date().toISOString();

  // 1. Fetch shared market data (one call, shared across all variants)
  const [pmRaw, fgData, fundingRates, lsRatios, cpSentiment, liqBiases] =
    await Promise.allSettled([
      fetchPolymarket().catch(() => []),
      fetchFearGreed(),
      fetchFundingRates().catch(() => ({})),
      fetchLongShortRatios().catch(() => ({})),
      fetchCryptoPanic(CRYPTOPANIC_KEY).catch(() => ({})),
      fetchLiquidationBias().catch(() => ({})),
    ]);

  const polymarket = correlatePolymarket(
    pmRaw.status === "fulfilled" ? pmRaw.value : []
  );
  const fearGreedValue = fgData.status === "fulfilled" ? fgData.value.value : 50;
  const funding  = fundingRates.status === "fulfilled" ? fundingRates.value : {};
  const ls       = lsRatios.status === "fulfilled" ? lsRatios.value : {};
  const cp       = cpSentiment.status === "fulfilled" ? cpSentiment.value : {};
  const liq      = liqBiases.status === "fulfilled" ? liqBiases.value : {};

  const sentiment = (id: string) => computePolymarketSentiment(id, polymarket);

  // 2. Fetch all asset classes in parallel
  const [cryptoRes, forexRes, commodityRes] = await Promise.allSettled([
    fetchCoinGecko(sentiment),
    fetchTwelveForex(TD_KEY, sentiment),
    fetchCommodities(TD_KEY, sentiment),
  ]);

  // Apply sentiment adjustment to crypto assets
  const cryptoAssets = (cryptoRes.status === "fulfilled" ? cryptoRes.value : []).map((a) => {
    const key = a.symbol.toUpperCase();
    const sentAdj = computeSentimentAdjustment({
      fundingRate:     (funding as Record<string, number>)[key],
      lsRatio:         (ls as Record<string, number>)[key],
      newsSentiment:   (cp as Record<string, number>)[key],
      liquidationBias: (liq as Record<string, number>)[key],
    });
    return { ...a, aiScore: Math.min(100, Math.max(0, a.aiScore + sentAdj)) };
  });

  const allAssets: Asset[] = [
    ...cryptoAssets,
    ...(forexRes.status === "fulfilled" ? forexRes.value : []),
    ...(commodityRes.status === "fulfilled" ? commodityRes.value : []),
  ];

  if (allAssets.length === 0) {
    return NextResponse.json({ error: "No market data available" }, { status: 503 });
  }

  // 3. Process all 4 variants in parallel
  const VARIANTS: VariantId[] = ["1", "2", "3", "4"];
  const results = await Promise.allSettled(
    VARIANTS.map((v) => processVariant(v, allAssets, fearGreedValue))
  );

  const summary = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { variant: "?", generated: 0, validated: 0, errors: [String(r.reason)] }
  );

  // 4. Save cron report to Redis
  const report = { runAt: startedAt, completedAt: new Date().toISOString(), assets: allAssets.length, variants: summary };
  await redisSet("nexus_cron_report", JSON.stringify(report));

  return NextResponse.json(report);
}
