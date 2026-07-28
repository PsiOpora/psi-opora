import { type BitrixApi, getPortalTokens } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import { resolveDialogCrmBindings } from "./crm-contact";
import type { CrmDealLink, CrmLinksResult, InboxMessenger } from "./types";

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
  if (!domain) return null;
  const origin = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  return `${origin.replace(/\/$/, "")}/crm/${entity}/details/${id}/`;
}

/** STATUS_ID → NAME для всех воронок сделок (DEAL_STAGE, DEAL_STAGE_2, …). */
async function loadDealStageNames(
  api: BitrixApi,
): Promise<Record<string, string>> {
  const statuses = await api
    .list<{
      ENTITY_ID?: string;
      STATUS_ID?: string;
      NAME?: string;
    }>("crm.status.list", {})
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

export async function loadCrmLinks(
  api: BitrixApi,
  memberId: string | null,
  messenger: InboxMessenger,
  userId: string,
): Promise<CrmLinksResult> {
  const domain = await resolvePortalDomain(memberId);

  let { contactId, dealId, leadId } = await resolveDialogCrmBindings(
    api,
    memberId,
    messenger,
    userId,
  );

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
}

/**
 * CRM-привязки диалога: контакт, лид и сделки клиента в Битрикс24 с прямыми
 * ссылками на карточки — для панели профиля в инбоксе «Клиенты».
 *
 * Резолвинг мессенджер → CRM см. resolveDialogCrmBindings (./crm-contact):
 * для ботов (telegram/max) — своя БД bitrix_crm_links, куда бот сам пишет
 * контакт/сделку при создании; для личных номеров — диалог Открытой линии.
 */
export const crmLinks = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input, context }): Promise<CrmLinksResult> => {
    const empty: CrmLinksResult = { contact: null, lead: null, deals: [] };

    const api = await context.getBitrixApi();
    if (!api) {
      return { ...empty, error: "Нет подключения к Битрикс24" };
    }

    try {
      return await loadCrmLinks(
        api,
        context.memberId,
        input.messenger,
        input.userId,
      );
    } catch (err) {
      return { ...empty, error: (err as Error).message };
    }
  });
