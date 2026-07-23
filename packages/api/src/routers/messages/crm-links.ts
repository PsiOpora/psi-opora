import {
  type BitrixApi,
  createWebhookApi,
  getPortalTokens,
} from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { getBotConnector } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import type { CrmDealLink, CrmLinksResult } from "./types";

/**
 * Домен портала для прямых ссылок на карточки CRM: из OAuth-токенов портала,
 * в вебхук-режиме (локальная разработка) — из хоста DASHBOARD_BITRIX_WEBHOOK_URL.
 */
async function resolvePortalDomain(
  memberId: string | null,
): Promise<string | null> {
  if (memberId) {
    const tokens = await getPortalTokens(memberId).catch(() => undefined);
    if (tokens) return tokens.domain;
  }
  if (env.DASHBOARD_BITRIX_WEBHOOK_URL) {
    try {
      return new URL(env.DASHBOARD_BITRIX_WEBHOOK_URL).host;
    } catch {
      return null;
    }
  }
  return null;
}

function crmUrl(
  domain: string | null,
  entity: "contact" | "deal" | "lead",
  id: string,
): string | null {
  return domain ? `https://${domain}/crm/${entity}/details/${id}/` : null;
}

/**
 * entity_data_2 диалога Открытой линии — привязки CRM парами `TYPE|ID`:
 * `LEAD|0|COMPANY|0|CONTACT|123|DEAL|456` (0 = привязки нет). Тот же формат
 * разбирает бот при создании сделки — см.
 * packages/bot-core/src/utils/bitrix.ts (parseDialogCrmBindings).
 */
function parseCrmBindings(raw: string | undefined): {
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
} {
  const bindings: Record<string, number> = {};
  const parts = (raw ?? "").split("|");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i];
    const id = Number(parts[i + 1]);
    if (type && Number.isFinite(id) && id > 0) bindings[type] = id;
  }
  return {
    contactId: bindings.CONTACT ? String(bindings.CONTACT) : null,
    dealId: bindings.DEAL ? String(bindings.DEAL) : null,
    leadId: bindings.LEAD ? String(bindings.LEAD) : null,
  };
}

/** STATUS_ID → NAME для всех воронок сделок (DEAL_STAGE, DEAL_STAGE_2, …). */
async function loadDealStageNames(
  api: BitrixApi,
): Promise<Record<string, string>> {
  const statuses = await api
    .list<{ ENTITY_ID?: string; STATUS_ID?: string; NAME?: string }>(
      "crm.status.list",
      {},
    )
    .catch(() => []);
  const names: Record<string, string> = {};
  for (const status of statuses) {
    if (
      status.ENTITY_ID?.startsWith("DEAL_STAGE") &&
      status.STATUS_ID &&
      status.NAME
    ) {
      names[status.STATUS_ID] = status.NAME;
    }
  }
  return names;
}

/**
 * Вебхук ботов для методов Открытых линий — та же логика выбора env, что у
 * bot-core (getWebhookBase): {TG|MAX}_BITRIX_WEBHOOK_URL, иначе общий
 * BITRIX_WEBHOOK_URL. Нужен как фолбэк: у вебхука дашборда (локальная
 * разработка) обычно нет скоупа imopenlines, а у вебхука ботов — есть.
 */
function botWebhookUrl(messenger: string): string | null {
  const prefix = messenger === "telegram" ? "TG" : "MAX";
  return (
    process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ??
    process.env.BITRIX_WEBHOOK_URL ??
    null
  );
}

interface OpenLineDialogRaw {
  id?: number;
  entity_data_2?: string;
}

/** Ошибки прав/скоупа — повод попробовать другой ключ, а не падать. */
function isCredentialsError(message: string): boolean {
  return /INVALID_CREDENTIALS|insufficient_scope|ACCESS_DENIED/i.test(message);
}

/**
 * Диалог Открытой линии по USER_CODE: сперва через основной API (OAuth в
 * проде), при нехватке прав — через вебхук ботов. ACCESS_ERROR означает
 * «диалога ещё нет» (клиент не писал через коннектор) — это null, не сбой.
 */
async function getOpenLineDialog(
  api: BitrixApi,
  messenger: string,
  userCode: string,
): Promise<OpenLineDialogRaw | null> {
  const call = (a: BitrixApi) =>
    a.call<OpenLineDialogRaw>("imopenlines.dialog.get", {
      USER_CODE: userCode,
    });

  try {
    return await call(api);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ACCESS_ERROR")) return null;
    if (!isCredentialsError(message)) throw err;

    const webhookUrl = botWebhookUrl(messenger);
    if (!webhookUrl) throw err;
    try {
      return await call(createWebhookApi(webhookUrl));
    } catch (retryErr) {
      const retryMessage =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      if (retryMessage.includes("ACCESS_ERROR")) return null;
      throw retryErr;
    }
  }
}

interface RawDeal {
  ID?: string | number;
  TITLE?: string;
  STAGE_ID?: string;
  OPPORTUNITY?: string;
  CURRENCY_ID?: string;
  CLOSED?: string;
  CONTACT_ID?: string | null;
}

const DEALS_LIMIT = 10;

/**
 * CRM-привязки диалога: контакт, лид и сделки клиента в Битрикс24 с прямыми
 * ссылками на карточки — для панели профиля в инбоксе «Клиенты».
 *
 * Резолвинг мессенджер → CRM:
 * - telegram/max: `imopenlines.dialog.get` по USER_CODE
 *   `{connector}|{line}|{chat_id}|{user_id}` возвращает сущности, которые
 *   CRM-трекер Открытой линии создал по этому чату. Для Telegram в личном
 *   диалоге chat_id совпадает с user_id; для MAX может отличаться — тогда
 *   диалог не найдётся и вернём пустой результат (не ошибка).
 * - telegram-personal: userId — это телефон, ищем контакт через
 *   `crm.duplicate.findbycomm`.
 */
export const crmLinks = publicProcedure
  .input(clientThreadSchema)
  .handler(async ({ input, context }): Promise<CrmLinksResult> => {
    const empty: CrmLinksResult = { contact: null, lead: null, deals: [] };

    const api = await context.getBitrixApi();
    if (!api) {
      return { ...empty, error: "Нет подключения к Битрикс24" };
    }

    try {
      const domain = await resolvePortalDomain(context.memberId);

      let contactId: string | null = null;
      let dealId: string | null = null;
      let leadId: string | null = null;

      if (input.messenger === "telegram-personal") {
        const found = await api.call<{ CONTACT?: number[] }>(
          "crm.duplicate.findbycomm",
          { entity_type: "CONTACT", type: "PHONE", values: [input.userId] },
        );
        contactId = found?.CONTACT?.[0] ? String(found.CONTACT[0]) : null;
      } else {
        const connector = await getBotConnector(input.messenger);
        if (connector) {
          const userCode = `${connector.connectorId}|${connector.openLineId}|${input.userId}|${input.userId}`;
          const dialog = await getOpenLineDialog(
            api,
            input.messenger,
            userCode,
          );
          if (dialog?.id) {
            ({ contactId, dealId, leadId } = parseCrmBindings(
              dialog.entity_data_2,
            ));
          }
        }
      }

      // Диалог знает сделку, но не контакт (или наоборот) — достраиваем связь.
      if (!contactId && dealId) {
        const deal = await api
          .call<RawDeal>("crm.deal.get", { id: dealId })
          .catch(() => null);
        contactId = deal?.CONTACT_ID ? String(deal.CONTACT_ID) : null;
      }

      const contact = contactId
        ? await api
            .call<{ NAME?: string; SECOND_NAME?: string; LAST_NAME?: string }>(
              "crm.contact.get",
              { id: contactId },
            )
            .then((raw) => ({
              id: contactId as string,
              name:
                [raw?.NAME, raw?.LAST_NAME].filter(Boolean).join(" ") ||
                `Контакт #${contactId}`,
              url: crmUrl(domain, "contact", contactId as string),
            }))
            .catch(() => null)
        : null;

      const lead = leadId
        ? await api
            .call<{ TITLE?: string }>("crm.lead.get", { id: leadId })
            .then((raw) => ({
              id: leadId as string,
              title: raw?.TITLE ?? `Лид #${leadId}`,
              url: crmUrl(domain, "lead", leadId as string),
            }))
            .catch(() => null)
        : null;

      let rawDeals: RawDeal[] = [];
      if (contactId) {
        rawDeals = await api.list<RawDeal>("crm.deal.list", {
          filter: { CONTACT_ID: contactId },
          select: [
            "ID",
            "TITLE",
            "STAGE_ID",
            "OPPORTUNITY",
            "CURRENCY_ID",
            "CLOSED",
          ],
          order: { ID: "DESC" },
        });
      } else if (dealId) {
        const deal = await api
          .call<RawDeal>("crm.deal.get", { id: dealId })
          .catch(() => null);
        if (deal) rawDeals = [deal];
      }

      let deals: CrmDealLink[] = [];
      if (rawDeals.length > 0) {
        const stageNames = await loadDealStageNames(api);
        deals = rawDeals.slice(0, DEALS_LIMIT).map((deal) => {
          const id = String(deal.ID ?? "");
          return {
            id,
            title: deal.TITLE || `Сделка #${id}`,
            stageName: deal.STAGE_ID
              ? (stageNames[deal.STAGE_ID] ?? deal.STAGE_ID)
              : null,
            opportunity: deal.OPPORTUNITY ?? null,
            currencyId: deal.CURRENCY_ID ?? null,
            closed: deal.CLOSED === "Y",
            url: crmUrl(domain, "deal", id),
          };
        });
      }

      return { contact, lead, deals };
    } catch (err) {
      return { ...empty, error: (err as Error).message };
    }
  });
