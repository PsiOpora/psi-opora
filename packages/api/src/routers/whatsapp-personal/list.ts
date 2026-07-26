import { listWhatsappPersonalAccounts } from "@psi-opora/db/queries";
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
