# NEXUS MARKET — Cahier des Charges : Auto-Validation & Auto-Apprentissage
**Date :** 2026-03-28
**Version :** 2.0 (basé sur audit code réel)
**Module :** AlertAutoControl + PerformanceMemory + AutoLearn
**Dépend de :** code existant dans src/lib/

---

## ÉTAT DU CODE EXISTANT (lu le 2026-03-28)

Avant de spécifier les nouveautés, voici ce qui existe **déjà** :

| Fichier | Ce qui est implémenté |
|---------|----------------------|
| `src/lib/useAlerts.ts` | `Alert` interface, localStorage, déduplication 15min, fraîcheur, bannière critique |
| `src/lib/regimeDetection.ts` | `detectRegime()` → BULL/BEAR/RANGING/TRANSITION via ATR+ADX+pente |
| `src/lib/fearGreed.ts` | `fetchFearGreed()` + `fearGreedAdjustment()` via alternative.me |
| `src/lib/macroCorrelation.ts` | `getMacroAdjustment()` → règles USD/VIX/risk cross-asset |
| `src/lib/indicators.ts` | RSI, MACD, Bollinger, ADX, StochRSI, OBV, SAR via @ixjb94/indicators |
| `src/lib/scoring.ts` | `SCORING_CONFIGS` par catégorie, `computeAIScore()`, `generateSignal()` |
| `src/lib/useBinanceWs.ts` | WebSocket Binance temps réel (crypto uniquement) |

**Conclusion :** Les alertes v2 sont déjà en place. Ce cahier des charges couvre uniquement la **couche auto-validation + mémoire + apprentissage** qui vient **par-dessus** l'existant.

---

## 1. OBJECTIF PRÉCIS

### Ce qu'on veut

```
Alerte BUY BTC générée à 14h00 au prix $66,420
           ↓
      [attendre 4h]
           ↓
à 18h00 : prix BTC = $67,500
           ↓
Système calcule : +1.63 PP ✅ VALIDÉ
           ↓
Mémorise : "RSI + ADX ont bien fonctionné ce coup-ci"
           ↓
Poids RSI +0.025, poids ADX +0.025
           ↓
Prochain score IA = légèrement plus précis
```

### Ce qu'on NE fait PAS

- Pas de vrais trades (zéro connexion exchange)
- Pas de dollars — uniquement des Points de Précision (PP)
- Pas de base de données — uniquement localStorage
- Pas de backend supplémentaire — uniquement client-side + API Next.js existante

---

## 2. MODIFICATION DE L'INTERFACE `Alert` EXISTANTE

**Fichier :** `src/lib/useAlerts.ts` — ligne 6

**Interface actuelle :**
```typescript
export interface Alert {
  id: string
  asset: string
  symbol: string
  type: "BUY" | "SELL" | "WATCH"
  message: string
  severity: "HIGH" | "MEDIUM" | "LOW"
  price: number
  entry?: number
  stopLoss?: number
  target1?: number
  generatedAt: string
  dismissedAt?: string | null
  read: boolean
  category?: AssetCategory
}
```

**Interface modifiée (ajout de `indicatorsSnapshot` et `validationStatus`) :**
```typescript
export interface AlertIndicatorsSnapshot {
  rsi: number                              // valeur RSI au moment du signal
  adx: number                              // valeur ADX au moment du signal
  stochRsiK: number                        // valeur Stoch RSI K
  macdCross: "BULLISH" | "BEARISH" | "NONE"
  bollingerPos: "ABOVE" | "INSIDE" | "BELOW"
  obvRising: boolean
  regime: "BULL" | "BEAR" | "RANGING" | "TRANSITION"
  fearGreed: number                        // 0-100, 50 si non dispo
  aiScore: number                          // score IA au moment du signal
}

export interface AlertValidation {
  status: "PENDING" | "WIN" | "LOSS" | "NEUTRAL" | "SKIPPED"
  priceAtValidation: number                // prix réel à T+window
  validatedAt: string                      // ISO timestamp
  points: number                           // PP calculés (+/-)
  windowUsed: "short" | "medium" | "long"
}

export interface Alert {
  // --- Champs existants (inchangés) ---
  id: string
  asset: string
  symbol: string
  type: "BUY" | "SELL" | "WATCH"
  message: string
  severity: "HIGH" | "MEDIUM" | "LOW"
  price: number
  entry?: number
  stopLoss?: number
  target1?: number
  generatedAt: string
  dismissedAt?: string | null
  read: boolean
  category?: AssetCategory
  // --- Nouveaux champs ---
  indicatorsSnapshot?: AlertIndicatorsSnapshot  // snapshot au moment du signal
  validation?: AlertValidation                  // résultat après validation (null = PENDING)
}
```

**Règle importante :** `indicatorsSnapshot` est optionnel → rétrocompatible avec les alertes déjà stockées dans localStorage (pas de migration nécessaire).

---

## 3. NOUVEAU TYPE : `PerformanceMemory`

**Fichier :** `src/lib/memoryEngine.ts` (NOUVEAU)

```typescript
// ─── Clés localStorage ────────────────────────────────────
export const MEMORY_STORAGE_KEY = "nexus_memory"
export const MEMORY_VERSION = 1  // incrémenter si migration nécessaire

// ─── Poids des indicateurs ────────────────────────────────
// Poids par défaut = 1.0. Plage = 0.3 à 1.8.
export interface IndicatorWeights {
  rsi: number           // défaut 1.0
  adx: number           // défaut 1.0
  stochRsi: number      // défaut 1.0
  macd: number          // défaut 1.0
  bollinger: number     // défaut 1.0
  obv: number           // défaut 1.0
  fearGreed: number     // défaut 1.0
  polymarket: number    // défaut 1.0
  macro: number         // défaut 1.0
}

export const DEFAULT_WEIGHTS: IndicatorWeights = {
  rsi: 1.0, adx: 1.0, stochRsi: 1.0, macd: 1.0,
  bollinger: 1.0, obv: 1.0, fearGreed: 1.0, polymarket: 1.0, macro: 1.0,
}

// ─── Résultat d'une alerte validée ────────────────────────
export interface AlertRecord {
  alertId: string
  asset: string                  // ex: "Bitcoin (BTC)"
  symbol: string                 // ex: "BTC"
  category: AssetCategory
  type: "BUY" | "SELL"
  severity: "HIGH" | "MEDIUM" | "LOW"
  priceAtSignal: number
  priceAtValidation: number
  result: "WIN" | "LOSS" | "NEUTRAL"
  points: number                 // PP (peut être négatif)
  generatedAt: string            // ISO
  validatedAt: string            // ISO
  windowMs: number               // durée de la fenêtre en ms
  snapshot: AlertIndicatorsSnapshot
}

// ─── Stats par actif ──────────────────────────────────────
export interface AssetStats {
  asset: string
  symbol: string
  totalSignals: number
  wins: number
  losses: number
  neutrals: number
  winRate: number                // 0–100, calculé = wins/(wins+losses)
  totalPoints: number
  avgPoints: number              // totalPoints / (wins+losses)
  lastSignalAt: string
}

// ─── Stats par régime ─────────────────────────────────────
export interface RegimeStats {
  wins: number
  losses: number
  neutrals: number
  winRate: number
  totalPoints: number
}

// ─── Objet mémoire principal ──────────────────────────────
export interface PerformanceMemory {
  version: number                            // = MEMORY_VERSION
  totalValidated: number                     // total alertes WIN+LOSS+NEUTRAL
  totalWins: number
  totalLosses: number
  totalNeutrals: number
  totalPoints: number                        // somme de tous les PP
  globalWinRate: number                      // 0–100
  learningPhase: "COLD" | "WARMING" | "ACTIVE" | "FULL"
  // COLD    = < 20 validations  → poids fixes
  // WARMING = 20–50             → learning rate × 0.5
  // ACTIVE  = 50–100            → learning rate × 1.0
  // FULL    = > 100             → learning rate × 1.0, confiance maximale

  weights: IndicatorWeights                  // poids actuels (évolue au fil du temps)
  lastWeightUpdate: string                   // ISO timestamp dernier ajustement

  byAsset: Record<string, AssetStats>        // clé = symbol (ex: "BTC")
  byRegime: {
    BULL: RegimeStats
    BEAR: RegimeStats
    RANGING: RegimeStats
    TRANSITION: RegimeStats
  }
  bySeverity: {
    HIGH: { wins: number; losses: number; winRate: number }
    MEDIUM: { wins: number; losses: number; winRate: number }
    LOW: { wins: number; losses: number; winRate: number }
  }

  history: AlertRecord[]                     // max 200 dernières alertes
  lastUpdated: string                        // ISO timestamp
  degradationStreak: number                  // nb d'LOSS consécutifs
}
```

---

## 4. CALCUL DES POINTS DE PRÉCISION (PP)

### Formule complète

```typescript
// src/lib/memoryEngine.ts

const VALIDATION_THRESHOLDS: Record<AssetCategory, number> = {
  CRYPTO:      0.008,  // 0.8% minimum pour compter
  FOREX:       0.0015, // 0.15%
  COMMODITIES: 0.005,  // 0.5%
  STOCKS:      0.005,  // 0.5%
}

const VALIDATION_WINDOWS_MS: Record<AssetCategory, {
  short: number; medium: number; long: number
}> = {
  CRYPTO:      { short: 1*60*60*1000,  medium: 4*60*60*1000,   long: 24*60*60*1000 },
  FOREX:       { short: 2*60*60*1000,  medium: 8*60*60*1000,   long: 24*60*60*1000 },
  COMMODITIES: { short: 4*60*60*1000,  medium: 12*60*60*1000,  long: 48*60*60*1000 },
  STOCKS:      { short: 4*60*60*1000,  medium: 24*60*60*1000,  long: 72*60*60*1000 },
}

export function calculatePP(
  type: "BUY" | "SELL",
  priceAtSignal: number,
  priceAtValidation: number,
  category: AssetCategory
): { points: number; result: "WIN" | "LOSS" | "NEUTRAL" } {
  if (priceAtSignal <= 0) return { points: 0, result: "NEUTRAL" }

  const threshold = VALIDATION_THRESHOLDS[category]
  const pctMove = (priceAtValidation - priceAtSignal) / priceAtSignal

  // Direction prédite
  const predictedUp = type === "BUY"

  // Mouvement réel dans la direction prédite
  const directionCorrect = predictedUp ? pctMove > 0 : pctMove < 0
  const amplitude = Math.abs(pctMove)

  // En dessous du seuil = bruit de marché
  if (amplitude < threshold) {
    return { points: 0, result: "NEUTRAL" }
  }

  // Points = ±amplitude en pourcentage
  const rawPoints = amplitude * 100
  const points = directionCorrect
    ? +parseFloat(rawPoints.toFixed(2))
    : -parseFloat(rawPoints.toFixed(2))

  return {
    points,
    result: directionCorrect ? "WIN" : "LOSS"
  }
}
```

### Exemples concrets

```
CRYPTO BUY BTC 66,420 → 4h après 67,500
  pctMove = (67500-66420)/66420 = +0.01626
  amplitude = 1.626% > 0.8% seuil ✓
  direction correcte ✓
  PP = +1.63  → WIN 🟢

FOREX SELL EUR/USD 1.1517 → 8h après 1.1502
  pctMove = (1.1502-1.1517)/1.1517 = -0.0013
  amplitude = 0.13% < 0.15% seuil → BRUIT
  PP = 0  → NEUTRAL ⚪

COMMODITY SELL Gold 3105 → 12h après 3120
  pctMove = (3120-3105)/3105 = +0.00483
  amplitude = 0.483% < 0.5% seuil → BRUIT
  PP = 0  → NEUTRAL ⚪

COMMODITY SELL Gold 3105 → 12h après 3150
  pctMove = +0.0145 → 1.45% > 0.5% seuil
  direction : prédite DOWN, réelle UP → FAUX
  PP = -1.45  → LOSS 🔴
```

---

## 5. ALGORITHME D'AUTO-APPRENTISSAGE

### 5.1 Mapping indicateur → contribution au signal

Quand un signal est généré, on capture quels indicateurs **ont activement contribué** dans `indicatorsSnapshot`. L'apprentissage ajuste uniquement les indicateurs qui étaient actifs.

```typescript
// src/lib/autoLearn.ts

const WEIGHT_BOUNDS = { min: 0.30, max: 1.80 }

// Vitesse d'apprentissage selon la phase
function getLearningRate(phase: PerformanceMemory["learningPhase"]): number {
  switch (phase) {
    case "COLD":    return 0      // pas d'apprentissage
    case "WARMING": return 0.025  // demi-vitesse
    case "ACTIVE":  return 0.05   // vitesse normale
    case "FULL":    return 0.05   // vitesse normale
  }
}

// Détermine quels indicateurs ont été actifs dans ce signal
function getActiveIndicators(
  snapshot: AlertIndicatorsSnapshot,
  category: AssetCategory
): (keyof IndicatorWeights)[] {
  const active: (keyof IndicatorWeights)[] = []

  // RSI: actif si extrême (< seuil oversold ou > overbought selon catégorie)
  const rsiThresholds = { CRYPTO: 30, FOREX: 25, COMMODITIES: 28, STOCKS: 30 }
  const rsiOversold = rsiThresholds[category]
  if (snapshot.rsi < rsiOversold || snapshot.rsi > (100 - rsiOversold)) {
    active.push("rsi")
  }

  // ADX: actif si > 25
  if (snapshot.adx > 25) active.push("adx")

  // StochRSI: actif si extrême
  if (snapshot.stochRsiK < 20 || snapshot.stochRsiK > 80) active.push("stochRsi")

  // MACD: actif si croisement
  if (snapshot.macdCross !== "NONE") active.push("macd")

  // Bollinger: actif si hors bandes
  if (snapshot.bollingerPos !== "INSIDE") active.push("bollinger")

  // OBV: toujours actif (confirmation volume)
  active.push("obv")

  // Fear & Greed: actif si extrême (< 25 ou > 75)
  if (snapshot.fearGreed < 25 || snapshot.fearGreed > 75) active.push("fearGreed")

  return active
}

// Mise à jour d'un poids
function clampWeight(w: number): number {
  return Math.min(WEIGHT_BOUNDS.max, Math.max(WEIGHT_BOUNDS.min, w))
}

export function updateWeights(
  currentWeights: IndicatorWeights,
  record: AlertRecord,
  phase: PerformanceMemory["learningPhase"]
): IndicatorWeights {
  if (phase === "COLD") return currentWeights // trop tôt

  const lr = getLearningRate(phase)
  const activeIndicators = getActiveIndicators(record.snapshot, record.category)

  // Confidence basée sur l'amplitude du mouvement (0.0 à 1.0)
  // Fort mouvement = apprentissage plus marqué
  const amplitudeConfidence = Math.min(1.0, Math.abs(record.points) / 3.0)
  const effectiveDelta = lr * amplitudeConfidence

  const updated = { ...currentWeights }

  for (const indicator of activeIndicators) {
    if (record.result === "WIN") {
      updated[indicator] = clampWeight(updated[indicator] + effectiveDelta)
    } else if (record.result === "LOSS") {
      updated[indicator] = clampWeight(updated[indicator] - effectiveDelta)
    }
    // NEUTRAL : pas de mise à jour de poids
  }

  return updated
}
```

### 5.2 Détermination de la phase d'apprentissage

```typescript
export function computeLearningPhase(
  totalValidated: number
): PerformanceMemory["learningPhase"] {
  if (totalValidated < 20)  return "COLD"
  if (totalValidated < 50)  return "WARMING"
  if (totalValidated < 100) return "ACTIVE"
  return "FULL"
}
```

### 5.3 Détection de dégradation

```typescript
// Déclenché si 10 LOSS consécutifs sans WIN
export function checkDegradation(
  degradationStreak: number,
  result: "WIN" | "LOSS" | "NEUTRAL"
): {
  newStreak: number
  shouldReset: boolean
  resetReason?: string
} {
  if (result === "WIN") {
    return { newStreak: 0, shouldReset: false }
  }
  if (result === "NEUTRAL") {
    return { newStreak: degradationStreak, shouldReset: false }
  }
  // LOSS
  const newStreak = degradationStreak + 1
  if (newStreak >= 10) {
    return {
      newStreak: 0,
      shouldReset: true,
      resetReason: `10 erreurs consécutives — poids réinitialisés automatiquement`
    }
  }
  return { newStreak, shouldReset: false }
}

// Remise à zéro partielle : ramène chaque poids vers 1.0 de 50%
export function partialWeightReset(weights: IndicatorWeights): IndicatorWeights {
  const reset: IndicatorWeights = {} as IndicatorWeights
  for (const key of Object.keys(weights) as (keyof IndicatorWeights)[]) {
    reset[key] = parseFloat(((weights[key] + 1.0) / 2).toFixed(3))
  }
  return reset
}
```

### 5.4 Impact sur `scoring.ts` — poids dynamiques

**Fichier :** `src/lib/scoring.ts`
**Modification :** `computeAIScore()` accepte un paramètre `weights` optionnel

```typescript
// AVANT (ligne 55)
export function computeAIScore(
  change24h: number,
  change7d: number,
  rsi: number,
  category: AssetCategory,
  sentiment = 50,
  adx = 0,
  stochRsiK = 50
): number

// APRÈS — signature étendue (rétrocompatible grâce aux défauts)
export function computeAIScore(
  change24h: number,
  change7d: number,
  rsi: number,
  category: AssetCategory,
  sentiment = 50,
  adx = 0,
  stochRsiK = 50,
  weights: IndicatorWeights = DEFAULT_WEIGHTS  // ← nouveau paramètre optionnel
): number {
  const cfg = SCORING_CONFIGS[category]

  // Mêmes calculs de base, mais pondérés par weights
  const rsiScore    = rsi * weights.rsi
  const adxMod      = (adx > 25 ? 5 : adx > 0 ? -10 : 0) * weights.adx
  const stochMod    = (stochRsiK < 20 ? 8 : stochRsiK > 80 ? -8 : 0) * weights.stochRsi
  const sentimentW  = sentiment * weights.polymarket

  const ch24  = normalize(change24h, cfg.change24hRange[0], cfg.change24hRange[1])
  const ch7d  = normalize(change7d, cfg.change7dRange[0], cfg.change7dRange[1])

  const baseScore =
    rsiScore         * cfg.rsiWeight +
    ch24             * cfg.change24hWeight +
    ch7d             * cfg.change7dWeight +
    sentimentW       * cfg.sentimentWeight

  return Math.round(Math.min(100, Math.max(0, baseScore + adxMod + stochMod)))
}
```

---

## 6. VALIDATION AUTOMATIQUE — FETCH DU PRIX

### 6.1 Source de données par catégorie

```
CRYPTO    → Binance WebSocket (useBinanceWs déjà implémenté) OU CoinGecko API
FOREX     → Frankfurter API (déjà utilisé dans providers.ts)
COMMODITIES → Twelve Data API (si clé dispo) OU simulation
STOCKS    → Alpha Vantage (si clé dispo) OU skip validation
```

### 6.2 Endpoint de validation

**Nouveau fichier :** `src/app/api/validate/route.ts`

```
GET /api/validate?symbol=BTC&category=CRYPTO&priceAtSignal=66420&window=medium

Réponse :
{
  symbol: "BTC",
  currentPrice: 67500,
  fetchedAt: "2026-03-28T18:00:00Z",
  source: "coingecko"
}
```

**Logique interne :**
```typescript
// Pour CRYPTO : fetch CoinGecko (1 appel par validation, gratuit)
// Pour FOREX : fetch Frankfurter (1 appel gratuit)
// Pour COMMODITIES : fetch Twelve Data /price (1 credit gratuit)
// Pour STOCKS : fetch Alpha Vantage GLOBAL_QUOTE (si ALPHA_VANTAGE_API_KEY)
//               sinon : return null → validation SKIPPED
```

**Fallback si fetch échoue :** résultat `SKIPPED` (ne compte pas dans les stats)

---

## 7. HOOK `useAlertValidation`

**Fichier :** `src/hooks/useAlertValidation.ts` (NOUVEAU)

```typescript
"use client"
import { useEffect, useCallback } from "react"
import type { Alert } from "@/lib/useAlerts"
import { calculatePP, VALIDATION_WINDOWS_MS } from "@/lib/memoryEngine"
import { addAlertRecord } from "@/lib/memoryEngine"

interface UseAlertValidationProps {
  alerts: Alert[]                  // depuis useAlerts
  onValidated: (
    alertId: string,
    validation: AlertValidation
  ) => void                        // callback pour mettre à jour l'alerte dans useAlerts
}

export function useAlertValidation({
  alerts,
  onValidated,
}: UseAlertValidationProps) {

  const validatePending = useCallback(async () => {
    const now = Date.now()

    // Filtre : alertes BUY/SELL, PENDING, et dont la fenêtre medium est écoulée
    const pendingAlerts = alerts.filter((a) => {
      if (a.type === "WATCH") return false              // WATCH jamais validé
      if (a.validation?.status !== undefined &&
          a.validation.status !== "PENDING") return false  // déjà validé
      if (!a.category) return false                    // catégorie requise
      if (!a.price || a.price <= 0) return false       // prix requis

      const windows = VALIDATION_WINDOWS_MS[a.category]
      const age = now - new Date(a.generatedAt).getTime()
      return age >= windows.medium  // fenêtre medium écoulée
    })

    if (pendingAlerts.length === 0) return

    // Valider une alerte à la fois (éviter flood API)
    for (const alert of pendingAlerts.slice(0, 3)) {  // max 3 par cycle
      try {
        const res = await fetch(
          `/api/validate?symbol=${alert.symbol}&category=${alert.category}`
        )
        if (!res.ok) continue

        const { currentPrice } = await res.json() as { currentPrice: number }
        if (!currentPrice || currentPrice <= 0) continue

        const { points, result } = calculatePP(
          alert.type as "BUY" | "SELL",
          alert.price,
          currentPrice,
          alert.category!
        )

        const validation: AlertValidation = {
          status: result,
          priceAtValidation: currentPrice,
          validatedAt: new Date().toISOString(),
          points,
          windowUsed: "medium",
        }

        // Notifie useAlerts de mettre à jour cette alerte
        onValidated(alert.id, validation)

        // Stocke dans la mémoire + déclenche apprentissage
        if (result !== "NEUTRAL" && alert.indicatorsSnapshot) {
          addAlertRecord({
            alertId: alert.id,
            asset: alert.asset,
            symbol: alert.symbol,
            category: alert.category!,
            type: alert.type as "BUY" | "SELL",
            severity: alert.severity,
            priceAtSignal: alert.price,
            priceAtValidation: currentPrice,
            result,
            points,
            generatedAt: alert.generatedAt,
            validatedAt: new Date().toISOString(),
            windowMs: VALIDATION_WINDOWS_MS[alert.category!].medium,
            snapshot: alert.indicatorsSnapshot,
          })
        }

      } catch {
        // Silencieux — réessayera au prochain cycle
      }
    }
  }, [alerts, onValidated])

  // Polling toutes les 5 minutes
  useEffect(() => {
    validatePending()  // check immédiat au mount
    const interval = setInterval(validatePending, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [validatePending])
}
```

---

## 8. FONCTIONS DE MÉMOIRE (`memoryEngine.ts`)

```typescript
// src/lib/memoryEngine.ts — fonctions principales

// ─── Lecture / Écriture localStorage ─────────────────────

export function loadMemory(): PerformanceMemory {
  if (typeof window === "undefined") return createEmptyMemory()
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY)
    if (!raw) return createEmptyMemory()
    const parsed = JSON.parse(raw) as PerformanceMemory
    // Migration si version différente
    if (parsed.version !== MEMORY_VERSION) return migrateMemory(parsed)
    return parsed
  } catch {
    return createEmptyMemory()
  }
}

export function saveMemory(memory: PerformanceMemory): void {
  if (typeof window === "undefined") return
  try {
    // Garde uniquement les 200 derniers enregistrements
    const trimmed = {
      ...memory,
      history: memory.history.slice(-200),
    }
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage plein → purge les anciens et réessaye
    const lighter = { ...memory, history: memory.history.slice(-50) }
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(lighter))
    } catch {
      // Abandon silencieux
    }
  }
}

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
  }
}

// ─── Ajout d'un résultat ──────────────────────────────────

export function addAlertRecord(record: AlertRecord): void {
  const memory = loadMemory()

  // 1. Mettre à jour compteurs globaux
  const updated: PerformanceMemory = {
    ...memory,
    totalValidated: memory.totalValidated + 1,
    totalWins:      record.result === "WIN"     ? memory.totalWins + 1     : memory.totalWins,
    totalLosses:    record.result === "LOSS"    ? memory.totalLosses + 1   : memory.totalLosses,
    totalNeutrals:  record.result === "NEUTRAL" ? memory.totalNeutrals + 1 : memory.totalNeutrals,
    totalPoints:    parseFloat((memory.totalPoints + record.points).toFixed(2)),
    lastUpdated:    new Date().toISOString(),
  }

  // 2. Win rate global (excluant NEUTRAL)
  const decisive = updated.totalWins + updated.totalLosses
  updated.globalWinRate = decisive > 0
    ? Math.round((updated.totalWins / decisive) * 100)
    : 0

  // 3. Phase d'apprentissage
  updated.learningPhase = computeLearningPhase(updated.totalValidated)

  // 4. Stats par actif
  const assetKey = record.symbol
  const prevAsset = memory.byAsset[assetKey] ?? {
    asset: record.asset, symbol: record.symbol,
    totalSignals: 0, wins: 0, losses: 0, neutrals: 0,
    winRate: 0, totalPoints: 0, avgPoints: 0, lastSignalAt: ""
  }
  const updatedAsset: AssetStats = {
    ...prevAsset,
    totalSignals: prevAsset.totalSignals + 1,
    wins:    record.result === "WIN"     ? prevAsset.wins + 1    : prevAsset.wins,
    losses:  record.result === "LOSS"    ? prevAsset.losses + 1  : prevAsset.losses,
    neutrals:record.result === "NEUTRAL" ? (prevAsset.neutrals ?? 0) + 1 : (prevAsset.neutrals ?? 0),
    totalPoints: parseFloat((prevAsset.totalPoints + record.points).toFixed(2)),
    lastSignalAt: record.validatedAt,
  }
  const assetDecisive = updatedAsset.wins + updatedAsset.losses
  updatedAsset.winRate = assetDecisive > 0
    ? Math.round((updatedAsset.wins / assetDecisive) * 100) : 0
  updatedAsset.avgPoints = assetDecisive > 0
    ? parseFloat((updatedAsset.totalPoints / assetDecisive).toFixed(2)) : 0
  updated.byAsset = { ...memory.byAsset, [assetKey]: updatedAsset }

  // 5. Stats par régime
  const regime = record.snapshot.regime
  const prevRegime = memory.byRegime[regime]
  const updatedRegime = {
    ...prevRegime,
    wins:    record.result === "WIN"  ? prevRegime.wins + 1   : prevRegime.wins,
    losses:  record.result === "LOSS" ? prevRegime.losses + 1 : prevRegime.losses,
    totalPoints: parseFloat((prevRegime.totalPoints + record.points).toFixed(2)),
  }
  const regimeDecisive = updatedRegime.wins + updatedRegime.losses
  updatedRegime.winRate = regimeDecisive > 0
    ? Math.round((updatedRegime.wins / regimeDecisive) * 100) : 0
  updated.byRegime = { ...memory.byRegime, [regime]: updatedRegime }

  // 6. Stats par sévérité
  const sev = record.severity
  const prevSev = memory.bySeverity[sev]
  const updatedSev = {
    wins:   record.result === "WIN"  ? prevSev.wins + 1   : prevSev.wins,
    losses: record.result === "LOSS" ? prevSev.losses + 1 : prevSev.losses,
    winRate: 0,
  }
  const sevDecisive = updatedSev.wins + updatedSev.losses
  updatedSev.winRate = sevDecisive > 0
    ? Math.round((updatedSev.wins / sevDecisive) * 100) : 0
  updated.bySeverity = { ...memory.bySeverity, [sev]: updatedSev }

  // 7. Détection dégradation
  const { newStreak, shouldReset, resetReason } = checkDegradation(
    memory.degradationStreak,
    record.result
  )
  updated.degradationStreak = newStreak
  if (shouldReset) {
    updated.weights = partialWeightReset(updated.weights)
    // TODO: afficher une notification à l'utilisateur
    console.warn("[NEXUS] Auto-reset poids:", resetReason)
  }

  // 8. Auto-apprentissage — mise à jour des poids
  if (!shouldReset && record.result !== "NEUTRAL") {
    updated.weights = updateWeights(updated.weights, record, updated.learningPhase)
    updated.lastWeightUpdate = new Date().toISOString()
  }

  // 9. Historique (FIFO 200)
  updated.history = [...memory.history, record].slice(-200)

  saveMemory(updated)
}
```

---

## 9. HOOK `useMemory`

**Fichier :** `src/hooks/useMemory.ts` (NOUVEAU)

```typescript
"use client"
import { useState, useEffect, useCallback } from "react"
import { loadMemory, saveMemory, createEmptyMemory } from "@/lib/memoryEngine"
import type { PerformanceMemory } from "@/lib/memoryEngine"

export function useMemory() {
  const [memory, setMemory] = useState<PerformanceMemory>(createEmptyMemory)

  // Charge depuis localStorage au mount
  useEffect(() => {
    setMemory(loadMemory())
  }, [])

  // Recharge toutes les 30 secondes (synchronise après validations en background)
  useEffect(() => {
    const interval = setInterval(() => setMemory(loadMemory()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const resetMemory = useCallback(() => {
    const fresh = createEmptyMemory()
    saveMemory(fresh)
    setMemory(fresh)
  }, [])

  // Helpers dérivés
  const winRateTrend = useCallback((): "UP" | "DOWN" | "STABLE" => {
    const h = memory.history
    if (h.length < 20) return "STABLE"
    const recent10 = h.slice(-10).filter(r => r.result !== "NEUTRAL")
    const prev10   = h.slice(-20, -10).filter(r => r.result !== "NEUTRAL")
    if (recent10.length === 0 || prev10.length === 0) return "STABLE"
    const recentWR = recent10.filter(r => r.result === "WIN").length / recent10.length
    const prevWR   = prev10.filter(r => r.result === "WIN").length / prev10.length
    if (recentWR > prevWR + 0.05) return "UP"
    if (recentWR < prevWR - 0.05) return "DOWN"
    return "STABLE"
  }, [memory])

  return { memory, resetMemory, winRateTrend }
}
```

---

## 10. AFFICHAGE UI — SPÉCIFICATION DÉTAILLÉE

### 10.1 Badge résultat sur chaque alerte (dans AlertPanel)

**Composant :** `src/components/AlertResultBadge.tsx` (NOUVEAU)

```
État PENDING (fenêtre pas encore écoulée) :
┌──────────────────────────────────────────────────────┐
│ 🔴 BTC   SELL   il y a 47 min                       │
│ RSI oversold + ADX 34 — AI confidence 72/100        │
│ Entry $66,420  SL $68,900  T1 $64,200               │
│                     [⏳ Validation dans 3h13]        │
└──────────────────────────────────────────────────────┘

État WIN (validé, bonne direction) :
┌──────────────────────────────────────────────────────┐
│ 🔴 BTC   SELL   il y a 4h12                         │
│ RSI oversold + ADX 34 — AI confidence 72/100        │
│ Entry $66,420  SL $68,900  T1 $64,200               │
│                         [✅ VALIDÉ  +1.63 PP]        │
└──────────────────────────────────────────────────────┘

État LOSS (mauvaise direction) :
┌──────────────────────────────────────────────────────┐
│ 🟠 EUR/USD  BUY  il y a 9h                          │
│ Rebond Bollinger lower band                         │
│                         [❌ INVALIDE  -0.48 PP]      │
└──────────────────────────────────────────────────────┘

État NEUTRAL (mouvement trop faible) :
┌──────────────────────────────────────────────────────┐
│ 🟡 Gold XAU  SELL  il y a 13h                       │
│ Momentum bearish + strong 7d downtrend              │
│                         [⚪ NEUTRE  ±0 PP]           │
└──────────────────────────────────────────────────────┘
```

**Couleurs CSS :**
```
✅ WIN    → background rgba(52,211,153,0.15), border #34D399, texte #34D399
❌ LOSS   → background rgba(251,113,133,0.15), border #FB7185, texte #FB7185
⚪ NEUTRAL → background rgba(100,116,139,0.1), border #475569, texte #64748B
⏳ PENDING → background rgba(245,158,11,0.1), border #F59E0B, texte #F59E0B (pulsing)
```

### 10.2 Onglet STATS — wireframe complet

**Composant :** `src/components/PerformanceStats.tsx` (NOUVEAU)
**Accès :** Nouvel onglet dans le header à côté des filtres ALL/CRYPTO/FOREX...

```
┌──────────────────────────────────────────────────────────────────┐
│  IA PERFORMANCE                              [7j] [30j] [TOUT]   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Win Rate          PP Total          Alertes         Phase      │
│   ┌─────────┐      ┌──────────┐      ┌────────┐     ┌────────┐  │
│   │  68.4%  │      │ +24.7 PP │      │  147   │     │ ACTIVE │  │
│   │ ████░░  │      │   ↑↑     │      │ total  │     │  ●     │  │
│   └─────────┘      └──────────┘      └────────┘     └────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  PERFORMANCE PAR ACTIF                                           │
│                                                                  │
│  BTC/USD   ██████████░░  78%  [32 sig]  +12.4 PP  ▲ meilleur   │
│  XAU/USD   █████████░░░  71%  [18 sig]  +8.2 PP   ▲            │
│  SOL/USD   ███████░░░░░  62%  [11 sig]  +3.1 PP   →            │
│  EUR/USD   ██████░░░░░░  54%  [24 sig]  +1.1 PP   →            │
│  ETH/USD   █████░░░░░░░  48%  [15 sig]  -0.8 PP   ▼            │
│  GBP/USD   ████░░░░░░░░  38%  [8 sig]   -2.4 PP   ▼ mauvais    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  PERFORMANCE PAR RÉGIME MARCHÉ                                   │
│                                                                  │
│  BULL        ██████████  76%  [45 sig]  signaux fiables ✓        │
│  BEAR        █████████   69%  [31 sig]  bon                      │
│  TRANSITION  █████       42%  [22 sig]  incertain ⚠️              │
│  RANGING     ███         31%  [14 sig]  ← éviter ❌              │
│                                                                  │
│  💡 En marché RANGING, NEXUS génère 69% de faux signaux          │
│     → Les alertes RANGING sont automatiquement rétrogradées      │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  POIDS INDICATEURS APPRIS (phase ACTIVE)                         │
│                                                                  │
│  ADX        ████████████████░░  1.62  ▲ FORT                    │
│  StochRSI   █████████████░░░░░  1.38  ▲ Bon                     │
│  RSI        ████████████░░░░░░  1.21  → Stable                  │
│  Polymarket ██████████░░░░░░░░  0.98  → Neutre                  │
│  OBV        █████████░░░░░░░░░  0.87  ↓ Léger recul             │
│  MACD       ████████░░░░░░░░░░  0.74  ↓                         │
│  Bollinger  ██████░░░░░░░░░░░░  0.58  ↓ PEU FIABLE              │
│  Macro      ██████░░░░░░░░░░░░  0.55  ↓                         │
│  FearGreed  ████░░░░░░░░░░░░░░  0.41  ↓ ↓ Révision              │
│                                                                  │
│  [⚠️ Si un poids < 0.4 → suggérer désactivation dans les params]  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  DERNIÈRES VALIDATIONS                                           │
│                                                                  │
│  ✅ BTC  SELL  +1.63PP   il y a 4h    ADX=34, RSI=28            │
│  ❌ EUR  BUY   -0.48PP   il y a 9h    Bollinger break            │
│  ✅ Gold SELL  +2.1PP    il y a 13h   RSI+ADX+Macro             │
│  ⚪ SOL  BUY   0PP       il y a 1j    mouvement trop faible      │
│  ✅ BTC  BUY   +3.2PP    il y a 1j    Fear=18 (Extrême)         │
│  ...                                                             │
│                                         [Voir tout] [Exporter]  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.3 Indicateur dans le header

```
NEXUS — AI Market Intelligence   ● LIVE   IA: 68% ↑   🔔 3

Où :
  "68%"  = globalWinRate depuis useMemory()
  "↑"    = winRateTrend() === "UP" (vert) / "↓" (rouge) / "" (stable)
  couleur du % : vert si >60%, orange si 45-60%, rouge si <45%
```

### 10.4 Notification de dégradation

Quand `checkDegradation()` retourne `shouldReset = true` :

```
┌──────────────────────────────────────────────────────┐
│ ⚠️  AUTO-CORRECTION NEXUS IA                         │
│                                                      │
│ 10 signaux incorrects consécutifs détectés.          │
│ Les poids des indicateurs ont été partiellement      │
│ réinitialisés pour éviter la sur-adaptation.         │
│                                                      │
│ Phase d'apprentissage : COLD → reconstruction        │
│                                              [OK]    │
└──────────────────────────────────────────────────────┘
```

---

## 11. INTÉGRATION AVEC LE CODE EXISTANT

### Modifications fichiers existants

| Fichier | Ligne(s) | Modification |
|---------|----------|-------------|
| `src/lib/useAlerts.ts:6` | Interface `Alert` | Ajouter `indicatorsSnapshot?` et `validation?` |
| `src/lib/useAlerts.ts:101` | `processSignals()` | Ajouter capture `indicatorsSnapshot` depuis les assets |
| `src/lib/scoring.ts:55` | `computeAIScore()` | Ajouter param `weights` optionnel |
| `src/app/api/markets/route.ts:119` | `generateSignal()` | Passer snapshot indicateurs |
| `src/app/page.tsx` | Hook section | Ajouter `useMemory()`, `useAlertValidation()` |
| `src/app/page.tsx` | Header JSX | Ajouter indicateur précision + onglet STATS |

### Nouveaux fichiers

| Fichier | Taille estimée | Dépend de |
|---------|---------------|-----------|
| `src/lib/memoryEngine.ts` | ~200 lignes | types market |
| `src/lib/autoLearn.ts` | ~80 lignes | memoryEngine |
| `src/hooks/useAlertValidation.ts` | ~100 lignes | memoryEngine, useAlerts |
| `src/hooks/useMemory.ts` | ~60 lignes | memoryEngine |
| `src/app/api/validate/route.ts` | ~80 lignes | providers |
| `src/components/PerformanceStats.tsx` | ~250 lignes | useMemory |
| `src/components/AlertResultBadge.tsx` | ~80 lignes | memoryEngine types |

---

## 12. CAS LIMITES ET GESTION D'ERREURS

| Cas | Comportement |
|-----|-------------|
| Alerte WATCH | Jamais validée, jamais dans les stats |
| `indicatorsSnapshot` absent (vieille alerte) | Validation calcule PP mais pas d'apprentissage |
| Fetch prix échoue | `status: "SKIPPED"`, ne compte pas dans les stats, réessaye au cycle suivant |
| Marché fermé au moment de la validation | Fetch quand même (prix ouverture suivante) |
| localStorage plein | Garde les 50 derniers enregistrements au lieu de 200 |
| `priceAtSignal = 0` | Alerte ignorée pour validation |
| `NaN` dans les PP | Remplacé par 0, résultat NEUTRAL |
| Dégradation + COLD phase | Reset poids ET reset phase (reconstruction from scratch) |
| Utilisateur efface localStorage | Repart de zéro, poids défauts, phase COLD |

---

## 13. PLAN D'IMPLÉMENTATION DÉTAILLÉ

### Phase A — Infrastructure de base (Jour 1-2)

```
Jour 1 :
  ✓ Créer src/lib/memoryEngine.ts (types + CRUD localStorage)
  ✓ Créer src/lib/autoLearn.ts (updateWeights + checkDegradation)
  ✓ Créer src/app/api/validate/route.ts (fetch prix par catégorie)
  ✓ Tests manuels : addAlertRecord() + loadMemory() dans console

Jour 2 :
  ✓ Modifier src/lib/useAlerts.ts (Alert interface étendue)
  ✓ Modifier src/app/api/markets/route.ts (snapshot indicateurs)
  ✓ Créer src/hooks/useAlertValidation.ts (polling 5min)
  ✓ Créer src/hooks/useMemory.ts
```

### Phase B — UI de base (Jour 3-4)

```
Jour 3 :
  ✓ Créer src/components/AlertResultBadge.tsx
  ✓ Intégrer badge dans AlertPanel (page.tsx ou composant dédié)
  ✓ Ajouter indicateur précision dans header

Jour 4 :
  ✓ Créer src/components/PerformanceStats.tsx (onglet STATS complet)
  ✓ Intégrer onglet STATS dans navigation
```

### Phase C — Apprentissage actif (Jour 5-6)

```
Jour 5 :
  ✓ Modifier scoring.ts pour poids dynamiques
  ✓ Charger poids depuis useMemory() dans page.tsx
  ✓ Passer poids à computeAIScore() via l'API

Jour 6 :
  ✓ Tester cycle complet : signal → validation → apprentissage → scoring amélioré
  ✓ Vérifier notification dégradation
  ✓ Vérifier localStorage ne dépasse pas 5Mo sur 200 records
```

---

## 14. CRITÈRES DE VALIDATION FONCTIONNELLE

```
[ ] Alerte BUY générée → après 4h (crypto), le prix est fetché automatiquement
[ ] Si prix monte → badge ✅ VALIDÉ +X.XX PP apparaît sur l'alerte
[ ] Si prix baisse → badge ❌ INVALIDE -X.XX PP apparaît sur l'alerte
[ ] Les PP apparaissent dans l'onglet STATS
[ ] Win rate dans le header change après 20 alertes validées
[ ] Les poids ADX/RSI montent si taux de succès > 65%
[ ] Les poids Bollinger descendent si taux de succès < 45%
[ ] Après 10 LOSS consécutifs → notification ⚠️ + reset partiel poids
[ ] localStorage["nexus_memory"] contient l'historique après refresh navigateur
[ ] Fermer et rouvrir le navigateur → stats et poids préservés
[ ] Alerte WATCH → jamais de badge résultat, jamais dans les stats
[ ] Si Twelve Data API indisponible → validation SKIPPED (silencieux)
[ ] PerformanceStats affiche "COLD" jusqu'à 20 validations
[ ] Score IA d'un actif change (légèrement) après apprentissage actif
```

---

## 15. MÉTRIQUES DE SUCCÈS À 30 JOURS

Après 1 mois d'utilisation réelle :

| Métrique | Cible minimale | Cible idéale |
|----------|---------------|--------------|
| Win rate global | > 55% | > 65% |
| PP total | > 0 (positif) | > +20 PP |
| Amélioration win rate (sem 1 → sem 4) | +5 points | +15 points |
| Poids ADX vs défaut | > 1.1 | > 1.3 |
| Poids Bollinger (faible fiabilité attendue) | < 0.9 | < 0.7 |
| Alertes RANGING dans stats | < 20% du total | < 10% |
```
