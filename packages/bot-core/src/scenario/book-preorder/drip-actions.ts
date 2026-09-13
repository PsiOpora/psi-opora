import {
	getBookPreorderOrderByOrderNo,
	markBookPreorderDeclined,
	recordBookPreorderDripAnyClick,
	recordBookPreorderDripDeferred,
} from "@psi-opora/db/queries";
import {
	appendDealComment,
	moveBookPreorderDealStage,
} from "../../utils/bitrix";
import { buildProdamusPaymentUrl } from "../../utils/prodamus";
import type { ScenarioTexts } from "../texts";
import { bpPaymentLinkMessage } from "./questions";
import type { BookPreorderMessage } from "./types";

/**
 * Кнопки цепочки напоминаний Б1–Б6 (packages/jobs/src/book-preorder-drip.ts)
 * уходят спустя дни/недели после того, как истекла Redis-сессия сценария —
 * поэтому адресуются напрямую по номеру заказа в callback_data
 * (`bpd_<action>:<orderNo>`), а не через ScenarioState/BookPreorderState.
 * Обрабатывается отдельной веткой в bot.ts/max-bot без похода в сессию.
 */
export const DRIP_CALLBACK_ACTIONS = [
	"pay",
	"defer",
	"cancel",
	"buy2480",
	"notify_ebook",
	"stop",
] as const;
export type DripCallbackAction = (typeof DRIP_CALLBACK_ACTIONS)[number];

const DRIP_CALLBACK_RE =
	/^bpd_(pay|defer|cancel|buy2480|notify_ebook|stop):(\d+)$/;

export interface ParsedDripCallback {
	action: DripCallbackAction;
	orderNo: number;
}

export function parseDripCallback(data: string): ParsedDripCallback | null {
	const match = data.match(DRIP_CALLBACK_RE);
	if (!match) return null;
	return { action: match[1] as DripCallbackAction, orderNo: Number(match[2]) };
}

const REGULAR_PRICE_RUB = 2480;
const PREORDER_PRICE_RUB = 1980;

/**
 * Обрабатывает клик по кнопке напоминания — обновляет заказ/сделку в Bitrix
 * и возвращает ответное сообщение. null — заказ не найден (устаревшая
 * кнопка/чужой callback), вызывающая сторона молча игнорирует.
 */
export async function handleBookPreorderDripCallback(
	messenger: string,
	parsed: ParsedDripCallback,
	t: ScenarioTexts,
): Promise<BookPreorderMessage | null> {
	const order = await getBookPreorderOrderByOrderNo(parsed.orderNo);
	if (!order) return null;

	switch (parsed.action) {
		case "pay":
		case "buy2480": {
			await recordBookPreorderDripAnyClick(order.id);
			const sum =
				parsed.action === "buy2480" ? REGULAR_PRICE_RUB : PREORDER_PRICE_RUB;
			const url = buildProdamusPaymentUrl({
				orderId: order.orderNo,
				phone: order.phone ?? undefined,
				email: order.email ?? undefined,
				sum,
			});
			if (order.dealId) {
				await moveBookPreorderDealStage(
					messenger,
					order.dealId,
					"awaitingPayment",
				);
				await appendDealComment(
					messenger,
					order.dealId,
					`💳 Ссылка на оплату отправлена повторно (напоминание): ${url}`,
				);
			}
			return bpPaymentLinkMessage(url, t);
		}

		case "defer": {
			await recordBookPreorderDripAnyClick(order.id);
			await recordBookPreorderDripDeferred(order.id);
			return { text: t.bp_drip_defer_reply };
		}

		case "cancel": {
			await recordBookPreorderDripAnyClick(order.id);
			await markBookPreorderDeclined(order.id);
			if (order.dealId) {
				await moveBookPreorderDealStage(messenger, order.dealId, "declined");
				await appendDealComment(
					messenger,
					order.dealId,
					"Клиент отменил бронь.",
				);
			}
			return { text: t.bp_drip_cancel_reply };
		}

		case "notify_ebook": {
			if (order.dealId) {
				await appendDealComment(
					messenger,
					order.dealId,
					"Просит уведомить о выходе электронной версии книги.",
				);
			}
			return { text: t.bp_drip_defer_reply };
		}

		case "stop": {
			await markBookPreorderDeclined(order.id);
			if (order.dealId) {
				await moveBookPreorderDealStage(messenger, order.dealId, "declined");
				await appendDealComment(
					messenger,
					order.dealId,
					"Просит больше не писать про предзаказ.",
				);
			}
			return { text: t.bp_drip_stop_reply };
		}

		default:
			return null;
	}
}
