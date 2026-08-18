import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botGuideDeliveries } from "../schema/bot-guide-deliveries";
import { botGuideViews } from "../schema/bot-guide-views";

export type BotGuideView = typeof botGuideViews.$inferSelect;

/**
 * Окно склейки повторных запросов. Один клик по PDF-ссылке легко даёт
 * несколько GET: встроенный просмотрщик мессенджера, переход во внешний
 * браузер, перезагрузка страницы. Считать это разными просмотрами нельзя —
 * метрика «сколько людей открыли материал» сразу поплывёт.
 */
const DEDUPE_WINDOW_SECONDS = 60;

/** Токен в ссылке — 32 hex-символа (см. guideOpenToken в @psi-opora/bot-core). */
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * Условие поиска выдачи по токену из ссылки. Токен — первые 32 символа
 * sha256 от bot_guide_deliveries.id (`messenger:userId:campaignId`), тот же
 * расчёт делает guideOpenToken в @psi-opora/bot-core/utils/guide-link.
 *
 * Считаем хеш в SQL, а не храним отдельной колонкой: ссылка уходит клиенту
 * раньше, чем создаётся строка выдачи (см. dispatchScenarioOutput), да и
 * выдачи, созданные до появления трекинга, так тоже находятся. Индекса нет —
 * сравнение идёт последовательным сканом, что для таблицы выдач лид-магнита
 * дешевле, чем ещё одна колонка с денормализованным хешем.
 */
function deliveryTokenMatches(token: string) {
  return sql`left(encode(sha256(convert_to(${botGuideDeliveries.id}, 'UTF8')), 'hex'), 32) = ${token}`;
}

export interface GuideViewMeta {
  /** Где была ссылка: chat — сообщение бота, email — письмо. */
  source?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordedGuideView {
  deliveryId: string;
  campaignId: string;
  messenger: string;
  userId: string;
  /** false — запрос склеен с недавним просмотром, в БД ничего не добавлено. */
  recorded: boolean;
}

/**
 * Фиксирует открытие материала по токену из персональной ссылки: строка в
 * bot_guide_views + счётчики в bot_guide_deliveries.
 *
 * Вызывается из роутов раздачи PDF. Машинные скачивания сюда не попадают:
 * вложение в письмо (sendGuideEmail), файл в MAX (sendMaxGuideFile) и
 * sendDocument в Telegram тянут гайд по URL без токена.
 *
 * null — токен не распознан или выдача не найдена; раздачу файла это не
 * должно ломать, поэтому вызывающий просто игнорирует результат.
 */
export async function recordBotGuideView(
  db: Database,
  token: string,
  meta: GuideViewMeta = {},
): Promise<RecordedGuideView | null> {
  if (!db) return null;
  if (!TOKEN_RE.test(token)) return null;

  const found = await db
    .select({
      id: botGuideDeliveries.id,
      campaignId: botGuideDeliveries.campaignId,
      messenger: botGuideDeliveries.messenger,
      userId: botGuideDeliveries.userId,
    })
    .from(botGuideDeliveries)
    .where(deliveryTokenMatches(token))
    .limit(1);
  const delivery = found[0];
  if (!delivery) return null;

  const base: Omit<RecordedGuideView, "recorded"> = {
    deliveryId: delivery.id,
    campaignId: delivery.campaignId,
    messenger: delivery.messenger,
    userId: delivery.userId,
  };

  const recent = await db
    .select({ id: botGuideViews.id })
    .from(botGuideViews)
    .where(
      and(
        eq(botGuideViews.deliveryId, delivery.id),
        sql`${botGuideViews.openedAt} > now() - ${sql.raw(`interval '${DEDUPE_WINDOW_SECONDS} seconds'`)}`,
      ),
    )
    .limit(1);
  if (recent.length > 0) return { ...base, recorded: false };

  await db
    .update(botGuideDeliveries)
    .set({
      firstOpenedAt: sql`coalesce(${botGuideDeliveries.firstOpenedAt}, now())`,
      lastOpenedAt: sql`now()`,
      openCount: sql`${botGuideDeliveries.openCount} + 1`,
    })
    .where(eq(botGuideDeliveries.id, delivery.id));

  await db.insert(botGuideViews).values({
    id: crypto.randomUUID(),
    deliveryId: delivery.id,
    campaignId: delivery.campaignId,
    messenger: delivery.messenger,
    userId: delivery.userId,
    source: meta.source?.trim() || "chat",
    ip: meta.ip?.trim() || null,
    // Обрезаем: User-Agent приходит от клиента и в логах метрики не нужен целиком
    userAgent: meta.userAgent?.slice(0, 500) || null,
  });

  return { ...base, recorded: true };
}

export interface GuideViewer {
  messenger: string;
  userId: string;
  campaignId: string | null;
  /** Контакты из снимка выдачи (bot_guide_deliveries). */
  name: string | null;
  phone: string | null;
  email: string | null;
  opens: number;
  firstOpenedAt: Date;
  lastOpenedAt: Date;
}

/**
 * Кто открывал материал — по строке на пользователя, с контактами из снимка
 * выдачи. Для карточки кампании в дашборде: «выдано N» без ответа на вопрос
 * «а кто вообще дошёл до файла» заказчику мало.
 */
export async function listGuideViewers(
  db: Database,
  opts: { campaignId?: string; limit?: number } = {},
): Promise<GuideViewer[]> {
  if (!db) return [];
  const rows = await db
    .select({
      messenger: botGuideViews.messenger,
      userId: botGuideViews.userId,
      campaignId: sql<string | null>`max(${botGuideViews.campaignId})`,
      name: sql<string | null>`max(${botGuideDeliveries.name})`,
      phone: sql<string | null>`max(${botGuideDeliveries.phone})`,
      email: sql<string | null>`max(${botGuideDeliveries.email})`,
      opens: sql<number>`count(*)::int`,
      firstOpenedAt: sql<Date>`min(${botGuideViews.openedAt})`,
      lastOpenedAt: sql<Date>`max(${botGuideViews.openedAt})`,
    })
    .from(botGuideViews)
    .leftJoin(
      botGuideDeliveries,
      eq(botGuideDeliveries.id, botGuideViews.deliveryId),
    )
    .where(
      opts.campaignId
        ? eq(botGuideViews.campaignId, opts.campaignId)
        : undefined,
    )
    .groupBy(botGuideViews.messenger, botGuideViews.userId)
    .orderBy(desc(sql`max(${botGuideViews.openedAt})`))
    .limit(opts.limit ?? 100);
  return rows;
}
