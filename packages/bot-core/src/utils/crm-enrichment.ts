import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env, logger } from "@psi-opora/config";
import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { generateObject } from "ai";
import { z } from "zod";
import { bitrixPost } from "./bitrix/client";
import { appendDealComment } from "./bitrix/sources";
import { hasPhoneNumber, isValidEmail } from "./validation";

const CrmEnrichmentSchema = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  usefulSummary: z.string().nullable(),
});

interface ExtractedCrmFacts {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  usefulSummary?: string;
}

interface BitrixContact {
  NAME?: string;
  PHONE?: Array<{ VALUE?: string }>;
  EMAIL?: Array<{ VALUE?: string }>;
  ADDRESS_CITY?: string;
}

export interface CrmEnrichmentMessage {
  messenger: string;
  userId: string;
  text: string;
}

const EXTRACTION_TIMEOUT_MS = 8_000;
const EMAIL_IN_TEXT = /[^\s<>()@,;:]+@[^\s<>()@,;:]+\.[^\s<>()@,;:]+/;

type OpenRouterClient = ReturnType<typeof createOpenRouter>;
type OpenRouterModel = ReturnType<OpenRouterClient["chat"]>;

let cachedClient: OpenRouterClient | null = null;
let cachedModel: OpenRouterModel | null = null;

function getModel(): OpenRouterModel | null {
  if (!env.OPENROUTER_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
  }
  if (!cachedModel) {
    cachedModel = cachedClient.chat(env.OPENROUTER_MODEL);
  }
  return cachedModel;
}

function extractObviousContacts(text: string): ExtractedCrmFacts {
  const emailCandidate = text.match(EMAIL_IN_TEXT)?.[0]?.trim();
  const email =
    emailCandidate && isValidEmail(emailCandidate) ? emailCandidate : undefined;

  const trimmed = text.trim();
  const phone =
    hasPhoneNumber(trimmed) &&
    /^[+\d\s()-]+$/.test(trimmed) &&
    trimmed.replace(/\D/g, "").length <= 15
      ? trimmed
      : undefined;

  return { email, phone };
}

function hasValue(values: Array<{ VALUE?: string }> | undefined): boolean {
  return Boolean(values?.some((item) => item.VALUE?.trim()));
}

function canReplaceName(name: string | undefined): boolean {
  const value = name?.trim() ?? "";
  return (
    !value || /^(max|telegram)(:|\s)/i.test(value) || /^без имени$/i.test(value)
  );
}

async function extractWithLlm(
  text: string,
  obvious: ExtractedCrmFacts,
): Promise<ExtractedCrmFacts> {
  // Одиночный email/телефон не нуждается в вероятностном распознавании.
  if (
    (obvious.email && text.trim() === obvious.email) ||
    (obvious.phone && text.trim() === obvious.phone)
  ) {
    return obvious;
  }

  const model = getModel();
  if (!model) return obvious;

  const { object } = await generateObject({
    model,
    schema: CrmEnrichmentSchema,
    abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    system:
      "Ты извлекаешь полезные данные из одного сообщения клиента " +
      "психологического центра для дополнения его CRM-карточки. Извлекай " +
      "только факты, которые клиент явно сообщает о себе или человеке, для " +
      "которого просит помощь. Не принимай за данные клиента контакты, имена, " +
      "города и даты, упомянутые в цитатах, примерах или рассказе о других " +
      "людях. name — только если клиент явно представился. phone, email и city — " +
      "только явно указанные значения. usefulSummary — одна короткая фраза до " +
      "25 слов только для содержательного и полезного CRM-факта: причина " +
      "обращения, возраст того, кому нужна помощь, предпочтения по консультации " +
      "или времени связи. Для приветствий, благодарностей, контактов без " +
      "дополнительного смысла, подтверждений и рутинных реплик верни null. " +
      "Не ставь диагнозов и ничего не додумывай.",
    prompt: text,
  });

  const llmEmail = object.email?.trim();
  const llmPhone = object.phone?.trim();
  return {
    name: object.name?.trim() || undefined,
    phone:
      obvious.phone ||
      (llmPhone && hasPhoneNumber(llmPhone) ? llmPhone : undefined),
    email:
      obvious.email ||
      (llmEmail && isValidEmail(llmEmail) ? llmEmail : undefined),
    city: object.city?.trim() || undefined,
    usefulSummary: object.usefulSummary?.trim() || undefined,
  };
}

/**
 * Дополняет уже связанную с диалогом CRM-карточку данными из нового
 * сообщения клиента. Существующие поля не перезаписываются. Если LLM нашла
 * содержательный факт, он добавляется отдельным комментарием в таймлайн
 * сделки, поэтому исходный комментарий сделки остаётся нетронутым.
 */
export async function enrichCrmFromClientMessage(
  message: CrmEnrichmentMessage,
): Promise<void> {
  const text = message.text.trim();
  if (!text) return;

  try {
    const link = await getBitrixCrmLink(message.messenger, message.userId);
    if (!link?.contactId) return;

    const obvious = extractObviousContacts(text);
    const facts = await extractWithLlm(text, obvious);
    if (
      !facts.name &&
      !facts.phone &&
      !facts.email &&
      !facts.city &&
      !facts.usefulSummary
    ) {
      return;
    }

    const contactId = Number(link.contactId);
    if (!Number.isFinite(contactId) || contactId <= 0) return;

    const contact = await bitrixPost<BitrixContact>(
      "crm.contact.get",
      { id: contactId },
      message.messenger,
    );
    const fields: Record<string, unknown> = {};
    if (facts.name && canReplaceName(contact.NAME)) fields.NAME = facts.name;
    if (facts.phone && !hasValue(contact.PHONE)) {
      fields.PHONE = [{ VALUE: facts.phone, VALUE_TYPE: "WORK" }];
    }
    if (facts.email && !hasValue(contact.EMAIL)) {
      fields.EMAIL = [{ VALUE: facts.email, VALUE_TYPE: "WORK" }];
    }
    if (facts.city && !contact.ADDRESS_CITY?.trim()) {
      fields.ADDRESS_CITY = facts.city;
    }

    if (Object.keys(fields).length > 0) {
      await bitrixPost(
        "crm.contact.update",
        { id: contactId, fields },
        message.messenger,
      );
      logger.info("bot.crm_enrichment.contact_updated", {
        messenger: message.messenger,
        userId: message.userId,
        contactId,
        fields: Object.keys(fields),
      });
    }

    const dealId = Number(link.dealId);
    if (facts.usefulSummary && Number.isFinite(dealId) && dealId > 0) {
      await appendDealComment(
        message.messenger,
        dealId,
        `🤖 Из сообщения клиента: ${facts.usefulSummary}`,
      );
    }
  } catch (err) {
    logger.error("bot.crm_enrichment.failed", err as Error, {
      messenger: message.messenger,
      userId: message.userId,
      textLength: text.length,
    });
  }
}
