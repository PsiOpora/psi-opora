import {
	appendDealComment,
	getBookReadyDate,
	getScenarioTexts,
	type ScenarioTexts,
} from "@psi-opora/bot-core";
import {
	type BookPreorderOrder,
	finalizeBookPreorderDripStep,
	insertBotMessage,
	listReservedBookPreorderOrders,
	releaseBookPreorderDripStep,
	reserveBookPreorderDripStep,
} from "@psi-opora/db/queries";
import {
	type Messenger,
	type MessengerButton,
	sendMessengerMessage,
} from "./messenger";

/**
 * Напоминания о предзаказе книги «Тело берёт своё», когда тираж готов —
 * Б1–Б6 (см. книгу-предзаказ ТЗ). Отсчёт от bot_texts.book_ready_date
 * (см. scripts/set-book-ready-date.ts), раз в три дня, с уступками для тех,
 * кто нажал «Не сейчас» (пропускаем Б2–Б4) или вообще не отвечал на Б1–Б3
 * (пропускаем только Б4) — см. computeDueDripStep.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_DEADLINE_DAY = 10;
const CLOSE_DAY = 11;

export interface SendBookPreorderDripResult {
	sent: number;
	errors: number;
}

function daysSince(bookReadyDate: Date, now: Date): number {
	return Math.floor((now.getTime() - bookReadyDate.getTime()) / DAY_MS);
}

/**
 * Следующий Б-шаг, который пора отправить, или null — рано либо уже
 * отправлено всё, что положено. dripStep — последний реально отправленный
 * шаг. Считаем наивысший шаг, для которого уже настало время (по
 * daysSinceReady), а не следующий по порядку — иначе после простоя джобы
 * (например, кроном на несколько дней) hourly-запуски досылали бы все
 * пропущенные шаги по одному за раз вместо того, чтобы сразу перескочить на
 * актуальный.
 */
export function computeDueDripStep(
	order: Pick<
		BookPreorderOrder,
		"dripStep" | "dripDeferredAt" | "dripAnyClickAt"
	>,
	daysSinceReady: number,
): number | null {
	const { dripStep, dripDeferredAt, dripAnyClickAt } = order;
	if (dripStep >= 6) return null;

	let due = 0;
	if (daysSinceReady >= 0) due = 1;
	if (!dripDeferredAt) {
		if (daysSinceReady >= 3) due = 2;
		if (daysSinceReady >= 6) due = 3;
		if (dripAnyClickAt && daysSinceReady >= 9) due = 4;
	}
	if (daysSinceReady >= PRICE_DEADLINE_DAY) due = 5;
	if (daysSinceReady >= CLOSE_DAY) due = 6;

	return due > dripStep ? due : null;
}

function formatRuDate(date: Date): string {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		day: "numeric",
		month: "long",
	}).format(date);
}

function render(template: string, vars: Record<string, string>): string {
	let text = template;
	for (const [key, value] of Object.entries(vars)) {
		text = text.replaceAll(`{${key}}`, value);
	}
	return text;
}

function buildStepMessage(
	step: number,
	order: BookPreorderOrder,
	priceDeadline: Date,
	t: ScenarioTexts,
): { text: string; buttons?: MessengerButton[][] } {
	const name = order.name?.trim() || "друг";
	const дата = formatRuDate(priceDeadline);
	const payButton: MessengerButton = {
		text: t.bp_btn_drip_pay,
		payload: `bpd_pay:${order.orderNo}`,
	};

	switch (step) {
		case 1:
			return {
				text: render(t.bp_drip_1_text, { name, дата }),
				buttons: [
					[payButton],
					[
						{
							text: t.bp_btn_drip_defer,
							payload: `bpd_defer:${order.orderNo}`,
						},
					],
					[
						{
							text: t.bp_btn_drip_cancel,
							payload: `bpd_cancel:${order.orderNo}`,
						},
					],
				],
			};
		case 2:
			return {
				text: render(t.bp_drip_2_text, { name, дата }),
				buttons: [
					[payButton],
					[
						{
							text: t.bp_btn_drip_defer,
							payload: `bpd_defer:${order.orderNo}`,
						},
					],
				],
			};
		case 3:
			return {
				text: render(t.bp_drip_3_text, { name, дата }),
				buttons: [
					[payButton],
					[
						{
							text: t.bp_btn_drip_defer,
							payload: `bpd_defer:${order.orderNo}`,
						},
					],
				],
			};
		case 4:
			return {
				text: render(t.bp_drip_4_text, { name }),
				buttons: [[payButton]],
			};
		case 5:
			return {
				text: render(t.bp_drip_5_text, { name }),
				buttons: [[payButton]],
			};
		default: {
			return {
				text: render(t.bp_drip_6_text, { name }),
				buttons: [
					[
						{
							text: t.bp_btn_drip_buy_2480,
							payload: `bpd_buy2480:${order.orderNo}`,
						},
					],
					[
						{
							text: t.bp_btn_drip_notify_ebook,
							payload: `bpd_notify_ebook:${order.orderNo}`,
						},
					],
					[{ text: t.bp_btn_drip_stop, payload: `bpd_stop:${order.orderNo}` }],
				],
			};
		}
	}
}

export async function sendBookPreorderDrip(): Promise<SendBookPreorderDripResult> {
	const bookReadyDate = await getBookReadyDate();
	if (!bookReadyDate) return { sent: 0, errors: 0 };

	const now = new Date();
	const daysSinceReady = daysSince(bookReadyDate, now);
	if (daysSinceReady < 0) return { sent: 0, errors: 0 };

	const priceDeadline = new Date(
		bookReadyDate.getTime() + PRICE_DEADLINE_DAY * DAY_MS,
	);
	const orders = await listReservedBookPreorderOrders();
	const t = await getScenarioTexts();

	let sent = 0;
	let errors = 0;

	for (const order of orders) {
		const step = computeDueDripStep(order, daysSinceReady);
		if (!step) continue;

		// Бронируем шаг до отправки — если параллельный запуск джобы уже забрал
		// этот же шаг для заказа (CAS по dripStep), пропускаем без повторной
		// отправки. См. reserveBookPreorderDripStep.
		const claimed = await reserveBookPreorderDripStep(
			order.id,
			order.dripStep,
			step,
		);
		if (!claimed) continue;

		const messenger = order.messenger as Messenger;
		const message = buildStepMessage(step, order, priceDeadline, t);
		try {
			const externalId = await sendMessengerMessage(
				messenger,
				order.userId,
				message.text,
				message.buttons,
			);
			await insertBotMessage({
				messenger,
				userId: order.userId,
				direction: "out",
				source: "reminder",
				text: message.text,
				status: "sent",
				externalId,
			});
			await finalizeBookPreorderDripStep(order.id, step);
			if (order.dealId) {
				await appendDealComment(
					messenger,
					order.dealId,
					`🔔 Отправлено напоминание о предзаказе (Б${step}).`,
				);
			}
			sent++;
		} catch (err) {
			errors++;
			// Снимаем бронь — иначе шаг больше никогда не будет due (dripStep уже
			// продвинут) и клиент молча не получит ни это напоминание, ни
			// следующие по цепочке.
			await releaseBookPreorderDripStep(order.id, step, order.dripStep);
			await insertBotMessage({
				messenger,
				userId: order.userId,
				direction: "out",
				source: "reminder",
				text: message.text,
				status: "failed",
			});
			console.error(
				`[book-preorder-drip] order=${order.id} step=${step}: ${(err as Error).message}`,
			);
		}
	}

	return { sent, errors };
}
