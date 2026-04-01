import { NextResponse, type NextRequest } from "next/server";
import type { Asset, Signal } from "@/types/market";
import { MODEL_VARIANTS, DEFAULT_VARIANT } from "@/lib/modelVariants";
import type { VariantId } from "@/lib/modelVariants";
import type { SignalConfig } from "@/lib/scoring";
import { calculateRSI, calculateADX, calculateStochRSI, computeAllIndicators, detectRSIDivergence, computeMultiTF, detectVolumeAnomaly } from "@/lib/indicators";
import type { SignalIndicatorsSnapshot } from "@/types/market";
import { computeAIScore, getDirection, generateSignal } from "@/lib/scoring";
import { correlatePolymarket, computePolymarketSentiment } from "@/lib/correlation";
import { computeMacroContext, getMacroAdjustment } from "@/lib/macroCorrelation";
import { DEFAULT_WEIGHTS } from "@/lib/memoryEngine";
import type { IndicatorWeights } from "@/lib/memoryEngine";
import {
  fetchCoinGecko, fetchCommodities, fetchTwelveForex, fetchPolymarket,
  fetchFundingRates, fetchLongShortRatios, fetchCryptoPanic, fetchLiquidationBias,
} from "@/lib/providers";
import { computeSentimentAdjustment } from "@/lib/scoring";
import type { MarketSentimentData } from "@/lib/scoring";
import { buildTradePlan } from "@/lib/tradePlan";
import { fetchFearGreed, fearGreedAdjustment } from "@/lib/fearGreed";
import { detectRegime } from "@/lib/regimeDetection";

export const revalidate = 60;

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY ?? "";
const TD_KEY = process.env.TWELVE_DATA_API_KEY ?? "";
const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY ?? "";

// ─── Redis (Upstash) — load learned weights ─────────────────
const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL  ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

async function loadLearnedWeights(variant: VariantId): Promise<IndicatorWeights> {
  if (!REDIS_URL || !REDIS_TOKEN) return DEFAULT_WEIGHTS;
  try {
    const key = `nexus_memory_v${variant}`;
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store",
    });
    const json = await res.json() as { result: string | null };
    if (!json.result) return DEFAULT_WEIGHTS;
    const mem = JSON.parse(json.result) as { weights?: IndicatorWeights };
    return mem?.weights ?? DEFAULT_WEIGHTS;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

// ─── Alpha Vantage (stocks only, optional) ──────────────────

const STOCK_MAP: Record<string, string> = {
  AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia",
  TSLA: "Tesla", GOOGL: "Alphabet", AMZN: "Amazon", META: "Meta",
};

const ALLOWED_STOCK_SYMBOLS = new Set(Object.keys(STOCK_MAP));

async function fetchStocks(): Promise<Asset[]> {
  if (!AV_KEY) return [];

  const symbols = Object.keys(STOCK_MAP).slice(0, 3);
  const results = await Promise.allSettled(
    symbols.map(async (sym): Promise<Asset | null> => {
      // Guard: only process symbols explicitly listed in STOCK_MAP
      if (!ALLOWED_STOCK_SYMBOLS.has(sym)) return null;
      try {
        // Fetch quote + intraday in parallel
        const [quoteRes, intradayRes] = await Promise.allSettled([
          fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${AV_KEY}`, { next: { revalidate: 120 } }),
          fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${sym}&interval=60min&outputsize=compact&apikey=${AV_KEY}`, { next: { revalidate: 120 } }),
        ]);

        // Parse quote
        let price = 0;
        let change24h = 0;
        if (quoteRes.status === "fulfilled" && quoteRes.value.ok) {
          const data = await quoteRes.value.json();
          const q = data["Global Quote"];
          if (!q?.["05. price"]) return null;
          price = parseFloat(q["05. price"]) || 0;
          change24h = parseFloat((q["10. change percent"] ?? "0").replace("%", "")) || 0;
        } else {
          return null;
        }

        // Parse intraday for sparkline
        let sparkline: number[] = [];
        if (intradayRes.status === "fulfilled" && intradayRes.value.ok) {
          const intradayData = await intradayRes.value.json();
          const timeSeries = intradayData["Time Series (60min)"];
          if (timeSeries) {
            const entries = Object.entries(timeSeries) as [string, Record<string, string>][];
            sparkline = entries
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, vals]) => parseFloat(vals["4. close"]) || 0)
              .filter((v) => v > 0);
          }
        }

        const rsi = calculateRSI(sparkline);
        const change7d = sparkline.length >= 2
          ? ((sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]) * 100
          : 0;
        const score = computeAIScore(change24h, change7d, rsi, "STOCKS");

        return {
          id: sym.toLowerCase(),
          name: STOCK_MAP[sym] ?? sym,
          symbol: sym,
          category: "STOCKS" as const,
          price,
          change1h: 0, change24h, change7d,
          marketCap: 0, volume: 0, sparkline,
          aiScore: score,
          aiDirection: getDirection(score),
        };
      } catch {
        return null;
      }
    })
  );

  const assets: Asset[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) assets.push(r.value);
  }
  return assets;
}

// ─── Route Handler ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  const variant = (req.nextUrl.searchParams.get("variant") ?? DEFAULT_VARIANT) as VariantId;
  const variantCfg = MODEL_VARIANTS[variant] ?? MODEL_VARIANTS[DEFAULT_VARIANT];
  const signalCfg: SignalConfig = {
    adxGate: variantCfg.adxGate,
    minPartsForMedium: variantCfg.minPartsForMedium,
    highOnly: variantCfg.highOnly,
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void signalCfg; // used below in generateSignal calls
  try {
    // 0. Load learned indicator weights from Redis (ML feedback loop)
    const learnedWeights = await loadLearnedWeights(variant);

    // 1. Fetch Polymarket, Fear&Greed, and crypto microstructure data in parallel
    const pmRaw = await fetchPolymarket().catch(() => []);
    const polymarket = correlatePolymarket(pmRaw);
    const fearGreed = await fetchFearGreed();

    const [fundingResult, lsResult, cpResult, liqResult] = await Promise.allSettled([
      fetchFundingRates(),
      fetchLongShortRatios(),
      fetchCryptoPanic(CRYPTOPANIC_KEY),
      fetchLiquidationBias(),
    ]);
    const fundingRates = fundingResult.status === "fulfilled" ? fundingResult.value : {};
    const lsRatios    = lsResult.status === "fulfilled" ? lsResult.value : {};
    const cpSentiment = cpResult.status === "fulfilled" ? cpResult.value : {};
    const liqBiases   = liqResult.status === "fulfilled" ? liqResult.value : {};

    const getMarketSentiment = (symbol: string): MarketSentimentData => {
      const key = symbol.toUpperCase();
      return {
        fundingRate:     fundingRates[key],
        lsRatio:         lsRatios[key],
        newsSentiment:   cpSentiment[key],
        liquidationBias: liqBiases[key],
      };
    };

    const sentiment = (assetId: string) => computePolymarketSentiment(assetId, polymarket);

    // 2. Fetch all asset classes in parallel
    const [cryptoResult, forexResult, stocksResult, commodityResult] = await Promise.allSettled([
      fetchCoinGecko(sentiment),
      fetchTwelveForex(TD_KEY, sentiment),
      fetchStocks(),
      fetchCommodities(TD_KEY, sentiment),
    ]);

    const allAssets: Asset[] = [
      ...(cryptoResult.status === "fulfilled" ? cryptoResult.value : []),
      ...(forexResult.status === "fulfilled" ? forexResult.value : []),
      ...(commodityResult.status === "fulfilled" ? commodityResult.value : []),
      ...(stocksResult.status === "fulfilled" ? stocksResult.value : []),
    ];

    // 3. Macro correlation context
    const macroCtx = computeMacroContext(allAssets);

    // 4. Apply macro adjustments + generate signals (using learned indicator weights)
    const signals: Signal[] = [];
    const assetsWithPlans: Asset[] = allAssets.map((a) => {
      const rsi = calculateRSI(a.sparkline);
      const adxVal = calculateADX(a.sparkline, a.sparkline, a.sparkline) ?? 0;
      const stoch = calculateStochRSI(a.sparkline);
      const stochK = stoch?.k ?? 50;

      // Re-score with learned weights from Redis (ML feedback loop)
      const learnedScore = computeAIScore(
        a.change24h, a.change7d, rsi, a.category,
        sentiment(a.id), adxVal, stochK, learnedWeights,
      );

      const { adjustment } = getMacroAdjustment(a.id, macroCtx);
      const regime = detectRegime(a.sparkline);
      const fgAdj = a.category === "CRYPTO"
        ? fearGreedAdjustment(fearGreed.value) * variantCfg.fearGreedMult : 0;
      const mktSentAdj = a.category === "CRYPTO"
        ? computeSentimentAdjustment(getMarketSentiment(a.symbol)) * variantCfg.sentimentMult
        : 0;
      const adjustedScore = Math.min(100, Math.max(0, learnedScore + adjustment + regime.scoreModifier + fgAdj + mktSentAdj));
      const adjustedDirection = adjustedScore > 55 ? "UP" as const : adjustedScore < 45 ? "DOWN" as const : "NEUTRAL" as const;

      // ── Predictive enhancements ──────────────────────────────
      const divergence = detectRSIDivergence(a.sparkline);
      const multiTF    = computeMultiTF(a.sparkline);
      const volAnomaly = detectVolumeAnomaly(a.sparkline);

      // Score bonus: divergence + multi-TF alignment + volume spike
      let predictiveBonus = 0;
      if (divergence.bullish && adjustedDirection === "UP")   predictiveBonus += 8;
      if (divergence.bearish && adjustedDirection === "DOWN") predictiveBonus += 8;
      if (multiTF.aligned && multiTF.direction === adjustedDirection) {
        predictiveBonus += Math.round(multiTF.alignmentStrength * 0.4); // up to +20
      }
      if (volAnomaly.isSpike && volAnomaly.direction === adjustedDirection) {
        predictiveBonus += 6; // volume confirms the move
      }

      const finalScore = Math.min(100, Math.max(0, adjustedScore + predictiveBonus));
      const finalDirection = finalScore > 55 ? "UP" as const : finalScore < 45 ? "DOWN" as const : "NEUTRAL" as const;

      // Block SELL in BEAR/RANGING regime with weak ADX — main cause of false signals
      // Data: BEAR=11% WR, RANGING=33% WR when shorting into choppy market
      // Exception: allow SELL if RSI bearish divergence AND volume spike confirm it
      const hardConfirmed = divergence.bearish && volAnomaly.isSpike && volAnomaly.direction === "DOWN";
      const blockSell =
        finalDirection === "DOWN" &&
        (regime.regime === "BEAR" || regime.regime === "RANGING") &&
        adxVal < 30 &&
        !hardConfirmed;

      const signal = blockSell ? null : generateSignal(
        a.name, a.symbol, rsi,
        a.change24h, a.change7d,
        finalScore, finalDirection, a.category, a.sparkline, signalCfg
      );

      if (signal) {
        // Build indicators snapshot for auto-validation (reuse adxVal/stochK computed above)
        const ind = computeAllIndicators(a.sparkline);
        const snapshot: SignalIndicatorsSnapshot = {
          rsi,
          adx: adxVal,
          stochRsiK: stochK,
          macdCross: ind.macd.cross,
          bollingerPos: ind.bollinger.position,
          obvRising: ind.obv.rising,
          regime: regime.regime,
          fearGreed: fearGreed.value,
          aiScore: finalScore,
        };
        signals.push({ ...signal, indicatorsSnapshot: snapshot });
      }

      // Force tradePlan direction to match the signal to avoid SL/TP inversion
      const signalForce: "LONG" | "SHORT" | undefined =
        signal?.type === "BUY" ? "LONG" :
        signal?.type === "SELL" ? "SHORT" :
        undefined;

      return {
        ...a,
        aiScore: finalScore,
        aiDirection: finalDirection,
        tradePlan: buildTradePlan(
          a.sparkline, rsi,
          a.change24h, a.change7d,
          finalScore, a.category,
          signalForce,
        ),
      };
    });

    return NextResponse.json(
      { assets: assetsWithPlans, polymarket, signals, fearGreed, lastUpdated: new Date().toISOString(), demo: !TD_KEY },
      { status: 200, headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" } }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Failed to fetch market data",
        detail: error instanceof Error ? error.message : "Unknown",
        assets: [], polymarket: [], signals: [],
        lastUpdated: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
