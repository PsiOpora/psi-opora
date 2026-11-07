import {
	addClientNote,
	type ClientIdentityRef,
	listClientNotesForGroup,
	listGroupIdentities,
	markConversationRead,
	resolveCanonicalIdentity,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import {
	addWidgetNoteSchema,
	widgetNotesSchema,
} from "../../schemas/broadcast";
import type { ClientNoteItem } from "../messages/types";
import { resolveWidgetContact } from "./helpers";
import type { WidgetChannel } from "./types";

/** Диалог личного MAX лежит под ID чата, а не под телефоном (см. historyUserIds). */
function dialogUserId(channel: WidgetChannel): string {
	return channel.historyUserIds?.[0] ?? channel.userId;
}

/** Все identity контакта вместе со слитыми с ними каналами (см. merge.ts) —
 * без дублей. */
async function listContactIdentities(
	channels: WidgetChannel[],
): Promise<ClientIdentityRef[]> {
	const groups = await Promise.all(
		channels.flatMap((channel) =>
			[channel.userId, ...(channel.historyUserIds ?? [])].map((userId) =>
				listGroupIdentities(channel.messenger, userId),
			),
		),
	);
	const unique = new Map<string, ClientIdentityRef>();
	for (const identity of groups.flat()) {
		unique.set(`${identity.messenger}:${identity.userId}`, identity);
	}
	return [...unique.values()];
}

function toItem(row: {
	id: string;
	text: string;
	operatorId: string | null;
	operatorName: string | null;
	createdAt: Date;
}): ClientNoteItem {
	return {
		id: row.id,
		text: row.text,
		operatorId: row.operatorId,
		operatorName: row.operatorName,
		createdAt: row.createdAt.toISOString(),
	};
}

/** Внутренние заметки по контакту — клиенту не отправляются. Те же заметки
 * видны оператору в едином инбоксе «Клиенты». */
export const notes = bitrixProcedure
	.input(widgetNotesSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ notes?: ClientNoteItem[]; error?: string }> => {
			const resolved = await resolveWidgetContact(input, {
				memberId: context.memberId,
				getBitrixApi: () => context.getBitrixApi(),
			});
			if ("error" in resolved) return { error: resolved.error };

			const identities = await listContactIdentities(resolved.contact.channels);
			if (identities.length === 0) return { notes: [] };
			const rows = await listClientNotesForGroup(identities);
			return { notes: rows.map(toItem) };
		},
	);

/** Новая заметка пишется на канонического клиента первого канала контакта —
 * так она не расходится по слитым identity и видна и в инбоксе. */
export const addNote = bitrixProcedure
	.input(addWidgetNoteSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ note?: ClientNoteItem; error?: string }> => {
			const resolved = await resolveWidgetContact(input, {
				memberId: context.memberId,
				getBitrixApi: () => context.getBitrixApi(),
			});
			if ("error" in resolved) return { error: resolved.error };

			const channel = resolved.contact.channels[0];
			if (!channel) {
				return {
					error: "У контакта нет каналов связи — заметку не к чему привязать",
				};
			}
			const primary = await resolveCanonicalIdentity(
				channel.messenger,
				dialogUserId(channel),
			);
			const row = await addClientNote({
				messenger: primary.messenger,
				userId: primary.userId,
				text: input.text,
				operatorId: input.operatorId ?? context.bitrixSession.userId,
				operatorName: input.operatorName,
			});
			return row
				? { note: toItem(row) }
				: { error: "Не удалось сохранить заметку" };
		},
	);

/** Открытая вкладка = переписка просмотрена: сбрасываем счётчик непрочитанных
 * у всех identity контакта, чтобы бейдж в инбоксе не висел. */
export const markRead = bitrixProcedure
	.input(widgetNotesSchema)
	.handler(async ({ input, context }): Promise<{ ok: boolean }> => {
		const resolved = await resolveWidgetContact(input, {
			memberId: context.memberId,
			getBitrixApi: () => context.getBitrixApi(),
		});
		if ("error" in resolved) return { ok: false };

		const identities = await listContactIdentities(resolved.contact.channels);
		await Promise.all(
			identities.map((identity) =>
				markConversationRead(identity.messenger, identity.userId),
			),
		);
		return { ok: true };
	});
