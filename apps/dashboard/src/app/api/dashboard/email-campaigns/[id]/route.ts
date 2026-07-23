import {
  getEmailCampaign,
  listEmailCampaignRecipients,
} from "@psi-opora/db/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [campaign, recipients] = await Promise.all([
    getEmailCampaign(id),
    listEmailCampaignRecipients(id),
  ]);
  if (!campaign) {
    return NextResponse.json({ campaign: null, recipients: [] }, { status: 404 });
  }
  return NextResponse.json({ campaign, recipients });
}
