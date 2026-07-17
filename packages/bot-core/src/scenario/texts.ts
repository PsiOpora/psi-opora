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
    hint: "Показывается при /start вместе с кнопками «Записаться» и «Получить гайд».",
    group: "Начало диалога",
    multiline: true,
    defaultValue:
      "Здравствуйте! Это бот центра «Опора». Чтобы помочь вам разобраться, ответьте, пожалуйста, на несколько вопросов.\n\n" +
      "Данные обрабатываются безопасно — в соответствии с [Политикой конфиденциальности](https://psi-opora.ru/private-policy/).",
  },
  {
    key: "btn_consult",
    label: "Кнопка «Записаться на консультацию»",
    group: "Начало диалога",
    defaultValue: "📝 Записаться на консультацию",
  },
  {
    key: "btn_guide",
    label: "Кнопка «Получить гайд»",
    group: "Начало диалога",
    defaultValue: "📖 Получить гайд для родителей",
  },
  {
    key: "category_question",
    label: "Вопрос о категории",
    hint: "Задаётся после нажатия «Получить гайд».",
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
    key: "consent_text",
    label: "Согласие на обработку ПДн",
    hint: "Показывается после нажатия «Записаться на консультацию».",
    group: "Запись на консультацию",
    multiline: true,
    defaultValue:
      "📋 *Согласие на обработку персональных данных*\n\n" +
      "В соответствии с Федеральным законом №152-ФЗ «О персональных данных» " +
      "для записи на консультацию нам необходимо обработать ваши персональные данные:\n\n" +
      "• Имя\n" +
      "• Номер телефона\n" +
      "• Email\n\n" +
      "*Цель обработки:* запись на психологическую консультацию и обратная связь.\n" +
      "*Оператор:* Центр психологической помощи «Пси-Опора».\n" +
      "*Срок хранения:* до отзыва согласия.\n\n" +
      "Нажимая «Согласен(а)», вы принимаете условия следующих документов:\n" +
      "• [Политика конфиденциальности](https://psi-opora.ru/private-policy/)\n" +
      "• [Согласие на обработку персональных данных](https://psi-opora.ru/personal-data/)\n" +
      "• [Публичная оферта](https://psi-opora.ru/oferta-kurs-rod/)\n" +
      "• [Согласие на рекламную рассылку](https://psi-opora.ru/reklama/)\n\n" +
      "Вы можете отозвать согласие в любой момент, написав нам.\n\n" +
      "Подтвердите согласие, чтобы продолжить 👇",
  },
  {
    key: "btn_consent_agree",
    label: "Кнопка согласия",
    group: "Запись на консультацию",
    defaultValue: "✅ Согласен(а) на обработку данных",
  },
  {
    key: "btn_consent_decline",
    label: "Кнопка отказа",
    group: "Запись на консультацию",
    defaultValue: "❌ Не согласен(а)",
  },
  {
    key: "consent_declined",
    label: "Отказ от согласия (финал)",
    group: "Запись на консультацию",
    multiline: true,
    defaultValue:
      "Вы отказались от обработки персональных данных.\n\n" +
      "Без согласия мы не можем принять заявку. " +
      "Если передумаете — нажмите /start.",
  },
  {
    key: "consent_agreed",
    label: "Согласие получено",
    group: "Запись на консультацию",
    defaultValue: "✅ Согласие получено. Приступим к записи!",
  },
  {
    key: "name_question",
    label: "Вопрос об имени",
    group: "Запись на консультацию",
    defaultValue: "Как вас зовут?",
  },
  {
    key: "consult_phone_question",
    label: "Запрос телефона (консультация)",
    hint: "{name} заменяется на имя клиента.",
    group: "Запись на консультацию",
    defaultValue:
      "Отлично, {name}! Теперь введите, пожалуйста, ваш номер телефона для связи.",
  },
  {
    key: "consult_phone_invalid_final",
    label: "Телефон не распознан (финал)",
    group: "Запись на консультацию",
    multiline: true,
    defaultValue:
      "😔 К сожалению, мы не смогли распознать номер. " +
      "Напишите, пожалуйста, номер в любом формате: +7 999 123-45-67, " +
      "8 999 123 45 67 и т.д. Мы свяжемся с вами для уточнения.",
  },
  {
    key: "consult_email_question",
    label: "Запрос email (консультация)",
    group: "Запись на консультацию",
    defaultValue:
      "Спасибо! И последний шаг — укажите, пожалуйста, ваш email для связи.",
  },
  {
    key: "consult_email_invalid_final",
    label: "Email не распознан (финал)",
    group: "Запись на консультацию",
    defaultValue:
      "😔 Не удалось распознать email, продолжим без него — уточним при звонке.",
  },
  {
    key: "consult_success",
    label: "Заявка принята",
    hint: "{name} заменяется на имя клиента.",
    group: "Запись на консультацию",
    multiline: true,
    defaultValue:
      "✅ *Заявка принята!*\n\n" +
      "{name}, наш администратор свяжется с вами в ближайшие 30 минут, чтобы подтвердить запись на консультацию.\n\n" +
      "А пока вы можете:\n" +
      "📖 Узнать больше о наших специалистах: https://psi-opora.ru/services\n" +
      "💬 Задать вопрос в чат\n\n" +
      "Хорошего дня! 🌿",
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

// ── Зарезервированные ключи bot_texts для PDF-гайда ───────────────────────────
// Их пишет форма загрузки гайда в дашборде; в форме текстов они не показываются
// (не входят в SCENARIO_TEXT_DEFS).

/** Публичный URL, по которому дашборд отдаёт PDF гайда. */
export const GUIDE_FILE_URL_KEY = "guide_file_url";
/** Имя файла гайда (для подписи и отправки в MAX). */
export const GUIDE_FILE_NAME_KEY = "guide_file_name";
/** Ключ объекта в S3 — используется дашбордом. */
export const GUIDE_FILE_S3_KEY = "guide_file_s3_key";
/** Размер файла в байтах — для отображения в дашборде. */
export const GUIDE_FILE_SIZE_KEY = "guide_file_size";

export interface GuideFile {
  url: string;
  name: string;
}

const CACHE_TTL_MS = 60_000;

let cachedOverrides: Record<string, string> | null = null;
let cachedAt = 0;

/** Строки bot_texts с кэшем на минуту; при недоступной БД — прошлый кэш. */
async function getOverrides(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedOverrides && now - cachedAt < CACHE_TTL_MS) return cachedOverrides;

  try {
    // Ленивый импорт: клиент БД падает при загрузке без POSTGRES_URL,
    // а дефолтные тексты и defs нужны и без базы (дашборд, тесты)
    const { getBotTextsRecord } = await import("@psi-opora/db/queries.edge");
    cachedOverrides = await getBotTextsRecord();
    cachedAt = now;
    return cachedOverrides;
  } catch (err) {
    console.error(
      `[texts] не удалось загрузить тексты бота: ${(err as Error).message}`,
    );
    return cachedOverrides ?? {};
  }
}

/**
 * Тексты сценария: значения по умолчанию, перекрытые правками из дашборда.
 * Кэшируются на минуту; при недоступной БД возвращаются дефолты —
 * ошибка не должна ломать диалог.
 */
export async function getScenarioTexts(): Promise<ScenarioTexts> {
  const overrides = await getOverrides();
  const texts = { ...DEFAULT_SCENARIO_TEXTS };
  for (const def of SCENARIO_TEXT_DEFS) {
    const value = overrides[def.key];
    if (value?.trim()) texts[def.key] = value;
  }
  return texts;
}

/** PDF-гайд, загруженный в дашборде; null — файл не настроен. */
export async function getGuideFile(): Promise<GuideFile | null> {
  const overrides = await getOverrides();
  const url = overrides[GUIDE_FILE_URL_KEY]?.trim();
  if (!url) return null;
  return {
    url,
    name: overrides[GUIDE_FILE_NAME_KEY]?.trim() || "guide.pdf",
  };
}
