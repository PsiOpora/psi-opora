import type { BitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { upsertWhatsappPersonalAccountConnected } from "@psi-opora/db/queries";

export function connectorId(): string {
  return env.WA_PERSONAL_CONNECTOR_ID;
}

/**
 * Конфигурация вебхука входящих для создаваемой WAHA-сессии: WAHA сама
 * доставляет события `message` на apps/bitrix-webhook (см. api/waha-webhook),
 * подписывая тело HMAC-ключом — поэтому у нас нет always-on процесса
 * на приём, в отличие от tg-userbot-worker.
 */
export function sessionWebhook():
  | { url: string; hmacKey?: string }
  | undefined {
  if (!env.WAHA_WEBHOOK_URL) return undefined;
  return {
    url: env.WAHA_WEBHOOK_URL,
    hmacKey: env.WAHA_WEBHOOK_SECRET,
  };
}

/**
 * Сохраняет подключённый номер и активирует коннектор на выбранной линии —
 * `imconnector.activate` требует контекста OAuth-приложения, поэтому
 * вызывается через `context.getBitrixApi()` дашборда. Ошибку активации не
 * считаем фатальной: аккаунт уже сохранён, администратор может повторить
 * активацию, открыв настройки канала ещё раз (как у telegram-personal).
 */
export async function finalizeConnectedLogin(params: {
  memberId: string;
  lineId: string;
  phone: string;
  sessionName: string;
  getBitrixApi: () => Promise<BitrixApi | null>;
}): Promise<{ activationError?: string }> {
  await upsertWhatsappPersonalAccountConnected({
    memberId: params.memberId,
    openLineId: params.lineId,
    connectorId: connectorId(),
    phone: params.phone,
    sessionName: params.sessionName,
  });

  try {
    const api = await params.getBitrixApi();
    if (!api) return { activationError: "Нет подключения к Битрикс24" };
    await api.call("imconnector.activate", {
      CONNECTOR: connectorId(),
      LINE: Number(params.lineId),
      ACTIVE: "Y",
    });
    return {};
  } catch (err) {
    return { activationError: (err as Error).message };
  }
}
