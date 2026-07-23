import { listBroadcasts } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const broadcasts = await listBroadcasts();
  return NextResponse.json({ broadcasts });
}
