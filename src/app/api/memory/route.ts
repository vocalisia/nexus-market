import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ─── Upstash Redis REST API (free, persistent across deployments) ─────────────
// Setup: upstash.com → Create Redis DB → copy REST URL + Token → Vercel env vars
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const KEY = "nexus_memory_v1";

function authHeaders() {
  return {
    Authorization: `Bearer ${REDIS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// GET /api/memory — load persisted memory from Redis
export async function GET() {
  if (!REDIS_URL || !REDIS_TOKEN) return NextResponse.json(null);
  try {
    const res = await fetch(`${REDIS_URL}/get/${KEY}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    const json = await res.json() as { result: string | null };
    if (!json.result) return NextResponse.json(null);
    return NextResponse.json(JSON.parse(json.result));
  } catch {
    return NextResponse.json(null);
  }
}

// POST /api/memory — save memory to Redis
export async function POST(req: NextRequest) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    // No Redis configured — silent fallback (client uses localStorage)
    return NextResponse.json({ saved: false, reason: "UPSTASH_REDIS not configured" });
  }
  try {
    const body = await req.text(); // already-stringified JSON from client
    // Use pipeline to safely handle large JSON values (no URL length limits)
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify([["SET", KEY, body]]),
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
