import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { botGuides } from "../bot-guides";

/**
 * Кампания выдачи лид-магнита по кодовому слову: пользователь пишет боту
 * keyword — бот сразу запускает согласие → email → выдачу гайда → телефон,
 * минуя обычный выбор категории/темы. guideId ссылается на библиотеку
 * bot_guides — PDF загружается тем же способом, что и обычный гайд.
 */
export const botGuideCampaigns = pgTable("bot_guide_campaigns", {
	id: text("id").primaryKey(),
	/** Кодовое слово входа, сравнивается регистронезависимо (см. matchGuideCampaignKeyword). */
	keyword: text("keyword").notNull().unique(),
	/** Тема материала — уходит в comment/campaign сделки Bitrix. */
	title: text("title").notNull(),
	guideId: text("guide_id").references(() => botGuides.id),
	/**
	 * Приветствие перед согласием на ПДн — показывается при любом входе в
	 * кампанию (по /start-ссылке и по кодовому слову в чате), в т.ч. для
	 * ссылок с источником рекламы вида SCHOOL_VK (см. resolveGuideCampaignStart
	 * в bot-core/scenario/guide-campaign.ts). Пусто — шаг пропускается,
	 * сценарий сразу показывает согласие на ПДн, как раньше.
	 */
	welcomeMessage: text("welcome_message"),
	/**
	 * Вопрос перед сбором email — специфичен для темы кампании, не общий
	 * emailQuestion сценария (тот жёстко ссылается на дефолтный гайд и вводит
	 * в заблуждение, когда кампаний несколько — см. чат SCHOOL 2026-08-18).
	 */
	emailQuestion: text("email_question")
		.notNull()
		.default("На какой email отправить материал?"),
	emailSubject: text("email_subject").notNull(),
	emailBody: text("email_body").notNull(),
	/** Сообщение в чате при выдаче материала (аналог lead_magnet, поддерживает Markdown-ссылку). */
	deliveryMessage: text("delivery_message").notNull(),
	/** Через сколько дней после выдачи слать напоминание с приглашением на диагностику. */
	followUpDelayDays: integer("follow_up_delay_days").notNull().default(2),
	followUpMessage: text("follow_up_message").notNull(),
	diagnosticCtaText: text("diagnostic_cta_text")
		.notNull()
		.default("Согласен/согласна на диагностику"),
	active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
