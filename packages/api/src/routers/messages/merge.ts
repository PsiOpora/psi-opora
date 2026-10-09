import { resolveBitrixPortalKey } from "@psi-opora/bitrix-client";
import {
	dismissMergeSuggestion as dismissMergeSuggestionInDb,
	mergeClientIdentities,
	resolveCanonicalIdentity,
	unmergeClientIdentity,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import {
	clientThreadSchema,
	dismissMergeSuggestionSchema,
	mergeClientsSchema,
} from "../../schemas/messages";
import { findMergeSuggestions, identityKey } from "./merge-suggestions";
import type { InboxMessenger, MergeSuggestion } from "./types";

/** Объединяет канал (messenger,userId) с другим клиентом — см. client-identity-links.ts. */
export const mergeClients = bitrixProcedure
	.input(mergeClientsSchema)
	.handler(
		async ({
			input,
		}): Promise<{ primary: { messenger: InboxMessenger; userId: string } }> => {
			const primary = await mergeClientIdentities({
				messenger: input.messenger,
				userId: input.userId,
				intoMessenger: input.intoMessenger,
				intoUserId: input.intoUserId,
				operatorId: input.operatorId,
				operatorName: input.operatorName,
			});
			return {
				primary: {
					messenger: primary.messenger as InboxMessenger,
					userId: primary.userId,
				},
			};
		},
	);

/** Расцепляет ранее объединённый канал — он снова независимый клиент. */
export const unmergeClient = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input }): Promise<{ ok: true }> => {
		await unmergeClientIdentity(input.messenger, input.userId);
		return { ok: true };
	});

/**
 * Возможные дубли клиента в других каналах (тот же контакт CRM или номер
 * телефона) — подсказка «объединить» в профиле, см. merge-suggestions.ts.
 * Нет подключения к Bitrix24 — ищем только по нашей БД.
 */
export const mergeSuggestions = bitrixProcedure
	.input(clientThreadSchema)
	.handler(
		async ({ input, context }): Promise<{ suggestions: MergeSuggestion[] }> => {
			const api = await context.getBitrixApi().catch(() => null);
			return {
				suggestions: await findMergeSuggestions(
					api,
					context.memberId,
					await resolveBitrixPortalKey(context.memberId).catch(() => null),
					input.messenger,
					input.userId,
				),
			};
		},
	);

/** «Это разные люди» — подсказка слияния для этой пары больше не показывается. */
export const dismissMergeSuggestion = bitrixProcedure
	.input(dismissMergeSuggestionSchema)
	.handler(async ({ input }): Promise<{ ok: true }> => {
		const [own, other] = await Promise.all([
			resolveCanonicalIdentity(input.messenger, input.userId),
			resolveCanonicalIdentity(input.otherMessenger, input.otherUserId),
		]);
		await dismissMergeSuggestionInDb({
			keyA: identityKey(own),
			keyB: identityKey(other),
			operatorId: input.operatorId,
			operatorName: input.operatorName,
		});
		return { ok: true };
	});
