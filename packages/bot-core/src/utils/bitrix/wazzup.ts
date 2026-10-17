import { z } from "zod";
import { bitrixPost } from "./client";
import { buildConsentFields, buildMessengerLinkFields } from "./contact";
import type { buildDealFields } from "./deal";
import type { ContactData, DealData } from "./types";

/**
 * Wazzup подключён к тем же каналам, что и бот (к MAX-боту — второй
 * webhook-подпиской, к Telegram — личным номером), и на первое сообщение
 * клиента сам заводит контакт и сделку в «Неразобранном». Менеджеры работают
 * в этой карточке, поэтому бот дописывает собранные данные в неё, а не
 * заводит свою. ID клиента в мессенджере Wazzup пишет в свои UF-поля
 * контакта (создаёт их сам при установке) — по ним карточку и находим.
 */
const WAZZUP_ID_FIELDS: Record<string, string> = {
	max: "UF_CRM_MAXID_WZ",
	telegram: "UF_CRM_TELEGRAMID_WZ",
};
/** Источники, которые заводит Wazzup, имеют вид `WZ<uuid>`. */
const WAZZUP_SOURCE = /^WZ/;
/** Название, которое Wazzup ставит сделке сам: «Сделка по обращению в Max (…)». */
const WAZZUP_DEFAULT_TITLE = /^Сделка по обращению/;
const DEAL_ENTITY_TYPE_ID = 2;
/** «Не разобранное» — первая стадия общей воронки. */
const UNSORTED_STAGE_ID = "NEW";

const contactRowsSchema = z.array(
	z.object({ ID: z.coerce.number() }).catchall(z.unknown()),
);
const dealRowsSchema = z.array(
	z.object({
		ID: z.coerce.number(),
		CONTACT_ID: z.coerce.number().nullish(),
		CATEGORY_ID: z.coerce.number(),
		STAGE_ID: z.string(),
		SOURCE_ID: z.string().nullish(),
		TITLE: z.string().nullish(),
		COMMENTS: z.string().nullish(),
	}),
);
const multiFieldSchema = z.array(z.object({ VALUE: z.string() })).nullish();
const contactSchema = z.object({
	NAME: z.string().nullish(),
	PHONE: multiFieldSchema,
	EMAIL: multiFieldSchema,
	IM: multiFieldSchema,
});
export type WazzupContactSnapshot = z.infer<typeof contactSchema>;

export interface WazzupDeal {
	id: number;
	categoryId: number;
	stageId: string;
	title: string;
	comments: string;
}

export interface WazzupClient {
	contactId: number;
	/** Самая свежая открытая сделка Wazzup по клиенту. */
	deal: WazzupDeal | null;
}

/**
 * Карточка, которую Wazzup завёл на клиента мессенджера. Контактов с одним ID
 * бывает несколько (Wazzup дописывает поле и в найденный им старый контакт) —
 * берём контакт открытой сделки Wazzup, иначе самый старый. Ошибки не
 * пробрасываются: без Wazzup бот работает со своей карточкой, как раньше.
 */
export async function findWazzupClient(
	messenger: string,
	userId: number,
): Promise<WazzupClient | null> {
	const field = WAZZUP_ID_FIELDS[messenger];
	if (!field) return null;
	try {
		const rows = contactRowsSchema.parse(
			await bitrixPost(
				"crm.contact.list",
				{
					filter: { [field]: String(userId) },
					select: ["ID", field],
					order: { ID: "ASC" },
				},
				messenger,
			),
		);
		// Фильтр по несуществующему UF-полю (портал без Wazzup) Bitrix молча
		// игнорирует и отдаёт первые попавшиеся контакты — значение сверяем сами.
		const contactIds = rows
			.filter((row) => String(row[field] ?? "") === String(userId))
			.map((row) => row.ID);
		const [oldestId] = contactIds;
		if (oldestId === undefined) return null;

		const deals = dealRowsSchema.parse(
			await bitrixPost(
				"crm.deal.list",
				{
					filter: { CONTACT_ID: contactIds, CLOSED: "N" },
					select: [
						"ID",
						"CONTACT_ID",
						"CATEGORY_ID",
						"STAGE_ID",
						"SOURCE_ID",
						"TITLE",
						"COMMENTS",
					],
					order: { ID: "DESC" },
				},
				messenger,
			),
		);
		const deal = deals.find((row) => WAZZUP_SOURCE.test(row.SOURCE_ID ?? ""));
		return {
			contactId:
				deal?.CONTACT_ID && contactIds.includes(deal.CONTACT_ID)
					? deal.CONTACT_ID
					: oldestId,
			deal: deal
				? {
						id: deal.ID,
						categoryId: deal.CATEGORY_ID,
						stageId: deal.STAGE_ID,
						title: deal.TITLE ?? "",
						comments: deal.COMMENTS ?? "",
					}
				: null,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось найти карточку Wazzup для ${messenger} ${userId}: ${message}`,
		);
		return null;
	}
}

const phoneKey = (value: string) => value.replace(/\D/g, "").slice(-10);
const emailKey = (value: string) => value.trim().toLowerCase();

/**
 * Что дописать в контакт Wazzup: только недостающее. Мультиполя без ID
 * Bitrix добавляет новой строкой, поэтому уже записанные телефон (8… и +7…
 * считаем одним номером), email и привязку мессенджера не передаём. Имя и
 * ответственного не трогаем — их ведут менеджеры.
 */
export function buildWazzupContactUpdate(
	data: ContactData,
	current: WazzupContactSnapshot,
	imol?: string,
): Record<string, unknown> {
	const phones = new Set((current.PHONE ?? []).map((p) => phoneKey(p.VALUE)));
	const emails = new Set((current.EMAIL ?? []).map((e) => emailKey(e.VALUE)));
	const ims = new Set((current.IM ?? []).map((im) => im.VALUE));
	const link = buildMessengerLinkFields(data, imol)?.IM.filter(
		(im) => !ims.has(im.VALUE),
	);
	return {
		...(!current.NAME?.trim() && data.name ? { NAME: data.name } : {}),
		...(data.phone && !phones.has(phoneKey(data.phone))
			? { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] }
			: {}),
		...(data.email && !emails.has(emailKey(data.email))
			? { EMAIL: [{ VALUE: data.email, VALUE_TYPE: "WORK" }] }
			: {}),
		...buildConsentFields(data),
		...(link?.length ? { IM: link } : {}),
	};
}

/** Дописывает данные из бота в контакт Wazzup; бросает, если Bitrix не сохранил. */
export async function updateWazzupContact(
	messenger: string,
	contactId: number,
	data: ContactData,
	imol?: string,
): Promise<void> {
	const current = contactSchema.parse(
		await bitrixPost<unknown>("crm.contact.get", { id: contactId }, messenger),
	);
	const fields = buildWazzupContactUpdate(data, current, imol);
	if (!Object.keys(fields).length) return;
	const updated = await bitrixPost<boolean>(
		"crm.contact.update",
		{ id: contactId, fields },
		messenger,
	);
	if (updated !== true)
		throw new Error(`Не удалось обновить контакт Wazzup ${contactId}`);
}

/**
 * Можно ли записать заявку в сделку Wazzup вместо новой. Нет, если в ней уже
 * наша строка «Бот:» (её заняла прошлая заявка клиента). Заявке со своей
 * воронкой (предзаказ книги) подходит сделка из этой воронки или ещё не
 * разобранная — разобранную менеджером сделку по другому продукту не уводим.
 */
export function canAdoptWazzupDeal(deal: WazzupDeal, data: DealData): boolean {
	if (/^Бот:/m.test(deal.comments)) return false;
	if (data.categoryId === undefined || deal.categoryId === data.categoryId)
		return true;
	return deal.categoryId === 0 && deal.stageId === UNSORTED_STAGE_ID;
}

/**
 * Записывает заявку в сделку Wazzup. Стадию, ответственного и контакты не
 * трогаем — сделку ведут менеджеры; воронку меняем, только если заявке нужна
 * своя (canAdoptWazzupDeal). Заметки менеджеров в «Комментарии» сохраняются
 * под нашими строками; название меняем, только если оно ещё от Wazzup.
 * null — не вышло: вызывающая сторона создаст новую сделку, чтобы заявка не
 * потерялась.
 */
export async function adoptWazzupDeal(
	deal: WazzupDeal,
	fields: Awaited<ReturnType<typeof buildDealFields>>,
	data: DealData,
	messenger: string,
): Promise<number | null> {
	const {
		ASSIGNED_BY_ID: _assignedBy,
		CONTACT_IDS: _contactIds,
		CATEGORY_ID: _categoryId,
		STAGE_ID: _stageId,
		TITLE,
		COMMENTS,
		...rest
	} = fields;
	try {
		if (data.categoryId !== undefined && deal.categoryId !== data.categoryId) {
			// CATEGORY_ID неизменяем в crm.deal.update — воронку меняет только
			// crm.item.update.
			await bitrixPost(
				"crm.item.update",
				{
					entityTypeId: DEAL_ENTITY_TYPE_ID,
					id: deal.id,
					fields: {
						categoryId: data.categoryId,
						...(data.stageId ? { stageId: data.stageId } : {}),
					},
				},
				messenger,
			);
		}
		await bitrixPost(
			"crm.deal.update",
			{
				id: deal.id,
				fields: {
					...rest,
					...(WAZZUP_DEFAULT_TITLE.test(deal.title) ? { TITLE } : {}),
					COMMENTS: [COMMENTS, deal.comments].filter(Boolean).join("\n\n"),
				},
			},
			messenger,
		);
		return deal.id;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось записать заявку в сделку Wazzup ${deal.id}, создаём новую: ${message}`,
		);
		return null;
	}
}
