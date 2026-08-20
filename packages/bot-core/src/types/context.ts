import type { Context, SessionFlavor } from "grammy";
import type { ScenarioState } from "../scenario/engine";

export interface ConsultationSession {
	step: "name" | "phone" | "email" | "done";
	/** Состояние сценария (категория → тема → email → телефон → рассылка). */
	scenario?: ScenarioState;
	consentGiven?: boolean;
	name?: string;
	phone?: string;
	phoneAttempts?: number;
	emailAttempts?: number;
	email?: string;
	campaign?: string;
	source?: string;
}

export type AppContext = Context & SessionFlavor<ConsultationSession>;
