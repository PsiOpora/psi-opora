import { ORPCError } from "@orpc/server";
import { logger } from "@psi-opora/config";
import { getBotConnector } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import type { BotConnectorView } from "./types";

async function toView(
	messenger: "telegram" | "max",
): Promise<BotConnectorView | null> {
	const row = await getBotConnector(messenger);
	if (!row) return null;
	return {
		messenger,
		openLineId: row.openLineId,
		webhookConfigured: !!row.webhookConfiguredAt,
		hasToken: !!row.botTokenEncrypted,
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Статус обоих ботов — для карточек в настройках. */
export const status = publicProcedure.handler(
	async (): Promise<{
		telegram: BotConnectorView | null;
		max: BotConnectorView | null;
	}> => {
		try {
			const [telegram, max] = await Promise.all([
				toView("telegram"),
				toView("max"),
			]);
			return { telegram, max };
		} catch (err) {
			logger.error(
				"bot-connector.status: не удалось получить статус коннекторов из БД",
				err,
			);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"Не удалось получить статус коннекторов ботов (ошибка базы данных)",
			});
		}
	},
);
