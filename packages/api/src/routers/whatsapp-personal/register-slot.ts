import { publicProcedure } from "../../orpc";
import { generateConnectorId } from "./helpers";

/**
 * Генерирует ID нового коннектора-слота для ещё одного личного номера
 * WhatsApp — дальше карточка настроек (wa-personal-connector-card.tsx)
 * сама регистрирует его через imconnector.register (нужен контекст
 * приложения из браузера) и просит администратора добавить канал на
 * нужной линии в Контакт-центре.
 */
export const registerSlot = publicProcedure.handler(
	async ({ context }): Promise<{ connectorId?: string; error?: string }> => {
		if (!context.memberId) {
			return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
		}
		return { connectorId: generateConnectorId() };
	},
);
