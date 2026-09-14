/**
 * Сценарий предзаказа книги «Тело берёт своё» (psi-opora.ru/telo-beret-svoe/).
 * Независим от основного движка (../engine.ts): свои шаги, своя воронка
 * Bitrix, реальная оплата и многодневная рассылка — общего с флоу
 * консультации/гайда почти нет, см. пояснение в scenario/book-preorder/engine.ts.
 */

export const BOOK_PREORDER_ACTIONS = [
	"bp_consent_agree",
	"bp_reserve_free",
	"bp_pay_now",
	"bp_more_excerpt",
	"bp_question",
] as const;
export type BookPreorderAction = (typeof BOOK_PREORDER_ACTIONS)[number];

export function isBookPreorderAction(
	value: string,
): value is BookPreorderAction {
	return (BOOK_PREORDER_ACTIONS as readonly string[]).includes(value);
}

/**
 * Ветка, выбранная кнопкой на лендинге ещё до диалога (см.
 * matchesBookPreorderStartParam в utils/utm.ts): "pay" — «Оформить
 * предзаказ» (оплата сразу), "reserve" — «Забронировать» (бесплатная бронь).
 */
export type BookPreorderIntent = "pay" | "reserve";

/** Единый источник цен предзаказа — используется и при оплате сразу
 * (dispatch.ts), и в кнопках цепочки напоминаний (drip-actions.ts), чтобы
 * цена не могла разъехаться между двумя файлами. */
export const BOOK_PREORDER_PRICE_RUB = 1980;
export const BOOK_PREORDER_REGULAR_PRICE_RUB = 2480;

export type BookPreorderStep =
	| "consent"
	| "name"
	| "phone"
	| "about_book"
	| "reserved"
	| "email_for_payment"
	| "awaiting_payment"
	| "done";

export interface BookPreorderState {
	step: BookPreorderStep;
	name?: string;
	/** Имя длиннее 40 знаков/со ссылкой — переспросили один раз (см. S1 в ТЗ). */
	nameReasked?: boolean;
	phone?: string;
	phoneAttempts?: number;
	/** После 2 неудачных попыток идём дальше без телефона (см. S2 в ТЗ). */
	phoneSkipped?: boolean;
	email?: string;
	emailAttempts?: number;
	consentAt?: string;
	/** Сколько раз подряд повторили вопрос согласия на текст (максимум 3, см. S0). */
	nudged?: number;
	/** ID сделки Bitrix, созданной на шаге "Забронировать бесплатно" или
	 * "Оплатить сейчас" — переиспользуется при переходе бронь → оплата. */
	dealId?: number;
	/** Номер заказа (book_preorder_orders.orderNo) — показывается клиенту. */
	orderNo?: number;
	/** Источник рекламы из /start-ссылки (см. matchesBookPreorderStartParam). */
	source?: string;
	/** undefined — вход по голому /start TELO, обычный выбор внутри диалога
	 * (см. bpAboutBookQuestion в engine.ts). */
	intent?: BookPreorderIntent;
}

export interface BookPreorderButton {
	label: string;
	action: BookPreorderAction;
}

export interface BookPreorderMessage {
	text: string;
	buttons?: BookPreorderButton[][];
}

/** Заявка для передачи в Bitrix — на шагах "Забронировать" и "Оплатить сейчас". */
export interface BookPreorderLead {
	name?: string;
	phone?: string;
	email?: string;
	consentAt?: string;
	/** immediate — сразу выбрал оплату, deferred — сначала бесплатная бронь. */
	paymentChoice: "immediate" | "deferred";
}

export interface BookPreorderOutput {
	state: BookPreorderState;
	messages: BookPreorderMessage[];
	/** Заявка — создать сделку/строку заказа (см. dispatch.ts). Присутствует
	 * только в момент первого перехода в "reserved" или "email_for_payment". */
	lead?: BookPreorderLead;
	/** Email подтверждён на шаге оплаты — построить ссылку Prodamus и
	 * перевести сделку/заказ на стадию "Ждёт оплаты" (см. dispatch.ts). */
	buildPaymentLink?: boolean;
	/** Клиент написал "оплатил" — заказ уже существует, просто уведомляем
	 * менеджера проверить вручную (см. dispatch.ts). */
	manualPaymentCheck?: boolean;
	/** Клиент написал "отменить" на шаге брони — перевести заказ/сделку в отказ. */
	cancelReservation?: boolean;
	/** Email на шаге оплаты так и не удалось распознать за MAX_EMAIL_ATTEMPTS
	 * попыток — сценарий завершается, менеджеру уходит комментарий, если
	 * сделка уже существует (см. dispatch.ts). */
	emailFailed?: boolean;
	awaitingInput: boolean;
}
