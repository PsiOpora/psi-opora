import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env, logger } from "@psi-opora/config";
import {
  addClientNote,
  addConversationTag,
  getConversationMeta,
} from "@psi-opora/db/queries.edge";
import { generateObject } from "ai";
import { z } from "zod";

const TriageSchema = z.object({
  needsAttention: z.boolean(),
  summary: z.string(),
});

const TRIAGE_TIMEOUT_MS = 8_000;
/** Совсем короткие реплики ("да", "спасибо", "хорошо", время встречи) почти
 * всегда рутинные — не тратим на них вызов LLM. */
const MIN_LENGTH = 20;
const ATTENTION_TAG = "⚠️ Требует внимания";

type OpenRouterClient = ReturnType<typeof createOpenRouter>;
type OpenRouterModel = ReturnType<OpenRouterClient["chat"]>;

let cachedClient: OpenRouterClient | null = null;
let cachedModel: OpenRouterModel | null = null;

/**
 * В отличие от llm-extract.ts (там через резервные бесплатные модели
 * прогоняются только короткие поля контактов), сюда попадает весь
 * свободный текст сообщения клиента — вплоть до тяжёлых личных
 * подробностей. Гонять его ещё и через анонимные резервные free-модели
 * ради устойчивости — лишнее расширение круга третьих сторон, которым
 * достаётся такое содержимое; при отказе основной модели просто не
 * триажим это сообщение (как и при отсутствии ключа).
 */
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

export interface TriageMessage {
  messenger: string;
  userId: string;
  text: string;
}

/**
 * Сообщение клиента, пришедшее вне сценария бота (applyScenarioAction/
 * applyScenarioText не смогли его обработать — бот и так уже просто
 * молчит на такие сообщения, а не пытается сам разобраться и ответить).
 * Эта функция ничего не отправляет клиенту и не участвует в диалоге —
 * только решает, стоит ли сообщение внимания оператора, и если да,
 * оставляет короткую авто-заметку и тег в инбоксе «Клиенты» (apps/clients),
 * чтобы тяжёлые/срочные обращения не терялись среди рутинных «спасибо»/«да»
 * в общем потоке (см. кейс клиентки, чьё сообщение о потере близкого и
 * внуке с аутизмом осталось незамеченным среди обычной переписки).
 *
 * При любой проблеме (нет ключа, таймаут, сеть, невалидный ответ модели) —
 * тихо ничего не делает, как и extractContactInfo в llm-extract.ts.
 */
export async function triageOffScriptMessage(
  message: TriageMessage,
): Promise<void> {
  const text = message.text.trim();
  if (text.length < MIN_LENGTH) return;

  const model = getModel();
  if (!model) return;

  // Диалог уже помечен — не гоняем LLM и не плодим дубликаты заметок на
  // каждое следующее внесценарное сообщение болтливого клиента. Пометка
  // снимается оператором вручную (как и любой другой тег) — это и есть
  // сигнал "уже разобрались, можно снова реагировать".
  const meta = await getConversationMeta(message.messenger, message.userId);
  if (meta?.tags?.includes(ATTENTION_TAG)) return;

  try {
    const { object } = await generateObject({
      model,
      schema: TriageSchema,
      abortSignal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
      system:
        "Ты помогаешь операторам психологического центра не пропустить важное " +
        "сообщение клиента. Тебе присылают сообщение, которое клиент написал в " +
        "чат-боте вне заранее прописанного сценария — бот на него не отвечает и " +
        "не должен пытаться помочь, это делает только оператор-человек. Определи: " +
        "1) needsAttention — действительно ли сообщение требует внимания оператора " +
        "(а не рутинная реплика вроде «спасибо», «да», «хорошо», подтверждение " +
        "времени встречи, приветствие); 2) summary — если needsAttention=true, одна " +
        "короткая фраза на русском (до 15 слов) с сутью обращения для оператора: " +
        "кто/что случилось, есть ли риск или срочность. Если needsAttention=false — " +
        "пустая строка в summary. Никогда не формулируй ответ клиенту, только оценку " +
        "для оператора.",
      prompt: text,
    });

    if (!object.needsAttention) return;
    const summary = object.summary.trim();
    if (!summary) return;

    await addClientNote({
      messenger: message.messenger,
      userId: message.userId,
      text: `🤖 Авто-заметка: ${summary}`,
    });
    await addConversationTag(message.messenger, message.userId, ATTENTION_TAG);
  } catch (err) {
    logger.error("bot.triage.failed", err as Error, {
      messenger: message.messenger,
      textLength: text.length,
      model: model.modelId,
    });
  }
}
