# NEXUS MARKET — Système Auto-Validation & Auto-Apprentissage
**Date :** 2026-03-28
**Module :** AlertAutoControl + PerformanceMemory
**Dépend de :** spec v2 (alertes + Twelve Data + ADX)

---

## 1. VISION

Chaque alerte générée par NEXUS est **jugée automatiquement** après un délai :
- Si le prix a bougé dans la bonne direction → ✅ **VALIDÉ** (gain de précision)
- Si le prix a bougé dans la mauvaise direction → ❌ **INVALIDE** (perte de précision)

Le système **mémorise** chaque résultat et **ajuste automatiquement** les poids des indicateurs pour que les prochaines alertes soient plus précises. Aucune action manuelle requise.

---

## 2. FONCTIONNEMENT — AUTO-VALIDATION

### 2.1 Fenêtres de validation

Chaque alerte est vérifiée à **3 horizons temporels** selon la catégorie d'actif :

| Catégorie | Court | Moyen | Long |
|-----------|-------|-------|------|
| CRYPTO | 1h | 4h | 24h |
| FOREX | 2h | 8h | 24h |
| COMMODITIES | 4h | 12h | 48h |
| STOCKS | 4h | 24h | 72h |

La validation principale = fenêtre **Moyen**. Court et Long sont des métriques secondaires.

### 2.2 Critères de validation

Pour une alerte **BUY** générée au prix `P_signal` :

```
Prix à T+moyen = P_check

VALIDÉ  si  P_check > P_signal × (1 + seuil_min)
INVALIDE si  P_check < P_signal × (1 - seuil_min)
EN COURS si  |P_check - P_signal| < P_signal × seuil_min
```

**Seuils minimum par catégorie** (en dessous = bruit, pas un vrai mouvement) :

| Catégorie | Seuil min |
|-----------|-----------|
| CRYPTO | 0.8% |
| FOREX | 0.15% |
| COMMODITIES | 0.5% |
| STOCKS | 0.5% |

Pour une alerte **SELL** : logique inverse.
Pour une alerte **WATCH** : pas de validation (informatif uniquement).

### 2.3 Calcul des POINTS (pas en dollars)

**Unité universelle : Points de précision (PP)**

```
PP = direction_correcte × amplitude_mouvement_normalisée × 100

Où :
  direction_correcte  = +1 si VALIDÉ, -1 si INVALIDE
  amplitude_normalisée = |P_check - P_signal| / P_signal

Exemples :
  BUY BTC à 66,420 → prix 4h après : 67,500
  PP = +1 × (67500-66420)/66420 × 100 = +1.63 PP  ✅

  SELL Gold à 3105 → prix 12h après : 3,120
  PP = -1 × (3120-3105)/3105 × 100 = -0.48 PP  ❌
```

**Conversion PP → notation visuelle :**

| PP | Icône | Label |
|----|-------|-------|
| > +2.0 | 🟢🟢 | Excellent |
| +0.5 à +2.0 | 🟢 | Validé |
| -0.5 à +0.5 | ⚪ | Neutre |
| -0.5 à -2.0 | 🔴 | Invalide |
| < -2.0 | 🔴🔴 | Très mauvais |

---

## 3. MÉMOIRE — STOCKAGE DES PERFORMANCES

### 3.1 Structure de données

**Fichier mémoire :** `localStorage["nexus_memory"]`

```typescript
interface AlertResult {
  alertId: string
  asset: string
  category: AssetCategory
  type: "BUY" | "SELL"
  severity: "HIGH" | "MEDIUM" | "LOW"
  priceAtSignal: number
  priceAtValidation: number
  validationWindow: "short" | "medium" | "long"
  validatedAt: string           // ISO timestamp
  result: "WIN" | "LOSS" | "NEUTRAL" | "PENDING"
  points: number                // PP calculés
  indicatorsActive: {           // quels indicateurs ont déclenché l'alerte
    rsi: number
    adx: number
    stochRsi: number
    macd: "BULLISH" | "BEARISH" | "NONE"
    bollinger: "ABOVE" | "INSIDE" | "BELOW"
    obv: "RISING" | "FALLING" | "FLAT"
    regime: "BULL" | "BEAR" | "RANGING" | "TRANSITION"
    fearGreed?: number
  }
  marketRegimeAtSignal: "BULL" | "BEAR" | "RANGING" | "TRANSITION"
}

interface PerformanceMemory {
  version: number                    // pour migrations futures
  totalAlerts: number
  totalValidated: number
  totalInvalid: number
  totalPoints: number
  winRate: number                    // 0–100%
  lastUpdated: string

  // Performance par actif
  byAsset: Record<string, AssetPerformance>

  // Performance par indicateur (pour ajuster les poids)
  byIndicator: IndicatorWeights

  // Performance par régime de marché
  byRegime: RegimePerformance

  // Historique des 200 dernières alertes validées
  history: AlertResult[]
}

interface AssetPerformance {
  asset: string
  totalSignals: number
  wins: number
  losses: number
  winRate: number
  totalPoints: number
  avgPoints: number
}

interface IndicatorWeights {
  rsi: number           // poids actuel 0.0–2.0 (défaut: 1.0)
  adx: number
  stochRsi: number
  macd: number
  bollinger: number
  obv: number
  fearGreed: number
  polymarket: number
  macroCorrelation: number
}

interface RegimePerformance {
  BULL:       { wins: number; losses: number; winRate: number }
  BEAR:       { wins: number; losses: number; winRate: number }
  RANGING:    { wins: number; losses: number; winRate: number }
  TRANSITION: { wins: number; losses: number; winRate: number }
}
```

### 3.2 Limites mémoire

- Max 200 `AlertResult` dans `history` (FIFO)
- Max 5 Mo localStorage (largement suffisant)
- L'apprentissage démarre après **20 alertes validées** (minimum statistique)

---

## 4. AUTO-APPRENTISSAGE — AJUSTEMENT DES POIDS

### 4.1 Algorithme d'ajustement

Après chaque validation, le système recalcule le poids de chaque indicateur actif :

```typescript
function updateWeight(
  current: number,
  result: "WIN" | "LOSS",
  confidence: number  // 0–1, basé sur amplitude du mouvement
): number {
  const LEARNING_RATE = 0.05        // ajustement max par validation
  const MIN_WEIGHT = 0.3            // plancher (indicateur jamais ignoré complètement)
  const MAX_WEIGHT = 1.8            // plafond (indicateur jamais dominant à 100%)

  const delta = result === "WIN"
    ? +LEARNING_RATE * confidence   // +5% si victoire forte
    : -LEARNING_RATE * confidence   // -5% si défaite forte

  return Math.min(Math.max(current + delta, MIN_WEIGHT), MAX_WEIGHT)
}
```

**Exemple après 50 alertes :**
```
RSI win rate = 72% → poids monte de 1.0 → 1.4
ADX win rate = 81% → poids monte de 1.0 → 1.6   ← le meilleur filtre
Bollinger win rate = 41% → poids descend de 1.0 → 0.6
MACD win rate = 55% → poids reste ~1.0 (neutre)
```

### 4.2 Impact sur le score IA

Les poids appris modifient directement le calcul du AI Score :

```typescript
// Scoring v2 (poids fixes)
score = rsi * 1.0 + adx * 1.0 + macd * 1.0 + ...

// Scoring avec mémoire (poids dynamiques)
score = rsi * memory.weights.rsi
      + adx * memory.weights.adx
      + macd * memory.weights.macd
      + bollinger * memory.weights.bollinger
      + stochRsi * memory.weights.stochRsi
      + fearGreed * memory.weights.fearGreed
      + polymarket * memory.weights.polymarket
```

### 4.3 Règles de protection

Pour éviter l'over-fitting sur peu de données :

```
< 20 validations  → poids FIXES (pas d'apprentissage, trop tôt)
20–50 validations → apprentissage LENT (learning rate × 0.5)
50–100 validations → apprentissage NORMAL
> 100 validations → apprentissage PLEIN
```

### 4.4 Détection de dégradation

Si le win rate global chute sous 40% pendant 10 alertes consécutives :
- Alerte système : `⚠️ Dégradation détectée — poids réinitialisés`
- Remise à zéro partielle des poids vers 1.0
- Conserve l'historique mais repart du défaut

---

## 5. UI — AFFICHAGE DE LA PERFORMANCE

### 5.1 Badge sur chaque alerte (dans AlertPanel)

```
┌─────────────────────────────────────────────────┐
│ 🔴 BTC/USD  SELL  il y a 4h    [VALIDÉ ✅ +1.63PP]│
│ RSI survente + ADX 34                           │
│ Entry: $66,420  SL: $68,900  T1: $64,200        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 🟠 EUR/USD  BUY   il y a 9h    [INVALIDE ❌ -0.48PP]│
│ Rebond Bollinger lower band                     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 🟡 Gold XAU  SELL  il y a 1h   [EN COURS ⏳ 3h restant]│
└─────────────────────────────────────────────────┘
```

### 5.2 Dashboard Performance (nouvel onglet "STATS")

```
┌──────────────────────────────────────────────────────┐
│  PERFORMANCE NEXUS IA                   [7j][30j][∞] │
├──────────────────────────────────────────────────────┤
│  Win Rate     Points totaux    Alertes              │
│   68.4%         +24.7 PP        147 total           │
│   ████████░░    ↑ en amélioration                   │
├──────────────────────────────────────────────────────┤
│  PAR ACTIF                                          │
│  BTC/USD   ██████████ 78%  +12.4 PP  (32 signaux)  │
│  XAU/USD   ████████░░ 71%  +8.2 PP   (18 signaux)  │
│  EUR/USD   ██████░░░░ 54%  +1.1 PP   (24 signaux)  │
│  ETH/USD   █████░░░░░ 48%  -0.8 PP   (15 signaux)  │
├──────────────────────────────────────────────────────┤
│  PAR RÉGIME MARCHÉ                                  │
│  BULL      ████████░░ 76%  meilleur contexte       │
│  BEAR      ███████░░░ 69%  bon                     │
│  RANGING   ███░░░░░░░ 31%  ← éviter les signaux    │
│  TRANSITION████░░░░░░ 42%  incertain               │
├──────────────────────────────────────────────────────┤
│  POIDS INDICATEURS APPRIS                           │
│  ADX        ████████████████ 1.62  ↑ très efficace │
│  StochRSI   █████████████░░░ 1.38  ↑ bon           │
│  RSI        ████████████░░░░ 1.21  → stable        │
│  Polymarket █████████░░░░░░░ 0.91  → stable        │
│  Bollinger  █████░░░░░░░░░░░ 0.58  ↓ peu fiable    │
│  MACD       ██████░░░░░░░░░░ 0.72  ↓               │
└──────────────────────────────────────────────────────┘
```

### 5.3 Indicateur de santé dans le header

```
[NEXUS MARKET]  ● LIVE  │  IA Précision: 68% ↑  │  🔔 3
```

---

## 6. ARCHITECTURE — NOUVEAUX FICHIERS

```
src/
  lib/
    alertValidator.ts     ← NOUVEAU: vérifie prix post-signal
    memoryEngine.ts       ← NOUVEAU: stockage + calcul PP
    autoLearn.ts          ← NOUVEAU: ajustement poids
    scoring.ts            ← MODIFIÉ: utilise poids dynamiques

  hooks/
    useMemory.ts          ← NOUVEAU: accès mémoire React
    useAlertValidation.ts ← NOUVEAU: polling prix post-alerte

  components/
    PerformanceStats.tsx  ← NOUVEAU: onglet STATS
    AlertResultBadge.tsx  ← NOUVEAU: badge WIN/LOSS sur alerte
    IndicatorWeights.tsx  ← NOUVEAU: visualisation poids appris
```

---

## 7. FLUX COMPLET

```
1. SIGNAL GÉNÉRÉ (API /markets)
   └── Alert créée avec generatedAt + indicatorsActive snapshot
   └── Stockée localStorage["nexus_alerts"]
   └── Statut initial : PENDING

2. VALIDATION AUTOMATIQUE (useAlertValidation hook)
   └── Toutes les 5 minutes : vérifie alertes PENDING
   └── Si T+moyen écoulé → fetch prix actuel via API
   └── Compare prix actuel vs prix signal
   └── Calcule PP selon formule
   └── Met à jour statut : WIN / LOSS / NEUTRAL
   └── Stocke AlertResult dans localStorage["nexus_memory"]

3. AUTO-APPRENTISSAGE (autoLearn.ts)
   └── Après chaque validation → updateWeight() pour chaque indicateur actif
   └── Si > 20 validations → applique poids à scoring.ts
   └── Met à jour nexus_memory.byIndicator

4. SCORING AMÉLIORÉ (scoring.ts)
   └── Charge poids depuis localStorage["nexus_memory"]
   └── Applique poids dynamiques au calcul AI Score
   └── Prochaine alerte = plus précise

5. AFFICHAGE (page.tsx + PerformanceStats.tsx)
   └── Badge WIN/LOSS sur chaque alerte dans AlertPanel
   └── Onglet STATS avec métriques complètes
   └── Indicateur précision dans header
```

---

## 8. CORRECTIONS BUGS LIÉS

| ID | Fichier | Impact sur ce module |
|----|---------|---------------------|
| B11 | `lib/scoring.ts` | Doit accepter poids dynamiques en paramètre |
| B12 | `src/types/market.ts` | Ajouter `indicatorsActive` dans `Alert` |
| B13 | `app/api/markets/route.ts` | Snapshot indicateurs dans chaque alerte |

---

## 9. CE QUI N'EST PAS DANS CE SCOPE

- Backtesting historique complet (nécessite base de données, post-v3)
- Alertes SMS / email quand un signal se valide (post-v3)
- Export des performances en CSV (post-v3)
- Apprentissage cross-utilisateurs (serveur requis, post-v3)
- Modèle ML réel (CNN-LSTM) en remplacement des règles (post-v4)

---

## 10. CRITÈRES DE SUCCÈS

- [ ] Chaque alerte affiche ✅ VALIDÉ ou ❌ INVALIDE après la fenêtre de validation
- [ ] Les PP sont calculés et affichés sur chaque alerte
- [ ] L'onglet STATS affiche win rate global + par actif + par régime
- [ ] Les poids indicateurs changent après 20 validations
- [ ] Si Bollinger a < 45% win rate → son poids descend sous 0.8
- [ ] Si ADX a > 65% win rate → son poids monte au-dessus de 1.3
- [ ] La précision globale s'améliore après 50 alertes validées vs les 20 premières
- [ ] Réinitialisation automatique si win rate < 40% sur 10 alertes consécutives
- [ ] Pas de dépendance serveur — 100% localStorage
- [ ] Performance visible dans le header en temps réel

---

## 11. ORDRE D'IMPLÉMENTATION RECOMMANDÉ

```
Phase A (2j) — Validation simple
  1. alertValidator.ts → fetch prix post-signal + calcul PP
  2. AlertResultBadge.tsx → badge WIN/LOSS sur alerte
  3. useAlertValidation.ts → polling 5min

Phase B (2j) — Mémoire
  4. memoryEngine.ts → stockage AlertResult + stats globales
  5. PerformanceStats.tsx → onglet STATS complet
  6. Header indicateur précision

Phase C (2j) — Auto-apprentissage
  7. autoLearn.ts → updateWeight() algorithm
  8. scoring.ts → poids dynamiques
  9. IndicatorWeights.tsx → visualisation poids
```

**Total estimé : 6 jours de développement**
```
