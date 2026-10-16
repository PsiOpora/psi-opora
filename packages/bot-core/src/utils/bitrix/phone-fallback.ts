import type { resolveOpenLineDialog } from "./openline";
import type { appendDealComment } from "./sources";

/**
 * Запасной путь, если бот не смог завести заявку: телефон, который клиент
 * оставил в сценарии, дописывается комментарием в сделку трекера Открытой
 * линии, а если сделки нет — в телефон связанного контакта.
 * Ошибки не пробрасываются: это уже обработка сбоя.
 *
 * @returns true, если запись телефона в CRM подтверждена
 */
export async function appendPhoneToDealComment(
	params: {
		messenger: string;
		userId?: number;
		chatId?: number;
		phone: string;
	},
	deps: {
		resolveDialog: typeof resolveOpenLineDialog;
		appendComment: typeof appendDealComment;
		updateContactPhone: (
			messenger: string,
			contactId: number,
			phone: string,
		) => Promise<boolean>;
	},
): Promise<boolean> {
	const { messenger, userId, chatId, phone } = params;
	if (!phone || !userId) return false;
	try {
		const dialog = await deps.resolveDialog(
			messenger,
			userId,
			chatId ?? userId,
		);
		if (!dialog?.dealId) {
			return dialog?.contactId
				? await deps.updateContactPhone(messenger, dialog.contactId, phone)
				: false;
		}
		return await deps.appendComment(
			messenger,
			dialog.dealId,
			`⚠️ Бот не смог сохранить заявку в CRM. Телефон клиента: ${phone}`,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[bitrix] не удалось записать телефон в CRM: ${message}`);
		return false;
	}
}
