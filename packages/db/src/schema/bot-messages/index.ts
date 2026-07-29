import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Журнал всех сообщений между ботами и клиентами:
 * сценарий, напоминания, отправка из вкладки CRM.
 * user_id — идентификатор клиента в мессенджере (chat id TG / user id MAX).
 */
export const botMessages = pgTable(
	"bot_messages",
	{
		id: text("id").primaryKey(),
		messenger: text("messenger").notNull(),
		userId: text("user_id").notNull(),
		/** in — от клиента, out — от бота/оператора. */
		direction: text("direction").notNull(),
		/** scenario | reminder | widget | broadcast | operator. */
		source: text("source").notNull().default("scenario"),
		text: text("text").notNull(),
		/** text | voice — голосовые/аудио-вложения (Telegram voice/audio, MAX
		 * audio-attachment, WAHA аудио с hasMedia). Фото/видео/документы в это
		 * поле не попадают — они как были текстом-заглушкой, так и остались. */
		kind: text("kind").notNull().default("text"),
		/** Внутренний ключ файла в S3 (bot/media/...) — наружу, в API/фронт,
		 * не отдаётся, только через раздающий роут по id сообщения. */
		mediaS3Key: text("media_s3_key"),
		mediaMimeType: text("media_mime_type"),
		/** Длительность голосового в секундах — не все мессенджеры её отдают. */
		mediaDurationSec: integer("media_duration_sec"),
		/** Bitrix-ID оператора, реально написавшего сообщение — заполняется и
		 * для source="operator" (ответ прямо из Открытой линии, см.
		 * apps/bitrix-webhook), и для source="widget" (ответ из инбокса
		 * «Клиенты», apps/clients — там оператор известен через b24 user.current). */
		operatorId: text("operator_id"),
		/** Имя оператора на момент отправки — денормализовано, как
		 * assignedOperatorName в bot_conversations, чтобы не резолвить его заново
		 * через Bitrix REST при каждом показе истории. */
		operatorName: text("operator_name"),
		/** sent | delivered | read | failed. Доставку/прочтение сейчас отдаёт
		 * только WAHA (ack-вебхук) — для остальных каналов статус не поднимается
		 * выше "sent". */
		status: text("status").notNull().default("sent"),
		/** ID сообщения во внешней системе: нужен для ack WAHA и редактирования
		 * исходящих сообщений Telegram/MAX. */
		externalId: text("external_id"),
		/** Канонический адресат внешнего сообщения, если ключ локального
		 * диалога отличается (личный Telegram, начатый по телефону/username). */
		externalChatId: text("external_chat_id"),
		/** Внутренний ID сообщения Bitrix для ответов, пришедших из Открытой
		 * линии. Нужен, чтобы удалить ту же реплику через im.message.delete. */
		bitrixMessageId: integer("bitrix_message_id"),
		/** Внешний message.id, с которым ответ из единого инбокса был отражён
		 * в Открытую линию через imconnector.send.messages. */
		bitrixExternalId: text("bitrix_external_id"),
		/** Только для messenger="telegram-personal"/"whatsapp-personal" — каким
		 * из нескольких личных номеров портала отправлено/получено сообщение
		 * (см. telegram_personal_accounts.connector_id / whatsapp_personal_accounts.
		 * connector_id). Для остальных мессенджеров не заполняется. */
		connectorId: text("connector_id"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		/** Сдвигается при обновлении status — по этому полю, а не createdAt,
		 * поллинг инбокса (listBotMessagesSince) ловит статусные апдейты уже
		 * показанных сообщений. */
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
		/** Когда оператор в последний раз изменил текст во внешнем мессенджере. */
		editedAt: timestamp("edited_at"),
		/** Мягкое удаление: исходный текст остаётся только в БД для аудита, API
		 * вместо него отдаёт безопасную заглушку. */
		deletedAt: timestamp("deleted_at"),
		deletedByOperatorId: text("deleted_by_operator_id"),
	},
	(table) => [
		index("bot_messages_user_idx").on(
			table.messenger,
			table.userId,
			table.createdAt,
		),
		index("bot_messages_updated_idx").on(
			table.messenger,
			table.userId,
			table.updatedAt,
		),
		index("bot_messages_external_idx").on(table.externalId),
	],
);
