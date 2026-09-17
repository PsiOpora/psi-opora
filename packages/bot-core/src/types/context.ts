import type { Context, SessionFlavor } from "grammy";
import type { BookPreorderState } from "../scenario/book-preorder/engine";
import type { ScenarioState } from "../scenario/engine";

export interface ConsultationSession {
	step: "name" | "phone" | "email" | "done";
	/** Состояние сценария (категория → тема → email → телефон → рассылка). */
	scenario?: ScenarioState;
	/** Состояние отдельного сценария предзаказа книги (см.
	 * scenario/book-preorder/engine.ts) — независимо от scenario выше. */
	bookPreorder?: BookPreorderState;
	consentGiven?: boolean;
	name?: string;
	phone?: string;
	phoneAttempts?: number;
	emailAttempts?: number;
	email?: string;
	campaign?: string;
	source?: string;
	/** ClientID Яндекс.Метрики визита, с которого пришёл клиент (см. extractYmClientId) —
	 * нужен, чтобы при создании сделки отправить в Метрику офлайн-конверсию
	 * «Запись на консультацию», привязанную к исходному рекламному визиту. */
	ymClientId?: string;
	/** Запасной идентификатор — id клика по объявлению Директа (см.
	 * extractYmClientId), на случай если ClientID не захватился. */
	yclid?: string;
}

export type AppContext = Context & SessionFlavor<ConsultationSession>;
