import type { IncomingMessage, ServerResponse } from "node:http";
import { bitrixWebhookHandler } from "@psi-opora/bitrix-webhook-api";

const handler = bitrixWebhookHandler();

type VercelRequest = IncomingMessage & { body?: unknown };

export default async function webhookHandler(
  req: VercelRequest,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }

  const body = req.body;
  const mockReq = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const response = await handler(mockReq);
  res.statusCode = response.ok ? 200 : 500;
  res.end(response.status);
}
