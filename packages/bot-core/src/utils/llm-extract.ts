import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env, logger } from "@psi-opora/config";
import { generateObject } from "ai";
import { z } from "zod";
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

let cachedModel: ReturnType<
  ReturnType<typeof createOpenRouter>["chat"]
> | null = null;

function getModel() {
  if (!env.OPENROUTER_API_KEY) return null;
  if (!cachedModel) {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
    cachedModel = openrouter.chat(env.OPENROUTER_MODEL);
  }
  return cachedModel;
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

  const model = getModel();
  if (!model) return null;

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
    });
    return null;
  }
}
