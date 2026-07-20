import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { handleConsultationDealUpdate } from "@psi-opora/jobs";

/**
 * Обработчик события ONCRMDEALUPDATE (привязывается через event.bind).
 * Bitrix шлёт его как application/x-www-form-urlencoded, а не JSON.
 */
export async function POST(request: Request) {
  const webhookToken = env.BITRIX_CRM_WEBHOOK_TOKEN;
  if (!webhookToken) {
    console.error("[consultation-reminder] BITRIX_CRM_WEBHOOK_TOKEN не задан");
    return new Response("Internal Server Error", { status: 500 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return new Response("Invalid form data", { status: 400 });
  }

  if (form.get("auth[application_token]") !== webhookToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dealId = Number(form.get("data[FIELDS][ID]") ?? 0);
  if (!dealId) {
    return Response.json({ success: false, message: "No deal id" });
  }

  const api = resolveBitrixApi();
  if (!api) {
    return Response.json(
      { success: false, message: "Bitrix24 не подключён" },
      { status: 500 },
    );
  }

  try {
    const result = await handleConsultationDealUpdate(
      api,
      createUpstashRedis(),
      dealId,
    );
    return Response.json({ success: true, result });
  } catch (err) {
    console.error("[consultation-reminder] deal-update error:", err);
    return Response.json(
      { success: false, message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return Response.json({ status: "ok" });
}
