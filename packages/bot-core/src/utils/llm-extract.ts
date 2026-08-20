import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env, logger } from "@psi-opora/config";
import { generateObject } from "ai";
import { z } from "zod";
import { OPENROUTER_FALLBACK_MODELS } from "./openrouter";
import { hasPhoneNumber } from "./validation";

const ExtractedContactSchema = z.object({
	name: z.string().nullable(),
	phone: z.string().nullable(),
	email: z.string().nullable(),
});

export interface ExtractedContact {
	name: string;
	phone?: string;
	email?: string;
}

const EXTRACTION_TIMEOUT_MS = 8_000;

/**
 * Обычное имя (без цифр, @, переносов строк) незачем гонять через LLM —
 * это основной случай, и на нём мы не хотим терять время/деньги на запрос.
 * LLM подключаем только когда текст похож на то, что пользователь вместо
 * имени вставил сразу блок контактов (частый кейс копипаста из анкеты).
 */
function looksLikePlainName(text: string): boolean {
	const trimmed = text.trim();
	return (
		trimmed.length > 0 &&
		trimmed.length <= 60 &&
		!trimmed.includes("\n") &&
		!trimmed.includes("@") &&
		!hasPhoneNumber(trimmed)
	);
}

// Резервные модели на случай, если основная (env.OPENROUTER_MODEL) вернёт
// ошибку — например, превышен лимит бесплатного воркера у провайдера
// ("ResourceExhausted: Worker local total request limit reached"). Пробуем
// по очереди, пока одна из них не отработает.
type OpenRouterClient = ReturnType<typeof createOpenRouter>;
type OpenRouterModel = ReturnType<OpenRouterClient["chat"]>;

let cachedClient: OpenRouterClient | null = null;
const cachedModels = new Map<string, OpenRouterModel>();

function getClient() {
	if (!env.OPENROUTER_API_KEY) return null;
	if (!cachedClient) {
		cachedClient = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
	}
	return cachedClient;
}

function getModels(): OpenRouterModel[] {
	const client = getClient();
	if (!client) return [];

	const modelNames = [env.OPENROUTER_MODEL, ...OPENROUTER_FALLBACK_MODELS];
	return modelNames.map((name) => {
		let model = cachedModels.get(name);
		if (!model) {
			model = client.chat(name);
			cachedModels.set(name, model);
		}
		return model;
	});
}

/**
 * Пытается разобрать свободный текст на имя/телефон/email через LLM —
 * подстраховка для шага «как вас зовут» на случай, если пользователь
 * присылает сразу весь блок контактов одним сообщением. При любой
 * проблеме (нет ключа, таймаут, сеть, невалидный ответ модели, имя не
 * распознано) возвращает null — вызывающий код (engine.ts) в этом случае
 * обрабатывает текст как раньше, вручную: весь ввод становится именем.
 */
export async function extractContactInfo(
	text: string,
): Promise<ExtractedContact | null> {
	if (looksLikePlainName(text)) return null;

	const models = getModels();
	if (models.length === 0) return null;

	for (const model of models) {
		try {
			const { object } = await generateObject({
				model,
				schema: ExtractedContactSchema,
				abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
				system:
					"Ты извлекаешь контактные данные из сообщения клиента психологического " +
					"центра. Клиент отвечал на вопрос «Как вас зовут?», но мог прислать " +
					"сразу имя, телефон и email одним сообщением (например, скопировал из " +
					"анкеты или визитки). Верни null для полей, которых в тексте нет. " +
					"Телефон и email возвращай как есть, без изменения формата. В поле " +
					"имени — только ФИО/имя, без лишних слов и подписей.",
				prompt: text,
			});

			const name = object.name?.trim();
			if (!name) return null;

			return {
				name,
				phone: object.phone?.trim() || undefined,
				email: object.email?.trim() || undefined,
			};
		} catch (err) {
			logger.error("bot.name_extraction.failed", err as Error, {
				textLength: text.length,
				model: model.modelId,
			});
		}
	}

	return null;
}
