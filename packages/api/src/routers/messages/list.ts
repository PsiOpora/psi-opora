import { resolveBitrixPortalKey } from "@psi-opora/bitrix-client";
import {
	listClientsWithLastMessage,
	upsertBotUser,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { listClientsSchema } from "../../schemas/messages";
import { type CrmContactRef, loadContactRefs } from "./client-phone-crm";
import { resolveCrmContactName } from "./crm-contact";
import { searchCrmIdentities } from "./crm-search";
import { resolvePortalDomain } from "./crm-urls";
import { type ClientListItem, createAvatarUrl } from "./types";

/** Сколько найденных в CRM контактов без диалога показываем под результатами поиска. */
const MAX_UNLINKED_CONTACTS = 5;

/**
 * Сколько строк без имени/username за один запрос пробуем обогатить именем
 * CRM-контакта — ограничение защищает время ответа и Bitrix API от нагрузки,
 * когда «безымянных» диалогов много. Остальные строки подхватятся на
 * следующих поллах списка (см. LIST_POLL_INTERVAL_MS в inbox-app.tsx).
 */
const MAX_CRM_NAME_LOOKUPS_PER_REQUEST = 5;

export const list = bitrixProcedure
	.input(listClientsSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ items: ClientListItem[]; crmContacts: CrmContactRef[] }> => {
			const api = await context.getBitrixApi();

			// Телефон и фамилия живут в CRM, а не в наших bot_users — по ним ищем
			// контакты в Bitrix и берём их привязанные диалоги. Сбой CRM не должен
			// ломать обычный поиск по имени.
			const portalKey = input.search?.trim()
				? await resolveBitrixPortalKey(context.memberId).catch(() => null)
				: null;
			const crm =
				api && portalKey && input.search
					? await searchCrmIdentities(api, portalKey, input.search).catch(
							() => null,
						)
					: null;

			const rows = await listClientsWithLastMessage({
				search: input.search,
				limit: input.limit,
				offset: input.offset,
				identities: crm?.identities,
			});

			let lookupsLeft = MAX_CRM_NAME_LOOKUPS_PER_REQUEST;

			const names = await Promise.all(
				rows.map(async (row) => {
					if (row.name || row.username) return row.name ?? row.username;
					if (!api || lookupsLeft <= 0) return null;
					lookupsLeft--;

					const messenger = row.messenger as ClientListItem["messenger"];
					const crmName = await resolveCrmContactName(
						api,
						context.memberId,
						messenger,
						row.userId,
					);
					if (crmName) {
						await upsertBotUser({
							messenger: row.messenger,
							userId: row.userId,
							name: crmName,
						}).catch(() => {});
					}
					return crmName;
				}),
			);

			// Контакты CRM, подошедшие под запрос, но не привязанные ни к одному
			// нашему диалогу (например, клиент писал только через Wazzup) — чтобы
			// оператор видел, что клиент в CRM есть, и мог открыть карточку.
			const crmContacts =
				api && crm && crm.unlinkedContactIds.length > 0
					? await loadContactRefs(
							api,
							await resolvePortalDomain(context.memberId),
							crm.unlinkedContactIds.slice(0, MAX_UNLINKED_CONTACTS),
						).catch(() => [])
					: [];

			return {
				crmContacts,
				items: rows.map((row, i) => ({
					messenger: row.messenger as ClientListItem["messenger"],
					userId: row.userId,
					name: names[i] ?? `${row.messenger}:${row.userId}`,
					username: row.username,
					avatarUrl: createAvatarUrl(row.messenger, row.userId, row.hasAvatar),
					lastMessageText: row.lastMessageText,
					lastMessageDirection: row.lastMessageDirection,
					lastMessageAt: row.lastMessageAt.toISOString(),
					unread: row.unread,
					unreadCount: row.unreadCount,
					assignedOperatorId: row.assignedOperatorId,
					assignedOperatorName: row.assignedOperatorName,
					tags: row.tags,
					linkedChannels:
						row.linkedChannels as ClientListItem["linkedChannels"],
				})),
			};
		},
	);
