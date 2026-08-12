import {
	listWhatsappPersonalAccounts,
	setWhatsappPersonalAccountStateBySession,
} from "@psi-opora/db/queries";
import { wahaGetSession, wahaSessionHealth } from "@psi-opora/waha";
import { publicProcedure } from "../../orpc";
import type { WhatsappPersonalAccountView } from "./types";

function maskPhone(phone: string): string {
	if (phone.length <= 6) return phone;
	return `${phone.slice(0, 4)}···${phone.slice(-2)}`;
}

/** Список личных номеров WhatsApp, подключённых на этом портале (для карточки в настройках). */
export const list = publicProcedure.handler(
	async ({ context }): Promise<{ accounts: WhatsappPersonalAccountView[] }> => {
		if (!context.memberId) return { accounts: [] };

		const rows = await listWhatsappPersonalAccounts(context.memberId);
		const reconciled = await Promise.all(
			rows.map(async (row) => {
				try {
					const health = wahaSessionHealth(
						await wahaGetSession(row.sessionName),
					);
					if (row.status !== health.status || row.lastError !== health.error) {
						await setWhatsappPersonalAccountStateBySession(
							row.sessionName,
							health.status,
							health.error,
						);
					}
					return { ...row, status: health.status, lastError: health.error };
				} catch (err) {
					const error = `WAHA недоступна: ${(err as Error).message}`;
					await setWhatsappPersonalAccountStateBySession(
						row.sessionName,
						"error",
						error,
					).catch(() => {});
					return { ...row, status: "error", lastError: error };
				}
			}),
		);
		return {
			accounts: reconciled.map((row) => ({
				lineId: row.openLineId,
				connectorId: row.connectorId,
				phone: maskPhone(row.phone),
				status: row.status,
				lastError: row.lastError ?? undefined,
				updatedAt: row.updatedAt.toISOString(),
			})),
		};
	},
);
