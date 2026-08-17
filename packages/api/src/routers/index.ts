/**
 * Root Router
 *
 * The single entry-point for the entire oRPC API.
 * Add new domain routers here and they become available everywhere
 * (Next.js handler, RSC clients, type-safe hooks, etc.).
 *
 * Current route map:
 *
 *   user.*          – current user profile & account settings  (protected)
 *   post.list       – paginated list of posts                  (public)
 *   post.byId       – single post by UUID                      (public)
 *   post.create     – create a post                            (protected)
 *   post.delete     – delete a post                            (admin)
 *   admin.users.*   – user management                          (admin)
 *   admin.stats.*   – system-wide statistics                   (admin)
 */

import { adsRouter } from "./ads";
import { backupRouter } from "./backup";
import { botRouter } from "./bot";
import { botConnectorRouter } from "./bot-connector";
import { broadcastRouter } from "./broadcast";
import { costsRouter } from "./costs";
import { emailRouter } from "./email";
import { emailBroadcastRouter } from "./email-broadcast";
import { emailTemplatesRouter } from "./email-templates";
import { guideCampaignsRouter } from "./guide-campaigns";
import { maxPersonalRouter } from "./max-personal";
import { messagesRouter } from "./messages";
import { telegramPersonalRouter } from "./telegram-personal";
import { whatsappPersonalRouter } from "./whatsapp-personal";
import { widgetMessageRouter } from "./widget-message";

export {
	adsRouter,
	backupRouter,
	botConnectorRouter,
	botRouter,
	broadcastRouter,
	costsRouter,
	emailBroadcastRouter,
	emailRouter,
	emailTemplatesRouter,
	guideCampaignsRouter,
	maxPersonalRouter,
	messagesRouter,
	telegramPersonalRouter,
	whatsappPersonalRouter,
	widgetMessageRouter,
};
export const appRouter = {
	ads: adsRouter,
	backup: backupRouter,
	bot: botRouter,
	botConnector: botConnectorRouter,
	broadcast: broadcastRouter,
	costs: costsRouter,
	email: emailRouter,
	emailBroadcast: emailBroadcastRouter,
	emailTemplates: emailTemplatesRouter,
	guideCampaigns: guideCampaignsRouter,
	messages: messagesRouter,
	maxPersonal: maxPersonalRouter,
	telegramPersonal: telegramPersonalRouter,
	whatsappPersonal: whatsappPersonalRouter,
	widgetMessage: widgetMessageRouter,
};

export type AppRouter = typeof appRouter;
