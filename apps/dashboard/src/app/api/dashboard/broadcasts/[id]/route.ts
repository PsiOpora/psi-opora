import { getBroadcast, listBroadcastRecipients } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [broadcast, recipients] = await Promise.all([
    getBroadcast(id),
    listBroadcastRecipients(id),
  ]);
  if (!broadcast) {
    return NextResponse.json({ broadcast: null, recipients: [] }, { status: 404 });
  }
  return NextResponse.json({ broadcast, recipients });
}
