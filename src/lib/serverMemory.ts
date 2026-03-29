/**
 * Server-side memory operations — uses Redis directly, no localStorage.
 * Safe to import in API routes and cron jobs.
 */
import type { PerformanceMemory, AlertRecord } from "./memoryEngine";
import { createEmptyMemory, updateMemoryWithRecord, MEMORY_VERSION } from "./memoryEngine";
import type { VariantId } from "./modelVariants";

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL  ?? "").replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

function authHeaders() {
  return { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" };
}

function memKey(variant: VariantId): string {
  return `nexus_memory_v${variant}`;
}

export async function loadMemoryServer(variant: VariantId): Promise<PerformanceMemory> {
  if (!REDIS_URL || !REDIS_TOKEN) return createEmptyMemory();
  try {
    const res = await fetch(`${REDIS_URL}/get/${memKey(variant)}`, {
      headers: authHeaders(), cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json() as { result: string | null };
    if (!json.result) return createEmptyMemory();
    const parsed = JSON.parse(json.result) as PerformanceMemory;
    if (parsed.version !== MEMORY_VERSION) return createEmptyMemory();
    return parsed;
  } catch {
    return createEmptyMemory();
  }
}

export async function saveMemoryServer(variant: VariantId, memory: PerformanceMemory): Promise<void> {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  const trimmed = { ...memory, history: memory.history.slice(-200) };
  await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify([["SET", memKey(variant), JSON.stringify(trimmed)]]),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* fire-and-forget */ });
}

export async function addAlertRecordServer(
  variant: VariantId,
  record: AlertRecord,
): Promise<void> {
  const memory  = await loadMemoryServer(variant);
  const updated = updateMemoryWithRecord(memory, record);
  await saveMemoryServer(variant, updated);
}
