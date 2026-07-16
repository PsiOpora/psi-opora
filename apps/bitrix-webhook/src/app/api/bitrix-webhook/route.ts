import { bitrixWebhookHandler } from "@psi-opora/bitrix-webhook-api";

const handler = bitrixWebhookHandler();

export async function POST(request: Request) {
  return handler(request);
}

export async function GET() {
  return Response.json({ status: "ok" });
}
