import { NextRequest, NextResponse } from "next/server";
import type { AssetCategory } from "@/types/market";
import type { AlertIndicatorsSnapshot } from "@/lib/memoryEngine";
import type { VariantId } from "@/lib/modelVariants";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────

export interface StoredAlert {
  id: string;
  variant: VariantId;
  asset: string;
  symbol: string;
  type: "BUY" | "SELL";
  message: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  price: number;
  entry?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  category: AssetCategory;
  generatedAt: string;
  status: "PENDING" | "WIN" | "LOSS" | "NEUTRAL";
  validatedAt?: string;
  validationPrice?: number;
  points?: number;
  levelHit?: "TP2" | "TP1" | "SL" | "NONE";
  indicatorsSnapshot?: AlertIndicatorsSnapshot;
}

// ─── Redis ───────────────────────────────────────────────────

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL  ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

function auth() {
  return { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" };
}

function alertKey(variant: VariantId): string {
  return `nexus_alerts_v${variant}`;
}

async function redisGet(key: string): Promise<string | null> {
  const res = await fetch(`${REDIS_URL}/get/${key}`, { headers: auth(), cache: "no-store" });
  const json = await res.json() as { result: string | null };
  return json.result ?? null;
}

async function redisSet(key: string, value: string): Promise<void> {
  await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST", headers: auth(),
    body: JSON.stringify([["SET", key, value]]),
  });
}

// ─── GET /api/alerts?variant=N ────────────────────────────────

export async function GET(req: NextRequest) {
  if (!REDIS_URL || !REDIS_TOKEN) return NextResponse.json([]);
  const variant = (req.nextUrl.searchParams.get("variant") ?? "1") as VariantId;
  try {
    const raw = await redisGet(alertKey(variant));
    if (!raw) return NextResponse.json([]);
    const alerts = JSON.parse(raw) as StoredAlert[];
    // Return last 50, newest first
    return NextResponse.json(alerts.slice(-50).reverse());
  } catch {
    return NextResponse.json([]);
  }
}

// ─── POST /api/alerts?variant=N — replace full list ───────────

export async function POST(req: NextRequest) {
  if (!REDIS_URL || !REDIS_TOKEN) return NextResponse.json({ saved: false });
  const variant = (req.nextUrl.searchParams.get("variant") ?? "1") as VariantId;
  try {
    const alerts = await req.json() as StoredAlert[];
    await redisSet(alertKey(variant), JSON.stringify(alerts.slice(-100)));
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ saved: false }, { status: 500 });
  }
}
