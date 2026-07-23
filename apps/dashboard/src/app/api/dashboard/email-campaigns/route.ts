import { listEmailCampaigns } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const campaigns = await listEmailCampaigns();
  return NextResponse.json({ campaigns });
}
