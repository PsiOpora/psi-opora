import { getUnisenderSettings } from "@psi-opora/db/queries";
import { createUnisenderClient } from "@psi-opora/unisender-client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getUnisenderSettings().catch(() => null);

  if (!settings?.apiKey) {
    return NextResponse.json({
      configured: false,
      senderConfigured: false,
      templates: [],
      error: null,
    });
  }

  try {
    const templates = await createUnisenderClient(settings.apiKey).getTemplates();
    return NextResponse.json({
      configured: true,
      senderConfigured: !!settings.senderEmail,
      templates,
      error: null,
    });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      senderConfigured: !!settings.senderEmail,
      templates: [],
      error: (err as Error).message,
    });
  }
}
