import type { Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";

export interface ConsultationSession {
  step: "name" | "phone" | "done";
  consentGiven?: boolean;
  name?: string;
  phone?: string;
  campaign?: string;
}

type SessionContext = Context & SessionFlavor<ConsultationSession>;
export type AppContext = ConversationFlavor<SessionContext>;
export type ConvContext = SessionContext;
