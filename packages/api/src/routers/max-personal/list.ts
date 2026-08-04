import { listMaxPersonalAccounts } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import type { MaxPersonalAccountView } from "./types";

const maskPhone = (phone: string) =>
	phone.length <= 6 ? phone : `${phone.slice(0, 4)}···${phone.slice(-2)}`;

export const list = publicProcedure.handler(
	async ({ context }): Promise<{ accounts: MaxPersonalAccountView[] }> => {
		if (!context.memberId) return { accounts: [] };
		const rows = await listMaxPersonalAccounts(context.memberId);
		return {
			accounts: rows.map((row) => ({
				lineId: row.openLineId,
				connectorId: row.connectorId,
				phone: maskPhone(row.phone),
				status: row.status,
				updatedAt: row.updatedAt.toISOString(),
			})),
		};
	},
);
