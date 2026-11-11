import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/** pending — ждёт времени; sending — взято воркером; sent/failed — итог;
 * cancelled — отменено оператором до отправки. */
export type ScheduledMessageStatus =
	| "pending"
	| "sending"
	| "sent"
	| "failed"
	| "cancelled";

/** inbox — из инбокса «Клиенты» (канал известен: messenger + userId);
 * widget — из вкладки «Мессенджер» в карточке CRM (канал определяется заново
 * по контакту в момент отправки, как и при обычной отправке из вкладки). */
export type ScheduledMessageKind = "inbox" | "widget";

/** Вложение, уже загруженное в S3 (см. packages/api message-attachment-storage). */
export interface ScheduledMessageAttachment {
	s3Key: string;
	fileName: string;
	mimeType: string;
	size: number;
	kind: "image" | "file" | "voice";
}

/**
 * Отложенные сообщения клиентам: оператор пишет сообщение сейчас, а уйдёт оно
 * в указанное время. Рассылает таймер в apps/hatchet-worker (packages/jobs
 * scheduled-messages-ticker.ts) тем же кодом, что и обычную отправку, —
 * результат попадает в тот же журнал bot_messages.
 */
export const scheduledMessages = pgTable(
	"scheduled_messages",
	{
		id: text("id").primaryKey(),
		/** member_id портала Bitrix24 — нужен воркеру, чтобы получить OAuth-клиент
		 * и найти личные номера портала без сессии оператора. */
		memberId: text("member_id"),
		kind: text("kind").$type<ScheduledMessageKind>().notNull(),
		messenger: text("messenger").notNull(),
		/** Для kind=inbox — диалог (bot_messages.user_id). Для widget не задаётся:
		 * получатель определяется из CRM по entity/entityId. */
		userId: text("user_id"),
		/** Только для kind=widget — сущность CRM (deal | contact) и её ID. */
		entity: text("entity"),
		entityId: text("entity_id"),
		lineId: text("line_id"),
		connectorId: text("connector_id"),
		text: text("text").notNull(),
		attachment: jsonb("attachment").$type<ScheduledMessageAttachment>(),
		/** Кто запланировал — автор сообщения в журнале после отправки. */
		operatorId: text("operator_id"),
		operatorName: text("operator_name"),
		sendAt: timestamp("send_at").notNull(),
		status: text("status")
			.$type<ScheduledMessageStatus>()
			.notNull()
			.default("pending"),
		error: text("error"),
		/** Сколько раз воркер брал сообщение в работу — для защиты от вечных повторов. */
		attempts: integer("attempts").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
		sentAt: timestamp("sent_at"),
	},
	(table) => [
		index("scheduled_messages_due_idx").on(table.status, table.sendAt),
		index("scheduled_messages_dialog_idx").on(
			table.messenger,
			table.userId,
			table.status,
		),
		index("scheduled_messages_entity_idx").on(
			table.entity,
			table.entityId,
			table.status,
		),
	],
);
