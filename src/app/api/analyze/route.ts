import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

export interface ChartAnalysis {
  direction: "BUY" | "SELL" | "WAIT";
  confidence: number; // 0-100
  summary: string;
  reasons: string[];
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  suggestedEntry: number;
  suggestedSL: number;
  suggestedTP1: number;
  suggestedTP2: number;
  riskReward: string;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function buildPrompt(symbol: string, tf: string, candles: Candle[]): string {
  // Use last 60 candles max to keep tokens reasonable
  const slice = candles.slice(-60);
  const last  = slice[slice.length - 1];
  const first = slice[0];

  // Compact OHLCV table — one line per candle
  const rows = slice.map((c) => {
    const d = new Date(c.time);
    const t = tf === "1d"
      ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
      : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const bull = c.close >= c.open ? "▲" : "▼";
    return `${t} ${bull} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${(c.volume / 1000).toFixed(1)}K`;
  }).join("\n");

  const pctMove = ((last.close - first.open) / first.open * 100).toFixed(2);
  const highInPeriod  = Math.max(...slice.map((c) => c.high)).toFixed(4);
  const lowInPeriod   = Math.min(...slice.map((c) => c.low)).toFixed(4);

  return `Tu es un analyste technique expert en trading. Analyse ce graphique ${tf} de ${symbol} et donne une recommandation de trading précise.

DONNÉES OHLCV — ${slice.length} bougies (${tf}):
${rows}

RÉSUMÉ PÉRIODE:
- Mouvement: ${pctMove}%
- Plus haut: ${highInPeriod}
- Plus bas:  ${lowInPeriod}
- Dernier prix: ${last.close.toFixed(4)}

Analyse les éléments suivants:
1. Tendance principale (court terme et moyen terme)
2. Supports et résistances clés
3. Patterns de bougies significatifs
4. Momentum (accélération ou ralentissement)
5. Volumes (confirment-ils le mouvement?)

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "direction": "BUY" | "SELL" | "WAIT",
  "confidence": <nombre 0-100>,
  "summary": "<phrase courte décrivant la situation du marché>",
  "reasons": ["<raison 1>", "<raison 2>", "<raison 3>"],
  "keyLevels": {
    "support": [<niveau1>, <niveau2>],
    "resistance": [<niveau1>, <niveau2>]
  },
  "suggestedEntry": <prix d'entrée>,
  "suggestedSL": <stop loss>,
  "suggestedTP1": <target 1, ratio 2:1>,
  "suggestedTP2": <target 2, ratio 3:1>,
  "riskReward": "<ex: 2.5:1>"
}`;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let body: { symbol?: string; tf?: string; candles?: Candle[] };
  try {
    body = await req.json() as { symbol?: string; tf?: string; candles?: Candle[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, tf, candles } = body;
  if (!symbol || !tf || !candles || candles.length < 10) {
    return NextResponse.json({ error: "symbol, tf, and at least 10 candles required" }, { status: 400 });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001", // fast + cheap for chart analysis
      max_tokens: 1024,
      messages: [
        { role: "user", content: buildPrompt(symbol, tf, candles) },
      ],
    });

    const rawText = message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON — Claude sometimes wraps it in ```json ... ```
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "No JSON in response", raw: rawText }, { status: 500 });
    }

    const analysis = JSON.parse(jsonMatch[0]) as ChartAnalysis;
    return NextResponse.json(analysis);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
