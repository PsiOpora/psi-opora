import { bitrixWebhookHandler } from "@psi-opora/bitrix-webhook-api";
import { env } from "@psi-opora/config";

const handler = bitrixWebhookHandler({ token: env.BITRIX_WEBHOOK_TOKEN });

export async function POST(request: Request) {
  return handler(request);
}

export async function GET() {
  return Response.json({ status: "ok" });
}
