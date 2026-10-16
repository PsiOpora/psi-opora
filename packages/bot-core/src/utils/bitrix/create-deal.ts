import { bitrixPortalKey } from "@psi-opora/config";
import { getBitrixCrmLink, upsertBitrixCrmLink } from "@psi-opora/db/queries";
import { z } from "zod";
import { bitrixPost, getBotId, getEnv, getWebhookBase } from "./client";
import {
	buildContactFields,
	buildMessengerLinkFields,
	findExistingContactId,
} from "./contact";
import { buildDealFields, linkBitrixTrace } from "./deal";
import { type OpenLineDialog, resolveOpenLineDialog } from "./openline";
import type { ContactData, DealData } from "./types";

/**
 * Создаёт или дополняет контакт сразу после того, как клиент оставил email
 * либо телефон. Сделку намеренно не создаёт: она появляется только после
 * завершения соответствующего сценария.
 */
export async function createBitrixContact(data: ContactData): Promise<number> {
	return (await ensureBitrixContact(data)).contactId;
}

async function ensureBitrixContact(
	data: ContactData,
): Promise<{ contactId: number; dialog: OpenLineDialog | null }> {
	const messenger = data.messenger ?? "telegram";
	const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!webhookUrl) {
		console.warn(
			`[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`,
		);
		return { contactId: 0, dialog: null };
	}

	// Автосоздание сделки трекером Открытой линии отключено в настройках
	// линии — сделку всегда создаём сами, ждать её от трекера больше не нужно.
	// Диалог всё равно резолвим: он даёт внутренний ID чата Bitrix для поля IM
	// (imol, см. buildMessengerLinkFields) и для привязки чата к контакту
	// (imopenlines.crm.chat.user.add) — без этого переписка в Открытой линии
	// не будет связана с карточкой CRM. sendMessageToOpenLine к этому моменту
	// уже отработал (вызывается и ожидается до сценария в apps/tg-bot и
	// apps/max-bot), так что диалог на стороне Bitrix уже существует.
	const dialog =
		data.chatId && data.telegramUserId
			? await resolveOpenLineDialog(messenger, data.telegramUserId, data.chatId)
			: null;

	let contactId = dialog?.contactId ?? null;
	if (contactId) {
		// Контакт трекера линии — «пустышка» с именем из мессенджера: дополняем
		// его собранными ботом данными (телефон, email, согласие, профиль).
		// IM-привязку не передаём (imol: null) — трекер уже проставил её сам.
		console.log(
			`[bitrix] используем контакт Открытой линии id=${contactId} (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
		);
		const updated = await bitrixPost<boolean>(
			"crm.contact.update",
			{ id: contactId, fields: buildContactFields(data, null) },
			messenger,
		);
		if (updated !== true)
			throw new Error(`Не удалось обновить контакт ${contactId}`);
	} else {
		contactId = await findExistingContactId(data);
		if (contactId) {
			console.log(
				`[bitrix] используем существующий контакт id=${contactId} вместо создания нового (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
			);
			const messengerLink = buildMessengerLinkFields(data, dialog?.imol);
			if (messengerLink || data.phone) {
				const updated = await bitrixPost<boolean>(
					"crm.contact.update",
					{
						id: contactId,
						fields: {
							...messengerLink,
							...(data.phone
								? { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] }
								: {}),
						},
					},
					messenger,
				);
				if (updated !== true)
					throw new Error(`Не удалось обновить контакт ${contactId}`);
			}
		} else {
			contactId = await bitrixPost<number>(
				"crm.contact.add",
				{
					fields: buildContactFields(data, dialog?.imol),
				},
				messenger,
			);
		}
	}

	// Запоминаем контакт в своей БД — панель CRM в «Клиенты»
	// (packages/api/src/routers/messages/crm-links.ts) резолвит их отсюда,
	// а не через imopenlines.dialog.get: entity_data_2 заполняет только
	// трекер Открытой линии при автосоздании сущностей, а мы теперь всегда
	// создаём контакт/сделку сами (см. комментарий выше).
	if (data.telegramUserId) {
		try {
			await upsertBitrixCrmLink({
				portalKey: bitrixPortalKey(getWebhookBase(messenger)),
				messenger,
				userId: String(data.telegramUserId),
				contactId: String(contactId),
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[bitrix] не удалось сохранить связку CRM в БД: ${message}`,
			);
		}
	}

	// Привязка чата к контакту нужна, только если контакт не от трекера линии
	// (свой чат трекер привязывает сам при создании).
	if (dialog && dialog.contactId !== contactId) {
		try {
			await bitrixPost(
				"imopenlines.crm.chat.user.add",
				{
					CRM_ENTITY_TYPE: "contact",
					CRM_ENTITY: contactId,
					USER_ID: 0,
					CHAT_ID: dialog.chatId,
				},
				messenger,
			);
			console.log(
				`[bitrix] чат ${dialog.chatId} привязан к контакту ${contactId}`,
			);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[bitrix] не удалось привязать чат к контакту: ${message}`);
		}
	}

	return { contactId, dialog };
}

const trackerDealSchema = z
	.object({ CLOSED: z.string(), COMMENTS: z.string().nullish() })
	.nullable();

/**
 * Сделка, которую трекер Открытой линии уже завёл по этому диалогу (у
 * повторных клиентов он создаёт её на первое сообщение, в «Неразобранном»),
 * если её ещё можно занять вместо создания дубля. Только для заявок со своей
 * воронкой (categoryId) — остальные сценарии не меняем. Занять можно сделку,
 * которая открыта и ещё не наша: у наших в «Комментарии» есть строка «Бот: …»
 * (см. buildDealFields) — иначе повторная заявка клиента перетёрла бы
 * прошлую сделку. Любая неопределённость — не занимаем, создаём новую.
 */
async function findAdoptableTrackerDeal(
	data: DealData,
	dialog: OpenLineDialog | null,
): Promise<number | null> {
	const trackerDealId = dialog?.dealId;
	if (!trackerDealId || data.categoryId === undefined) return null;
	if (!data.telegramUserId) return null;
	const messenger = data.messenger ?? "telegram";
	try {
		const link = await getBitrixCrmLink(messenger, String(data.telegramUserId));
		if (link?.dealId === String(trackerDealId)) return null;
		const deal = trackerDealSchema.parse(
			await bitrixPost<unknown>(
				"crm.deal.get",
				{ id: trackerDealId },
				messenger,
			),
		);
		if (deal?.CLOSED !== "N") return null;
		if (/^Бот:/m.test(deal.COMMENTS ?? "")) return null;
		return trackerDealId;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось проверить сделку трекера ${trackerDealId}: ${message}`,
		);
		return null;
	}
}

/**
 * Переносит сделку трекера в нужную воронку/стадию и дополняет её нашими
 * полями. Ответственного не трогаем — его уже назначила линия. null — если
 * обновить не вышло: вызывающая сторона создаст новую сделку, чтобы заявка не
 * осталась без сделки.
 */
async function adoptTrackerDeal(
	trackerDealId: number,
	fields: Awaited<ReturnType<typeof buildDealFields>>,
	messenger: string,
): Promise<number | null> {
	const { ASSIGNED_BY_ID: _assignedBy, ...adoptFields } = fields;
	try {
		await bitrixPost(
			"crm.deal.update",
			{ id: trackerDealId, fields: adoptFields },
			messenger,
		);
		return trackerDealId;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось занять сделку трекера ${trackerDealId}, создаём новую: ${message}`,
		);
		return null;
	}
}

/**
 * @param existingContactId контакт, уже созданный/дополненный отдельным
 *   вызовом createBitrixContact (телефон к этому моменту уже в CRM) —
 *   повторно контакт не создаём.
 */
export async function createBitrixDeal(
	data: DealData,
	existingContactId?: number,
): Promise<{ contactId: number; dealId: number }> {
	const messenger = data.messenger ?? "telegram";
	const { contactId, dialog } = existingContactId
		? {
				contactId: existingContactId,
				dialog:
					data.chatId && data.telegramUserId
						? await resolveOpenLineDialog(
								messenger,
								data.telegramUserId,
								data.chatId,
							)
						: null,
			}
		: await ensureBitrixContact(data);
	if (!contactId) return { contactId: 0, dealId: 0 };

	const fields = await buildDealFields(data, contactId);
	const trackerDealId = await findAdoptableTrackerDeal(data, dialog);
	const adoptedDealId = trackerDealId
		? await adoptTrackerDeal(trackerDealId, fields, messenger)
		: null;
	const dealId =
		adoptedDealId ??
		(await bitrixPost<number>("crm.deal.add", { fields }, messenger));
	console.log(
		`[bitrix] сделка ${adoptedDealId ? "трекера использована" : "создана"} id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
	);

	if (data.telegramUserId) {
		try {
			await upsertBitrixCrmLink({
				portalKey: bitrixPortalKey(getWebhookBase(messenger)),
				messenger,
				userId: String(data.telegramUserId),
				contactId: String(contactId),
				dealId: String(dealId),
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[bitrix] не удалось сохранить связку CRM в БД: ${message}`,
			);
		}
	}

	await linkBitrixTrace(messenger, contactId, dealId, data);
	return { contactId, dealId };
}
