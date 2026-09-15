import { NextResponse } from "next/server";
import { isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json({ configured: isRedisConfigured() });
}
