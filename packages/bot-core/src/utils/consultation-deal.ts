/**
 * Общая логика завершения воронки консультации:
 * создание сделки в Bitrix → трекинг шага "deal".
 *
 * Используется в TG и MAX ботах.
 */

import { getBotUserProfile } from "@psi-opora/db/queries";
import {
	type ContactData,
	createBitrixContact,
	createBitrixDeal,
	type DealData,
} from "./bitrix";
import { type FunnelEventContext, trackFunnelStep } from "./funnel";

export interface SubmitDealParams {
	name: string;
	phone: string;
	email?: string;
	messenger: string;
	userId?: number;
	/** Внешний ID чата (chat.id, который бот передаёт в imconnector.send.messages) —
	 * для Telegram это ctx.chatId, для MAX — тот же userId (см. bot.ts). */
	chatId?: number;
	source?: string;
	campaign?: string;
	/** Комментарий к сделке (например, выбранные в сценарии категория и тема). */
	comment?: string;
	/** Ветка сценария — попадает в заголовок сделки и «Продукт» в Bitrix. */
	flow?: DealData["flow"];
	audience?: DealData["audience"];
	issue?: DealData["issue"];
}

export interface SubmitContactParams extends Omit<ContactData, "name"> {
	name?: string;
}

/** Сохраняет email-контакт в CRM, не создавая сделку до завершения сценария. */
export async function submitBitrixContact(
	params: SubmitContactParams,
): Promise<number | null> {
	try {
		const contactId = await createBitrixContact({
			...params,
			name: params.name?.trim() || "Клиент из бота",
			consentGranted: params.consentGranted ?? true,
		});
		return contactId || null;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] ошибка создания контакта (${params.messenger}): ${message}`,
		);
		return null;
	}
}

/**
 * Создаёт сделку в Bitrix24 и трекает шаг "deal" в воронке.
 * Ошибки Bitrix не пробрасываются — логируются и поглощаются,
 * чтобы не ломать диалог с клиентом.
 *
 * @returns ID созданной сделки, null при ошибке или отключённом Bitrix
 */
export async function submitConsultationDeal(
	params: SubmitDealParams,
): Promise<number | null> {
	const {
		name,
		phone,
		email,
		messenger,
		userId,
		chatId,
		source,
		campaign,
		comment,
		flow,
		audience,
		issue,
	} = params;

	const funnelCtx: FunnelEventContext = { messenger, source, campaign, userId };

	try {
		// Профиль мессенджера (bot_users), собранный ботом на /start —
		// добавляем в карточку контакта для оператора. Не критично для сделки.
		let username: string | undefined;
		let languageCode: string | undefined;
		let isPremium: boolean | undefined;
		let bio: string | undefined;
		if (userId) {
			try {
				const profile = await getBotUserProfile(messenger, String(userId));
				username = profile?.username ?? undefined;
				languageCode = profile?.languageCode ?? undefined;
				isPremium = profile?.isPremium ?? undefined;
				bio = profile?.bio ?? undefined;
			} catch (err) {
				console.error(
					`[deal] не удалось получить профиль пользователя ${userId}: ${(err as Error).message}`,
				);
			}
		}

		const dealData: DealData = {
			name,
			phone,
			consentGranted: true,
			...(email ? { email } : {}),
			campaign,
			source,
			telegramUserId: userId,
			messenger,
			...(comment ? { comment } : {}),
			...(flow ? { flow } : {}),
			...(audience ? { audience } : {}),
			...(issue ? { issue } : {}),
			...(chatId !== undefined ? { chatId } : {}),
			...(username ? { username } : {}),
			...(languageCode ? { languageCode } : {}),
			...(isPremium !== undefined ? { isPremium } : {}),
			...(bio ? { bio } : {}),
		};

		const { dealId } = await createBitrixDeal(dealData);
		await trackFunnelStep("deal", funnelCtx);
		return dealId || null;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[bitrix] ошибка создания сделки (${messenger}): ${message}`);
		return null;
	}
}
