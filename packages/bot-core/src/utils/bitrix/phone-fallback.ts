import type { resolveOpenLineDialog } from "./openline";
import type { appendDealComment } from "./sources";

/**
 * Запасной путь, если бот не смог завести заявку: телефон, который клиент
 * оставил в сценарии, дописывается комментарием в сделку трекера Открытой
 * линии (она уже есть по этому чату) — оператор увидит номер в таймлайне и
 * не потеряет клиента. Ошибки не пробрасываются: это уже обработка сбоя.
 *
 * @returns true, если комментарий отправлен в найденную сделку
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
		if (!dialog?.dealId) return false;
		await deps.appendComment(
			messenger,
			dialog.dealId,
			`⚠️ Бот не смог сохранить заявку в CRM. Телефон клиента: ${phone}`,
		);
		return true;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось записать телефон в сделку трекера: ${message}`,
		);
		return false;
	}
}
