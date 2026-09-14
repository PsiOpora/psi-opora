import {
	markBookPreorderAwaitingPayment,
	markBookPreorderDeclined,
	upsertBookPreorderOrder,
} from "@psi-opora/db/queries";
import {
	appendDealComment,
	BOOK_PREORDER_CATEGORY_ID,
	BOOK_PREORDER_STAGE_IDS,
	moveBookPreorderDealStage,
} from "../../utils/bitrix";
import { submitConsultationDeal } from "../../utils/consultation-deal";
import { logBotMessage } from "../../utils/message-log";
import { buildProdamusPaymentUrl } from "../../utils/prodamus";
import type { ScenarioTexts } from "../texts";
import { bpPaymentLinkMessage } from "./questions";
import {
	BOOK_PREORDER_PRICE_RUB,
	type BookPreorderMessage,
	type BookPreorderOutput,
} from "./types";

export interface BookPreorderDispatchDeps {
	messenger: string;
	sendMessage: (message: BookPreorderMessage) => Promise<void>;
	texts: ScenarioTexts;
	userName?: string;
	userId?: number;
	chatId?: number;
	source?: string;
	campaign?: string;
	ymClientId?: string;
}

function orderKey(messenger: string, userId: number): string {
	return `${messenger}:${userId}`;
}

/**
 * Исполняет результат шага сценария предзаказа книги: отправляет сообщения,
 * создаёт сделку/строку заказа, строит ссылку на оплату, двигает стадию
 * сделки. По образцу ../dispatch.ts (dispatchScenarioOutput), но без
 * трекинга в общую воронку дашборда — это отдельный, самостоятельный
 * сценарий с собственной отчётностью через book_preorder_orders/Bitrix.
 */
export async function dispatchBookPreorderOutput(
	out: BookPreorderOutput,
	deps: BookPreorderDispatchDeps,
): Promise<void> {
	for (const message of out.messages) {
		try {
			await deps.sendMessage(message);
		} catch (err) {
			await logBotMessage({
				messenger: deps.messenger,
				userId: deps.userId,
				direction: "out",
				source: "scenario",
				text: message.text,
				status: "failed",
			});
			throw err;
		}
		await logBotMessage({
			messenger: deps.messenger,
			userId: deps.userId,
			direction: "out",
			source: "scenario",
			text: message.text,
		});
	}

	if (deps.userId === undefined) return;
	const key = orderKey(deps.messenger, deps.userId);

	if (out.lead) {
		const name =
			out.lead.name?.trim() || deps.userName?.trim() || "Клиент из бота";
		const phoneNote = out.state.phoneSkipped ? "\n(телефон не получен)" : "";
		const comment =
			(out.lead.paymentChoice === "immediate"
				? "Заявка: Предзаказ книги — оплата сразу"
				: "Заявка: Предзаказ книги — бесплатная бронь") + phoneNote;

		const dealId = await submitConsultationDeal({
			name,
			phone: out.lead.phone ?? "",
			email: out.lead.email,
			messenger: deps.messenger,
			userId: deps.userId,
			chatId: deps.chatId,
			source: deps.source,
			campaign: deps.campaign,
			ymClientId: deps.ymClientId,
			comment,
			flow: "book_preorder",
			consentAt: out.lead.consentAt,
			// Воронка предзаказа книги отдельная от дефолтной — без явного
			// CATEGORY_ID/STAGE_ID сделка попала бы в общую воронку на стадию
			// "новая", минуя стадию "Бронь" (см. book-preorder-pipeline.ts).
			// buildDealFields сам про book_preorder ничего не знает — эти два
			// поля выбирает вызывающая сторона.
			categoryId: BOOK_PREORDER_CATEGORY_ID,
			stageId: BOOK_PREORDER_STAGE_IDS.reserved,
		});
		if (dealId) out.state.dealId = dealId;

		const order = await upsertBookPreorderOrder({
			messenger: deps.messenger,
			userId: String(deps.userId),
			chatId: deps.chatId !== undefined ? String(deps.chatId) : undefined,
			name,
			phone: out.lead.phone,
			email: out.lead.email,
			consentAt: out.lead.consentAt ? new Date(out.lead.consentAt) : undefined,
			dealId: dealId ?? undefined,
			paymentChoice: out.lead.paymentChoice,
			source: deps.source,
			campaign: deps.campaign,
			ymClientId: deps.ymClientId,
		});
		if (order) out.state.orderNo = order.orderNo;
	}

	if (out.buildPaymentLink && out.state.orderNo !== undefined) {
		await markBookPreorderAwaitingPayment(key, {
			email: out.state.email,
			dealId: out.state.dealId,
		});
		if (out.state.dealId) {
			await moveBookPreorderDealStage(
				deps.messenger,
				out.state.dealId,
				"awaitingPayment",
			);
		}
		const url = buildProdamusPaymentUrl({
			orderId: out.state.orderNo,
			phone: out.state.phone,
			email: out.state.email,
			sum: BOOK_PREORDER_PRICE_RUB,
		});
		const linkMessage = bpPaymentLinkMessage(
			url,
			BOOK_PREORDER_PRICE_RUB,
			deps.texts,
		);
		try {
			await deps.sendMessage(linkMessage);
			await logBotMessage({
				messenger: deps.messenger,
				userId: deps.userId,
				direction: "out",
				source: "scenario",
				text: linkMessage.text,
			});
		} catch (err) {
			await logBotMessage({
				messenger: deps.messenger,
				userId: deps.userId,
				direction: "out",
				source: "scenario",
				text: linkMessage.text,
				status: "failed",
			});
			throw err;
		}
		if (out.state.dealId) {
			await appendDealComment(
				deps.messenger,
				out.state.dealId,
				`💳 Ссылка на оплату отправлена клиенту: ${url}`,
			);
		}
	}

	if (out.manualPaymentCheck && out.state.dealId) {
		await appendDealComment(
			deps.messenger,
			out.state.dealId,
			"Клиент написал «оплатил» — автоматическое подтверждение ещё не пришло, нужно проверить вручную.",
		);
	}

	if (out.emailFailed && out.state.dealId) {
		await appendDealComment(
			deps.messenger,
			out.state.dealId,
			"Клиент не смог указать email для оплаты за несколько попыток — сценарий завершён, нужно дожать вручную.",
		);
	}

	if (out.cancelReservation) {
		await markBookPreorderDeclined(key);
		if (out.state.dealId) {
			await moveBookPreorderDealStage(
				deps.messenger,
				out.state.dealId,
				"declined",
			);
			await appendDealComment(
				deps.messenger,
				out.state.dealId,
				"Клиент отменил бронь.",
			);
		}
	}
}
