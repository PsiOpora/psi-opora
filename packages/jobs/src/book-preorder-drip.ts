import {
	appendDealComment,
	buildProdamusPaymentUrl,
	getBookReadyDate,
	getScenarioTexts,
	type ScenarioTexts,
} from "@psi-opora/bot-core";
import {
	type BookPreorderOrder,
	insertBotMessage,
	listReservedBookPreorderOrders,
	recordBookPreorderDripStep,
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
const PREORDER_PRICE_RUB = 1980;
const REGULAR_PRICE_RUB = 2480;
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
 * шаг (может перескакивать через пропущенные, см. пояснение выше).
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
	if (dripStep < 1) return daysSinceReady >= 0 ? 1 : null;

	if (!dripDeferredAt) {
		if (dripStep < 2) return daysSinceReady >= 3 ? 2 : null;
		if (dripStep < 3) return daysSinceReady >= 6 ? 3 : null;
		if (dripStep < 4 && dripAnyClickAt && daysSinceReady >= 9) return 4;
	}

	if (dripStep < 5) return daysSinceReady >= PRICE_DEADLINE_DAY ? 5 : null;
	if (dripStep < 6) return daysSinceReady >= CLOSE_DAY ? 6 : null;
	return null;
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
	const payUrl = buildProdamusPaymentUrl({
		orderId: order.orderNo,
		phone: order.phone ?? undefined,
		email: order.email ?? undefined,
		sum: PREORDER_PRICE_RUB,
	});
	const payButton: MessengerButton = {
		text: t.bp_btn_drip_pay,
		payload: `bpd_pay:${order.orderNo}`,
	};

	switch (step) {
		case 1:
			return {
				text: render(t.bp_drip_1_text, { name, дата, ссылка: payUrl }),
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
				text: render(t.bp_drip_2_text, { name, дата, ссылка: payUrl }),
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
				text: render(t.bp_drip_3_text, { name, дата, ссылка: payUrl }),
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
				text: render(t.bp_drip_4_text, { name, ссылка: payUrl }),
				buttons: [[payButton]],
			};
		case 5:
			return {
				text: render(t.bp_drip_5_text, { name, ссылка: payUrl }),
				buttons: [[payButton]],
			};
		default: {
			const regularUrl = buildProdamusPaymentUrl({
				orderId: order.orderNo,
				phone: order.phone ?? undefined,
				email: order.email ?? undefined,
				sum: REGULAR_PRICE_RUB,
			});
			return {
				text: render(t.bp_drip_6_text, { name, ссылка: regularUrl }),
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
			await recordBookPreorderDripStep(order.id, step);
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
