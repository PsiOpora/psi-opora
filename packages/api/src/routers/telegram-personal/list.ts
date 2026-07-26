import { listTelegramPersonalAccounts } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import type { TelegramPersonalAccountView } from "./types";

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}···${phone.slice(-2)}`;
}

/** Список личных номеров Telegram, подключённых на этом портале (для карточки в настройках). */
export const list = publicProcedure.handler(
  async ({ context }): Promise<{ accounts: TelegramPersonalAccountView[] }> => {
    if (!context.memberId) return { accounts: [] };

    const rows = await listTelegramPersonalAccounts(context.memberId);
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
