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
import type { AlertIndicatorsSnapshot, KlineValidationResult } from "@/lib/memoryEngine";
import { calculatePP, VALIDATION_WINDOWS_MS, validateWithKlines } from "@/lib/memoryEngine";
import type { Candle } from "@/app/api/klines/route";
import { addAlertRecordServer, loadMemoryServer } from "@/lib/serverMemory";
import { generateSignal, computeSentimentAdjustment, computeAIScore } from "@/lib/scoring";
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
  await redisSet(alertKey(v), JSON.stringify(alerts.slice(-1000)));
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

// ─── Klines fetch for validation ─────────────────────────────
// Récupère les candles 1h depuis le signal jusqu'à maintenant

async function fetchKlinesForValidation(
  symbol: string,
  category: string,
  fromMs: number,
): Promise<Candle[]> {
  try {
    if (category === "CRYPTO") {
      // OKX → Bybit → Binance en fallback
      const okxSym: Record<string, string> = {
        BTC: "BTC-USDT", ETH: "ETH-USDT", SOL: "SOL-USDT", XRP: "XRP-USDT",
        DOGE: "DOGE-USDT", ADA: "ADA-USDT", DOT: "DOT-USDT", AVAX: "AVAX-USDT",
        LINK: "LINK-USDT", MATIC: "MATIC-USDT", UNI: "UNI-USDT", LTC: "LTC-USDT",
        XLM: "XLM-USDT", NEAR: "NEAR-USDT", SUI: "SUI-USDT",
      };
      const sym = okxSym[symbol.toUpperCase()];
      if (!sym) return [];

      // Calcule combien de candles 1h il faut (depuis le signal)
      const hoursNeeded = Math.min(168, Math.ceil((Date.now() - fromMs) / 3_600_000) + 2);

      const res = await fetch(
        `https://www.okx.com/api/v5/market/candles?instId=${sym}&bar=1H&limit=${hoursNeeded}`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) throw new Error(`OKX ${res.status}`);
      const data = await res.json() as { code: string; data: string[][] };
      if (data.code !== "0") throw new Error("OKX error");

      return data.data.reverse()
        .map(([t, o, h, l, c, v]) => ({
          time: parseInt(t), open: parseFloat(o), high: parseFloat(h),
          low: parseFloat(l), close: parseFloat(c), volume: parseFloat(v),
        }))
        .filter((c) => c.time >= fromMs);
    }

    if (category === "FOREX") {
      const tdMap: Record<string, string> = {
        "EUR/USD": "EUR/USD", "GBP/USD": "GBP/USD",
        "USD/JPY": "USD/JPY", "USD/CHF": "USD/CHF",
      };
      const tdSym = tdMap[symbol];
      if (!tdSym || !TD_KEY) return [];

      const res = await fetch(
        `https://api.twelvedata.com/time_series?symbol=${tdSym}&interval=1h&outputsize=120&apikey=${TD_KEY}&format=JSON`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) return [];
      const data = await res.json() as { values?: { datetime: string; high: string; low: string; open: string; close: string }[] };
      if (!data.values) return [];

      return data.values.reverse()
        .map((b) => ({
          time: new Date(b.datetime).getTime(),
          open: parseFloat(b.open), high: parseFloat(b.high),
          low: parseFloat(b.low), close: parseFloat(b.close), volume: 0,
        }))
        .filter((c) => c.time >= fromMs);
    }

    // COMMODITIES / STOCKS : pas de klines dispo facilement → retourner vide
    return [];
  } catch {
    return [];
  }
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
  btcIsDumping: boolean,
): Promise<CronResult> {
  const errors: string[] = [];
  const cfg = MODEL_VARIANTS[variant];
  const signalCfg: SignalConfig = {
    adxGate: cfg.adxGate,
    minPartsForMedium: cfg.minPartsForMedium,
    highOnly: cfg.highOnly,
  };

  // 1. Load existing alerts + learned weights + asset performance
  const existing = await loadAlerts(variant);
  const memory = await loadMemoryServer(variant);
  const learnedWeights = memory.weights;
  const now = Date.now();

  // V3 FIX 4: Build set of chronically losing assets (win rate < 35% over 20+ trades)
  const losersSet = new Set<string>();
  for (const [sym, stats] of Object.entries(memory.byAsset)) {
    const decisive = stats.wins + stats.losses;
    if (decisive >= 10 && stats.winRate < 35) {
      losersSet.add(sym);
    }
  }

  // Build dedup map from pending alerts
  const dedupMap = new Map<string, number>();
  for (const a of existing) {
    if (a.status === "PENDING") {
      dedupMap.set(`${a.symbol}_${a.type}`, new Date(a.generatedAt).getTime());
    }
  }

  const macroCtx = computeMacroContext(assets);

  // 2. Generate new signals — USING LEARNED WEIGHTS
  const newAlerts: StoredAlert[] = [];
  for (const asset of assets) {
    const rsi    = calculateRSI(asset.sparkline);
    const regime = detectRegime(asset.sparkline);
    const { adjustment } = getMacroAdjustment(asset.id, macroCtx);
    const fgAdj = asset.category === "CRYPTO"
      ? fearGreedAdjustment(fearGreedValue) * cfg.fearGreedMult : 0;

    // Recalculer le score avec les poids appris
    const sigAdx   = calculateADX(asset.sparkline, asset.sparkline, asset.sparkline) ?? 0;
    const sigStoch = calculateStochRSI(asset.sparkline);
    const learnedScore = computeAIScore(
      asset.change24h, asset.change7d, rsi, asset.category,
      50, sigAdx, sigStoch?.k ?? 50, learnedWeights,
    );
    const adjustedScore = Math.min(100, Math.max(0,
      learnedScore + adjustment + regime.scoreModifier + fgAdj
    ));

    // BUG 2 FIX: Bloquer SELL crypto en régime BULL avec Fear&Greed > 65
    const isBullCrypto = asset.category === "CRYPTO"
      && regime.regime === "BULL" && fearGreedValue > 65;

    const adjustedDir = adjustedScore > 55 ? "UP" as const
      : adjustedScore < 45 ? "DOWN" as const : "NEUTRAL" as const;

    // Block ALL signals in RANGING/BEAR with weak ADX (same logic as /api/markets)
    // Data: RANGING=24% WR (13W/41L), BEAR=10% WR (1W/9L) → massacre
    if ((regime.regime === "BEAR" || regime.regime === "RANGING") && sigAdx < 25) continue;

    // FIX WR: Require conviction — SELL ≤ 40, BUY ≥ 65 (adjusted from data distribution)
    const hasStrongConviction =
      (adjustedDir === "DOWN" && adjustedScore <= 40) ||
      (adjustedDir === "UP"   && adjustedScore >= 65);
    if (!hasStrongConviction) continue;

    // FIX WR: Extreme fear (F&G < 20) = block crypto BUY unless extreme oversold (score ≥ 80)
    if (fearGreedValue < 20 && asset.category === "CRYPTO" && adjustedDir === "UP" && adjustedScore < 80) continue;

    const signal = generateSignal(
      asset.name, asset.symbol, rsi,
      asset.change24h, asset.change7d,
      adjustedScore, adjustedDir,
      asset.category, asset.sparkline, signalCfg,
    );
    if (!signal) continue;

    // BUG 2 FIX: Bloquer SELL crypto en régime BULL + Fear&Greed > 65
    if (isBullCrypto && signal.type === "SELL") continue;

    // V3 FIX 4: Skip chronically losing assets (lowered to 10 decisive trades for faster exclusion)
    if (losersSet.has(asset.symbol.toUpperCase())) continue;

    // V3 FIX 5: Block altcoin BUY when BTC is dumping > 5%
    if (btcIsDumping && asset.category === "CRYPTO" && asset.symbol.toUpperCase() !== "BTC" && signal.type === "BUY") continue;

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

  // ─── Correlation filter: keep top N per category ────────────
  // Prevents flooding alerts with 10 correlated crypto signals
  const MAX_ALERTS_PER_CAT: Record<string, number> = {
    CRYPTO: 3, FOREX: 2, COMMODITIES: 2, STOCKS: 3,
  };
  const sevRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  newAlerts.sort((a, b) => (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0));
  const catAlertCount: Record<string, number> = {};
  const filteredAlerts = newAlerts.filter((a) => {
    catAlertCount[a.category] = (catAlertCount[a.category] ?? 0) + 1;
    return catAlertCount[a.category] <= (MAX_ALERTS_PER_CAT[a.category] ?? 3);
  });

  // 3. Validate pending alerts
  let validatedCount = 0;
  const updatedExisting: StoredAlert[] = [];

  for (const alert of existing) {
    // Already decided — keep as-is, expire after 90 days
    if (alert.status !== "PENDING") {
      const age = now - new Date(alert.generatedAt).getTime();
      if (age < 90 * 24 * 60 * 60 * 1000) updatedExisting.push(alert);
      continue;
    }

    const age = now - new Date(alert.generatedAt).getTime();
    const windows = VALIDATION_WINDOWS_MS[alert.category];

    // Too old (21 days max) — expire
    const MAX_AGE = 21 * 24 * 60 * 60 * 1000;
    if (age > MAX_AGE) {
      updatedExisting.push({ ...alert, status: "NEUTRAL", validatedAt: new Date().toISOString() });
      continue;
    }

    // Too young — not yet
    if (age < windows.short) {
      updatedExisting.push(alert);
      continue;
    }

    // ── Validation par klines (simulation séquentielle) ──────────
    const hasLevels = !!(alert.entry && alert.stopLoss && alert.target1);
    const pastMedium = age > windows.medium;

    let result: "WIN" | "LOSS" | "NEUTRAL";
    let points: number;
    let levelHit: "TP2" | "TP1" | "BE" | "SL" | "NONE" = "NONE";
    let currentPrice = 0;
    let klinesValidation: KlineValidationResult | null = null;

    if (hasLevels) {
      // Tente la validation par klines (candle par candle)
      const signalMs = new Date(alert.generatedAt).getTime();
      const candles = await fetchKlinesForValidation(alert.symbol, alert.category, signalMs);

      if (candles.length > 0) {
        klinesValidation = validateWithKlines(
          alert.type, alert.entry!, alert.stopLoss!, alert.target1!, alert.target2,
          candles,
        );
        result   = klinesValidation.result;
        points   = klinesValidation.points;
        levelHit = klinesValidation.levelHit;
        currentPrice = candles[candles.length - 1].close;
      } else {
        // Fallback prix spot si pas de klines
        const spotPrice = await fetchCurrentPrice(alert.symbol, alert.category);
        if (!spotPrice) { updatedExisting.push(alert); continue; }
        currentPrice = spotPrice;
        if (pastMedium) {
          const pp = calculatePP(alert.type, alert.price, spotPrice, alert.category);
          result = pp.result; points = pp.points; levelHit = "NONE";
        } else {
          result = "NEUTRAL"; points = 0;
        }
      }
    } else {
      // Pas de niveaux → fallback % threshold
      const spotPrice = await fetchCurrentPrice(alert.symbol, alert.category);
      if (!spotPrice) { updatedExisting.push(alert); continue; }
      currentPrice = spotPrice;
      const pp = calculatePP(alert.type, alert.price, spotPrice, alert.category);
      result = pp.result; points = pp.points;
    }

    // ── NEUTRE supprimé — seulement EXPIRATION ──
    // Si aucun niveau touché ET dépassé le long window → EXPIRE (pas de record)
    // Si aucun niveau touché ET dans le long window → reste PENDING
    const pastLong = age > windows.long;
    if (result === "NEUTRAL") {
      if (!pastLong) {
        updatedExisting.push(alert); // Reste en attente
        continue;
      } else {
        // Expiré sans record — on ne l'enregistre pas
        updatedExisting.push({
          ...alert,
          status: "NEUTRAL", // Marqué NEUTRE UI mais pas dans la mémoire
          validatedAt: new Date().toISOString(),
          validationPrice: currentPrice,
        });
        continue; // Skip le record en mémoire
      }
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
        // Kline precision data
        tp1Price:     klinesValidation?.tp1Price,
        tp2Price:     klinesValidation?.tp2Price,
        bePrice:      klinesValidation?.bePrice,
        slPrice:      klinesValidation?.slPrice,
        tp1TouchedAt: klinesValidation?.tp1TouchedAt,
        tp2TouchedAt: klinesValidation?.tp2TouchedAt,
        beTouchedAt:  klinesValidation?.beTouchedAt,
        slTouchedAt:  klinesValidation?.slTouchedAt,
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
  const merged = [...updatedExisting, ...filteredAlerts].slice(-1000);
  await saveAlerts(variant, merged);

  return { variant, generated: filteredAlerts.length, validated: validatedCount, errors };
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

  // V3 FIX 1: Skip forex on weekends (stale data = junk signals)
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // V3 FIX 5: Detect BTC dump for altcoin signal suppression
  let btcDumping = false;

  // 2. Fetch all asset classes in parallel
  const [cryptoRes, forexRes, commodityRes] = await Promise.allSettled([
    fetchCoinGecko(sentiment),
    isWeekend ? Promise.resolve([]) : fetchTwelveForex(TD_KEY, sentiment),
    isWeekend ? Promise.resolve([]) : fetchCommodities(TD_KEY, sentiment),
  ]);

  // V3 FIX 5: Detect BTC dump (24h change < -5%)
  const rawCrypto = cryptoRes.status === "fulfilled" ? cryptoRes.value : [];
  const btcAsset = rawCrypto.find((a) => a.symbol === "BTC");
  if (btcAsset && btcAsset.change24h < -5) btcDumping = true;

  // Apply sentiment adjustment to crypto assets
  const cryptoAssets = rawCrypto.map((a) => {
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
    VARIANTS.map((v) => processVariant(v, allAssets, fearGreedValue, btcDumping))
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
