import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env, logger } from "@psi-opora/config";
import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { generateObject } from "ai";
import { z } from "zod";
import { bitrixPost } from "./bitrix/client";
import { createBitrixContact } from "./bitrix/create-deal";
import { appendDealComment } from "./bitrix/sources";
import { OPENROUTER_FALLBACK_MODELS } from "./openrouter";
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
	name?: string;
	chatId?: number;
	source?: string;
	campaign?: string;
}

const EXTRACTION_TIMEOUT_MS = 8_000;
const EMAIL_IN_TEXT = /[^\s<>()@,;:]+@[^\s<>()@,;:]+\.[^\s<>()@,;:]+/;

type OpenRouterClient = ReturnType<typeof createOpenRouter>;
type OpenRouterModel = ReturnType<OpenRouterClient["chat"]>;

let cachedClient: OpenRouterClient | null = null;
const cachedModels = new Map<string, OpenRouterModel>();

function getModels(): OpenRouterModel[] {
	if (!env.OPENROUTER_API_KEY) return [];
	if (!cachedClient) {
		cachedClient = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
	}
	const client = cachedClient;

	return [env.OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS].map((name) => {
		let model = cachedModels.get(name);
		if (!model) {
			model = client.chat(name);
			cachedModels.set(name, model);
		}
		return model;
	});
}

function extractObviousContacts(text: string): ExtractedCrmFacts {
	const emailCandidate = text.match(EMAIL_IN_TEXT)?.[0]?.trim();
	const email =
		emailCandidate && isValidEmail(emailCandidate) ? emailCandidate : undefined;

	// Поддерживаем как отдельный номер, так и естественный ответ оператору
	// «мой телефон +7 ...». Разделители ограничены телефонными символами,
	// чтобы не принять произвольную последовательность чисел за номер.
	const phoneCandidate = text.match(/(?:\+?\d[\d\s()-]{5,}\d)/)?.[0]?.trim();
	const digitsCount = phoneCandidate?.replace(/\D/g, "").length ?? 0;
	const phone =
		phoneCandidate &&
		hasPhoneNumber(phoneCandidate) &&
		digitsCount >= 7 &&
		digitsCount <= 15
			? phoneCandidate
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

	const models = getModels();
	if (models.length === 0) return obvious;

	for (const model of models) {
		try {
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
		} catch (err) {
			const meta = {
				provider: "openrouter",
				model: model.modelId,
				textLength: text.length,
				timeoutMs: EXTRACTION_TIMEOUT_MS,
			};
			if (err instanceof Error && err.name === "TimeoutError") {
				logger.warn("bot.crm_enrichment.timed_out", meta);
			} else {
				logger.error("bot.crm_enrichment.model_failed", err, meta);
			}
		}
	}

	return obvious;
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
		const obvious = extractObviousContacts(text);
		let link = await getBitrixCrmLink(message.messenger, message.userId);

		// Телефон/email, присланные вне активного шага сценария (например,
		// в ответ на ручной вопрос оператора), раньше терялись: обогащение
		// требовало уже существующую bitrix_crm_links. Теперь создаём минимальный
		// контакт либо находим существующий по коммуникации, а createBitrixContact
		// сразу сохраняет связку messenger+userId → contactId.
		if (
			!link?.contactId &&
			(obvious.phone || obvious.email) &&
			(message.messenger === "telegram" || message.messenger === "max")
		) {
			const numericUserId = Number(message.userId);
			if (Number.isSafeInteger(numericUserId) && numericUserId > 0) {
				const contactId = await createBitrixContact({
					name:
						message.name?.trim() ||
						`${message.messenger === "max" ? "MAX" : "Telegram"} #${message.userId}`,
					phone: obvious.phone,
					email: obvious.email,
					consentGranted: false,
					messenger: message.messenger,
					telegramUserId: numericUserId,
					chatId: message.chatId ?? numericUserId,
					source: message.source,
					campaign: message.campaign,
				});
				if (contactId) {
					link = {
						id: `${message.messenger}:${message.userId}`,
						messenger: message.messenger,
						userId: message.userId,
						contactId: String(contactId),
						dealId: null,
						updatedAt: new Date(),
					};
					logger.info("bot.crm_enrichment.contact_created", {
						messenger: message.messenger,
						userId: message.userId,
						contactId,
					});
				}
			}
		}

		if (!link?.contactId) return;

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
		if (!contact) {
			logger.warn("bot.crm_enrichment.contact_not_found", {
				messenger: message.messenger,
				userId: message.userId,
				contactId,
			});
			return;
		}

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
