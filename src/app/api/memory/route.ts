import { NextRequest, NextResponse } from "next/server";
import { redisKey } from "@/lib/modelVariants";
import type { VariantId } from "@/lib/modelVariants";

export const dynamic = "force-dynamic";

// ─── Upstash Redis REST API (free, persistent across deployments) ─────────────
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

function getKey(req: NextRequest): string {
  const v = (req.nextUrl.searchParams.get("variant") ?? "1") as VariantId;
  return redisKey(v);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${REDIS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// GET /api/memory?variant=1 — load persisted memory from Redis
export async function GET(req: NextRequest) {
  if (!REDIS_URL || !REDIS_TOKEN) return NextResponse.json(null);
  const key = getKey(req);
  try {
    const res = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    const json = (await res.json()) as { result: string | null };
    if (!json.result) return NextResponse.json(null);
    return NextResponse.json(JSON.parse(json.result));
  } catch {
    return NextResponse.json(null);
  }
}

// POST /api/memory?variant=1 — save memory to Redis
export async function POST(req: NextRequest) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ saved: false, reason: "UPSTASH_REDIS not configured" });
  }
  const key = getKey(req);
  try {
    const body = await req.text(); // already-stringified JSON from client
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([["SET", key, body]]),
    });
    if (!res.ok) throw new Error(`Redis ${res.status}`);
    return NextResponse.json({ saved: true });
  } catch (err) {
    return NextResponse.json(
      { saved: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
