import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Факт открытия материала клиентом: одна строка на переход по персональной
 * ссылке из чата бота (см. buildGuideTrackingUrl в @psi-opora/bot-core).
 * Раздача PDF (apps/dashboard /api/guide-file/[id]/[filename] и
 * /api/guide/[filename]) пишет сюда только запросы с валидной подписью —
 * скачивания самих сервисов (вложение в письме, отправка файла в MAX,
 * sendDocument в Telegram) идут по URL без токена и не считаются.
 *
 * Ссылки на bot_guides / bot_guide_campaigns / bot_guide_deliveries — без
 * внешних ключей: гайд удаляется из библиотеки обычным DELETE
 * (deleteBotGuide), и накопленная история просмотров не должна это
 * блокировать. Плюс ссылка уходит клиенту раньше, чем создаётся строка
 * выдачи (см. dispatchScenarioOutput), поэтому deliveryId может быть null.
 */
export const botGuideViews = pgTable(
	"bot_guide_views",
	{
		id: text("id").primaryKey(),
		/** bot_guide_deliveries.id (`messenger:userId:campaignId`); null — выдача не найдена. */
		deliveryId: text("delivery_id"),
		/** null — глобальный «активный» гайд, он выдаётся вне кампаний. */
		campaignId: text("campaign_id"),
		/** bot_guides.id; null для глобального гайда из bot_texts (GUIDE_FILE_*). */
		guideId: text("guide_id"),
		messenger: text("messenger").notNull(),
		userId: text("user_id").notNull(),
		/** Где была ссылка: chat — сообщение бота, email — письмо с материалом. */
		source: text("source").notNull().default("chat"),
		ip: text("ip"),
		userAgent: text("user_agent"),
		openedAt: timestamp("opened_at").defaultNow().notNull(),
	},
	(table) => [
		index("bot_guide_views_delivery_idx").on(table.deliveryId),
		index("bot_guide_views_campaign_idx").on(table.campaignId),
		index("bot_guide_views_user_idx").on(table.messenger, table.userId),
		index("bot_guide_views_opened_at_idx").on(table.openedAt),
	],
);
