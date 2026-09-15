import { getBotConnector } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { bitrixDialogSchema } from "../../schemas/messages";
import { loadCrmLinks } from "./crm-links";
import type { CrmLinksResult, InboxMessenger } from "./types";

interface OpenLineDialog {
	entity_id?: string;
	entity_type?: string;
}

/**
 * Разбирает entity_id чата Открытой линии:
 * `{connector}|{line}|{externalChatId}|{externalUserId}`.
 */
function parseOpenLineEntityId(entityId: string | undefined): {
	connectorId: string;
	lineId: string;
	userId: string;
} | null {
	const [connectorId, lineId, , userId] = (entityId ?? "").split("|");
	if (!connectorId || !lineId || !userId) return null;
	return { connectorId, lineId, userId };
}

async function resolveBotMessenger(
	connectorId: string,
	lineId: string,
	memberId: string | null,
): Promise<InboxMessenger | null> {
	const candidates = await Promise.all(
		(["telegram", "max"] as const).map(async (messenger) => ({
			messenger,
			connector: await getBotConnector(messenger).catch(() => null),
		})),
	);

	const match = candidates.find(
		({ connector }) =>
			connector?.connectorId === connectorId &&
			connector.openLineId === lineId &&
			(!memberId || connector.memberId === memberId),
	);
	return match?.messenger ?? null;
}

/**
 * CRM-контекст для IM_SIDEBAR. Bitrix передаёт только dialogId, поэтому
 * сначала восстанавливаем внешний userId из диалога Открытой линии, затем
 * используем тот же источник истины bitrix_crm_links, что и единый инбокс.
 */
export const crmLinksByDialog = bitrixProcedure
	.input(bitrixDialogSchema)
	.handler(async ({ input, context }): Promise<CrmLinksResult> => {
		const empty: CrmLinksResult = { contact: null, lead: null, deals: [] };
		const api = await context.getBitrixApi();
		if (!api) return { ...empty, error: "Нет подключения к Битрикс24" };

		try {
			const dialog = await api.call<OpenLineDialog>("imopenlines.dialog.get", {
				DIALOG_ID: input.dialogId,
			});
			const entity = parseOpenLineEntityId(dialog?.entity_id);
			if (!entity || dialog?.entity_type !== "LINES") {
				return {
					...empty,
					error: "Этот чат не является диалогом нашей Открытой линии",
				};
			}

			const messenger = await resolveBotMessenger(
				entity.connectorId,
				entity.lineId,
				context.memberId,
			);
			if (!messenger) {
				return {
					...empty,
					error: "Чат не относится к подключённому боту Telegram или MAX",
				};
			}

			return await loadCrmLinks(
				api,
				context.memberId,
				messenger,
				entity.userId,
			);
		} catch (err) {
			return { ...empty, error: (err as Error).message };
		}
	});
