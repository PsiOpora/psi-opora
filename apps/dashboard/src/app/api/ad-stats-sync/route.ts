import { NextResponse } from "next/server";
import { fetchAdStats } from "@psi-opora/api";
import { env } from "@psi-opora/config";
import { getRedisOrNull } from "@/lib/redis";
import { orpc } from "@/lib/orpc/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = env.CRON_SECRET;

	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const redis = getRedisOrNull();
		const creds = await orpc.ads.getCredentials().catch(() => null);
		const result = await fetchAdStats(redis, creds);
		return NextResponse.json({
			ok: true,
			campaigns: result.campaigns.length,
			totalSpend: result.totalSpend,
			totalImpressions: result.totalImpressions,
			totalClicks: result.totalClicks,
			lastUpdated: result.lastUpdated,
		});
	} catch (err) {
		console.error("[ad-stats-sync] error:", err);
		return NextResponse.json(
			{ ok: false, error: (err as Error).message },
			{ status: 500 },
		);
	}
}
