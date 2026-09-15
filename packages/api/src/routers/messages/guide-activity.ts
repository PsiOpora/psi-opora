import { listClientGuideActivity } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import type { ClientGuideItem } from "./types";

/**
 * Что происходило с материалами (лид-магнитами) у этого клиента: выдача,
 * письмо, открытия, напоминание, заявка на диагностику. Оператору в карточке
 * важно видеть не только «бот обещал прислать», но и дошёл ли человек до
 * файла — по одной переписке это не понять.
 */
export const guideActivity = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input }): Promise<{ guides: ClientGuideItem[] }> => {
		const rows = await listClientGuideActivity(input.messenger, input.userId);
		return {
			guides: rows.map((row) => ({
				campaignId: row.campaignId,
				title: row.title ?? "Материал",
				deliveredAt: row.deliveredAt.toISOString(),
				email: row.email,
				emailSentAt: row.emailSentAt?.toISOString() ?? null,
				firstOpenedAt: row.firstOpenedAt?.toISOString() ?? null,
				lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
				openCount: row.openCount,
				followUpSentAt: row.followUpSentAt?.toISOString() ?? null,
				diagnosticRequestedAt: row.diagnosticRequestedAt?.toISOString() ?? null,
			})),
		};
	});
