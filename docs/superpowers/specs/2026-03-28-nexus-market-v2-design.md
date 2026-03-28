# NEXUS MARKET v2 — Design Spec
**Date :** 2026-03-28
**Projet :** prediction-dashboard (https://prediction-dashboard-one.vercel.app)
**Stack :** Next.js 16 + React 19 + Tailwind v4 + TypeScript strict

---

## 1. OBJECTIFS

Transformer NEXUS MARKET en un SaaS de prédiction **précis et actionnable** en corrigeant les données fausses, en améliorant l'algorithme de signaux, et en ajoutant un système d'alertes utilisable.

### Problèmes actuels à résoudre
| Priorité | Problème | Impact |
|----------|----------|--------|
| 🔴 | Commodities simulées (prix faux) | Signaux inutilisables |
| 🔴 | Forex insuffisant (pas assez de bougies pour RSI) | WATCH constant, aucun signal |
| 🔴 | ADA catégorisée STOCKS au lieu de CRYPTO | Bug de données |
| 🔴 | AI Score 21 pour toutes les commodities | Artefact simulation |
| 🟠 | Aucun système d'alertes | User ne sait pas quand agir |
| 🟠 | Faux signaux en marché ranging (pas de filtre ADX) | ~60% signaux non fiables |
| 🟡 | Indicateurs calculés manuellement (non vérifiés TradingView) | Risque bugs de calcul |
| 🟡 | Dead code `hasCross` dans tradePlan.ts:145 | Code quality |

---

## 2. PÉRIMÈTRE v2

### 2.1 Nouvelles données réelles — Twelve Data API

**Variable d'environnement :** `TWELVE_DATA_API_KEY`

**Commodities** (remplace simulation déterministe) :
- XAU/USD (Gold), XAG/USD (Silver), WTI (pétrole), NATGAS
- Endpoint : `GET /time_series?symbol=XAU/USD&interval=1h&outputsize=30`
- 30 bougies 1h → RSI + tous indicateurs calculables

**Forex** (remplace Frankfurter données journalières) :
- EUR/USD, GBP/USD, USD/JPY, USD/CHF
- Endpoint : `GET /time_series?symbol=EUR/USD&interval=1h&outputsize=30`
- Résout le bug "Insufficient data" — signaux FOREX actifs

**Fallback si clé absente :** données simulées avec badge `[DEMO]` visible

**Limite API gratuite :** 800 req/jour (largement suffisant)

---

### 2.2 Librairie indicateurs — `@ixjb94/indicators`

Remplace `lib/indicators.ts` (calcul manuel) par une librairie vérifiée contre TradingView.

**Installation :**
```bash
npm install @ixjb94/indicators
```

**Nouveaux indicateurs ajoutés :**

| Indicateur | Usage dans le scoring | Pourquoi |
|------------|----------------------|----------|
| **ADX** (Average Directional Index) | Filtre principal | ADX < 25 = marché plat → ignorer RSI. ADX > 25 = tendance forte → signal fiable |
| **Stochastic RSI** | Signal d'entrée anticipé | Détecte retournements 2-3 bougies avant RSI classique |
| **Parabolic SAR** | Stop loss dynamique | Remplace stop loss fixe par pourcentage |
| **OBV** (On Balance Volume) | Confirmation volume | Valide si le mouvement prix est soutenu par du volume |
| **ATR** (déjà présent, améliorer) | Taille position | Stop loss basé sur volatilité réelle |

**Indicateurs existants conservés :** RSI, MACD, Bollinger Bands, SMA 50/200

---

### 2.3 Filtre ADX — Élimination des faux signaux

**Logique actuelle (buggy) :**
```
RSI < 30 → BUY   ← génère des faux signaux en marché ranging
RSI > 70 → SELL
```

**Nouvelle logique avec ADX :**
```
ADX > 25 AND RSI < 30 → BUY   (signal fiable, marché en tendance)
ADX > 25 AND RSI > 70 → SELL  (signal fiable, marché en tendance)
ADX < 25              → WATCH (marché ranging, attendre)
```

**Impact estimé :** élimination de ~60% des faux signaux

---

### 2.4 Corrélation macro cross-asset

Nouveau module `lib/macroCorrelation.ts` qui ajuste le score IA selon les corrélations historiques inter-marchés.

**Corrélations intégrées :**

| Signal macro | Actif affecté | Ajustement score |
|-------------|---------------|-----------------|
| USD Index +1% | Gold -0.8 corr. | Score Gold -8 pts |
| USD Index +1% | BTC -0.5 corr. | Score BTC -5 pts |
| VIX > 25 (peur marché) | Gold → refuge | Score Gold +10 pts |
| VIX > 25 | BTC → risk-off | Score BTC -10 pts |
| EUR/USD baisse fort | Gold en EUR monte | Alerte croisée |

**Source données macro :** Twelve Data (DXY = USD Index), CoinGecko (BTC comme proxy risque)

**Calcul VIX simulé :** moyenne de la volatilité 7j sur S&P500 ou BTC jusqu'à intégration Alpha Vantage.

---

### 2.5 Système d'alertes complet

#### Type `Alert` (remplace `Signal`)

```typescript
interface Alert {
  id: string                          // uuid unique
  asset: string                       // "BTC/USD"
  type: "BUY" | "SELL" | "WATCH"
  message: string                     // "RSI survente critique + ADX 34"
  severity: "HIGH" | "MEDIUM" | "LOW"
  price: number                       // prix au moment du signal
  entry?: number
  stopLoss?: number
  target1?: number
  target2?: number
  generatedAt: string                 // ISO 8601 timestamp
  dismissedAt?: string                // null tant que non fermée par user
}
```

#### Fraîcheur des alertes

| Âge | Couleur | Label | Action recommandée |
|-----|---------|-------|-------------------|
| 0–15 min | Rouge vif | "il y a X min" | Actionnable maintenant |
| 15–30 min | Orange | "il y a X min" | Surveiller |
| 30–60 min | Gris foncé | "il y a X min" | Prudence |
| > 60 min | Barré | "EXPIRÉ" | Ignorer — archivé auto |

#### Stockage — localStorage

- Clé : `nexus_alerts`
- Max 100 alertes (FIFO — les plus vieilles supprimées)
- Expiration auto : 60 min
- Déduplication : même `asset` + même `type` dans les 15 min = pas de doublon
- Les alertes expirées restent visibles dans le panel (grisées) mais ne comptent pas dans le badge

#### Composants UI

**`AlertBanner`** — Bandeau rouge en haut de page
- Affiché uniquement pour severity `HIGH`
- Une seule alerte à la fois (la plus récente HIGH)
- Reste affiché jusqu'à clic `✕` par l'utilisateur (NE disparaît PAS automatiquement)
- Affiche : asset, type, message, prix entry/SL/T1, âge en temps réel mis à jour chaque minute
- Indicateur de fraîcheur : dégradé couleur selon âge

**`AlertBell`** — Icône dans le header
- Badge rouge avec count alertes non-lues (HIGH + MEDIUM non dismissées < 60 min)
- Clignote si au moins 1 alerte HIGH active non dismissée
- Clic → ouvre/ferme `AlertPanel`

**`AlertPanel`** — Overlay latéral
- Liste complète triée par `generatedAt DESC`
- Chaque item : barre couleur gauche (fraîcheur), asset, type badge, message, entry/SL/T1, âge
- Barre de progression fraîcheur sous chaque alerte
- Alertes expirées visibles mais grisées en bas de liste
- Bouton "Effacer expirées"

**`useAlerts` hook** — Logique client
- Compare nouvelles alertes API vs localStorage
- Déduplication 15 min
- Calcul âge en temps réel (re-render chaque minute)
- Déclenche `AlertBanner` si nouvelle HIGH
- Persiste dans localStorage

---

### 2.6 Corrections de bugs

| ID | Fichier | Correction |
|----|---------|------------|
| B1 | `lib/providers.ts` | ADA → catégorie `CRYPTO` (pas `STOCKS`) |
| B2 | `lib/providers.ts` | Commodities → Twelve Data (vraies données) |
| B3 | `lib/providers.ts` | Forex → Twelve Data (30 bougies 1h) |
| B4 | `lib/indicators.ts` | Remplacer par `@ixjb94/indicators` |
| B5 | `lib/scoring.ts` | Intégrer filtre ADX dans `generateSignal()` |
| B6 | `lib/scoring.ts` | Intégrer Stochastic RSI dans scoring |
| B7 | `src/types/market.ts` | `Signal` → `Alert` avec timestamp |
| B8 | `lib/tradePlan.ts` | Supprimer dead code `hasCross` ligne 145 |
| B9 | `app/api/markets/route.ts` | Passer `generatedAt` dans chaque alerte |
| B10 | `app/page.tsx` | Badge `[DEMO]` si `TWELVE_DATA_API_KEY` absent |

---

## 3. ARCHITECTURE v2

```
src/
  types/
    market.ts           ← Alert (remplace Signal) + nouveaux types
  lib/
    providers.ts        ← MODIFIÉ: Twelve Data pour commodities + forex
    indicators.ts       ← REMPLACÉ: wraps @ixjb94/indicators
    scoring.ts          ← MODIFIÉ: filtre ADX + Stochastic RSI
    correlation.ts      ← INCHANGÉ: Polymarket keywords
    macroCorrelation.ts ← NOUVEAU: USD/VIX/cross-asset scoring
    tradePlan.ts        ← CORRIGÉ: dead code + SAR stop loss
  app/
    api/markets/route.ts ← MODIFIÉ: Alert avec generatedAt
    page.tsx             ← MODIFIÉ: AlertBanner + AlertBell
  components/           ← NOUVEAU dossier
    AlertBanner.tsx
    AlertBell.tsx
    AlertPanel.tsx
  hooks/                ← NOUVEAU dossier
    useAlerts.ts
```

---

## 4. FLUX DE DONNÉES v2

```
GET /api/markets (60s cache)
  ├── Twelve Data → commodities (30 bougies 1h réelles)
  ├── Twelve Data → forex (30 bougies 1h réelles)
  ├── CoinGecko   → crypto (inchangé)
  ├── Alpha Vantage → stocks (inchangé, optionnel)
  └── Polymarket  → sentiment (inchangé)
        │
        ▼
  lib/indicators.ts (via @ixjb94/indicators)
    RSI + Stochastic RSI + ADX + OBV + Bollinger + MACD + SAR
        │
        ▼
  lib/macroCorrelation.ts (NOUVEAU)
    Ajustement score selon USD/VIX/cross-asset
        │
        ▼
  lib/scoring.ts
    ADX filter → BUY/SELL/WATCH
    Severity: HIGH (ADX>30 + RSI extrême) / MEDIUM / LOW
    Alert avec generatedAt = new Date().toISOString()
        │
        ▼
  API Response: { assets, alerts, polymarket, lastUpdated }
        │
  page.tsx (refresh 30s)
        │
  useAlerts hook
    ├── Déduplication 15 min
    ├── Persist localStorage
    ├── AlertBanner si HIGH
    └── AlertBell badge count
```

---

## 5. RÈGLES DE SCORING v2

### Calcul AI Score (0–100)

```
Score de base (inchangé):
  RSI contrib         = f(rsi, category)         → 0–40 pts
  Momentum contrib    = f(change24h, change7d)    → 0–35 pts
  Sentiment Poly      = polymarketSentiment       → 0–25 pts

Nouveaux modificateurs:
  ADX bonus/malus     = ADX > 25 ? +5 : -10      → ±10 pts
  Stoch RSI           = stochRsi < 20 ? +8 : 0   → ±8 pts
  OBV confirmation    = obv rising ? +5 : -5      → ±5 pts
  Macro correlation   = macroAdjust(assetId)      → ±15 pts

Plafond: min(max(score, 0), 100)
```

### Règles severity

```
HIGH   = ADX > 30 AND (RSI < 25 OR RSI > 75) AND volume spike
MEDIUM = ADX > 25 AND (RSI < 30 OR RSI > 70)
LOW    = RSI < 35 OR RSI > 65 (sans confirmation)
```

---

## 6. CE QUI N'EST PAS DANS CE SCOPE

- Base de données (alertes localStorage uniquement)
- Notifications push navigateur (post-v2)
- Analyse multi-timeframe 1h+4h+1d (post-v2, nécessite +90 bougies)
- Modèles LSTM/ML (post-v2)
- Authentification utilisateur (post-v2)
- Export CSV/PDF (post-v2)

---

## 7. DÉPENDANCES

```json
{
  "dependencies": {
    "@ixjb94/indicators": "latest"
  },
  "env": {
    "TWELVE_DATA_API_KEY": "requis pour données réelles (gratuit sur twelvedata.com)",
    "ALPHA_VANTAGE_API_KEY": "optionnel pour stocks"
  }
}
```

---

## 8. CRITÈRES DE SUCCÈS

- [ ] Commodities affichent des prix réels (Gold ~$3,100, WTI ~$68)
- [ ] Forex génère des signaux BUY/SELL (plus de "Insufficient data")
- [ ] ADA s'affiche dans le filtre CRYPTO
- [ ] Alertes HIGH persistent après refresh de page
- [ ] Bannière rouge visible à l'arrivée si alerte active < 60 min
- [ ] Badge cloche compte correctement les alertes non-lues
- [ ] Âge alerte se met à jour chaque minute
- [ ] Alerte identique (même asset+type) non dupliquée dans 15 min
- [ ] Alerte > 60 min affichée grisée + "EXPIRÉ"
- [ ] Au moins 50% des signaux filtrés par ADX (pas de WATCH sur marché ranging)
