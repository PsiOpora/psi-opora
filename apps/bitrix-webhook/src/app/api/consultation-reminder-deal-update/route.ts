import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { handleConsultationDealUpdate } from "@psi-opora/jobs";

/**
 * Обработчик события ONCRMDEALUPDATE (привязывается через event.bind).
 * Bitrix шлёт его как application/x-www-form-urlencoded, а не JSON.
 */
export async function POST(request: Request) {
  try {
    const webhookToken = env.BITRIX_CRM_WEBHOOK_TOKEN;
    if (!webhookToken) {
      return Response.json(
        { success: false, message: "BITRIX_CRM_WEBHOOK_TOKEN не задан" },
        { status: 500 },
      );
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

    const result = await handleConsultationDealUpdate(
      api,
      createUpstashRedis(),
      dealId,
    );
    return Response.json({ success: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error("[consultation-reminder] deal-update error:", err);
    return Response.json(
      {
        success: false,
        message: err instanceof Error ? err.message : String(err),
        stack: message,
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return Response.json({ status: "ok" });
}
