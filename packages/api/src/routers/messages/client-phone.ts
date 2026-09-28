import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
	getBotUserProfile,
	listAllBotMessagesForGroup,
	listGroupIdentities,
	resolveCanonicalIdentity,
	upsertBitrixCrmLink,
} from "@psi-opora/db/queries";
import { phoneFromJid } from "@psi-opora/waha";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import {
	extractPhones,
	normalizePhone,
	samePhone,
	setClientPhoneSchema,
} from "../../schemas/phone";
import {
	type CrmContactRef,
	contactDisplayName,
	findContactIdsByPhone,
	loadContactRefs,
	parseContactPhones,
	type RawCrmContact,
} from "./client-phone-crm";
import { resolveDialogCrmBindings } from "./crm-contact";
import { crmUrl, resolvePortalDomain } from "./crm-urls";
import type { InboxMessenger } from "./types";

export type { CrmContactRef };

export type SetClientPhoneResult =
	| {
			ok: true;
			/** added — номер дописан к контакту, updated — исправлен существующий,
			 * unchanged — такой номер у контакта уже был, linked — диалог привязан
			 * к контакту CRM с этим номером, created — заведён новый контакт. */
			outcome: "added" | "updated" | "unchanged" | "linked" | "created";
			phone: string;
			contact: CrmContactRef;
			/** Другие контакты CRM с тем же номером — повод объединить их в Bitrix. */
			duplicates: CrmContactRef[];
	  }
	| { ok: false; error: string }
	| {
			ok: false;
			/** У диалога нет контакта, а номер уже есть у этих контактов CRM —
			 * оператор выбирает: привязать (linkContactId) или создать (createNew). */
			conflict: CrmContactRef[];
	  };

export interface PhoneHint {
	phone: string;
	source: "whatsapp" | "message";
	/** Когда клиент прислал сообщение с номером (source="message"). */
	messageAt: string | null;
}

const HINTS_LIMIT = 5;
const CONFLICT_LIMIT = 3;

/** Контакт диалога: из CRM-привязок, либо через CONTACT_ID сделки. */
async function resolveContact(
	api: BitrixApi,
	memberId: string | null,
	messenger: InboxMessenger,
	userId: string,
): Promise<{ contactId: string | null; dealId: string | null }> {
	const bindings = await resolveDialogCrmBindings(
		api,
		memberId,
		messenger,
		userId,
	);
	if (bindings.contactId || !bindings.dealId) return bindings;
	const deal = await api
		.call<{ CONTACT_ID?: string | number | null }>("crm.deal.get", {
			id: bindings.dealId,
		})
		.catch(() => null);
	return {
		contactId: deal?.CONTACT_ID ? String(deal.CONTACT_ID) : null,
		dealId: bindings.dealId,
	};
}

/**
 * Телефон клиента в CRM — для случаев, когда клиент не оставил его боту:
 * номер пишется в мультиполе PHONE контакта Bitrix24, привязанного к диалогу.
 * Контакта нет — ищем в CRM контакт с этим номером (тот же человек уже
 * обращался другим путём) и по решению оператора привязываем диалог к нему,
 * иначе заводим новый. Связь диалог → контакт фиксируем в bitrix_crm_links,
 * чтобы панель CRM и бот (resolveKnownContact — больше не спросит телефон)
 * находили контакт без трекера Открытой линии.
 */
export const setClientPhone = bitrixProcedure
	.input(setClientPhoneSchema)
	.handler(async ({ input, context }): Promise<SetClientPhoneResult> => {
		const phone = normalizePhone(input.phone);
		if (!phone) return { ok: false, error: "Номер не похож на телефон" };

		const api = await context.getBitrixApi();
		if (!api) return { ok: false, error: "Нет подключения к Битрикс24" };

		const primary = await resolveCanonicalIdentity(
			input.messenger,
			input.userId,
		);
		const domain = await resolvePortalDomain(context.memberId);
		const link = (contactId: string, dealId?: string | null) =>
			upsertBitrixCrmLink({
				messenger: primary.messenger,
				userId: primary.userId,
				contactId,
				...(dealId ? { dealId } : {}),
			});
		const ref = (id: string, raw: RawCrmContact | null): CrmContactRef => ({
			id,
			name: contactDisplayName(raw, id),
			url: crmUrl(domain, "contact", id),
		});

		try {
			const { contactId, dealId } = await resolveContact(
				api,
				context.memberId,
				input.messenger,
				input.userId,
			);

			if (contactId) {
				const raw = await api.call<RawCrmContact>("crm.contact.get", {
					id: contactId,
				});
				const phones = parseContactPhones(raw);
				let outcome: "added" | "updated" | "unchanged" = "unchanged";

				if (input.replaceValueId) {
					const target = phones.find((p) => p.id === input.replaceValueId);
					if (!target) {
						return {
							ok: false,
							error: "Номер уже изменили в CRM — обновите карточку клиента",
						};
					}
					if (!samePhone(target.value, phone)) {
						await api.call("crm.contact.update", {
							id: contactId,
							fields: { PHONE: [{ ID: target.id, VALUE: phone }] },
						});
						outcome = "updated";
					}
				} else if (!phones.some((p) => samePhone(p.value, phone))) {
					// Значение без ID Bitrix дописывает к мультиполю, не затирая
					// уже сохранённые номера.
					await api.call("crm.contact.update", {
						id: contactId,
						fields: { PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }] },
					});
					outcome = "added";
				}

				await link(contactId, dealId);
				const otherIds = (
					await findContactIdsByPhone(api, phone).catch(() => [])
				)
					.filter((id) => id !== contactId)
					.slice(0, CONFLICT_LIMIT);
				return {
					ok: true,
					outcome,
					phone,
					contact: ref(contactId, raw),
					duplicates: await loadContactRefs(api, domain, otherIds),
				};
			}

			const existingIds = await findContactIdsByPhone(api, phone);

			if (input.linkContactId) {
				if (!existingIds.includes(input.linkContactId)) {
					return {
						ok: false,
						error: "У выбранного контакта в CRM нет этого номера",
					};
				}
				const [contact] = await loadContactRefs(api, domain, [
					input.linkContactId,
				]);
				await link(input.linkContactId);
				return {
					ok: true,
					outcome: "linked",
					phone,
					contact: contact ?? ref(input.linkContactId, null),
					duplicates: [],
				};
			}

			if (existingIds.length > 0 && !input.createNew) {
				return {
					ok: false,
					conflict: await loadContactRefs(
						api,
						domain,
						existingIds.slice(0, CONFLICT_LIMIT),
					),
				};
			}

			const profile = await getBotUserProfile(
				primary.messenger,
				primary.userId,
			);
			const fields = {
				NAME:
					profile?.firstName ||
					profile?.name ||
					profile?.username ||
					"Клиент без имени",
				...(profile?.firstName && profile.lastName
					? { LAST_NAME: profile.lastName }
					: {}),
				PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
				SOURCE_DESCRIPTION: `Инбокс «Клиенты»: ${primary.messenger}`,
			};
			const createdId = String(
				await api.call<number>("crm.contact.add", { fields }),
			);
			await link(createdId);
			return {
				ok: true,
				outcome: "created",
				phone,
				contact: ref(createdId, fields),
				duplicates: [],
			};
		} catch (err) {
			return {
				ok: false,
				error: `Не удалось сохранить телефон в CRM: ${(err as Error).message}`,
			};
		}
	});

/**
 * Подсказки для поля телефона — номера, которые уже «есть» в диалоге, но не
 * попали в CRM: номер личного WhatsApp клиента (его chatId) и телефоны,
 * которые клиент написал текстом в переписке (новые первыми).
 */
export const phoneHints = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input }): Promise<{ hints: PhoneHint[] }> => {
		const identities = await listGroupIdentities(input.messenger, input.userId);
		const hints = new Map<string, PhoneHint>();

		for (const identity of identities) {
			if (identity.messenger !== "whatsapp-personal") continue;
			const phone = normalizePhone(phoneFromJid(identity.userId) ?? "");
			if (phone)
				hints.set(phone, { phone, source: "whatsapp", messageAt: null });
		}

		const rows = await listAllBotMessagesForGroup(identities);
		for (const row of rows) {
			if (hints.size >= HINTS_LIMIT) break;
			if (row.direction !== "in" || !row.text) continue;
			for (const phone of extractPhones(row.text)) {
				if (hints.has(phone)) continue;
				hints.set(phone, {
					phone,
					source: "message",
					messageAt: row.createdAt.toISOString(),
				});
			}
		}

		return { hints: [...hints.values()].slice(0, HINTS_LIMIT) };
	});
