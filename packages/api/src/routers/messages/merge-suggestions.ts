import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
	type ClientIdentity,
	getBitrixCrmLink,
	getBotUserProfile,
	listBitrixCrmLinksByContactIds,
	listDismissedPartnerKeys,
	listGroupIdentities,
	resolveCanonicalIdentity,
} from "@psi-opora/db/queries";
import { jidFromPhone, phoneFromJid } from "@psi-opora/waha";
import { inboxMessengerSchema } from "../../schemas/messages";
import { normalizePhone } from "../../schemas/phone";
import {
	findContactIdsByPhone,
	parseContactPhones,
	type RawCrmContact,
} from "./client-phone-crm";
import { resolveDialogCrmBindings } from "./crm-contact";
import type { InboxMessenger, MergeSuggestion } from "./types";

const SUGGESTIONS_LIMIT = 3;
const PHONES_LIMIT = 5;
const CONTACTS_LIMIT = 10;

export function identityKey(identity: ClientIdentity): string {
	return `${identity.messenger}:${identity.userId}`;
}

interface Candidate {
	identity: ClientIdentity;
	reason: MergeSuggestion["reason"];
	phone: string | null;
}

/** Контакты CRM, привязанные к любому каналу группы; если привязок нет — контакт диалога Открытой линии. */
async function collectOwnContactIds(
	api: BitrixApi | null,
	memberId: string | null,
	messenger: InboxMessenger,
	userId: string,
	group: ClientIdentity[],
): Promise<Set<string>> {
	const ids = new Set<string>();
	for (const identity of group) {
		const link = await getBitrixCrmLink(
			identity.messenger,
			identity.userId,
		).catch(() => null);
		if (link) ids.add(link.contactId);
	}
	if (ids.size === 0 && api) {
		const bindings = await resolveDialogCrmBindings(
			api,
			memberId,
			messenger,
			userId,
		).catch(() => null);
		if (bindings?.contactId) ids.add(bindings.contactId);
	}
	return ids;
}

/** Телефоны клиента: из его контактов CRM и из JID личного WhatsApp (chatId = номер). */
async function collectPhones(
	api: BitrixApi | null,
	contactIds: Iterable<string>,
	group: ClientIdentity[],
): Promise<string[]> {
	const phones = new Set<string>();
	for (const identity of group) {
		if (identity.messenger !== "whatsapp-personal") continue;
		const phone = normalizePhone(phoneFromJid(identity.userId) ?? "");
		if (phone) phones.add(phone);
	}
	if (api) {
		for (const id of contactIds) {
			const raw = await api
				.call<RawCrmContact>("crm.contact.get", { id })
				.catch(() => null);
			for (const item of parseContactPhones(raw)) {
				const phone = normalizePhone(item.value);
				if (phone) phones.add(phone);
			}
		}
	}
	return [...phones].slice(0, PHONES_LIMIT);
}

/**
 * Каналы других клиентов, которые, судя по надёжным признакам, — тот же
 * человек: диалог привязан к тому же контакту CRM, у контакта с таким же
 * номером есть свой диалог, либо личный WhatsApp с этим номером. Совпадение по
 * имени/username намеренно не используется — ложная склейка раскрывает
 * переписку одного человека в карточке другого.
 */
async function collectCandidates(
	api: BitrixApi | null,
	ownContactIds: Set<string>,
	phones: string[],
): Promise<Candidate[]> {
	const contactReason = new Map<
		string,
		{ reason: Candidate["reason"]; phone: string | null }
	>();
	for (const id of ownContactIds) {
		contactReason.set(id, { reason: "same-contact", phone: null });
	}
	const candidates: Candidate[] = [];

	for (const phone of phones) {
		if (api) {
			const ids = await findContactIdsByPhone(api, phone).catch(() => []);
			for (const id of ids) {
				if (!contactReason.has(id)) {
					contactReason.set(id, { reason: "same-phone", phone });
				}
			}
		}
		const whatsapp = {
			messenger: "whatsapp-personal",
			userId: jidFromPhone(phone),
		};
		const profile = await getBotUserProfile(
			whatsapp.messenger,
			whatsapp.userId,
		).catch(() => null);
		if (profile) {
			candidates.push({ identity: whatsapp, reason: "same-phone", phone });
		}
	}

	const links = await listBitrixCrmLinksByContactIds(
		[...contactReason.keys()].slice(0, CONTACTS_LIMIT),
	).catch(() => []);
	for (const link of links) {
		const match = contactReason.get(link.contactId);
		if (!match) continue;
		candidates.push({
			identity: { messenger: link.messenger, userId: link.userId },
			...match,
		});
	}

	// Совпадение по контакту надёжнее совпадения по номеру — показываем первым.
	return candidates.sort(
		(a, b) =>
			Number(b.reason === "same-contact") - Number(a.reason === "same-contact"),
	);
}

/**
 * Возможные дубли клиента (messenger,userId) в других каналах — для подсказки
 * «объединить» в профиле. Без подключения к Bitrix работает только по привязкам
 * из нашей БД и номеру личного WhatsApp. Уже объединённые и отклонённые
 * оператором («это разные люди») пары отфильтровываются.
 */
export async function findMergeSuggestions(
	api: BitrixApi | null,
	memberId: string | null,
	messenger: InboxMessenger,
	userId: string,
): Promise<MergeSuggestion[]> {
	const group = await listGroupIdentities(messenger, userId);
	const groupKeys = new Set(group.map(identityKey));

	const ownContactIds = await collectOwnContactIds(
		api,
		memberId,
		messenger,
		userId,
		group,
	);
	const phones = await collectPhones(api, ownContactIds, group);
	if (ownContactIds.size === 0 && phones.length === 0) return [];

	const candidates = await collectCandidates(api, ownContactIds, phones);
	const dismissed = await listDismissedPartnerKeys([...groupKeys]).catch(
		() => new Set<string>(),
	);

	const suggestions: MergeSuggestion[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (suggestions.length >= SUGGESTIONS_LIMIT) break;
		const parsedMessenger = inboxMessengerSchema.safeParse(
			candidate.identity.messenger,
		);
		if (!parsedMessenger.success) continue;

		const canonical = await resolveCanonicalIdentity(
			candidate.identity.messenger,
			candidate.identity.userId,
		);
		const key = identityKey(canonical);
		if (groupKeys.has(key) || seen.has(key)) continue;
		seen.add(key);

		const candidateGroup = await listGroupIdentities(
			canonical.messenger,
			canonical.userId,
		);
		if (candidateGroup.some((i) => groupKeys.has(identityKey(i)))) continue;
		if (candidateGroup.some((i) => dismissed.has(identityKey(i)))) continue;

		const canonicalMessenger = inboxMessengerSchema.safeParse(
			canonical.messenger,
		);
		if (!canonicalMessenger.success) continue;
		const profile = await getBotUserProfile(
			canonical.messenger,
			canonical.userId,
		).catch(() => null);
		const fullName = [profile?.firstName, profile?.lastName]
			.filter(Boolean)
			.join(" ");
		suggestions.push({
			messenger: canonicalMessenger.data,
			userId: canonical.userId,
			name: profile?.name || fullName || profile?.username || canonical.userId,
			username: profile?.username ?? null,
			reason: candidate.reason,
			phone: candidate.phone,
		});
	}
	return suggestions;
}
