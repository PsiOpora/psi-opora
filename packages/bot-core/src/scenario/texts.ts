/**
 * Тексты сценария бота. Значения по умолчанию заданы здесь,
 * переопределения хранятся в таблице bot_texts и редактируются в дашборде
 * (/settings/bot). Ключи стабильны — по ним бот и дашборд находят тексты.
 */

export interface ScenarioTextDef {
  key: string;
  /** Название поля в дашборде. */
  label: string;
  /** Подсказка под полем в дашборде. */
  hint?: string;
  /** Группа-карточка в дашборде. */
  group: string;
  /** Многострочное поле (textarea). */
  multiline?: boolean;
  defaultValue: string;
}

export const SCENARIO_TEXT_DEFS = [
  {
    key: "welcome",
    label: "Приветствие",
    group: "Начало диалога",
    multiline: true,
    defaultValue:
      "Здравствуйте! Это бот центра «Опора». Чтобы помочь вам разобраться, ответьте, пожалуйста, на несколько вопросов.\n\n" +
      "Данные обрабатываются безопасно — в соответствии с [Политикой конфиденциальности](https://psi-opora.ru/private-policy/).",
  },
  {
    key: "category_question",
    label: "Вопрос о категории",
    group: "Начало диалога",
    defaultValue: "Что вас привело? Так я точнее подскажу.",
  },
  {
    key: "btn_child",
    label: "Кнопка «Ребёнок»",
    group: "Начало диалога",
    defaultValue: "Трудности с ребенком / подростком",
  },
  {
    key: "btn_self",
    label: "Кнопка «Для себя»",
    group: "Начало диалога",
    defaultValue: "Хочу помощь для себя",
  },
  {
    key: "issue_question",
    label: "Вопрос о трудностях",
    group: "Начало диалога",
    defaultValue: "С чем связаны трудности?",
  },
  {
    key: "btn_issue_eating",
    label: "Кнопка «Пищевое расстройство»",
    group: "Начало диалога",
    defaultValue: "Пищевое расстройство",
  },
  {
    key: "btn_issue_other",
    label: "Кнопка «Другое»",
    group: "Начало диалога",
    defaultValue: "Другое",
  },
  {
    key: "email_question",
    label: "Запрос email",
    hint: "Показывается в ветке «Трудности с ребенком» перед отправкой гайда.",
    group: "Лид-магнит (ветка «Ребёнок»)",
    multiline: true,
    defaultValue:
      "На какой email отправить материалы для родителей? Пришлю гайд «3 фразы, которые нельзя говорить ребенку».\n\n" +
      "Напишите адрес сообщением или нажмите кнопку ниже.",
  },
  {
    key: "btn_skip_email",
    label: "Кнопка отказа от email",
    group: "Лид-магнит (ветка «Ребёнок»)",
    defaultValue: "Продолжить без email",
  },
  {
    key: "email_invalid",
    label: "Некорректный email",
    group: "Лид-магнит (ветка «Ребёнок»)",
    defaultValue:
      "Не удалось распознать email. Введите, пожалуйста, адрес в формате: example@mail.ru",
  },
  {
    key: "lead_magnet",
    label: "Гайд (лид-магнит)",
    hint: "Отправляется после того, как пользователь оставил email. Поддерживается Markdown — можно вставить ссылку на PDF.",
    group: "Лид-магнит (ветка «Ребёнок»)",
    multiline: true,
    defaultValue:
      "Спасибо! Отправил материалы на ваш email. А чтобы не ждать письма — держите гайд прямо здесь:\n\n" +
      "📎 *«3 фразы, которые нельзя говорить ребенку»*\n" +
      "https://psi-opora.ru/guide-parents.pdf",
  },
  {
    key: "phone_question",
    label: "Запрос телефона",
    group: "Заявка на консультацию",
    multiline: true,
    defaultValue:
      "Оставьте, пожалуйста, номер телефона — так специалист центра «Опора» сможет связаться с вами и подсказать, как действовать дальше.\n\n" +
      "Напишите номер сообщением или нажмите кнопку ниже.",
  },
  {
    key: "btn_skip_phone",
    label: "Кнопка отказа от телефона",
    group: "Заявка на консультацию",
    defaultValue: "Не оставлять телефон",
  },
  {
    key: "phone_invalid",
    label: "Некорректный телефон",
    group: "Заявка на консультацию",
    defaultValue:
      "Не удалось распознать номер телефона. Введите, пожалуйста, номер в любом формате, например: +7 (999) 123-45-67",
  },
  {
    key: "phone_thanks",
    label: "Телефон получен",
    group: "Заявка на консультацию",
    multiline: true,
    defaultValue:
      "✅ Спасибо! Заявка передана специалисту — он свяжется с вами в ближайшее время.\n\nХорошего дня! 🌿",
  },
  {
    key: "phone_declined",
    label: "Отказ от телефона (финал)",
    group: "Заявка на консультацию",
    multiline: true,
    defaultValue:
      "Хорошо, ничего страшного. Если захотите получить консультацию — просто напишите /start.\n\nБерегите себя! 🌿",
  },
  {
    key: "subscribe_question",
    label: "Вопрос о рассылке",
    hint: "Задаётся в ветке «Помощь для себя» после того, как оставлен телефон.",
    group: "Рассылка",
    multiline: true,
    defaultValue:
      "Хотите получать от центра «Опора» полезные материалы для родителей, новости и приглашения на курсы?",
  },
  {
    key: "btn_subscribe_yes",
    label: "Кнопка «Да»",
    group: "Рассылка",
    defaultValue: "Да, хочу",
  },
  {
    key: "btn_subscribe_no",
    label: "Кнопка «Нет»",
    group: "Рассылка",
    defaultValue: "Нет, спасибо",
  },
  {
    key: "subscribe_yes_reply",
    label: "Ответ на «Да»",
    group: "Рассылка",
    multiline: true,
    defaultValue:
      "Отлично! Будем присылать только полезное и нечасто. Специалист свяжется с вами в ближайшее время. 🌿",
  },
  {
    key: "subscribe_no_reply",
    label: "Ответ на «Нет»",
    group: "Рассылка",
    multiline: true,
    defaultValue:
      "Хорошо, без рассылки. Специалист свяжется с вами в ближайшее время. 🌿",
  },
  {
    key: "reminder",
    label: "Напоминание",
    hint: "Отправляется один раз, если пользователь не ответил на вопрос. Без ответа на напоминание сценарий завершается.",
    group: "Напоминание",
    multiline: true,
    defaultValue:
      "Вы не закончили диалог 🙂 Ответьте на вопрос выше — и я подскажу, как центр «Опора» может помочь именно вам.",
  },
] as const satisfies readonly ScenarioTextDef[];

export type ScenarioTextKey = (typeof SCENARIO_TEXT_DEFS)[number]["key"];
export type ScenarioTexts = Record<ScenarioTextKey, string>;

export const DEFAULT_SCENARIO_TEXTS: ScenarioTexts = Object.fromEntries(
  SCENARIO_TEXT_DEFS.map((def) => [def.key, def.defaultValue]),
) as ScenarioTexts;

const CACHE_TTL_MS = 60_000;

let cached: ScenarioTexts | null = null;
let cachedAt = 0;

/**
 * Тексты сценария: значения по умолчанию, перекрытые правками из дашборда.
 * Кэшируются на минуту; при недоступной БД возвращаются дефолты —
 * ошибка не должна ломать диалог.
 */
export async function getScenarioTexts(): Promise<ScenarioTexts> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  try {
    // Ленивый импорт: клиент БД падает при загрузке без POSTGRES_URL,
    // а дефолтные тексты и defs нужны и без базы (дашборд, тесты)
    const { getBotTextsRecord } = await import("@psi-opora/db/queries.edge");
    const overrides = await getBotTextsRecord();
    const texts = { ...DEFAULT_SCENARIO_TEXTS };
    for (const def of SCENARIO_TEXT_DEFS) {
      const value = overrides[def.key];
      if (value?.trim()) texts[def.key] = value;
    }
    cached = texts;
    cachedAt = now;
    return texts;
  } catch (err) {
    console.error(
      `[texts] не удалось загрузить тексты бота: ${(err as Error).message}`,
    );
    return cached ?? DEFAULT_SCENARIO_TEXTS;
  }
}
