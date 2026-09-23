import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Health check untuk Railway/Render
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
    let dbStatus = "unknown";
    let dbError: string | null = null;
    try {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = "connected";
    } catch (e: any) {
        dbStatus = "error";
        dbError = e?.message || String(e);
    }

    return NextResponse.json({ 
        status: true, 
        ok: true, 
        uptime: process.uptime(), 
        ts: Date.now(),
        database: {
            status: dbStatus,
            error: dbError ? dbError.slice(0, 300) : null
        }
    });
}
