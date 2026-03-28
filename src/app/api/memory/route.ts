import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Saved on disk next to the project so it survives browser clears and PC restarts
const DATA_FILE = path.join(process.cwd(), "data", "nexus_memory.json");

async function ensureDir() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
}

// GET /api/memory — load persisted memory
export async function GET() {
  try {
    await ensureDir();
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    // File doesn't exist yet — return null so client falls back to localStorage
    return NextResponse.json(null);
  }
}

// POST /api/memory — save memory to disk
export async function POST(req: NextRequest) {
  try {
    await ensureDir();
    const body = await req.json();
    await fs.writeFile(DATA_FILE, JSON.stringify(body), "utf-8");
    return NextResponse.json({ saved: true });
  } catch (err) {
    return NextResponse.json(
      { saved: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 },
    );
  }
}
